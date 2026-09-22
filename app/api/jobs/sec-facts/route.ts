import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { recordJobRun } from "@/lib/server/jobRuns";
import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { readManifest, writeManifest, type SecManifest } from "@/lib/server/secManifest";
import { drainColdCiks } from "@/lib/server/secColdCik";
import { extractCompanyFacts, checkIdentities, identityRates, SEC_QUARTER_WINDOW, SEC_YEAR_WINDOW, type CompanyFacts } from "@/lib/server/secExtract";
import { readFactSet, writeFactSet, type StoredFactSet, type StoredPeriod } from "@/lib/server/secFactStore";
import { toStoredSet } from "@/lib/server/secFactBuild";
import { defaultSources, type FxSeries } from "@/lib/server/fxRates";
import { readColdQueue, clearColdQueue, cikForSymbol } from "@/lib/server/secColdFetch";
import { needsReread } from "@/lib/server/secStaleness";
import { SEC_FIELD_KEYS } from "@/lib/server/secFields";
import { canWriteSecState, noteSecWriteBlocked } from "@/lib/server/secWriteGate";
import {
  resultsPairing, earlyNonResultsPattern, estimateUpcoming, nextPeriodEndFrom,
  latestResultsAnnouncement, pendingResults,
  type Submissions,
} from "@/lib/server/secReportDates";
import { writeReportDates, STORED_EVENT_LIMIT } from "@/lib/server/secReportDatesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// STEP 3 — the standing population path.
//
// KEYED ON contentHash === null, AND STANDING RATHER THAN A BACKFILL.
// `claude/sec-cold-start-coverage-2026-09-14.md` §2: only a filing event fills
// contentHash, so a symbol that has not filed since the manifest was seeded
// stays null forever and a one-off backfill leaves the same hole open for every
// symbol admitted afterwards. So this job runs every day and keeps finding them,
// and it will keep finding them for as long as the universe grows.
//
// TWO QUEUES, IN ORDER, WITH SEPARATE ALLOWANCES:
//
//   0. COLD QUEUE -- a visitor asked for this symbol and the synchronous fetch
//      on their render timed out or was refused. SOMEBODY IS LOOKING AT THIS
//      PAGE RIGHT NOW and it is showing them a pending state, so it goes before
//      everything: it is the only one of the three with a person attached.
//      Bounded by SEC_COLD_QUEUE_MAX, because an endpoint anyone can hit must
//      not be able to make this job do their work forever.
//   1. REVERIFY -- a filing event says this symbol's numbers may have moved.
//      Time-sensitive: the page is showing last quarter's figures right now.
//   2. POPULATE -- contentHash is null; the page has nothing at all.
//
// Reverify goes before populate because a stale number on a live page is worse
// than an absent one, and it is given the smaller allowance because it is
// driven by what actually filed rather than by a backlog.
//
// WHY A SEPARATE JOB FROM sec-daily-index. That job's stated property is ZERO
// companyfacts calls -- the change detector proved in isolation, so a wrong
// number later cannot be blamed on a detector nobody tested alone. Folding the
// fetch into it would spend that property. Two crons, twenty minutes apart.

/**
 * Per-run allowances — MEASURED, not estimated.
 *
 * THE FIRST VALUES WERE 60/40 AND CAME FROM THE BRIEF'S WIRE ESTIMATE, "~150 KB
 * typical, AAPL's is ~10 MB". That estimate was wrong by an order of magnitude
 * in one direction and the allowance wrong by another in the other, and 40/day
 * against ~875 CIK-bearing symbols is TWENTY-TWO DAYS of "not loaded yet"
 * across the site.
 *
 * scripts/sec-populate-cost.mjs, relay run 34959833821, 40 symbols sampled
 * evenly through the dump universe, 0 failures:
 *
 *   wire    p50 3.0 MB   p90 5.3 MB   max 6.4 MB   (the brief said ~150 KB)
 *   time    p50 153ms    p90 327ms    max 549ms    mean 165ms
 *   stored  p50 11.2 KB  p90 13.2 KB  max 14.3 KB
 *
 * THREE CEILINGS, SMALLEST WINS:
 *   wall time     1450/run at a 20% margin on the 300s budget (165ms each)
 *   SEC's rate    1920/run at the route's own 8 req/s
 *   Redis writes  one SET per CHANGED symbol -- but only the FIRST pass writes
 *                 every symbol; after that a set is rewritten only when its
 *                 contentHash moves, which is a filing event. So this is a
 *                 one-off ~875 SETs spread over the drain, then roughly the
 *                 daily filing count. Not a recurring bill.
 *
 * SET AT 300, WHICH IS THE 1450 CEILING DIVIDED BY FIVE, and the divisor is the
 * honest part: THE MEASUREMENT WAS TAKEN ON A GITHUB RUNNER, NOT ON A VERCEL
 * LAMBDA. The two do not have the same network. The spec's own iad1 figure is
 * encouraging (~90ms for JPM's 4.6 MB submissions), but "encouraging" is not
 * "measured on the thing that will run it", and the first real cron run is the
 * measurement that settles it -- the summary log reports attempted, written and
 * both backlogs, so it will say plainly whether 300 fits.
 *
 * At 300: ~2.9 days to drain, ~810 MB of wire per run, ~50s of the 300s budget
 * at the measured mean.
 *
 * REVERIFY RAISED TO 150 for a different reason: it is driven by what actually
 * filed, and the measured window's busiest day queued ~130. At 60 a peak day
 * took three runs to clear, which means a stale number stayed on a live page
 * for two extra days. 150 clears a peak day in one.
 *
 * SEPARATE, NOT SHARED. One pool would let the populate backlog starve the
 * reverify queue for days -- the same priority inversion
 * SEC_COLD_FETCH_DRAIN_PER_RUN was given its own allowance to avoid.
 */
/**
 * The cold queue's own allowance, and it is small on purpose.
 *
 * This queue is fed by an endpoint anyone can hit. It goes FIRST because every
 * entry has a person looking at a pending page, but it is capped well below the
 * other two so that filling it cannot displace the universe's own drain.
 */
export const SEC_COLD_PER_RUN = 50;
export const SEC_REVERIFY_PER_RUN = 150;
export const SEC_POPULATE_PER_RUN = 300;

/**
 * Symbols whose SEC REPORT DATES are refreshed per run, from `submissions`.
 *
 * ── ITS OWN ALLOWANCE, AND A SMALL ONE ───────────────────────────────────
 * This is a SECOND endpoint and a second payload per symbol, and the numbers
 * above — 300/run, ~810 MB of wire, ~50s of a 300s budget — were measured for
 * companyfacts alone. Folding report dates into that loop would silently
 * rewrite every one of those figures, and the first sign would be a cron
 * timing out mid-drain with the manifest half written.
 *
 * So it drains separately and cannot displace the fact-set work: the fact set
 * is what the page's numbers come from, and a date is the smaller loss.
 *
 * 100/RUN IS ~9 DAYS across the CIK-bearing universe, and after that the queue
 * is only what filed — an 8-K is the only thing that moves these dates, so the
 * steady state is the daily filing count, not the universe.
 */
export const SEC_REPORT_DATES_PER_RUN = 100;

/**
 * Sets re-read per run because they were written under an older quarter window.
 *
 * SMALL AND GUARANTEED, which is the whole design. This is a migration with no
 * deadline: nothing is wrong with an 8-quarter set, it simply shows four
 * "not on file" rows the wider window would fill. So it takes a few slots a day
 * and never competes with work a reader is waiting on.
 *
 * Its own slice, not the remainder. Ordering it last would have meant zero
 * re-reads on any day the populate backlog was full — which is exactly the
 * backlog earnings season produces, so the migration would stall precisely
 * when the pages are being read.
 *
 * SIZED FROM THE DRAIN, not picked, and the drain is MEASURED rather than
 * assumed. The census (relay 35004878304) found the store holds 19 sets, all at
 * w=8, and the manifest records only 4 of them as job-written — the other 15
 * are cold-path writes, which leave contentHash null and are therefore
 * populate's, not this queue's. So the eligible backlog on first run is 4
 * SYMBOLS, drained in one run, not 759.
 *
 * WHICH IS WHY THE NUMBER IS NOT 5. A backlog this small makes the allowance
 * look academic today, and it is not: the 740 unpopulated SYMBOLS are written
 * at the current window as populate reaches them, so this queue's real job is
 * the NEXT window change, when the whole populated universe is eligible at
 * once. At 759 SYMBOLS, 5 a run is 152 days — a permanent state rather than a
 * migration. At 25 it is ~31 days, still small enough never to compete with
 * work a reader is waiting on (reverify takes 150 and populate 300 in the same
 * run), and short enough to actually finish.
 */
export const SEC_REWINDOW_PER_RUN = 25;

/**
 * THE POPULATE BACKLOG ABOVE WHICH REWINDOW STOPS BORROWING SLACK.
 *
 * Below this, rewindow may take whatever reverify and populate leave unused in
 * the same run (see populationQueues). Above it, populate is under real
 * pressure — a page reading "not loaded yet" is worse than a page reading a
 * figure from an older window — and rewindow drops back to its guaranteed floor.
 *
 * 400 is a ceiling on the BACKLOG, not on the slice. populate takes 300/run, so
 * a backlog under 400 clears in two runs; above it, the queue is growing faster
 * than one run drains and the slack is not spare.
 */
export const SEC_POPULATE_SLACK_CEILING = 400;

/** SEC asks for at most 10 requests a second with a declared User-Agent. */
const MIN_GAP_MS = 125;

const SEC_UA = process.env.SEC_USER_AGENT || "";

async function authorize(req: NextRequest): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth === `Bearer ${secret}`) return null;
  return guardDebugRequest(req);
}

/**
 * The two queues, in priority order, each capped separately.
 *
 * EXPORTED AND PURE so a check can run it against a fixed manifest. The ordering
 * rule is the whole behaviour of this job and it should not need a network to
 * test.
 */
/**
 * A set that is behind what the code would write today is eligible for a
 * re-read. THE RULE ITSELF NOW LIVES IN lib/server/secStaleness.
 *
 * ── WHY IT MOVED, AND WHY THIS RE-EXPORT STAYS ───────────────────────────
 * Refresh-on-view asks the identical question from the READ path, and a lib
 * module cannot import from a route without inverting the dependency. Two
 * copies of a staleness rule is the shape where one gains a condition and the
 * other does not — and the symptom is a migration that silently completes on
 * one path while the other keeps serving stale sets. So there is one function,
 * and the next PR imports it rather than agreeing with it.
 *
 * ANY OF THE THREE BEING BEHIND IS ENOUGH — quarter window, year window, or
 * the TAG CHAINS the set was read under — and all three feed this ONE queue.
 * A second queue over the same symbols would be two allowances competing for
 * the same re-read: one companyfacts payload produces every one of them, so a
 * set fetched to widen its years arrives with today's chains too.
 *
 * THE QUEUE KEEPS THE NAME `rewindow`. The path, the allowance and the work
 * are unchanged; only the reasons to enter it grew. Renaming it would churn
 * the job's result JSON and the census that reads it for no behaviour.
 */
export { needsReread };

/**
 * CELLS whose existing answer moved — as opposed to cells that are newly
 * present, and periods that are newly present.
 *
 * ── TWO LAYERS OF "NEW IS NOT CHANGED", AND THE SECOND WAS MISSING ───────
 * The first layer was already here: a period present only in the NEW set is a
 * wider window doing its job, not a restatement. Without it a rewindow re-read
 * reported all 759 SYMBOLS as silent restatements and buried the real ones.
 *
 * A CHAIN EDIT PRODUCES THE SAME SHAPE ONE LEVEL DOWN. The period is in both
 * sets; one CELL inside it goes from null to a number, because the chain gained
 * a concept the filer had been publishing all along. That is not a changed
 * answer either — nothing was restated, we simply could not read it before.
 * Measured: 24 of 119 SYMBOLS gain a capex cell on a re-read, 14 of them across
 * all 18 periods, so a whole-array comparison would put NVDA, AMZN, V, HD, CVX
 * and QCOM into the restatement log the first time the queue reached them. Same
 * failure as the window migration, same remedy, one level finer.
 *
 * SO THE COMPARISON IS PER CELL, AND IT IS ASYMMETRIC ON PURPOSE:
 *   null   -> value    NOT logged. The chains gained it.
 *   value  -> value'   LOGGED. The filer's own answer moved.
 *   value  -> null     LOGGED. An answer we had is gone, which is a real
 *                      disturbance and the exact shape sec-capex-blast reports
 *                      as GONE when a same-length frame is displaced.
 *
 * Deliberately NOT `JSON.stringify(before.v) !== JSON.stringify(p.v)` — that is
 * the whole-array test this replaces, and reverting to it re-introduces the
 * noise one migration finer. Deliberately NOT `prior.contentHash !==
 * set.contentHash` either, which is the layer above that and was replaced first.
 *
 * Quarters, years and instants alike: a restatement can land on any of them.
 * Exported and pure so a check can run it against a fixture pair without a
 * network or a store.
 *
 * NAMES THE FIELD, not just the period. "AAPL 2026-06-27 moved" sends the
 * reader to a 46-column array to find out what; the field key is already in
 * hand here and costs nothing to carry.
 */
export function restatedPeriods(
  prior: StoredFactSet | null,
  next: StoredFactSet
): string[] {
  if (!prior) return [];
  const out: string[] = [];
  const lists: [StoredPeriod[], StoredPeriod[]][] = [
    [prior.quarters ?? [], next.quarters ?? []],
    [prior.years ?? [], next.years ?? []],
    [prior.instants ?? [], next.instants ?? []],
  ];
  for (const [was, now] of lists) {
    for (const p of now) {
      const before = was.find((x) => x.e === p.e);
      // ONLY WHERE BOTH SIDES HAVE THE PERIOD. `before` undefined means the
      // period is new to this set — which is what a wider window produces, and
      // is not a changed answer.
      if (!before) continue;
      const moved: string[] = [];
      for (let i = 0; i < before.v.length; i++) {
        // THE ASYMMETRY. A cell that held nothing cannot have been restated.
        if (before.v[i] == null) continue;
        if (p.v[i] === before.v[i]) continue;
        moved.push(`${SEC_FIELD_KEYS[i] ?? `#${i}`}:${before.v[i]}->${p.v[i] ?? "null"}`);
      }
      if (moved.length) out.push(`${p.e}(${p.a ?? "?"}) ${moved.join(" ")}`);
    }
  }
  return out;
}

export function populationQueues(
  manifest: SecManifest,
  limits = {
    reverify: SEC_REVERIFY_PER_RUN,
    populate: SEC_POPULATE_PER_RUN,
    rewindow: SEC_REWINDOW_PER_RUN,
  },
  /**
   * The backlog above which rewindow stops borrowing. A parameter so the check
   * can drive both sides of the boundary without editing the constant.
   */
  slackCeiling = SEC_POPULATE_SLACK_CEILING
) {
  const entries = Object.entries(manifest.symbols).filter(([, e]) => e.cik);

  const reverify = entries
    .filter(([, e]) => e.needsReverify)
    // Oldest enqueue first, so a symbol cannot be starved by a steadier stream
    // of newer events -- the same reason secRereadQueue sorts by enqueuedAt.
    .sort((a, b) => (a[1].enqueuedAt ?? 0) - (b[1].enqueuedAt ?? 0))
    .map(([s]) => s);

  const populate = entries
    .filter(([, e]) => !e.needsReverify && e.contentHash === null)
    .map(([s]) => s)
    .sort();

  // ── REWINDOW: ALREADY POPULATED, UNDER THE OLD WINDOW ────────────────────
  //
  // `contentHash === null` is "never populated", so the populate queue cannot
  // see these — a populated 8-quarter set would otherwise never be re-read and
  // the wider window would never reach a single existing symbol.
  //
  // A GUARANTEED ALLOWANCE, NOT WHATEVER IS LEFT OVER. "Ordered last" reads as
  // safe and is not: populate alone can carry a fortnight's backlog, so last
  // place means zero rewindows a day for a fortnight — and the fortnight that
  // matters is earnings season. Its slice is its own and the other two queues
  // cannot consume it.
  const rewindow = entries
    .filter(([, e]) => !e.needsReverify && e.contentHash !== null && needsReread(e))
    .map(([s]) => s)
    .sort();

  // ── REWINDOW BORROWS WHAT THE OTHER TWO QUEUES DO NOT USE ────────────────
  //
  // THE PROBLEM THIS SOLVES, MEASURED. A chain edit makes the whole populated
  // universe eligible at once — `oneConceptPerFiler` did exactly that, and the
  // census on 01ea371a read 431 SYMBOLS eligible against 25/run: EIGHTEEN DAYS.
  // For eighteen days the store would serve capex resolved under the old rule
  // while the code that replaced it sat in production. That is not a migration,
  // it is a standing discrepancy.
  //
  // AND THE SLACK IS REAL RATHER THAN THEORETICAL. reverify is driven by what
  // actually filed: its allowance is 150 and it took ONE. populate is capped at
  // 300 against a backlog of 323. So 149 of 525 per-run fetches went unspent
  // while the queue that needed them was throttled to 25.
  //
  // THE TOTAL DOES NOT MOVE. rewindow's ceiling is its floor plus exactly what
  // the other two left, so cold + reverify + populate + rewindow still sums to
  // at most the same 525 it did before — no extra wire, no extra wall time, and
  // nothing new to check against SEC's rate limit. This is reallocation, not
  // an increase, and that is the whole reason it needs no new measurement.
  //
  // THE FLOOR IS STILL GUARANTEED. `Math.max` with limits.rewindow, so the
  // borrowing can only ever add. The original design note stands: ordering
  // rewindow last would mean zero re-reads on any day populate is full, which
  // is exactly earnings season.
  //
  // AND IT STOPS WHEN POPULATE IS UNDER PRESSURE. Above the ceiling the backlog
  // is growing faster than one run drains it, so the unused reverify slice is
  // not spare — a symbol showing "not loaded yet" outranks one showing a figure
  // read under an older policy.
  const reverifyTaken = Math.min(reverify.length, limits.reverify);
  const populateTaken = Math.min(populate.length, limits.populate);
  const slack =
    populate.length < slackCeiling
      ? limits.reverify - reverifyTaken + (limits.populate - populateTaken)
      : 0;
  const rewindowLimit = Math.max(limits.rewindow, limits.rewindow + slack);

  return {
    reverify: reverify.slice(0, limits.reverify),
    populate: populate.slice(0, limits.populate),
    rewindow: rewindow.slice(0, rewindowLimit),
    /** What rewindow was actually allowed this run, floor plus borrowed slack. */
    rewindowLimit,
    // The BACKLOG, not just what this run took. A drain that never shortens is
    // invisible from a per-run count alone, and this is the number that says
    // whether the standing path is keeping up.
    reverifyBacklog: reverify.length,
    populateBacklog: populate.length,
    rewindowBacklog: rewindow.length,
  };
}

let lastAt = 0;
async function fetchCompanyFacts(cik: string): Promise<CompanyFacts> {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    { headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  // A 200 CARRYING HTML IS NOT DATA. Parsing one as data is how this site got
  // wrong numbers before; the same strictness that caught Stooq.
  if (!ct.includes("json")) throw new Error(`expected JSON, got ${ct}`);
  return (await res.json()) as CompanyFacts;
}

/**
 * The same rate gate, the other endpoint.
 *
 * SHARES `lastAt` DELIBERATELY. SEC's limit is per requester, not per endpoint,
 * and two fetchers each politely spacing their own calls would between them
 * double the rate the limit is measured at — which is how a well-behaved
 * client gets a block for the whole account.
 */
async function fetchSubmissions(cik: string): Promise<Submissions> {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
    { headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error(`expected JSON, got ${ct}`);
  return (await res.json()) as Submissions;
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  if (!SEC_UA) {
    const summary = {
      ok: false,
      error:
        "SEC_USER_AGENT is unset. SEC's fair-access policy requires a declared, " +
        "contactable agent; fetching without one risks a block on the whole account.",
    };
    await recordJobRun("sec-facts", false, summary);
    console.log("[sec-facts]", JSON.stringify(summary));
    return NextResponse.json(summary, { status: 503 });
  }

  const manifest = await readManifest();
  if (!manifest) {
    const summary = { ok: false, error: "no manifest — run /api/jobs/sec-daily-index first" };
    await recordJobRun("sec-facts", false, summary);
    console.log("[sec-facts]", JSON.stringify(summary));
    return NextResponse.json(summary, { status: 503 });
  }

  // ── FOLD IN THE CIKs THE COLD PATH RESOLVED, BEFORE THE QUEUES ARE BUILT ──
  //
  // ORDER MATTERS AND IS THE POINT. populationQueues filters on `e.cik`, so a
  // symbol whose CIK arrives from the cold path is in NO queue until this has
  // run. Draining after would fill the entry and then leave it unqueued for a
  // whole day — the exact ONDS state this exists to end, one run later.
  const coldCiks = await drainColdCiks(manifest);
  if (coldCiks.conflicts.length) {
    // REPORTED, NOT APPLIED. A CIK that disagrees with the manifest is
    // reconcileCiks's decision, with its ticker map and its change threshold;
    // taking the cold path's value here would route a CIK change around both.
    console.warn(
      `[sec-facts] cold-CIK conflicts (not applied): ` +
        coldCiks.conflicts.map((c) => `${c.symbol} manifest=${c.manifest} cold=${c.cold}`).join(", ")
    );
  }

  const q = populationQueues(manifest);
  const url = new URL(req.url);
  // One symbol, on demand — for checking a single page after a deploy without
  // waiting a day for the cron. Still goes through the same code path.
  const only = (url.searchParams.get("symbol") || "").toUpperCase();
  // THE COLD QUEUE IS NOT IN populationQueues() because it is not in the
  // manifest: a render path may not read the manifest (417 KB per visitor), so
  // the cold path enqueues into its own small ZSET and this reads that.
  const coldSymbols = only ? [] : await readColdQueue(SEC_COLD_PER_RUN);
  const work = only
    ? [{ symbol: only, reason: "manual" as const }]
    : [
        ...coldSymbols.map((symbol) => ({ symbol, reason: "cold" as const })),
        ...q.reverify.map((symbol) => ({ symbol, reason: "reverify" as const })),
        ...q.populate.map((symbol) => ({ symbol, reason: "populate" as const })),
        ...q.rewindow.map((symbol) => ({ symbol, reason: "rewindow" as const })),
      ];

  const results: Record<string, unknown>[] = [];
  /**
   * The sets this run produced, kept so the report-dates phase below does not
   * re-READ from Redis what this loop just WROTE. It needs the period ends, and
   * they are the period ends in hand.
   */
  const setsThisRun = new Map<string, StoredFactSet>();
  /**
   * Rate series already loaded this run, by currency.
   *
   * A run touching twelve euro filers would otherwise pull the same six-year
   * series twelve times. A null entry is a REMEMBERED FAILURE, kept so a
   * source that is down is asked once rather than once per symbol.
   */
  const fxSeriesThisRun = new Map<string, FxSeries | null>();
  /** Symbols whose numbers moved this run — the signal that an 8-K landed. */
  const changedThisRun: string[] = [];
  let written = 0;
  let unchanged = 0;
  let failed = 0;
  /**
   * Pages flushed. NOT the same as `written` by definition — a cold symbol is
   * written without a manifest entry, and a future edit could move the flush —
   * so it is counted where it happens rather than inferred from another number.
   */
  let revalidated = 0;

  for (const { symbol, reason } of work) {
    const entry = manifest.symbols[symbol];
    // A COLD SYMBOL IS OFF-UNIVERSE BY DEFINITION and has no manifest entry, so
    // its CIK comes from the ticker file instead. Looking only in the manifest
    // would fail every symbol this queue exists to serve.
    const cik = entry?.cik ?? cikForSymbol(symbol);
    if (!cik) {
      results.push({ symbol, reason, error: "no CIK in the manifest or the ticker file" });
      failed++;
      continue;
    }
    try {
      const facts = await fetchCompanyFacts(cik);
      const extracted = extractCompanyFacts(symbol, facts);
      // CONVERTED HERE, NOT IN THE EXTRACTION. extractCompanyFacts is
      // network-free and a rate lookup is not; keeping the fetch out here is
      // also what keeps the conversion after differencing, which happens
      // inside it. A USD filer takes no extra call at all.
      const set = await toStoredSet(extracted, defaultSources(), fxSeriesThisRun);
      const rates = identityRates(checkIdentities(extracted));

      const prior = await readFactSet(symbol);
      const changed = prior ? prior.contentHash !== set.contentHash : true;
      // LAYER 2 OF THE CORRECTIONS FAILSAFE (spec §3). A figure that moved with
      // no filing event behind it is a SILENT RESTATEMENT -- the case the
      // amended-form signal cannot see. The site is allowed to update; it is
      // not allowed to update without a trace.
      //
      // ── THE OVERLAP, NOT THE HASH ────────────────────────────────────────
      // A WINDOW CHANGE IS NOT A RESTATEMENT. A rewindow re-read adds four
      // older quarters, which moves contentHash with no filing event behind it
      // -- exactly the shape this logs -- and would have reported every one of
      // 759 SYMBOLS as a silent restatement, burying the real ones in a
      // migration's noise. That is a worse failure than no log at all: a
      // tripwire nobody reads is a tripwire that is off.
      //
      // So the comparison is the OVERLAP: periods present in BOTH sets whose
      // values differ. A period that exists only in the new set is new
      // information, not a changed answer. Deliberately not `prior.contentHash
      // !== set.contentHash` as the trigger -- that is the whole-hash test
      // this replaces, and reverting to it re-introduces the migration noise.
      const movedPeriods = restatedPeriods(prior, set);
      if (prior && movedPeriods.length && !entry.needsReverify) {
        console.warn(
          "[sec-facts] SILENT RESTATEMENT",
          JSON.stringify({ symbol, from: prior.contentHash, to: set.contentHash, movedPeriods })
        );
      }

      if (changed) {
        if (await writeFactSet(set)) written++;
        else throw new Error("fact-set write failed");
        // ── FLUSH THE PAGE THAT IS SHOWING THE OLD ANSWER ────────────────
        //
        // The earnings route inherits `revalidate = 3600`, so whatever it
        // rendered LAST is served for up to an hour -- including a pending
        // card. A cold symbol that timed out or lost the rate budget renders
        // "being fetched", that HTML is cached, and this run is the moment the
        // data actually lands. Without this the visitor who triggered the
        // fetch keeps being told to check back for an hour after it arrived.
        //
        // Cheap and exact: one path, invalidated, re-rendered on the next
        // request from the set just written. Not revalidateTag, which would
        // need a tag on a render this job does not perform; not a shorter
        // `revalidate`, which would make every stock page re-render for the
        // sake of the few that are stale.
        //
        // Inside the `changed` branch deliberately. An unchanged set means the
        // cached HTML is already right, and flushing it would throw away a
        // valid render -- and with it the FMP calls and Redis reads that
        // produced it -- to rebuild the identical page.
        // FLUSHING A PAGE IS A WRITE TO WHAT EVERY VISITOR SEES. A preview
        // deployment invalidating a production route is the same defect as a
        // preview storing a fact set, one layer up.
        if (canWriteSecState()) revalidatePath(`/stock/${symbol}/earnings`);
        else noteSecWriteBlocked("revalidatePath");
        // COUNTED, so "changed-only" is a number rather than a claim about the
        // shape of the code. The cache-health panel shows it against
        // `attempted`: if those two ever converge, the flush has escaped this
        // branch and the cron is re-rendering every stock page it touches.
        revalidated++;
      } else {
        unchanged++;
      }

      // Only a manifest symbol has state to update. A cold symbol's fact set is
      // written and that is the whole of its record -- it is deliberately NOT
      // added to the manifest, which tracks the universe rather than everything
      // anyone has ever looked at.
      if (entry) {
        entry.contentHash = set.contentHash;
        entry.needsReverify = false;
        entry.reverifyReason = null;
        entry.verifiedAt = Date.now();
        // ── WHAT WAS WRITTEN, RECORDED ON THE MANIFEST ────────────────────
        //
        // Written on EVERY pass, not only when `changed` — an unchanged set
        // re-read under the wider window still needs its `w` updated or it
        // stays in the rewindow queue forever, re-read daily, achieving
        // nothing. That is the same "re-fetched every day for the same
        // nothing" loop the cold queue's unconditional clear exists to avoid.
        //
        // The STORED set's own `w` may lag the manifest's when nothing changed
        // — a filer with fewer than 8 quarters to give gains none from the
        // wider window, so no write happens. That is correct and harmless: the
        // manifest is what selects, and the set is already at everything it
        // has.
        //
        // The three counts make the annual-filer census a single manifest read
        // instead of 759 GETs, and cost nothing: the set is already in hand.
        entry.w = set.w ?? SEC_QUARTER_WINDOW;
        entry.y = set.y ?? SEC_YEAR_WINDOW;
        // FROM THE SET for the same reason `c` is, below: the manifest records
        // what actually produced this set, not what was current when the line
        // was written. A set written by the cold path never passes through here.
        entry.lv = set.lv ?? 1;
        // FROM THE SET, NOT FROM secChainsHash() — the manifest must record
        // which chains ACTUALLY produced this set, not which chains were
        // current when the manifest line was written. They are the same value
        // on this path today, and calling the function here would silently stop
        // being true the moment a set arrives from anywhere else (the cold
        // path writes sets this job never sees). Copying the set's own stamp
        // cannot drift from the set.
        entry.c = set.c ?? null;
        entry.quarters = set.quarters.length;
        entry.years = set.years.length;
        entry.instants = set.instants.length;
      }

      setsThisRun.set(symbol, set);
      if (changed) changedThisRun.push(symbol);

      results.push({
        symbol, reason, changed,
        quarters: set.quarters.length, years: set.years.length, instants: set.instants.length,
        coverAsOf: set.cover?.asOf ?? null,
        identities: rates,
        notes: set.notes.length,
      });
    } catch (err) {
      failed++;
      // NOT CLEARED ON FAILURE. Leaving needsReverify set is what makes the next
      // run retry it; clearing it here would turn one bad fetch into a symbol
      // that is never re-read again.
      results.push({ symbol, reason, error: String((err as Error)?.message ?? err) });
    }
  }

  // ── REPORT DATES, FROM THE SUBMISSIONS FEED ──────────────────────────────
  //
  // WHAT THIS WRITES AND WHY IT IS NOT IN THE LOOP ABOVE: companyfacts carries
  // fiscal periods and numbers, and carries no announcement dates at all. When
  // a company told the market is an 8-K Item 2.02 (or, for a foreign private
  // issuer, a 6-K), and that lives in `submissions`. Two endpoints, two
  // payloads, so two allowances — see SEC_REPORT_DATES_PER_RUN.
  //
  // ORDERED: THE FILERS FIRST. A symbol whose fact set changed this run has
  // almost certainly just announced, so its dates are the ones a reader is
  // about to look at. The backfill behind it is the one-off sweep of symbols
  // populated before this existed, and it drains and then stays drained.
  //
  // THE PERIOD ENDS COME FROM THE STORED FACT SET, NEVER FROM THE FILING. That
  // is the whole point of the matching in `reportEvents`: an Item 2.02 8-K's
  // "date of report" is the day results were released, and reading it as a
  // fiscal period end makes every reporting lag zero by construction.
  const reportDates = { attempted: 0, written: 0, failed: 0, noEvents: 0, backlog: 0, dated: 0, pending: 0 };
  const todayIso = new Date().toISOString().slice(0, 10);
  if (!only) {
    const changedSet = new Set(changedThisRun);
    const backfill = Object.entries(manifest.symbols)
      .filter(([sym, e]) => e.cik && !e.reportDatesAt && !changedSet.has(sym))
      .map(([sym]) => sym);
    reportDates.backlog = backfill.length;
    for (const symbol of [...changedThisRun, ...backfill].slice(0, SEC_REPORT_DATES_PER_RUN)) {
      const entry = manifest.symbols[symbol];
      const cik = entry?.cik ?? cikForSymbol(symbol);
      if (!cik) continue;
      reportDates.attempted++;
      try {
        const set = setsThisRun.get(symbol) ?? (await readFactSet(symbol));
        // NO FACT SET, NO PERIOD ENDS, NO MATCHING. Fetching submissions for a
        // symbol whose periods are unknown would produce events with a null
        // period every time — rows that cannot be charted and cannot be
        // estimated from. It waits for populate to reach it.
        if (!set) continue;
        const subs = await fetchSubmissions(cik);
        const quarterEnds = set.quarters.map((p) => p.e).filter(Boolean);
        const yearEnds = set.years.map((p) => p.e).filter(Boolean);
        // ONE PAIRING, TWO OUTPUTS: the events (each period's results 2.02,
        // chosen against its 10-Q/10-K) and the filer's own history of an
        // EARLY non-results 2.02, which is what keeps the current period --
        // no 10-Q yet -- from reading TSLA's delivery 8-K as its results.
        const pairing = resultsPairing(subs, new Set([...quarterEnds, ...yearEnds]));
        const events = pairing.events
          .filter((e) => e.periodEnd)
          .slice(0, STORED_EVENT_LIMIT);
        const earlyNonResults = earlyNonResultsPattern(pairing.periods);
        // ROLLED FORWARD PAST WHAT HAS ALREADY BEEN REPORTED. The fact set
        // lags the filings — companyfacts carries a period once it is FILED —
        // so one cadence step past its newest period can be a date in the
        // past, rendered under "next expected".
        const cadence = nextPeriodEndFrom(quarterEnds, yearEnds);
        const { estimate: next, periodEnd: nextEnd } = estimateUpcoming(
          events, cadence, subs.category, todayIso
        );
        // ── ANNOUNCED BUT NOT YET IN THE FEED ─────────────────────────────
        // Read from the SAME submissions payload already in hand, so this
        // costs nothing beyond the arithmetic. See pendingResults for why it
        // cannot come out of `events`.
        const pending = pendingResults(
          events, latestResultsAnnouncement(subs), cadence, todayIso, earlyNonResults
        );
        // ── category AND annual: ALREADY IN HAND, PREVIOUSLY DISCARDED ────
        // Both were live variables three lines up -- `subs.category` goes into
        // estimateUpcoming and `cadence.annual` decides which deadline column
        // it uses -- and both were then thrown away. The due strip's overdue
        // cap needs exactly these two, and nothing persisted them, so a
        // consumer had to choose between ~50 live SEC fetches per page render
        // and silently taking DEADLINE_FALLBACK.
        //
        // Storing them costs one field each and NO extra request. See the
        // migration note on StoredReportDates.category.
        //
        // `cadence?.annual ?? null` rather than `?? false`: a filer with too
        // thin a history for nextPeriodEndFrom to find a cadence has no
        // annual-ness to record, and writing `false` there would assert
        // "quarterly" about a filer we could not read. Absent means
        // not-yet-known, which is the whole point of the optionality.
        const ok = await writeReportDates({
          symbol, cik,
          at: new Date().toISOString(),
          events,
          nextPeriodEnd: nextEnd,
          next,
          pending,
          category: typeof subs.category === "string" ? subs.category : null,
          annual: cadence?.annual ?? null,
          earlyNonResults,
        });
        if (!ok) { reportDates.failed++; continue; }
        reportDates.written++;
        if (!events.length) reportDates.noEvents++;
        if (next.kind === "date") reportDates.dated++;
        if (pending) reportDates.pending++;
        // STAMPED WHETHER OR NOT IT FOUND ANYTHING, for the same reason the cold
        // queue is cleared on a fetch that populated nothing: a filer with no
        // Item 2.02 history would otherwise sit at the head of the backfill
        // being re-fetched every day forever.
        if (entry) entry.reportDatesAt = Date.now();
      } catch (err) {
        reportDates.failed++;
        console.warn("[sec-facts] report dates failed", symbol, String((err as Error)?.message ?? err));
      }
    }
  }

  // CLEARED WHETHER OR NOT IT POPULATED. A symbol that fetched to nothing --
  // an IFRS filer -- would otherwise sit in the queue being re-read every day
  // forever, which is the same mistake as rendering it as pending.
  const coldCleared = coldSymbols.length ? await clearColdQueue(coldSymbols) : 0;

  // ONE SET, whatever happened — the manifest is a single key.
  const persisted = await writeManifest(manifest);

  const summary = {
    ok: failed === 0 || failed < work.length,
    attempted: work.length,
    written, unchanged, failed, revalidated,
    coldTaken: coldSymbols.length,
    coldCleared,
    coldCikSeen: coldCiks.seen,
    coldCikFilled: coldCiks.filled,
    coldCikCreated: coldCiks.created,
    coldCikConflicts: coldCiks.conflicts.length,
    reverifyTaken: only ? 0 : q.reverify.length,
    populateTaken: only ? 0 : q.populate.length,
    rewindowTaken: only ? 0 : q.rewindow.length,
    reverifyBacklog: q.reverifyBacklog,
    populateBacklog: q.populateBacklog,
    rewindowBacklog: q.rewindowBacklog,
    // SYMBOLS, not filings — the panel's own rule. `dated` is how many of the
    // written records earned a specific next-report date rather than a month
    // or nothing; it is the number that says whether the regularity gate is
    // behaving in production the way the backtest said it does.
    reportDatesAttempted: reportDates.attempted,
    reportDatesWritten: reportDates.written,
    reportDatesFailed: reportDates.failed,
    reportDatesNoEvents: reportDates.noEvents,
    reportDatesDated: reportDates.dated,
    // SYMBOLS showing "announced, not yet in the SEC feed". A number that
    // climbs through earnings season and falls back is the feed catching up;
    // one that only climbs is a bug in the test, not a lag at SEC.
    reportDatesPending: reportDates.pending,
    reportDatesBacklog: reportDates.backlog,
    manifestWritten: persisted,
  };
  await recordJobRun("sec-facts", summary.ok, summary);
  // THE CRON LEAVES NO OTHER TRACE. sec-daily-index ran for a full day writing
  // nothing to the runtime log, and "did it run at all" could not be answered
  // from the Vercel console. One line, always.
  console.log("[sec-facts]", JSON.stringify(summary));

  return NextResponse.json({ ...summary, results });
}
