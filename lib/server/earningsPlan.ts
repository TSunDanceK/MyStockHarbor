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
