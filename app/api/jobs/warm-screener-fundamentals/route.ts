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
  recordAbsence,
  clearAbsence,
  evictionAction,
  claimPresetHandEditAlarm,
  evictSymbol,
  poolLooksDegraded,
  EVICTION_MIN_FAIL_STREAK,
} from "../../../../lib/server/symbolEviction";

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
  const sweep = {
    absent: 0,
    evicted: [] as string[],
    presetHandEdit: [] as string[],
    skipped: null as string | null,
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
          await evictSymbol(symbol);
          sweep.evicted.push(symbol);
        }
      }
      if (sweep.evicted.length) {
        await deregisterSymbols(sweep.evicted);
        console.warn(
          `[screener-fundamentals] evicted ${sweep.evicted.length} symbol(s) ` +
            `absent from the screener AND failing quotes: ${sweep.evicted.join(", ")}`
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

  await recordJobRun("warm-screener-fundamentals", result.ok, {
    // Symbols carrying BOTH signals today, and the ones that reached the
    // corroboration threshold. `absent` far above `evicted` is the healthy
    // shape -- it means the corroboration window is doing its job.
    absentAndFailing: sweep.absent,
    evicted: sweep.evicted.length,
    // THE SYMBOLS, NOT A COUNT, AND ON EVERY RUN. The log line above is
    // rationed to once a month per symbol so it cannot become churn; this
    // field is the standing state, so a dead curated ticker is still visible
    // to anyone reading the record on day thirty. A count would say "something
    // needs a hand edit" without saying what, which is not an actionable
    // signal -- and the list is at most a handful of names. Joined rather than
    // an array because a JobRun summary value is a scalar; null when there is
    // nothing to report, so the field reads as "clean" rather than as "".
    presetNeedsHandEdit: sweep.presetHandEdit.join(", ") || null,
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
