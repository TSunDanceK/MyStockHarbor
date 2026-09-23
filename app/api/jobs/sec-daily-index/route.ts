import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import {
  readManifest,
  secRereadQueue,
  SEC_REREAD_DRAIN_PER_RUN,
  SEC_REREAD_PEAK_INFLOW,
  writeManifest,
  seedManifest,
  symbolsByCik,
  reconcileCiks,
  reconcileDelistings,
  reconcileExchanges,
  discardFactSets,
  type SecManifest,
} from "@/lib/server/secManifest";
import { resolveTickerMap, refreshTickerMap } from "@/lib/server/secTickerMap";
import {
  addDays,
  fetchDailyIndex,
  intersect,
  isPeriodicForm,
  isRereadOnlyForm,
  isWeekend,
  latestProcessableDate,
  type SymbolFiling,
} from "@/lib/server/secDailyIndex";
import { PRESET_UNIVERSE } from "@/lib/server/presetUniverse";
import { refreshSecFilingNews } from "@/lib/server/news/secFilingsJob";
import {
  readDynamicUniverse,
} from "@/lib/server/dynamicUniverseCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Step 2 of the SEC build order, and deliberately the whole of it: fetch the
// daily index, intersect the CIK column against the manifest, record what
// filed, write the manifest back.
//
// ZERO companyfacts CALLS. Not an omission -- the point. The change detector is
// proved in isolation before anything depends on it, so a wrong number later
// cannot be blamed on a detector nobody tested alone.
//
// REDIS BUDGET: one GET and one SET per run, whatever happens. Not one write
// per symbol that filed -- the manifest is a single key, so the symbols that
// filed ride along in the same SET as the watermark. Writes are already 76% of
// the command count on this account and that is the meter that bills.
//
// THE SEED LIVES HERE because seeding needs a write and the relay's Upstash
// credential is deliberately read-only; the app is the only thing that can
// write. It is idempotent and never clears existing state.

/**
 * How many dates one invocation will process.
 *
 * BOUNDED CATCH-UP, NOT "YESTERDAY". Processing only the previous day means a
 * single missed cron run loses those filings permanently and silently -- there
 * is no second chance at a daily index, because tomorrow's run would move the
 * watermark past the gap. So every date from the watermark forward is
 * processed, oldest first, and the watermark is left wherever it got to. A long
 * gap drains over several days instead of timing out in one and making no
 * progress at all.
 */
const MAX_DAYS_PER_RUN = 10;

/**
 * Consecutive failures before the run reports itself unhealthy.
 *
 * A day with no index answers 403 (see secDailyIndex.looksLikeMissingIndex),
 * which is every weekend and every market holiday -- so alarming on one is
 * alarming roughly 110 times a year for nothing. Three consecutive covers a
 * Friday-Saturday-Sunday run of absences without firing; a real block does not
 * stop on the fourth day.
 */
const CONSECUTIVE_FAILURE_ALARM = 4;

/**
 * Consecutive ABSENT days before absence itself becomes suspicious.
 *
 * The longest genuine run is a weekend either side of a two-day holiday -- four.
 * Ten is comfortably past anything the calendar produces, so it catches the one
 * case the absent/failed split could otherwise hide forever: a block that
 * happens to answer with a small 403 body and therefore reads as "no index
 * published" every single day.
 */
const IMPLAUSIBLE_ABSENCE_RUN = 10;

/** SEC's fair-access policy requires a declared agent carrying a contact. */
const SEC_UA = process.env.SEC_USER_AGENT || "";

/**
 * TWO WAYS IN, AND BOTH ARE NEEDED.
 *
 * Vercel's cron sends `Authorization: Bearer $CRON_SECRET` and must keep
 * working exactly as it does -- that path is unchanged, checked first, and
 * still fails OPEN when CRON_SECRET is unset, which is the house convention
 * every other warm job follows.
 *
 * But a header cannot be typed into an address bar, so with the Bearer check
 * alone the first real run of this job could only happen after a merge to main
 * -- testing the thing after shipping it, which is the order this whole build
 * has been arranged to avoid. So `?key=` is accepted too, through the same
 * guardDebugRequest every debug route uses: same key, same IP lockout, same
 * 401/429 bodies.
 *
 * Returns a Response to send, or null to carry on.
 */
async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  // The cron path, first and cheapest. Not routed through guardDebugRequest,
  // because a valid Bearer must never record a key failure against Vercel's IP
  // and eventually lock the scheduler out of its own job.
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

/**
 * Fold one day's filings into the manifest. Pure, so the acceptance test can
 * run it against fixed rows without a network or a database.
 */
export function applyFilings(manifest: SecManifest, filings: SymbolFiling[]) {
  const touched = new Set<string>();
  const periodicBySymbol = new Map<string, SymbolFiling[]>();

  for (const f of filings) {
    const entry = manifest.symbols[f.symbol];
    if (!entry) continue;
    touched.add(f.symbol);

    // AN 8-K OR 6-K, AMENDED OR NOT, MAY BE A RESULTS RELEASE. Recorded before
    // any gate below, so the report-dates phase can re-read this symbol's
    // record first -- see SecManifestEntry.lastEventFiled.
    const bare = f.form.toUpperCase().replace(/\/A$/, "");
    if ((bare === "8-K" || bare === "6-K") && (!entry.lastEventFiled || f.filed > entry.lastEventFiled)) {
      entry.lastEventFiled = f.filed;
    }

    // THE AMENDMENT GATE IS NARROWED TO FINANCIAL FORMS, and this was a real
    // defect rather than a tidy-up. `isAmendment` matches any form ending "/A",
    // so a Form 4/A -- an amended insider transaction, common and entirely
    // routine -- set needsReverify and queued a multi-MB companyfacts read.
    //
    // ── THE FIGURES HERE WERE STALE, AND SO WAS THE FORM NAMED ────────────
    // This described an earlier window (166 queued / 39 dropped) and was left
    // in place when the live ones came back different. A measurement quoted in
    // a comment is a claim like any other.
    //
    // EVERY FIGURE BELOW NAMES ITS UNIT, because two of them are counted in
    // different things and the first version of this correction implied one
    // count. That union-vs-sum confusion has now cost this file twice -- it is
    // what produced an unpassable rereadQueued gate.
    //
    //   LIVE:   134 SYMBOLS queued, 7 SYMBOLS dropped by the narrowed gate.
    //   FIXTURE (data/sec/window-fixture-20260908-11.json, its own capture):
    //           123 SYMBOLS queued against 130 pre-fix -- the same 7 SYMBOLS,
    //           named: BEN CRL DOCU DT GS RSG VTRS.
    //
    // THE FORMS ARE COUNTED IN FILINGS, NOT SYMBOLS, and there are 8 of them
    // across those 7 symbols because BEN filed two. Derived from the fixture
    // rather than asserted:
    //
    //   FILINGS (8)                    SYMBOLS (7)
    //   SCHEDULE 13D/A   x4            BEN (x2), DT, RSG      -> 3 symbols
    //   SCHEDULE 13G/A   x3            CRL, GS, VTRS          -> 3 symbols
    //   4/A              x1            DOCU                   -> 1 symbol
    //
    // so SIX of the seven SYMBOLS are dropped on an amended beneficial-
    // ownership statement and exactly ONE on an amended Form 4. Same shape of
    // defect, different form: an ownership amendment carries no financial
    // statements, so "amendment" is no more meaningful on a 13D/A than on a
    // 4/A. The gate is unchanged; only its description was wrong.
    // scripts/check-sec-daily-index.mjs pins both counts and both units.
    //
    // The taxonomy was right and the gate was wrong -- "amendment" is only
    // meaningful for a form that carries numbers. isPeriodicForm and
    // isRereadOnlyForm both strip the suffix, so 10-Q/A and 8-K/A still qualify
    // and 4/A, 13D/A, 13G/A, 144/A and 424B2/A do not.
    if (f.amendment && (isPeriodicForm(f.form) || isRereadOnlyForm(f.form))) {
      // A restatement is recorded as its own event. Folding it into
      // lastAccession would lose the fact that an already-published period
      // moved, which 3.8 requires be attributable rather than merely detected.
      entry.lastAmendment = { accession: f.accession, form: f.form, filed: f.filed };
      entry.needsReverify = true;
      entry.enqueuedAt ??= Date.now();
      entry.reverifyReason = "amendment";
    }

    // 8-K ENQUEUES A RE-READ BUT IS NOT A PERIOD REPORT. §3.8's Item 4.02 --
    // a non-reliance determination, i.e. "our previous numbers were wrong" --
    // arrives on an 8-K, so it must trigger a re-read. It must NOT set
    // lastAccession: an 8-K is a material-event notice, not the quarter, and
    // recording it as the latest periodic filing would make the manifest claim
    // a report that does not exist.
    if (isRereadOnlyForm(f.form)) {
      entry.needsReverify = true;
      entry.enqueuedAt ??= Date.now();
      if (!entry.reverifyReason) entry.reverifyReason = "unconfirmed";
      continue;
    }

    if (!isPeriodicForm(f.form)) continue;
    const list = periodicBySymbol.get(f.symbol) ?? [];
    list.push(f);
    periodicBySymbol.set(f.symbol, list);
  }

  for (const [symbol, list] of periodicBySymbol) {
    const entry = manifest.symbols[symbol];
    if (!entry) continue;
    // Newest filing date wins; within a date the order is left alone, because
    // the index carries nothing that could break the tie honestly.
    const newest = list.reduce((a, b) => (b.filed > a.filed ? b : a));
    if (!entry.lastFiled || newest.filed >= entry.lastFiled) {
      entry.lastAccession = newest.accession;
      entry.lastFiled = newest.filed;
    }
    entry.needsReverify = true;
    entry.enqueuedAt ??= Date.now();
    // A 10-Q/10-K/20-F is a report; a 6-K is a catch-all that is USUALLY not
    // one. Both set needsReverify -- the 6-K genuinely might carry ARM's
    // quarter -- but only the first is worth a full companyfacts payload
    // without checking first. Amendment wins if one was also seen.
    if (entry.reverifyReason !== "amendment") {
      entry.reverifyReason = newest.form.toUpperCase().startsWith("6-K") ? "unconfirmed" : "periodic-report";
    }

    const sameDay = list.filter((f) => f.filed === newest.filed);
    // ARM files 6-Ks in pairs on the same day. Which one carries the period
    // report needs reportDate, which this index does not have -- both are kept
    // and flagged for step 3 rather than picked by a guess.
    entry.ambiguousSameDayFilings =
      sameDay.length > 1 ? sameDay.map((f) => f.accession).sort() : null;
  }

  return { touched: [...touched].sort(), periodic: [...periodicBySymbol.keys()].sort() };
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  const started = Date.now();
  const url = new URL(req.url);
  const maxDays = Math.max(1, Math.min(30, Number(url.searchParams.get("maxDays") ?? MAX_DAYS_PER_RUN)));
  // Test-only overrides so the acceptance window can be replayed against real
  // dates without waiting for the watermark to reach them.
  const fromOverride = url.searchParams.get("from");
  const toOverride = url.searchParams.get("to");
  const dryRun = url.searchParams.get("dryRun") === "1";
  // A DEBUG-LOOKING PARAMETER MUST NOT MUTATE LIVE STATE AS A SIDE EFFECT.
  // Measured: a from/to run rewound the persisted watermark 20260912 -> 20260911.
  // Self-healing and harmless in that instance, but a walk-range override reads
  // as inspection, so it is now non-persisting unless persistence is asked for
  // explicitly -- and the response says which happened either way.
  const explicitRange = Boolean(url.searchParams.get("from") || url.searchParams.get("to"));
  const persistRange = url.searchParams.get("persist") === "1";
  const inspectionOnly = explicitRange && !persistRange;
  // THE ESCAPE HATCH for a refused spike -- see mapChangeThreshold in
  // secManifest.ts. Without it a legitimate mass change (an index
  // reconstitution, a wave of renames) leaves the guard refusing every week
  // forever and the map never updating, flagged on each run but with no way to
  // say "I have looked at it, apply it".
  const applyMapChanges = url.searchParams.get("applyMapChanges") === "1";

  if (!SEC_UA) {
    // Named as its own failure. Without a declared agent SEC answers 403 with
    // "Request Rate Threshold Exceeded", which reads as a rate limit and is
    // not one -- and would be counted as a missing index by any looser rule.
    await recordJobRun("sec-daily-index", false, { error: "SEC_USER_AGENT is not set" });
    // The refusal paths log too. A 503 that prints nothing is the same blind
    // spot as a silent 200, and worse: it looks like the job never fired.
    console.log("[sec-daily-index]", JSON.stringify({ ok: false, error: "SEC_USER_AGENT is not set" }));
    return NextResponse.json(
      { ok: false, error: "SEC_USER_AGENT is not set; every request would be blocked as an undeclared agent" },
      { status: 503 }
    );
  }

  // ── ONE READ ──────────────────────────────────────────────────────────────
  const manifest = await readManifest();
  if (!manifest) {
    await recordJobRun("sec-daily-index", false, { error: "manifest unreadable" });
    console.log("[sec-daily-index]", JSON.stringify({ ok: false, error: "manifest unreadable" }));
    return NextResponse.json({ ok: false, error: "manifest unreadable (Redis unconfigured or read failed)" }, { status: 503 });
  }

  // ── The ticker map: refresh if due, then reconcile ────────────────────────
  //
  // THE COMMITTED FILE IS THE SEED AND FALLBACK, NOT THE SOURCE OF TRUTH. A file
  // committed once goes stale, and the dangerous staleness is not absence but
  // REASSIGNMENT -- a delisted ticker later given to a different company routes
  // companyfacts at the wrong company under a symbol that still looks valid.
  // Absence is loud; reassignment is not.
  let tickers = await resolveTickerMap();
  const refresh =
    tickers.refreshDue || url.searchParams.get("refreshTickers") === "1"
      ? await refreshTickerMap(SEC_UA, { force: url.searchParams.get("forceTickers") === "1" })
      : { attempted: false as const };

  if ("ok" in refresh && refresh.ok && !refresh.notModified) {
    // Re-read so the reconciliation below runs against what was just stored,
    // not against the copy read before the fetch.
    tickers = await resolveTickerMap();
  }

  // THE MANIFEST IS NOT BOUNDED BY ANALYSIS_UNIVERSE_CAP, AND THAT IS THE POINT.
  //
  // It was, and the result was a silent product defect: JPM and C were absent
  // from the manifest entirely, so /stock/JPM/earnings could never be populated
  // by this cron. Nothing raised anything -- seedManifest adds exactly what it
  // is given, and a symbol with no entry simply never matches the daily index.
  // See claude/sec-manifest-misses-preset-universe-2026-09-14.md.
  //
  // THIS REPO HAS HAD THIS EXACT BUG BEFORE, one layer up, and wrote it down:
  // pickersBuilder.ts:3314 says "NOT concat-then-slice. That exact pattern is
  // what sliced the mega-caps off (PRESET was appended after the big dynamic
  // set, then the whole thing was cut to the cap, dropping AAPL/NVDA/... -- only
  // active movers like MU survived, which is why the biggest companies were
  // missing from the All Stocks screener)." That is this defect, in the screener
  // instead of the manifest. It is why pickersBuilder fills explicit quotas and
  // why union-then-slice was rejected here rather than merely not chosen.
  //
  // TWO DIFFERENT COSTS, WHICH THE CAP CONFLATES.
  //   ANALYSIS_UNIVERSE_CAP bounds what gets ANALYSED -- a history fetch and a
  //   pass through the indicator stack per symbol, which is real upstream spend
  //   that scales linearly. It is doing its job for the consumers that analyse
  //   and is deliberately left alone.
  //
  //   The manifest bounds what gets DETECTED, and detection is ONE daily-index
  //   request whether it covers 700 filers or 10,000. The per-symbol cost that
  //   does scale is the re-read, and that already has its own governor in
  //   SEC_REREAD_DRAIN_PER_RUN -- 150 a run against a measured peak inflow of
  //   98 a day. Applying the analysis cap here charges detection for a cost it
  //   does not incur, and double-governs the one it does.
  //
  // sec-pipeline-spec-2026-09-13.md §7 says so outright: "§1 already survives
  // this. The daily index is one request whether you track 700 filers or all
  // ~10,000, so the correctness mechanism needs no change at all." The cap
  // contradicted the spec this build follows, which is why nothing ever
  // recorded a reason for it being here.
  //
  // SIZE, STATED RATHER THAN ASSUMED: 391 B/symbol, 266 KB at 696, ~305 KB with
  // the presets unioned in, against Upstash's 10 MB per-request ceiling. The
  // bound is asserted in check-sec-daily-index.mjs so growth stays visible.
  //
  // THE THIRD INPUT IS ACCOUNTED FOR, NOT OMITTED. dynamicUniverseCache's header
  // says ANALYSIS_UNIVERSE_CAP bounds the union of THREE things: PRESET_UNIVERSE,
  // the dynamic pool, and the popular-search promotions. This unions two,
  // because the third already flows through the second: pickersBuilder persists
  // promoted names into the shared pool with
  // `addToDynamicUniverse(popularSearchSymbols, "search", 1)`
  // (pickersBuilder.ts:3311), so readDynamicUniverse() returns them. There is no
  // separate list to union here.
  //
  // ONE RESIDUAL, recorded because it is bounded rather than absent. A promoted
  // name "enters at zero and still has to earn a place by score like anything
  // else"; pruneUniverse trims the pool to MAX_DYNAMIC_UNIVERSE_SIZE by
  // ZREMRANGEBYRANK on the lowest scores. So a freshly-searched symbol (quota 30
  // a build, threshold 3 distinct callers) can be pruned before this job reads
  // the pool. That is rank competition, not structural omission -- unlike the
  // preset case, nothing promises it a slot -- but spec §7a's "attention, not
  // market cap" argues those are exactly the symbols that deserve one. Left as
  // an open question rather than fixed silently either way.
  //
  // PRESET_UNIVERSE FIRST, because those 100 mega-caps are "guaranteed a slot"
  // everywhere else -- sectorUniverse and pickersBuilder both union them in --
  // and the dynamic pool ages entries out after 14 days, so which preset name
  // is missing changes week to week. Order is irrelevant to the manifest, which
  // is a set; readDynamicUniverse's own ordering still governs every consumer
  // that cares about rank.
  const universe = [
    ...new Set([...PRESET_UNIVERSE, ...(await readDynamicUniverse()).map((e) => e.symbol)]),
  ];
  const seed = seedManifest(manifest, universe, tickers.map, tickers.source !== "none");

  // Reconcile BEFORE the index is read, so a symbol whose CIK moved is matched
  // on its new CIK the same run rather than a day later.
  const cikChanges =
    tickers.source === "none"
      ? null
      : reconcileCiks(manifest, tickers.map, { override: applyMapChanges });

  // Exchange is reconciled on EVERY run with a map, not only on a refresh: it
  // is a field copy with no destructive branch, so there is nothing to guard
  // and nothing to lose by doing it often. It deliberately does not go through
  // reconcileCiks -- a venue change is not a reason to discard a fact set.
  const exchanges =
    tickers.source === "none"
      ? null
      : reconcileExchanges(manifest, tickers.map, { sourceHasExchangeColumn: tickers.shape === "fields+data" });

  // DELISTING IS COUNTED PER REFRESH, NOT PER RUN, so it is gated on a refresh
  // having actually succeeded this run. Absence from the committed fallback
  // means nothing -- that file is smaller than the live map by construction --
  // and counting daily against a map fetched weekly would call a symbol
  // delisted after three days rather than three weeks.
  const refreshSucceeded = "ok" in refresh && refresh.ok === true;
  const delistings =
    refreshSucceeded && tickers.source === "redis"
      ? reconcileDelistings(manifest, tickers.map, { override: applyMapChanges })
      : null;

  // The discard is the irreversible half, so it happens only for changes that
  // were actually applied.
  const discarded =
    cikChanges?.applied && cikChanges.changes.length
      ? await discardFactSets(cikChanges.changes.map((c) => c.symbol))
      : 0;

  const bySymbolCik = symbolsByCik(manifest);

  // ── Which dates ───────────────────────────────────────────────────────────
  const latest = toOverride || latestProcessableDate();
  const start = fromOverride || (manifest.lastIndexDate ? addDays(manifest.lastIndexDate, 1) : latest);

  const dates: string[] = [];
  for (let d = start; d <= latest && dates.length < maxDays; d = addDays(d, 1)) dates.push(d);

  const days: Record<string, unknown>[] = [];
  const filingsBySymbol: Record<string, SymbolFiling[]> = {};
  let consecutive = manifest.consecutiveIndexFailures;
  let consecutiveAbsent = manifest.consecutiveIndexAbsent ?? 0;
  let lastProcessed: string | null = null;

  for (const date of dates) {
    const res = await fetchDailyIndex(date, SEC_UA);

    if (res.outcome === "parsed") {
      const filings = intersect(res.parsed.rows, bySymbolCik);
      const applied = applyFilings(manifest, filings);
      for (const f of filings) (filingsBySymbol[f.symbol] ??= []).push(f);
      // ANY success resets both counters.
      consecutive = 0;
      consecutiveAbsent = 0;
      lastProcessed = date;
      days.push({
        date,
        outcome: "parsed",
        status: res.status,
        ms: res.ms,
        indexRows: res.parsed.dataRows,
        malformedRows: res.parsed.malformedRows,
        matched: filings.length,
        filings: filings.map((f) => `${f.symbol} ${f.form}`),
        symbolsTouched: applied.touched,
        periodicFilers: applied.periodic,
      });
      continue;
    }

    if (res.outcome === "absent") {
      // Expected: weekend or market holiday. The watermark still advances --
      // there is no index to come back for -- and this does NOT touch the
      // failure counter. Measured: a Saturday-only run moved it 0 -> 1, and a
      // cron walking one day at a time through a holiday stretch would reach
      // the alarm threshold with nothing wrong.
      consecutiveAbsent += 1;
      lastProcessed = date;
      days.push({
        date,
        outcome: "absent",
        status: res.status,
        ms: res.ms,
        weekend: isWeekend(date),
        bodyHead: res.bodyHead,
        note: "no index published for this date (403 AccessDenied from S3 is how EDGAR says 'no such key'); watermark advances, no alarm",
      });
      continue;
    }

    // A real failure. The watermark is NOT advanced past it -- the day is
    // retried tomorrow rather than lost.
    consecutive += 1;
    days.push({ date, outcome: "failed", status: res.status, ms: res.ms, reason: res.reason });
    break;
  }

  if (lastProcessed) manifest.lastIndexDate = lastProcessed;
  manifest.consecutiveIndexFailures = consecutive;
  manifest.consecutiveIndexAbsent = consecutiveAbsent;

  // ── ONE WRITE ─────────────────────────────────────────────────────────────
  const written = dryRun || inspectionOnly ? false : await writeManifest(manifest);

  const failedDays = days.filter((d) => d.outcome === "failed").length;
  const alarming = consecutive >= CONSECUTIVE_FAILURE_ALARM;
  // A separate, far looser question: absence is normal, but TEN consecutive days
  // with no index published does not happen, so that shape is a block answering
  // with a small body rather than a run of holidays.
  const absenceImplausible = consecutiveAbsent >= IMPLAUSIBLE_ABSENCE_RUN;
  // A suspected map shape change is not a healthy run even when every date
  // parsed -- something upstream is wrong and nothing was applied because of it.
  // Either map-derived guard firing means the run is NOT healthy: something
  // upstream is wrong and work was deliberately skipped because of it.
  const ok =
    failedDays === 0 &&
    !alarming &&
    (dryRun || inspectionOnly || written) &&
    !absenceImplausible &&
    !(cikChanges?.suspectedMapShapeChange ?? false) &&
    !(delistings?.suspectedPartialMap ?? false);

  // ── THE NEWS FEED'S SEC LEG (#535 COWORK #12/#13) ────────────────────────
  // Moved here from the view-triggered news refresh, so no visitor or bot can
  // cause SEC traffic. See lib/server/news/secFilingsJob.ts.
  const secNews = dryRun || inspectionOnly
    ? null
    : await refreshSecFilingNews(
        Object.keys(filingsBySymbol),
        Object.entries(manifest.symbols).filter(([, e]) => e.cik && !e.delisted).map(([s]) => s)
      );

  const summary = {
    secNewsFiled: secNews?.filed ?? 0,
    secNewsBackfill: secNews?.backfill ?? 0,
    secNewsRequests: secNews?.requests ?? 0,
    secNewsWritten: secNews?.written ?? 0,
    secNewsFailed: secNews?.failed ?? 0,
    secNewsDeferred: secNews?.deferred ?? 0,
    datesConsidered: dates.length,
    parsed: days.filter((d) => d.outcome === "parsed").length,
    absent: days.filter((d) => d.outcome === "absent").length,
    failed: failedDays,
    consecutiveIndexFailures: consecutive,
    consecutiveIndexAbsent: consecutiveAbsent,
    alarming,
    absenceImplausible,
    watermark: manifest.lastIndexDate,
    symbolsWithFilings: Object.keys(filingsBySymbol).length,
    // The re-read queue, read straight off the manifest -- no extra Redis.
    rereadQueued: Object.values(manifest.symbols).filter((e) => e.needsReverify && e.cik).length,
    rereadDrainPerRun: SEC_REREAD_DRAIN_PER_RUN,
    rereadPeakInflowPerDay: SEC_REREAD_PEAK_INFLOW,
    universe: seed.symbols,
    withCik: seed.withCik,
    tickerMapSource: tickers.source,
    tickerMapCount: tickers.count,
    tickerMapLastModified: tickers.lastModified,
    tickerRefreshed: "ok" in refresh ? refresh.ok : false,
    tickerNotModified: "notModified" in refresh ? refresh.notModified : false,
    cikChanges: cikChanges?.changes.length ?? 0,
    cikChangesApplied: cikChanges?.applied ?? false,
    factSetsDiscarded: discarded,
    suspectedMapShapeChange: cikChanges?.suspectedMapShapeChange ?? false,
    delistingChecked: delistings !== null,
    newlyAbsentFromTickerMap: delistings?.newlyAbsent.length ?? 0,
    newlyDelisted: delistings?.newlyDelisted.length ?? 0,
    retickered: delistings?.retickered.length ?? 0,
    unresolvableNoCik: delistings?.unresolvable.length ?? 0,
    reappeared: delistings?.reappeared.length ?? 0,
    suspectedPartialMap: delistings?.suspectedPartialMap ?? false,
    // Flattened to a string HERE because recordJobRun's summary is scalars
    // only -- the structured histogram rides in the response body below. The
    // NYSE slice is the population that loses price history if the bars deal
    // lands Nasdaq-only, so it belongs on /cache-health too, not just in a
    // one-off response nobody keeps.
    exchanges: exchanges
      ? Object.entries(exchanges.histogram).map(([k, n]) => `${k}:${n}`).join(" ")
      : null,
    exchangesFilled: exchanges?.filled ?? 0,
    exchangeBlankRows: exchanges?.noVenueRecorded ?? 0,
    mapChangesOverridden: applyMapChanges,
    exchangesChanged: exchanges?.updated.length ?? 0,
    tickerFileShape: tickers.shape,
    symbolsWithExchange: tickers.withExchange,
    // One GET for the manifest, one for the ticker map, one SET for the
    // manifest. Up from two: the ticker map is read daily (seeding and
    // reconciliation both need it) and written weekly.
    redisCommands: dryRun || inspectionOnly ? 2 : 3,
    // Stated rather than left to be inferred from a watermark that did not move.
    watermarkMoved: !dryRun && !inspectionOnly && written,
    inspectionOnly,
    ms: Date.now() - started,
  };

  await recordJobRun("sec-daily-index", ok, summary);

  // THE SUMMARY GOES TO THE PLATFORM LOG, matching warm-stock-data's
  // `console.log("[warm-stock-data]", JSON.stringify(result))`.
  //
  // The first automated run -- 04:00:16 UTC 2026-09-15, 200, dpl_B6UF7eCd8tcq --
  // printed NOTHING. recordJobRun writes behind CACHE_HEALTH_KEY and the
  // response body is discarded by the cron caller, so there was no way to tell
  // what it had done without a key. A daily job returning 200 while doing
  // nothing is indistinguishable from one working, which is the precise failure
  // this pipeline was designed against -- and it went unobservable on its own
  // first run.
  console.log("[sec-daily-index]", JSON.stringify({ ok, ...summary }));

  return NextResponse.json({
    ok,
    ...summary,
    exchangeHistogram: exchanges?.histogram ?? null,
    // Stated rather than left to be inferred from zero matches.
    tickerMapNote:
      tickers.source !== "none"
        ? tickers.source === "committed-file"
          ? "Using the COMMITTED FILE — Redis has no refreshed copy yet. That file is a seed and fallback, not the source of truth; a stale map can route a reassigned ticker at the wrong company."
          : null
        : `Neither Redis nor data/sec/company-tickers.json has a ticker map, so ${seed.withoutCik.length} symbol(s) have no CIK and the index can match nothing. See data/sec/README.md. This is NOT "no filings today".`,
    tickerRefresh: refresh,
    // How often SEC actually changes the file. Weekly is a guess until these
    // accumulate; notModified week after week says weekly is too often.
    tickerMapAge: {
      fetchedAt: tickers.fetchedAt,
      lastChangedAt: tickers.lastChangedAt,
      lastModified: tickers.lastModified,
      stale: tickers.stale,
      refreshWasDue: tickers.refreshDue,
    },
    exchange: exchanges
      ? {
          ...exchanges,
          updated: exchanges.updated.slice(0, 25),
          note:
            tickers.shape === "legacy-object"
              ? "The ticker file in use is the LEGACY shape (company_tickers.json), which has no exchange column — every symbol reads (unknown) until company_tickers_exchange.json is committed or refreshed. Nothing was written: not a failure, and existing exchange values were NOT blanked."
              : "an exchange change updates the field and nothing else; only a CIK change invalidates. A blank exchange is a real answer (SEC lists the filer with no venue) and reads as (none recorded), distinct from (unknown).",
        }
      : { skipped: "no ticker map available" },
    delisting: delistings
      ? {
          ...delistings,
          // Truncated in the response; the manifest carries the full state.
          newlyAbsent: delistings.newlyAbsent.slice(0, 25),
          stillAbsent: delistings.stillAbsent.slice(0, 25),
          reappeared: delistings.reappeared.slice(0, 25),
          refreshesRequired: 3,
          // A rename and a deregistration are indistinguishable by ticker, so
          // the CIK is what tells them apart. A symbol that never resolved has
          // neither, and gets no verdict rather than a confident wrong one.
          retickerNote:
            "retickered = absent under this ticker but the CIK is still in the map under another; a rename, never a delisting. " +
            "unresolvable = absent AND no CIK ever resolved, so there is nothing to trace and no delisting clock is started.",
          note:
            delistings.note ??
            "every symbol in the manifest is present in the ticker map; nothing absent, nothing delisted",
        }
      : {
          skipped:
            refreshSucceeded
              ? "the ticker map came from the committed fallback, which is smaller than the live map by construction -- absence against it is not evidence of delisting"
              : "no successful ticker-map refresh this run, and delisting is counted per refresh rather than per run",
        },
    cikReassignment: cikChanges
      ? {
          ...cikChanges,
          factSetsDiscarded: discarded,
          note:
            cikChanges.note ??
            "no CIK changed under an existing symbol; nothing was invalidated",
        }
      : { skipped: "no ticker map available to reconcile against" },
    absenceNote: absenceImplausible
      ? `${consecutiveAbsent} consecutive days with no index published. The calendar does not produce a run that long — this is more likely a block answering with a small body than a holiday stretch. Absence does NOT feed consecutiveIndexFailures, which is why that counter is still ${consecutive}.`
      : null,
    alarmNote: alarming
      ? `${consecutive} consecutive index failures (threshold ${CONSECUTIVE_FAILURE_ALARM}). A weekend is two; a holiday weekend three. Four means www.sec.gov is refusing us, not that EDGAR published nothing.`
      : null,
    seededThisRun: seed.seeded,
    symbolsWithoutCik: seed.withoutCik.slice(0, 20),
    days,
    filingsBySymbol,
    // What step 3 would take next, in order: amendments first, then real
    // reports, then the 6-K/8-K events that probably carry nothing.
    rereadQueueHead: secRereadQueue(manifest, 25),
    manifestWritten: written,
    rangeNote: inspectionOnly
      ? "from/to was supplied, so this run is INSPECTION ONLY: nothing was written and the persisted watermark is untouched. Add &persist=1 to make a range walk durable."
      : null,
  });
}
