import { NextRequest, NextResponse } from "next/server";
import { refreshScreenerFundamentals } from "../../../../lib/server/screenerFundamentals";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
import {
  readPricePoolBulk,
  readPricePoolSessionHealth,
} from "../../../../lib/server/pricePool";
import { deregisterSymbols } from "../../../../lib/server/stalenessQueue";
import {
  readNewestBarStamps,
  weekdaysBehindEastern,
} from "../../../../lib/server/historyCache";
import {
  recordAbsence,
  clearAbsence,
  evictionAction,
  claimPresetHandEditAlarm,
  evictSymbol,
  poolLooksDegraded,
  readStaleBarDays,
  writeStaleBarDays,
  mergeStaleBarDay,
  staleBarEvictionAction,
  secListingEvictionAction,
  EVICTION_MIN_FAIL_STREAK,
  EVICTION_STALE_BAR_WEEKDAYS,
} from "../../../../lib/server/symbolEviction";
import { resolveTickerMap } from "../../../../lib/server/secTickerMap";
import { secUnlistedSymbols } from "../../../../lib/server/secListing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One FMP call plus one Redis pipeline. Nothing here waits on capacity the way
// warm-fundamentals does, so it does not need that route's 300s.
export const maxDuration = 60;

/** A deliberate stop with its reason already recorded, not a fault. */
class SweepSkipped extends Error {}

// Daily cron (see vercel.json), deliberately scheduled BEFORE warm-fundamentals
// so that job finds a freshly populated screener-fundamentals cache rather than
// an expired one.
//
// ─────────────────────────────────────────────────────────────────────────────
// AND AFTER warm-picker-universe, WHICH IS WHY IT MOVED 06:50 -> 07:50.
//
// THE DIAGNOSIS THIS CORRECTS, twice. The sweep logged `barStampsRead 0` on
// 2026-09-05 and that was first read as "the stale-bar signal is inert". It was
// then re-read as a TTL race with a twelve-minute margin. BOTH ARE WRONG, and
// the second one is wrong in a checkable way: the stamp hash carries NO TTL at
// all (historyCache.ts, "The fields carry no TTL of their own"), so there is no
// expiry to race. The 09-05 zero was the deploy-day artifact -- #417 merged at
// 09:38 on 09-04, after that day's 07:02 producer run, so the first stamps were
// written at 07:02 on 09-05, twelve minutes AFTER the 06:50 sweep that read
// none. Once, by construction, not intermittently.
//
// THE TWELVE MINUTES ARE REAL, AND THEY ARE SOMEWHERE ELSE. The binding
// constraint is EVICTION_BAR_STAMP_MAX_AGE_MS (48h), the observation-age guard
// in symbolEviction. At 06:50 the sweep consumed stamps written at 07:02 the
// PREVIOUS day -- 23h48m old, fine. But one missed producer run makes them
// 47h48m old: TWELVE MINUTES INSIDE THE 48-HOUR GUARD. A single failed picker
// build, on any day, and the stale-bar signal silently disappears -- and
// `staleBarred: 0` against a blind reader is exactly the reading this signal's
// `barStampsRead` denominator exists to make impossible.
//
// AT 07:50 the stamps are ~48 MINUTES old on a normal day and ~24h48m after one
// missed producer run, so the signal survives a missed run instead of nearly
// dying on one. Two consecutive missed runs still correctly blind it, which is
// the behaviour the guard is for.
//
// THE ORDER IS AN INVARIANT, NOT A COINCIDENCE OF TWO CRON STRINGS, and
// scripts/check-bar-stamp-ordering.mjs asserts it by RUNNING the arithmetic
// over vercel.json and EVICTION_BAR_STAMP_MAX_AGE_MS -- so moving either cron
// back fails the build rather than quietly restoring the twelve minutes.
//
// The warm-fundamentals constraint above still holds: it runs hourly at :22, so
// 07:50 still lands before one (08:22) with a 30h screener TTL that never
// expires in between either way.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY IT EXISTS AS ITS OWN JOB. One company-screener call carries
// marketCap/sector/industry for ~1000 symbols, and caching it is what lets
// warmFundamentals skip a per-symbol `profile` fetch for most of the universe.
// That refresh used to happen ONLY as a side effect of a master-list rebuild
// inside /api/market -- a route nothing calls on a schedule. Measured
// 2026-08-22: no /api/market request in 24h, and warm-fundamentals reported
// `screenerCovered: 0` for all 755 symbols. The free industry source had
// drained past its 30h TTL with nothing to rewrite it, so every symbol fell
// through to the profile fetch, metered at 120 a day.
//
// This is the biggest lever on industry/sector coverage and it costs one FMP
// call a day.
function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshScreenerFundamentals(process.env.FMP_API_KEY);

  // Logged as well as returned: the cron invokes this and discards the body, so
  // without this line the run's coverage is invisible in Vercel logs. Same
  // reasoning as warm-fundamentals.
  //
  // `symbols` is dropped from both the log and the response -- it is ~1000
  // tickers and the count is the part anyone reads.
  const { symbols, ...summary } = result;
  const payload = { ...summary, symbolsReturned: symbols.length };
  console.log("[warm-screener-fundamentals]", JSON.stringify(payload));
  // ─────────────────────────────────────────────────────────────────────────
  // DELISTING SWEEP. Runs here because this is the job that already holds the
  // screener response -- the signal is free, and putting it anywhere else means
  // a second call to learn the same thing.
  //
  // Only on a SUCCESSFUL screener read. A failed one returns no symbols, which
  // would read as "the entire universe is absent" and start corroboration
  // against every symbol at once. Absence is only evidence when there was
  // something to be absent from.
  let sweepUniverse: string[] | null = null;
  const sweep = {
    absent: 0,
    // THE THIRD SIGNAL, COUNTED SEPARATELY AND NEVER FOLDED IN. `absentAndFailing: 0`
    // was informative precisely because it named its condition; a single
    // "candidates" number would make "nothing is dead" and "the metadata signal
    // is blind again" the same reading, which is the whole reason this signal
    // exists.
    staleBarred: 0,
    // The denominator for the one above, and the blindness detector. 0 stamps
    // read means warm-picker-universe has not flushed any -- so `staleBarred: 0`
    // says nothing at all, exactly as `quarterlyRefreshes: 0` said nothing
    // before #416 gave it `quarterlyStamped`.
    barStampsRead: 0,
    evicted: [] as string[],
    // WHICH SIGNAL FIRED, for the destructive half. The counts above are about
    // detection; this is about what was actually deleted and on whose evidence.
    evictedByAbsence: 0,
    evictedByStaleBars: 0,
    // TALLIED FROM WHAT evictSymbol ACTUALLY DID, not aliased off the two
    // counts above. See the note on its return type: a preset reaching that
    // function is evicted and NOT tombstoned, and a Redis failure after the
    // deletes does the same -- so an alias over-reports in precisely the cases
    // the record is consulted for.
    tombstonedByAbsence: 0,
    tombstonedByStaleBars: 0,
    presetHandEdit: [] as string[],
    skipped: null as string | null,
    // THE FOURTH SIGNAL (secListing.ts): absent from SEC's live ticker file.
    // Its own skip reason, because it runs when the three above cannot.
    secUnlisted: [] as string[],
    evictedBySecListing: 0,
    tombstonedBySecListing: 0,
    secSkipped: null as string | null,
  };
  if (!result.ok || !result.symbols.length) {
    sweep.skipped = "screener-unavailable";
  } else {
    try {
      const present = new Set(result.symbols);

      // THE UNIVERSE READ IS AN OUTBOUND HTTP CALL TO THIS SITE, from inside a
      // cron. getWarmTargetSymbols self-fetches /api/market on a cold cache,
      // and the firewall runs Bot Protection at ~1.3k challenges/day -- a
      // challenged self-fetch means the sweep silently never runs, and
      // `absentAndFailing: 0` reads identical to "looked and found nothing".
      // Distinguished rather than swallowed.
      const { symbols: universe } = await getWarmTargetSymbols(
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com"
      );
      sweepUniverse = universe;
      if (!universe.length) {
        sweep.skipped = "universe-unavailable";
        throw new SweepSkipped();
      }

      // DO NOT SWEEP ON A DAY THE LAST SESSION WAS DEGRADED. The streak
      // evidence this rule stands on is written by warm-price-pool, so a
      // session full of refusals or wholesale deferrals means today's streaks
      // describe FMP, not the tickers.
      //
      // The SESSION-HEALTH key, not the job record: this cron runs at 06:50 UTC
      // = 02:50 ET, when warm-price-pool's last run is always a market-closed
      // skip carrying none of the fields this tests. See pricePool.ts.
      //
      // Read AFTER the universe so `universeSize` is real. That costs a
      // self-fetch on a degraded day, which is the cheaper mistake: sizing the
      // deferral share against a guess is how the previous version came to
      // compare against a field the record did not carry.
      const degraded = poolLooksDegraded(
        await readPricePoolSessionHealth(),
        universe.length
      );
      if (degraded) {
        sweep.skipped = `pool-degraded:${degraded}`;
        throw new SweepSkipped();
      }

      const missing = universe.filter((s) => !present.has(s));
      // Reappearing clears the evidence: the rule is "absent on N days
      // recently", not "absent on N days ever".
      await clearAbsence(universe.filter((s) => present.has(s)));

      // The second signal. A symbol below the market-cap cut-off is absent
      // every day and quotes perfectly well; a delisted one does not quote at
      // all. Without this half, absence alone would evict the whole tail.
      const pool = await readPricePoolBulk(missing);
      const nowMs = Date.now();
      for (const symbol of missing) {
        const row = pool.get(symbol);
        const failStreak = row?.failStreak ?? 0;
        if (failStreak < EVICTION_MIN_FAIL_STREAK) continue;
        const days = await recordAbsence(symbol);
        sweep.absent++;
        const action = evictionAction(symbol, days, failStreak, row?.failAt, nowMs);
        if (action === "hand-edit") {
          // A CURATED SYMBOL MET EVERY EVICTION CONDITION. Evicting it would
          // delete its caches and change nothing: PRESET_UNIVERSE is an array
          // in the bundle, so the next pickers build puts the ticker straight
          // back. See symbolEviction.ts -- this is the loop, replaced by a
          // message to a person.
          sweep.presetHandEdit.push(symbol);
          // ERROR, NOT WARN. Every other line this job emits is routine; this
          // one is the only one asking somebody to change a file, and it
          // arrives at most once a month per symbol so the level costs nothing.
          if (await claimPresetHandEditAlarm(symbol)) {
            console.error(
              `[screener-fundamentals] PRESET UNIVERSE NEEDS A HAND EDIT: ${symbol} ` +
                `has been absent from the screener for ${days} day(s) and is failing ` +
                `quotes (streak ${failStreak}). It cannot be evicted -- it is hardcoded ` +
                `in lib/server/presetUniverse.ts. Check whether it was renamed, ` +
                `acquired or delisted, then edit that array and redeploy.`
            );
          }
          continue;
        }
        if (action === "evict") {
          const evicted = await evictSymbol(symbol);
          sweep.evicted.push(symbol);
          sweep.evictedByAbsence++;
          if (evicted.tombstoned) sweep.tombstonedByAbsence++;
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // THE THIRD SIGNAL. Independent of FMP's metadata, which is the point:
      // both rules above ask FMP whether the symbol is alive, and probe Q5
      // measured FMP still answering `isActivelyTrading: true` for FB years
      // after it became META. A symbol that has not printed a daily bar in a
      // quarter is dead whatever that flag says.
      //
      // Runs AFTER the absence pass and skips anything it already handled, so a
      // symbol carrying all three signals is evicted once and attributed to the
      // route that found it first.
      //
      // Reads two hashes: the bar observations warm-picker-universe flushed at
      // 07:02 yesterday, and this route's own day evidence. Deliberately not
      // ~760 reads of msh:history:v7:<SYM> -- see historyCache's note.
      const stamps = await readNewestBarStamps();
      sweep.barStampsRead = stamps.size;
      const staleDayEvidence = await readStaleBarDays(nowMs);
      const handled = new Set([...sweep.evicted, ...sweep.presetHandEdit]);
      const staleUpdates: Record<string, string[]> = {};
      const staleRecovered: string[] = [];
      const staleBarEvicted: string[] = [];

      for (const symbol of universe) {
        if (handled.has(symbol)) continue;
        const stamp = stamps.get(symbol);
        const behind = stamp ? weekdaysBehindEastern(stamp.newest) : null;
        const isStale = behind !== null && behind >= EVICTION_STALE_BAR_WEEKDAYS;

        if (!isStale) {
          // RECOVERING CLEARS THE EVIDENCE, the mirror of clearAbsence. Named
          // rather than blanket-cleared: only fields the read actually returned
          // are sent to HDEL, so a clean universe costs no command at all.
          if (staleDayEvidence.has(symbol)) staleRecovered.push(symbol);
          continue;
        }


        sweep.staleBarred++;
        const days = mergeStaleBarDay(
          (staleDayEvidence.get(symbol) ?? []).join(","),
          nowMs
        );
        staleUpdates[symbol] = days;

        const action = staleBarEvictionAction(
          symbol,
          days.length,
          behind,
          stamp?.observedAt,
          nowMs
        );
        if (action === "hand-edit") {
          // THE #404 RULE HOLDS WHATEVER FIRED IT. A curated symbol is never
          // evicted, only shouted about -- and it reaches the identical alarm
          // through the identical preset gate, because staleBarEvictionAction
          // and evictionAction share one.
          sweep.presetHandEdit.push(symbol);
          if (await claimPresetHandEditAlarm(symbol)) {
            console.error(
              `[screener-fundamentals] PRESET UNIVERSE NEEDS A HAND EDIT: ${symbol} ` +
                `last printed a daily bar on ${stamp?.newest} -- ${behind} trading ` +
                `days ago -- across ${days.length} day(s) of evidence. It cannot be ` +
                `evicted -- it is hardcoded in lib/server/presetUniverse.ts. Check ` +
                `whether it was renamed, acquired or delisted, then edit that array ` +
                `and redeploy.`
            );
          }
          continue;
        }
        if (action === "evict") {
          const evicted = await evictSymbol(symbol);
          sweep.evicted.push(symbol);
          sweep.evictedByStaleBars++;
          if (evicted.tombstoned) sweep.tombstonedByStaleBars++;
          staleBarEvicted.push(`${symbol}@${stamp?.newest}`);
        }
      }
      // Written after the loop so one HSET and one HDEL carry the whole day.
      // An evicted symbol's field is removed by evictSymbol (PER_SYMBOL_HASHES),
      // so it is deliberately not re-written here.
      // ANYTHING IN THE HASH WITH NO EVIDENCE WRITTEN TODAY GOES. That is the
      // recovered universe symbols above, and also fields for symbols that have
      // since left the universe entirely -- the loop never reaches those, so
      // without this line their evidence would sit in the hash forever, which is
      // the immortal-field problem PER_SYMBOL_HASHES exists to avoid.
      for (const symbol of staleDayEvidence.keys()) {
        if (!(symbol in staleUpdates) && !staleRecovered.includes(symbol)) {
          staleRecovered.push(symbol);
        }
      }
      await writeStaleBarDays(
        Object.fromEntries(
          Object.entries(staleUpdates).filter(([sym]) => !sweep.evicted.includes(sym))
        ),
        staleRecovered
      );
      if (staleBarEvicted.length) {
        console.warn(
          `[screener-fundamentals] evicted ${staleBarEvicted.length} symbol(s) whose ` +
            `newest daily bar is at least ${EVICTION_STALE_BAR_WEEKDAYS} trading days ` +
            `old, independently of FMP's isActivelyTrading flag: ${staleBarEvicted.join(", ")}`
        );
      }

      if (sweep.evicted.length) {
        await deregisterSymbols(sweep.evicted);
        console.warn(
          `[screener-fundamentals] evicted ${sweep.evicted.length} symbol(s) ` +
            `(${sweep.evictedByAbsence} absent from the screener AND failing quotes, ` +
            `${sweep.evictedByStaleBars} on stale bars): ${sweep.evicted.join(", ")}`
        );
      }
    } catch (error) {
      // The sweep must never break the refresh it rides on. A SweepSkipped is
      // a deliberate stop with its reason already recorded; anything else is a
      // fault and gets its own reason rather than reading as a clean day.
      if (!(error instanceof SweepSkipped)) {
        sweep.skipped = "sweep-threw";
        console.warn("[screener-fundamentals] delisting sweep failed:", error);
      }
    }
  }
  if (sweep.skipped) {
    console.warn(`[screener-fundamentals] delisting sweep skipped: ${sweep.skipped}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THE FOURTH SIGNAL: SEC NO LONGER LISTS THE TICKER (#553 COWORK #20).
  //
  // OUTSIDE THE SCREENER BRANCH ON PURPOSE. The three rules above all stand on
  // FMP and skip when its screener read fails; BK, EQR, EA and WBS stayed in
  // the universe for weeks under them, and after 14 October the screener read
  // fails every day. This pass needs only SEC's ticker file, already in Redis
  // (one GET), and the universe -- reused when the pass above read it.
  //
  // Same preset gate, same eviction, same deregistration as the other routes.
  // A rename is evicted like a delisting: the successor ticker (BNY for BK)
  // cannot be derived from committed data, so the log names every symbol for a
  // person to check.
  try {
    const universe =
      sweepUniverse ??
      (await getWarmTargetSymbols(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com")).symbols;
    const verdict = secUnlistedSymbols(universe, await resolveTickerMap());
    sweep.secSkipped = verdict.skipped;
    const already = new Set([...sweep.evicted, ...sweep.presetHandEdit]);
    const secEvicted: string[] = [];
    for (const symbol of verdict.unlisted) {
      sweep.secUnlisted.push(symbol);
      if (already.has(symbol)) continue;
      const action = secListingEvictionAction(symbol, true);
      if (action === "hand-edit") {
        sweep.presetHandEdit.push(symbol);
        if (await claimPresetHandEditAlarm(symbol)) {
          console.error(
            `[screener-fundamentals] PRESET UNIVERSE NEEDS A HAND EDIT: ${symbol} ` +
              `is no longer in SEC's ticker file. It cannot be evicted -- it is ` +
              `hardcoded in lib/server/presetUniverse.ts. Check whether it was ` +
              `renamed, acquired or delisted, then edit that array and redeploy.`
          );
        }
        continue;
      }
      if (action === "evict") {
        const evicted = await evictSymbol(symbol);
        sweep.evicted.push(symbol);
        sweep.evictedBySecListing++;
        if (evicted.tombstoned) sweep.tombstonedBySecListing++;
        secEvicted.push(symbol);
      }
    }
    if (secEvicted.length) {
      await deregisterSymbols(secEvicted);
      console.warn(
        `[screener-fundamentals] evicted ${secEvicted.length} symbol(s) SEC's ticker ` +
          `file no longer lists: ${secEvicted.join(", ")}. A RENAME looks the same ` +
          `as a delisting here -- check each for a successor ticker (same CIK) and ` +
          `add it to the universe by hand.`
      );
    }
  } catch (error) {
    sweep.secSkipped = "sec-sweep-threw";
    console.warn("[screener-fundamentals] SEC listing sweep failed:", error);
  }

  await recordJobRun("warm-screener-fundamentals", result.ok, {
    // Symbols carrying BOTH signals today, and the ones that reached the
    // corroboration threshold. `absent` far above `evicted` is the healthy
    // shape -- it means the corroboration window is doing its job.
    absentAndFailing: sweep.absent,
    // THE THIRD SIGNAL'S OWN COUNT, NOT FOLDED INTO THE ONE ABOVE. Both rules
    // above ask FMP whether the symbol is alive and FMP is wrong about exactly
    // the symbols they exist to catch (probe Q5: FB still reads
    // isActivelyTrading: true). When the metadata goes blind again this field is
    // what says so -- `absentAndFailing: 0` beside `staleBarred: 6` reads
    // completely differently from both at zero.
    staleBarred: sweep.staleBarred,
    // THE DENOMINATOR FOR IT, and the reason `staleBarred: 0` is readable at
    // all. Zero stamps means warm-picker-universe never flushed any and the
    // signal is blind, which is a fault; a full universe of stamps with zero
    // stale is a clean day. Same principle as #416's `quarterlyStamped`.
    barStampsRead: sweep.barStampsRead,
    evicted: sweep.evicted.length,
    // WHICH SIGNAL ACTUALLY DELETED SOMETHING. The two counts above are
    // detection; a destructive action deserves its own attribution, and without
    // it a rising `evicted` cannot be traced to the rule that caused it.
    evictedByAbsence: sweep.evictedByAbsence,
    evictedByStaleBars: sweep.evictedByStaleBars,
    // WHICH SIGNAL SET A TOMBSTONE, and it is not the same question as which
    // signal evicted. An absence eviction's tombstone is belt-and-braces -- that
    // symbol is gone from the screener, so discovery was never going to re-offer
    // it. A stale-bar eviction's tombstone is load-bearing: that symbol IS in
    // the screener and WILL be re-offered on the next build, which is the churn
    // the tombstone exists to stop. Folded into one count, a rising number could
    // not be read as either.
    //
    // TALLIED FROM evictSymbol'S OWN ANSWER, not derived from the eviction
    // counts. They were aliases, on the reasoning that "every eviction writes
    // exactly one log entry" -- which the preset guard added in the same PR
    // (#424) made false: a preset reaching evictSymbol returns BEFORE the zadd,
    // so it is evicted and not tombstoned. A Redis failure after the deletes
    // does the same. The counts diverging is rare, and the case where they
    // diverge is precisely the case the guard exists for -- which is when this
    // record most needs to be true rather than plausible.
    tombstonedByAbsence: sweep.tombstonedByAbsence,
    tombstonedByStaleBars: sweep.tombstonedByStaleBars,
    // THE SYMBOLS, NOT A COUNT, AND ON EVERY RUN. The log line above is
    // rationed to once a month per symbol so it cannot become churn; this
    // field is the standing state, so a dead curated ticker is still visible
    // to anyone reading the record on day thirty. A count would say "something
    // needs a hand edit" without saying what, which is not an actionable
    // signal -- and the list is at most a handful of names. Joined rather than
    // an array because a JobRun summary value is a scalar; null when there is
    // nothing to report, so the field reads as "clean" rather than as "".
    presetNeedsHandEdit: sweep.presetHandEdit.join(", ") || null,
    // THE FOURTH SIGNAL, named rather than counted: every symbol here is a
    // delisting OR a rename, and only a person can tell which.
    secUnlisted: sweep.secUnlisted.join(", ") || null,
    evictedBySecListing: sweep.evictedBySecListing,
    tombstonedBySecListing: sweep.tombstonedBySecListing,
    secSweepSkipped: sweep.secSkipped,
    // WHY A DAY LOOKED CLEAN. Without this, "the sweep ran and found nothing"
    // and "the sweep never ran" are the same record -- and the second is the
    // more likely one, since it happens whenever the self-fetch is challenged
    // or the pool had a bad day.
    sweepSkipped: sweep.skipped,
    // THE REAL COVERAGE FLOOR, as returned rather than as configured. The
    // screener answers market-cap-descending, so the smallest cap in the
    // response is where the pool actually stops. While it sits well above
    // SCREENER_MIN_MARKET_CAP the LIMIT is what bounds the pool and that
    // constant is inert; when the two converge, the constant has started
    // shaping the universe and is a decision again. Recording it is what makes
    // that transition visible instead of silent.
    observedFloor: result.observedFloor ?? null,
    rows: result.rows,
    cached: result.cached,
    reason: result.reason ?? null,
    status: result.status ?? null,
  });

  // 200 even on a failed refresh, with ok:false in the body. A 5xx here would
  // make Vercel's cron surface mark the job failed for something that is
  // routinely an upstream plan restriction, and the log line above is the
  // signal that matters. The one thing that must never happen is silence.
  return NextResponse.json(payload);
}
