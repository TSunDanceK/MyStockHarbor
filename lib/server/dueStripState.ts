// The "Due to report" strip's THREE states, and why an empty list is two of them.
//
// ── THE DISTINCTION THIS MODULE EXISTS FOR ────────────────────────────────
// An empty strip has two entirely different causes and they must not render the
// same words:
//
//   we looked, and nothing is outstanding   a fact about the market
//   we have nothing to look in              a fact about US
//
// Rendering the second as the first is a lie the reader cannot detect. It is
// also the exact defect #483 fixed one layer down, where a failed quote and a
// day with no US-listed reporters were indistinguishable because both produced
// an empty list -- see lib/server/earningsCalendar.ts. The same shape reappears
// here at the page, so it gets the same treatment: a distinct flag, threaded
// into the state, rather than an emptiness test that cannot tell them apart.
//
// `lastResultsDate` is null for every symbol until the stage 1 backfill has run
// over the universe. That is the NORMAL state of this page today, not an edge
// case, which is why "no results currently outstanding" would currently be
// false on every render.
//
// ── THE COPY RULE, WHICH IS NOT A STYLE PREFERENCE ────────────────────────
// lib/server/dueToReport.ts establishes that this strip is NOT a forecast. Two
// routes to a real forward calendar were measured and both failed: cadence
// prediction landed 2 of 48 filers inside their own p90 band, and 8-K
// scheduling announcements put 0 of 276 in the band a calendar would need.
//
// So every string here is present tense about the public record -- a period has
// ended and nothing has been filed for it. "Results have not yet been filed",
// never "will report", and never a date a company is expected to report on.
// `expectedOn` exists for ORDERING and is deliberately not rendered as a date.

import type { DueEntry } from "./dueToReport";

/**
 * How much of the manifest can actually answer "has this filed yet".
 *
 * COUNTED, NOT INFERRED FROM THE RESULT. A denominator beside every counter:
 * `withResultsDate` of `universeSize`. Zero entries with a healthy denominator
 * is a real empty; zero entries with a zero denominator is no measurement at
 * all, and the two are the whole point of this module.
 */
export type DueStripInputs = {
  /** Symbols in the analysis universe the strip is computed over. */
  universeSize: number;
  /** Of those, how many carry a non-null lastResultsDate. */
  withResultsDate: number;
  /** Whether the manifest read itself succeeded. A failed read is NOT zero. */
  manifestRead: boolean;
  entries: DueEntry[];
};

export type DueStripState =
  | { kind: "listed"; entries: DueEntry[]; coverage: number }
  /** We measured, and nothing is outstanding. A claim about the market. */
  | { kind: "none-outstanding"; coverage: number }
  /**
   * We cannot answer. A claim about us, and the honest thing to print while
   * the stage 1 backfill has not run.
   */
  | { kind: "unavailable"; reason: "manifest-unread" | "no-results-dates" };

/**
 * THE FLOOR IS NOT ZERO, and picking zero would defeat the module.
 *
 * With one symbol of 700 carrying a results date, "nothing is outstanding" is
 * technically computed and practically meaningless -- the strip would claim the
 * market is quiet on the strength of a single filer. A coverage floor makes the
 * claim proportional to the evidence behind it.
 *
 * 0.5 is a THRESHOLD, not a measurement, and is named as one so it is not later
 * cited as if it had been measured. What is measured is that below it the strip
 * cannot see the top-50 cut it renders: the cut is by market cap and the pool's
 * coverage is uneven, so a half-populated manifest routinely misses the largest
 * names -- the same failure the due-strip canary caught when NVDA fell out of a
 * "top 50" under 99.4% headline coverage.
 */
export const MIN_COVERAGE_TO_CLAIM_EMPTY = 0.5;

export function resolveDueStrip(inputs: DueStripInputs): DueStripState {
  if (!inputs.manifestRead) return { kind: "unavailable", reason: "manifest-unread" };

  // A zero denominator cannot produce a coverage figure, so it is answered
  // before the division rather than by it -- 0/0 is NaN and NaN < 0.5 is false,
  // which would have fallen through to "none outstanding" on an empty manifest.
  if (inputs.universeSize <= 0 || inputs.withResultsDate <= 0) {
    return { kind: "unavailable", reason: "no-results-dates" };
  }

  const coverage = inputs.withResultsDate / inputs.universeSize;

  // Entries first: if something IS outstanding we can say so regardless of
  // coverage, because the claim is existential ("these have not filed") rather
  // than universal ("nothing has"). Only the universal claim needs the floor.
  if (inputs.entries.length > 0) return { kind: "listed", entries: inputs.entries, coverage };

  if (coverage < MIN_COVERAGE_TO_CLAIM_EMPTY) {
    return { kind: "unavailable", reason: "no-results-dates" };
  }
  return { kind: "none-outstanding", coverage };
}

// ── THE STRINGS, IN ONE PLACE SO THE CHECK CAN ASSERT ON THEM ─────────────
// Held here rather than inline in the component because the copy rule is the
// deliverable, and a rule that lives only in JSX is one refactor from being
// paraphrased back into a forecast.

export const DUE_STRIP_HEADING = "Due to report";

export const DUE_STRIP_INTRO =
  "Companies whose fiscal period has ended and whose results have not yet been filed. " +
  "This is a record of what has been filed to date, not a forecast of future filing dates.";

export const DUE_STRIP_NONE_OUTSTANDING =
  "No companies in this list currently have results outstanding.";

export const DUE_STRIP_UNAVAILABLE =
  "Outstanding results cannot be listed right now. This page reads results dates from " +
  "companies' own filings, and that record is not yet populated — so this is a gap on " +
  "our side, not a quiet market.";

/** Present tense, about one symbol's public record. Never "will report". */
export function dueRowLabel(entry: DueEntry): string {
  const d = entry.daysOutstanding;
  const since = d === 1 ? "1 day" : `${d} days`;
  return `Period ended ${entry.periodEnd} · results have not yet been filed · ${since} outstanding`;
}
