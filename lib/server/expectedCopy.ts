// The "expected to report" section's words, in one place so a check can assert
// on them.
//
// SAME REASON AS dueStripState.ts's string block, and the same risk: the copy
// rule IS the deliverable here. This section is the only forward-looking thing
// on a page whose entire spine is the filed record, and one careless rewrite
// turns a measured band into a promised date. A rule that lives only in JSX is
// one refactor from being paraphrased into a forecast.

import type { ExpectedBandId } from "./expectedToReport";

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

// ── THE SAME CLAIM, MADE TO ONE SYMBOL AT A TIME ──────────────────────────
// The ticker search on /earnings-calendar asks the same question the section
// answers, about one company: when will this report. It used to answer from
// FMP's calendar as a flat fact -- "NVDA next reports on Nov 18, 2026" -- with
// no hedge at all, which is the single most confident sentence on the page and
// the only one nothing measured supports.
//
// ITS WORDS LIVE HERE, BESIDE THE SECTION'S, AND NOT IN THE COMPONENT OR IN A
// SECOND COPY MODULE. One estimator now answers both, and two files of copy for
// one claim is how the two drift into making different promises about the same
// number (claude/traps/two-validators-for-one-value.md is the same shape, one
// level down). A check asserts on both blocks together.

/** Under every estimated headline. Never omitted, never softened. */
export const OUTLOOK_HEDGE =
  "Estimated from this company's own filing history — not a confirmed date, and not " +
  "announced by the company.";

/**
 * The band, as the sentence a searcher reads. A RANGE, NEVER A DAY.
 *
 * The section can lean on its layout to carry the uncertainty -- three headed
 * groups, widest thing on screen. A single search result has no layout to lean
 * on, so the range has to be inside the sentence itself.
 */
export function outlookBandLabel(symbol: string, band: ExpectedBandId): string {
  const window =
    band === "d0_7" ? "within the next 7 days"
      : band === "d8_21" ? "in roughly 8 to 21 days"
        : "in roughly 22 to 30 days";
  return `${symbol} is expected to report ${window}.`;
}

/**
 * Estimated, and the estimate lands past the window.
 *
 * NO NUMBER HERE, deliberately. The estimate for a filer 50 days out exists and
 * this module has it, but the measurement behind every claim on this page scored
 * a 30-day window and says nothing about 50 -- and two thirds of its misses fell
 * in the 31-45 day band. "Not in the next 30 days" is the widest statement the
 * evidence supports, so it is the one made.
 */
export function outlookBeyondWindowLabel(symbol: string): string {
  return `${symbol} is not expected to report in the next 30 days.`;
}

/** No estimate we are willing to stand behind. A statement about us. */
export function outlookNoEstimateLabel(symbol: string): string {
  return `We don't have a reliable estimate for ${symbol}'s next report.`;
}

/**
 * Why, in a reader's words rather than the skip's.
 *
 * Each arm is a DIFFERENT OWNER, which is the whole reason the skips are named
 * instead of counted: "we haven't read this filer yet" is our backlog, "it
 * files too irregularly" is the filer's habit, and a reader can tell from the
 * sentence which of the two they are being told.
 */
export function outlookReasonLabel(
  reason: "no-record" | "no-period-end" | "thin-history" | "below-precision-bar" | "estimate-in-past",
): string {
  switch (reason) {
    case "no-record":
      return "We have no SEC filing record for it yet.";
    case "no-period-end":
      return "We can't tell when its current fiscal period ends.";
    case "thin-history":
      return "It has filed too few periods for us to estimate from.";
    case "below-precision-bar":
      return "Its filing dates move around too much for an estimate to be worth showing.";
    case "estimate-in-past":
      return "Our estimate for its last period has already passed with nothing filed since.";
  }
}

/** The record could not be read at all. A gap on our side, said as one. */
export const OUTLOOK_UNAVAILABLE =
  "Report estimates cannot be shown right now. This reads filing histories from companies' " +
  "own SEC filings, and that record is not available — so this is a gap on our side.";
