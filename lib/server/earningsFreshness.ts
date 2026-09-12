// What "stale earnings" actually means, and who is entitled to say so.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FINDING THIS FILE EXISTS FOR.
//
// /cache-health, 2026-09-11:
//
//     Earnings   12 / 349 · 337 past their TTL · oldest 19d ago · policy 7d
//                "96% of observed symbols past their own TTL"
//
// and warm-earnings, 7h earlier, on the same page:
//
//     checked 6 · fetched 6 · deferred 0 · failed 0 · outOfTime false
//
// Six checked against 337 past TTL, not capacity-limited, not out of time, not
// failing. Two readings of the same dataset that disagree by a factor of 56.
//
// ONE OF THEM WAS WRONG, AND IT WAS THE PAGE. The chain, traced rather than
// assumed:
//
//   1. Both enqueue sites gate on the SAME condition -- warm-earnings'
//      enqueueDynamicUniverseMissing and pickersBuilder's queueEarningsSymbols
//      each skip a symbol whose cached rows are non-empty. So the job's notion
//      of "due" is exactly "the Redis key is gone".
//   2. The key's lifetime is computeEarningsTtlSeconds, which returns
//      min(secondsUntilNextReport - 1 day, 95 days) between reports.
//   3. markRefreshed("earnings", ...) is the only writer of a non-zero staleness
//      score, and it only fires when the job refetches -- which only happens
//      after (2) expires.
//
//   Therefore the staleness score tracks KEY EXPIRY, and key expiry is designed
//   to be up to 95 days apart. earningsPlan.ts says so outright: "THE BASE
//   ROTATION. Every symbol refetches at least once a quarter under the 95-day
//   cap." A correctly cached symbol at rest reads "past a 7-day TTL" for up to
//   94 days in every 95. 96% past TTL was the DESIGNED steady state.
//
// AND THE FOUR-DAY SWING IS EXPLAINED BY THE SAME ARITHMETIC. The dataset read
// 371 / 550 with 31% past TTL on 2026-09-07 and 12 / 349 with 96% four days
// later. Three changes landed 2026-09-01..03 -- #391 (the render path joined
// the store), #406 (the run stopped abandoning at 110 calls) and #412 (the
// batch went from 40 to 262) -- and together they drained a backlog of several
// hundred symbols over 2026-09-02..04. Every one of those got a refresh stamp
// within a couple of days of the others, so the whole cohort sat inside a
// 7-day window on the 7th and had crossed out of it by the 11th. One cohort,
// one line, four days. Nothing rotted.
//
// WHY THE 7 WAS NEVER ARGUED. Every other entry in DATASETS carries a comment
// defending its number -- 26h for dailyHistory "NOT the 50h Redis TTL", 30d for
// profile "effectively static", 15m for pricePool with a fifteen-line note on
// why it is red all night. `earnings: 7 days` carried none. It is the one
// number in that table nobody derived, and it is the one that was wrong.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE COST OF LEAVING IT AT 7, stated because "the page was a bit pessimistic"
// undersells it. A policy that 90%+ of a dataset fails at all times, by design,
// is an alarm that cannot be acted on -- so it is ignored, and then the morning
// it means something it is ignored too. The pricePool note in stalenessQueue.ts
// already names this exact failure for a different dataset ("a page that cannot
// tell IDLE-BECAUSE-CORRECT from BROKEN reports the more alarming of the two,
// every night, until the alarm is ignored"). Earnings had the same disease and
// no diagnosis.
//
// AND THE COST OF THE FIX, which is real and is why the run-record comparison
// in warm-earnings is part of the same change rather than a nice-to-have: a
// ~97-day policy cannot detect a three-week outage. It is not supposed to. The
// dataset row now answers "is any symbol older than this store is allowed to
// let it get", which is a question with a derivable answer; "did the job keep
// up yesterday" moves to the job's own record, where it is answerable in a day
// instead of a quarter.
import {
  EARNINGS_TTL_MAX_SECONDS,
  EARNINGS_TTL_UNKNOWN_SECONDS,
} from "./earningsStore";
import { JOBS, cronIntervalSeconds } from "./jobRuns";

/**
 * How often the dynamic-universe backfill enqueue is allowed to run.
 *
 * LIVES HERE RATHER THAN IN THE ROUTE because the staleness policy below is
 * derived from it: this is the lag between a key expiring and anything
 * noticing. A constant that another module's arithmetic depends on should not
 * sit in a route handler where only a grep can find it.
 *
 * The enqueue does one bulk read of up to ~700 cached-earnings entries to find
 * which are missing; throttling it to once an hour keeps that read rare even if
 * the job itself is hit every few minutes.
 */
export const EARNINGS_ENQUEUE_THROTTLE_SECONDS = 60 * 60;

/**
 * Runs allowed between a symbol being enqueued and it being fetched.
 *
 * TWO, and the second one is not padding. Fetch 1 for a symbol reporting on D
 * lands on the run of D-1 and fetch 2 on the run of D (earningsPlan.ts,
 * fetchesPerReport), and EARNINGS_BATCH_SIZE is sized to exactly one peak day's
 * work -- so on the busiest day of the season the batch is full and a symbol
 * enqueued that morning can legitimately wait for the next run. One run of
 * slack would make the policy call a peak day a fault.
 */
export const EARNINGS_DRAIN_RUNS = 2;

/**
 * The age at which an earnings refresh stamp is a FAULT rather than the
 * expected state.
 *
 * DERIVED, because the number it replaces was typed. Three terms, each the
 * answer to "what is the longest this can legitimately take":
 *
 *   the store's own ceiling   how long computeEarningsTtlSeconds may hold a key
 *                             without a refetch -- 95 days, the quarter cap
 *   the enqueue lag           a key that expired is invisible until the
 *                             throttled backfill next runs
 *   the drain                 and then it has to be picked off the queue
 *
 * PURE OVER ITS INPUTS so scripts/check-earnings-due-selection.mjs can RUN it
 * against the real constants instead of reading a number someone wrote down.
 * Every assertion in this series that grepped a constant rather than running
 * the arithmetic has eventually passed for the wrong reason.
 *
 * THE UNKNOWN-DATE BUCKET IS NOT THE CEILING, checked rather than assumed:
 * EARNINGS_TTL_UNKNOWN_SECONDS is 10 days, well inside the 95-day cap, so it
 * never widens this. It is taken as an input anyway so that raising it past the
 * cap moves the policy instead of silently escaping it.
 */
export function earningsStaleAfterSeconds(input: {
  maxTtlSeconds: number;
  unknownTtlSeconds: number;
  enqueueThrottleSeconds: number;
  runPeriodSeconds: number;
  drainRuns: number;
}): number {
  const {
    maxTtlSeconds,
    unknownTtlSeconds,
    enqueueThrottleSeconds,
    runPeriodSeconds,
    drainRuns,
  } = input;
  const longest = Math.max(maxTtlSeconds, unknownTtlSeconds);
  return longest + enqueueThrottleSeconds + Math.max(0, drainRuns) * runPeriodSeconds;
}

export const EARNINGS_STALE_AFTER_SECONDS = earningsStaleAfterSeconds({
  maxTtlSeconds: EARNINGS_TTL_MAX_SECONDS,
  unknownTtlSeconds: EARNINGS_TTL_UNKNOWN_SECONDS,
  enqueueThrottleSeconds: EARNINGS_ENQUEUE_THROTTLE_SECONDS,
  runPeriodSeconds: cronIntervalSeconds(JOBS["warm-earnings"].cron),
  drainRuns: EARNINGS_DRAIN_RUNS,
});

/**
 * Symbols the staleness record calls past-TTL that the job does not know are
 * due.
 *
 * THE SIGNAL THAT WOULD HAVE CAUGHT THE 6-AGAINST-337 LINE, and the reason it
 * is a SET DIFFERENCE rather than a subtraction of two counts. `337 - 6 = 331`
 * is satisfied by any 331 symbols; it cannot tell "the job is behind on the
 * same symbols the page is worried about" from "the page is worried about
 * symbols the job has never heard of". Only the second is a fault, and only the
 * second is what an orphaned symbol -- registered in the staleness queue, absent
 * from BOTH enqueue sources, so nothing will ever refetch it -- actually looks
 * like.
 *
 * Once the policy above is honest, the two sides mean the same thing: past TTL
 * means "the key is long gone and nothing refetched it", and the work queue is
 * "the key is gone". A symbol in the first and not the second is a symbol
 * rotting outside the job's view.
 *
 * NOTE THE ASYMMETRY, which is deliberate. The reverse difference -- queued but
 * not past TTL -- is the NORMAL case (a key that expired an hour ago is due and
 * nowhere near the policy age) and is not reported as anything.
 */
export function unexplainedStaleSymbols(
  pastTtl: readonly string[],
  workQueue: readonly string[]
): string[] {
  const queued = new Set(workQueue.map((s) => String(s).toUpperCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of pastTtl) {
    const symbol = String(raw).toUpperCase();
    if (!symbol || queued.has(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}
