// What an empty day on /earnings-calendar actually means — and it is FOUR
// different things, only two of which are about the market.
//
// ── THE BUG THIS EXISTS TO CLOSE, FOR THE THIRD TIME ──────────────────────
// #483 built the failure-vs-absence distinction one layer down, in
// earningsCalendar.ts, because "every quote failed" and "every quote
// succeeded and nobody was US-listed" both produced an empty list. It shipped
// `complete` and `getMonthVisibility` to tell them apart.
//
// THE PAGE NEVER CONSULTED EITHER. app/earnings-calendar/page.tsx tested
// `dayData.usListedCount > 0` — a bare emptiness test — so a date whose feed
// read FAILED and a genuinely quiet Sunday rendered the same sentence. The
// signal existed, was exported, and had no caller anywhere in lib/ or app/:
// only the check script read it. A distinction nothing consumes is not a fix.
//
// So the rule that applies here is the one dueStripState.ts already
// established for the due strip, and it is stated the same way:
//
//   we looked, and nothing is there     a fact about the market
//   we could not look                   a fact about US
//
// ── A DENOMINATOR, NOT AN EMPTINESS TEST ──────────────────────────────────
// `usListedCount` alone cannot answer this and no amount of care at the call
// site makes it able to. The answer needs the denominator beside it —
// `totalCandidates` — plus whether the read that produced that denominator
// SUCCEEDED. Zero out of zero candidates on a month we never read is not the
// same fact as zero out of forty on a month we read completely, and the whole
// job of this module is that those two cannot reach the same branch.
import type { EarningsListItem } from "./earningsCalendar";

export type CalendarDayInputs = {
  /** US-listed rows assembled for the date. The numerator. */
  items: EarningsListItem[];
  /** Every candidate the feed listed for the date, US-listed or not. The denominator. */
  totalCandidates: number;
  /**
   * Whether every candidate was quoted with nothing skipped or failed. #483's
   * flag. FALSE IS NOT "EMPTY" -- it is "we have not finished looking".
   */
  complete: boolean;
  /**
   * Whether the month behind this date was read at all. "unknown" means a
   * slice of it FAILED, which is the case that must never render as a quiet
   * market. "unseen" means we have not tried yet, which is also not a claim
   * about the market.
   */
  monthVisibility: "known" | "unknown" | "unseen";
};

export type CalendarDayState =
  /** Rows to render. An existential claim, safe at any coverage. */
  | { kind: "listed"; items: EarningsListItem[]; totalCandidates: number }
  /** Measured: the feed lists nobody for this date. A claim about the market. */
  | { kind: "none-scheduled" }
  /**
   * Measured: candidates existed, all were quoted, none were US-listed. Also a
   * claim about the market, and a DIFFERENT one from none-scheduled -- forty
   * foreign filers is not the same day as an empty calendar.
   */
  | { kind: "none-us-listed"; totalCandidates: number }
  /** We cannot answer. A claim about us. */
  | {
      kind: "unavailable";
      reason: "month-unread" | "month-unseen" | "day-incomplete";
    };

export function resolveCalendarDay(inputs: CalendarDayInputs): CalendarDayState {
  // FIRST, AND BEFORE ANY COUNT IS LOOKED AT. A failed month read can produce
  // any count at all, including a plausible non-zero one from a partial slice,
  // so a count-shaped test can never rule it out. This is the branch whose
  // absence was the bug.
  if (inputs.monthVisibility === "unknown") {
    return { kind: "unavailable", reason: "month-unread" };
  }

  // Rows we have are rows we can show, whatever the month's state -- the claim
  // "these companies filed" is existential and needs no completeness behind
  // it. Only the universal claims below do.
  if (inputs.items.length > 0) {
    return { kind: "listed", items: inputs.items, totalCandidates: inputs.totalCandidates };
  }

  if (inputs.totalCandidates <= 0) {
    // A zero denominator is answered BEFORE it is divided by or reasoned from.
    // Unseen means we never asked; only a month we actually read may say the
    // calendar is empty.
    return inputs.monthVisibility === "known"
      ? { kind: "none-scheduled" }
      : { kind: "unavailable", reason: "month-unseen" };
  }

  // Candidates exist and none of them produced a row. That is only a fact
  // about the market if we finished looking at all of them.
  return inputs.complete
    ? { kind: "none-us-listed", totalCandidates: inputs.totalCandidates }
    : { kind: "unavailable", reason: "day-incomplete" };
}

// ── THE STRINGS, IN ONE PLACE SO THE CHECK CAN ASSERT ON THEM ─────────────
// Same reason as dueStripState.ts: the copy rule IS the deliverable, and a
// rule living only in JSX is one refactor away from being paraphrased back
// into the thing it forbids.
//
// House copy rule: present tense about the public record. Never "will report",
// never a date a company is expected to report on.

export const DAY_NONE_SCHEDULED =
  "No US-listed companies have results on file for this date.";

export const DAY_NONE_US_LISTED =
  "No US-listed companies have results on file for this date. " +
  "Companies outside US listings are not covered by this page.";

/**
 * All three unavailable reasons say the same thing to a reader, and that is
 * deliberate: the reader needs to know the gap is OURS, not that the market
 * was quiet. The reason is kept separate for logs and for the check, not to be
 * turned into three sentences nobody can act on differently.
 */
export const DAY_UNAVAILABLE =
  "Results for this date cannot be listed right now. This is a gap on our side, " +
  "not a quiet day — the record for this date has not been read successfully.";

export function dayStateMessage(state: CalendarDayState): string | null {
  switch (state.kind) {
    case "listed":
      return null;
    case "none-scheduled":
      return DAY_NONE_SCHEDULED;
    case "none-us-listed":
      return DAY_NONE_US_LISTED;
    case "unavailable":
      return DAY_UNAVAILABLE;
  }
}
