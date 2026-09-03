// How much earnings work a peak day actually is, and how many passes cover it.
//
// WHY THIS IS A MODULE AND NOT A SENTENCE IN A PR.
//
// The question it answers -- "can one daily pass cover the busiest day of
// earnings season?" -- has an arithmetic answer, and the alternative to
// computing it is typing a pass count into a cron expression. A hand-typed
// `15,27,39 7 * * *` encodes "3" as a magic number with no link to the numbers
// that produced it, and this repo has already paid for exactly that shape once:
// PRICE_TARGET_RUNS stated throughput in a unit that silently changed meaning,
// and when #374 restaggered the crons full price coverage stretched from ~12 to
// ~20 minutes with no line of code changing and nobody noticing for months.
//
// So the pass count is DERIVED from four real constants and printed on the
// probe's output. If the derivation says three, three is fine -- arrived at,
// not chosen.
//
// THE UNIT IS THE SAME ON BOTH SIDES, which is the part that made the old
// constant dangerous. fetchFmpEarnings makes exactly ONE FMP call per symbol,
// so "symbols in a batch", "calls in a run" and EARNINGS_BATCH_SIZE are the
// same number in the same unit. If that ever stops being true -- a batched
// endpoint, a retry inside the fetch -- this file is wrong and the check below
// is what should be updated first.

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE INPUT THAT CANNOT BE A CONSTANT, AND IS ONE ANYWAY.
//
// planEarningsDay needs the share of a season's reports that land on its
// busiest day. That is a MEASUREMENT -- it comes from the earnings calendar,
// not from anything in this repository -- and a build-time constant cannot read
// Redis or call FMP. So it is recorded here, WITH ITS PROVENANCE, because a
// bare 0.0935 with no history is exactly as bad as a typed batch size.
//
// PROVENANCE. /api/debug/earnings-concentration, re-run 2026-09-03 with
// ?fresh=1 AFTER #411's slicing, over 2026-01 and 2026-02:
//
//     2026-01   1,654 rows   1 fetch
//     2026-02   6,018 rows   3 fetches   cappedDays: []   truncated: false
//                                        dateRange 2026-02-01 -> 2026-02-28
//     distinct symbols  7,559
//     busiest day       2026-02-26, 710 symbols
//     share in the busiest 20 trading days   0.848
//
// That run's impliedPeakDayRefreshes were 72 at 762, 141 at 1,500 and 281 at
// 3,000, which pins the share to [0.09333, 0.09367). The value below sits
// inside that window and reproduces all three counts exactly -- and
// scripts/check-earnings-batch.mjs asserts that it still does, so the constant
// is re-derived from the numbers it came from on every build rather than
// trusted because it is written down.
//
// WHY THIS IS NOT COMPUTED AT RUNTIME, which was the better-sounding option:
//
//   THE BATCH MUST BE SIZED FOR THE PEAK, AND THE PEAK IS SEASONAL. A job
//   running in September that derives the share from the calendar it has
//   cached derives September's share -- a fraction of February's -- and sets a
//   batch that is too small for eleven months of the year, in the one
//   direction that fails silently. To size for the peak at runtime it would
//   have to read FEBRUARY from September, which is outside the window the
//   calendar cache is built for (three months forward), so it would mean new
//   FMP fetches of a distant month on a job that has no other reason to want
//   one.
//
//   AND A RUNTIME VALUE CANNOT FAIL A BUILD. The coupling below -- raise the
//   universe cap and the batch must follow -- is only enforceable against a
//   value a check can read statically. That enforcement is the point of the
//   whole exercise; PRICE_TARGET_RUNS was wrong for months precisely because
//   nothing could compare it to anything.
//
//   Cost if it were done anyway, for the record: ~1.4 MB of Redis calendar
//   reads per run plus one to three FMP calls for an out-of-window month, and
//   a new failure mode where an empty or 402'd month shrinks the batch.
//
// WHEN TO RE-TAKE IT. Whenever the calendar's SHAPE changes rather than its
// size: a new reporting-season pattern, an exchange added or dropped from
// FMP's feed, or the page cap moving again. Universe growth does NOT require a
// re-take -- the share is per-symbol, which is the whole reason it is a share.
// Re-running the probe prints the replacement.
export const EARNINGS_PEAK_DAY_SHARE = 0.0935;

/** The probe run this share came from, so the constant carries its own date. */
export const EARNINGS_PEAK_SHARE_MEASURED_AT = "2026-09-03";

/**
 * The months measured, and how.
 *
 * AS DATA RATHER THAN PROSE, and that is not tidiness. The provenance was
 * written in the comment block above and scripts/check-earnings-batch.mjs
 * reads sources through readCodeOnly, which strips comments -- so the
 * assertion that this share names its months FAILED, correctly, against a
 * provenance the build cannot see. A fact worth asserting has to be a value.
 */
export const EARNINGS_PEAK_SHARE_SOURCE = {
  months: ["2026-01", "2026-02"] as const,
  probe: "/api/debug/earnings-concentration?fresh=1",
  /** Slicing had to land first (#411) or February was truncated to 4,000 rows. */
  requiresSlicing: true,
} as const;

/**
 * The counts the recorded share must still reproduce.
 *
 * NOT DECORATION. These are the three impliedPeakDayRefreshes figures the probe
 * printed, and the check re-derives them from EARNINGS_PEAK_DAY_SHARE. A share
 * edited without re-running the probe fails the build against its own
 * provenance -- which is the difference between a measurement and a number.
 */
export const EARNINGS_PEAK_SHARE_WITNESSES: Array<{ universe: number; reporters: number }> = [
  { universe: 762, reporters: 72 },
  { universe: 1500, reporters: 141 },
  { universe: 3000, reporters: 281 },
];

/**

 * How many times one report costs a fetch, derived rather than assumed.
 *
 * THE CHAIN, traced through computeEarningsTtlSeconds rather than taken on
 * trust, for a symbol reporting on date D under the live daily cadence:
 *
 *   long TTL is `secondsUntil - EARNINGS_TTL_DAY`, so the key expires exactly
 *   ONE DAY before the report                                    -> D - 24h
 *   the first run after that expiry refetches                    -> FETCH 1
 *   now secondsUntil <= 2 days, so the TTL is 12h -- but the job runs once a
 *   day, so 12h is unreachable and the NEXT RUN is what refetches -> FETCH 2
 *   at that run the report date is no longer in the future, so the TTL jumps
 *   back to ~a quarter                                            -> done
 *
 * TWO, and it is two because of the CADENCE, not because of the 12h TTL. That
 * distinction matters: the figure rises to three the moment the job runs twice
 * a day, and a number typed as "x2" would not have moved.
 *
 * The effective period is `max(runPeriod, nearReportTtl)` because whichever is
 * longer is what actually gates a refetch -- runs more frequent than the TTL
 * find the key still warm and do nothing.
 */
export function fetchesPerReport(
  runPeriodSeconds: number,
  leadSeconds: number,
  nearReportTtlSeconds: number
): number {
  if (
    !Number.isFinite(runPeriodSeconds) ||
    !Number.isFinite(leadSeconds) ||
    !Number.isFinite(nearReportTtlSeconds) ||
    runPeriodSeconds <= 0 ||
    leadSeconds <= 0 ||
    nearReportTtlSeconds <= 0
  ) {
    // A missing input is not "one fetch". Refusing to answer is the honest
    // outcome; every caller here reports the plan rather than acting on it.
    return NaN;
  }
  const effectivePeriod = Math.max(runPeriodSeconds, nearReportTtlSeconds);
  return 1 + Math.ceil(leadSeconds / effectivePeriod);
}

export type EarningsDayPlan = {
  universeSize: number;
  /** Symbols of that universe reporting on the single busiest day. */
  peakDayReporters: number;
  fetchesPerReport: number;
  /** What the busiest run has to do. */
  callsOnPeakRun: number;
  callsPerRun: number;
  passesNeeded: number;
  /** EARNINGS_BATCH_SIZE would have to be at least this, at that pass count. */
  batchPerPass: number;
  /** True when one daily pass covers the peak day -- the question being asked. */
  onePassSuffices: boolean;
};

/**
 * What the busiest day of the season demands, and whether one run covers it.
 *
 * PURE over its inputs so the invariant check can RUN it at each universe size
 * rather than reading a table someone wrote out by hand.
 *
 * WHAT THIS MODEL DOES NOT COUNT, stated because the answer at 1,500 sits at
 * 94% of the per-run ceiling and the remaining 6% is not all spare:
 *
 *   * RETRIES. A failed symbol stays in the queue and is fetched again on the
 *     next run, so a bad FMP day adds work the peak-day arithmetic does not
 *     see.
 *   * THE UNKNOWN-DATE BUCKET. computeEarningsTtlSeconds gives a symbol with no
 *     future date EARNINGS_TTL_UNKNOWN_SECONDS (10 days), so those refetch on a
 *     rotation of their own, independent of any reporting season.
 *   * THE BASE ROTATION. Every symbol refetches at least once a quarter under
 *     the 95-day cap.
 *
 * All three are small against a peak day and none is zero. Read the headroom
 * below the ceiling as smaller than the percentage suggests, and do not treat
 * 94% as 6% of slack.
 *
 * THE PEAK RUN CARRIES TWO DAYS' WORK, which is the part that is easy to get
 * wrong by a factor of two in the reassuring direction. Fetch 1 for a symbol
 * reporting on D lands on the run of D-1; fetch 2 lands on the run of D. So the
 * run on day X does `R(X) + R(X+1)` fetches, and in peak season the busiest day
 * is flanked by other busy days -- which is why the multiplier is applied to
 * the peak count rather than to an average.
 */
export function planEarningsDay(input: {
  universeSize: number;
  peakDayShare: number;
  callsPerRun: number;
  runPeriodSeconds: number;
  leadSeconds: number;
  nearReportTtlSeconds: number;
}): EarningsDayPlan | null {
  const { universeSize, peakDayShare, callsPerRun } = input;
  if (
    !Number.isFinite(universeSize) ||
    !Number.isFinite(peakDayShare) ||
    !Number.isFinite(callsPerRun) ||
    universeSize <= 0 ||
    peakDayShare <= 0 ||
    callsPerRun <= 0
  ) {
    return null;
  }
  const per = fetchesPerReport(
    input.runPeriodSeconds,
    input.leadSeconds,
    input.nearReportTtlSeconds
  );
  if (!Number.isFinite(per)) return null;

  const peakDayReporters = Math.ceil(universeSize * peakDayShare);
  const callsOnPeakRun = peakDayReporters * per;
  const passesNeeded = Math.ceil(callsOnPeakRun / callsPerRun);

  return {
    universeSize,
    peakDayReporters,
    fetchesPerReport: per,
    callsOnPeakRun,
    callsPerRun,
    passesNeeded,
    batchPerPass: Math.ceil(callsOnPeakRun / passesNeeded),
    onePassSuffices: passesNeeded <= 1,
  };
}
