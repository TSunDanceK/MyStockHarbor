// The "expected to report" section's words, in one place so a check can assert
// on them.
//
// SAME REASON AS dueStripState.ts's string block, and the same risk: the copy
// rule IS the deliverable here. This section is the only forward-looking thing
// on a page whose entire spine is the filed record, and one careless rewrite
// turns a measured band into a promised date. A rule that lives only in JSX is
// one refactor from being paraphrased into a forecast.

export const EXPECTED_HEADING = "Expected to report in the next 30 days";

/**
 * Two sentences, and every clause earns its place.
 *
 *  - "estimated from each company's own filing history" -- names the method,
 *    so the reader can discount it.
 *  - "not announced by the company" -- the exact thing a reader would
 *    otherwise assume, said before they assume it.
 *  - "a range rather than a date" -- states the shape of the claim, which is
 *    the whole finding behind this section.
 */
export const EXPECTED_INTRO =
  "Estimated from each company's own filing history — how long it has typically " +
  "taken to report after a period ends. These are not confirmed dates and are not " +
  "announced by the company, so this shows a range rather than a date.";

/** Shown when nothing clears the bar. Not the same as "nothing is coming". */
export const EXPECTED_NONE =
  "No companies in this list have an estimate that clears our accuracy bar right now.";

/** Shown when the record could not be read at all. A fact about us. */
export const EXPECTED_UNAVAILABLE =
  "Estimates cannot be shown right now. This section reads filing histories from " +
  "companies' own SEC filings, and that record is not available — so this is a gap " +
  "on our side, not a quiet month.";

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * The per-row evidence line: the filer's OWN habit, with its sample size.
 *
 * THE SAMPLE SIZE TRAVELS WITH THE NUMBER, always. "usually reports 26 days
 * after period end" over three quarters and over sixteen are different claims,
 * and a reader cannot tell them apart unless the count is printed beside it.
 * Same rule secReportDates applies to `fromEvents`.
 */
export function habitLabel(medianLagDays: number, fromPeriods: number): string {
  return `Usually reports ${medianLagDays} ${plural(medianLagDays, "day")} after a period ends, ` +
    `over its last ${fromPeriods} ${plural(fromPeriods, "period")}`;
}

/** The band a row sits in, as words. NEVER a date. */
export function awayLabel(daysAway: number): string {
  if (daysAway <= 0) return "Expected around now";
  return `Expected in about ${daysAway} ${plural(daysAway, "day")}`;
}

/** What the section can actually see, stated rather than implied. */
export function coverageLabel(shown: number, considered: number): string {
  return `Showing ${shown} of the ${considered} largest companies we track. ` +
    `The rest either have no estimate that clears our accuracy bar, report outside ` +
    `this window, or already appear under “Due to report” above.`;
}

/** The last filing on record — a dated public document, so a date is honest here. */
export function lastReportedLabel(on: string, periodEnd: string | null): string {
  return periodEnd
    ? `Last reported ${on}, for the period ending ${periodEnd}`
    : `Last reported ${on}`;
}
