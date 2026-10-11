// THE ANNUAL-ONLY LAYOUT FOR 20-F / 40-F FILERS (#535 COWORK #15).
//
// A foreign private issuer files its annual report with the SEC on Form 20-F
// (or, for eligible Canadian issuers, 40-F) and publishes its quarterly
// results outside the SEC's structured data (a 6-K press release without XBRL
// financial statements). Its stored set therefore has fiscal years and no
// current quarters, and a quarterly page shows it as a page of holes. These
// filers get a deliberate annual page instead.
//
// ── THE RULE, BY FILER TYPE, NOT A LIST ──────────────────────────────────
// Annual-only when BOTH hold:
//   1. its annual form (data/sec/registrants.json `annualForm`) is 20-F or
//      40-F; and
//   2. its newest stored quarter ended MORE THAN 6 MONTHS ago (or it has none).
// A stored quarter can only come from a filing with XBRL financial statements
// (a 10-Q, or a 6-K that carries them), so (2) is "no structured quarter
// lately". A filer that files quarters would always have a newer one; one
// that starts filing 10-Qs keeps or regains the quarterly layout
// automatically — nothing is listed.
//
// 6 MONTHS, NOT 18 (owner, #535 COWORK #19 §2, 2026-09-23): under 18, BMO
// (newest quarter 2025-10-31) and ONON (2025-06-30) kept a quarterly page a
// year out of date, because their newer results sit only in 6-Ks. Measured on
// the live sets that day: of 156 stored 20-F/40-F sets, 148 are annual-only
// under 6 months (111 under 18); ARM and ICLR (newest 2026-06-30) stay
// quarterly; none has a half-yearly cadence that would flip within a year.
//
// PURE throughout: the pages pass in the form, the set and today.
import type { StoredFactSet } from "./secFactCodec";
import type { SymbolOutlook } from "./symbolOutlook";

export type AnnualForm = "20-F" | "40-F";

/** How far back a stored quarter still counts as "the filer publishes quarters". */
export const ANNUAL_ONLY_QUARTER_MONTHS = 6;

export function annualOnlyForm(
  annualForm: string | null | undefined,
  set: Pick<StoredFactSet, "quarters" | "years"> | null | undefined,
  today: string,
): AnnualForm | null {
  if (!set || !set.years.length) return null;
  const form = (annualForm ?? "").toUpperCase();
  const kind: AnnualForm | null = form.startsWith("20-F") ? "20-F" : form.startsWith("40-F") ? "40-F" : null;
  if (!kind) return null;
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - ANNUAL_ONLY_QUARTER_MONTHS);
  const cut = cutoff.toISOString().slice(0, 10);
  const recentQuarter = set.quarters.some((q) => q.e >= cut);
  return recentQuarter ? null : kind;
}

/** The one short note at the top of both pages. Filed facts, hedged, no instruction. */
export function annualOnlyNote(form: AnnualForm): string {
  return `This company files its annual report with the SEC on Form ${form}. ` +
    "Its quarterly results are published outside the SEC's structured data, so this page shows full fiscal years.";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * THE NEXT ANNUAL REPORT, AS A MONTH — never a day (#534's rule).
 *
 * From the newest fiscal year's own filing: its filed date is the one filing
 * date the set records reliably for that period (an older year's `f` can be a
 * later filing's comparative). One observation, so the hedge says so.
 */
export function annualNextReportOutlook(
  symbol: string,
  set: Pick<StoredFactSet, "years">,
  form: AnnualForm,
): SymbolOutlook {
  const y = set.years[0];
  const filed = y?.f && /^\d{4}-\d{2}-\d{2}$/.test(y.f) ? y.f : null;
  const label = y?.fy ? `FY${y.fy}` : "the latest fiscal year";
  if (!y || !filed || filed < y.e) {
    return {
      symbol, kind: "no-estimate", reason: "no-period-end",
      headline: "No estimate for the next annual report yet.",
      hedge: `The filing date of this company's latest Form ${form} is not in the data this page reads.`,
      evidence: [],
    };
  }
  const month = MONTHS[Number(filed.slice(5, 7)) - 1];
  return {
    symbol, kind: "beyond-window",
    headline: `The next annual report is typically filed around ${month}.`,
    // THE CARD VALUE AND THE GREY LINE UNDER IT, in the owner's words (#535
    // COWORK #22 §5). A month, never a day.
    value: `Est. ${month}`,
    hedge: `Based on when the latest Form ${form} was filed; timing may differ.`,
    evidence: [`${label} (year ending ${y.e}): Form ${form} filed ${filed}.`],
  };
}

/** Reaction bars around annual-report events only: the period is a stored fiscal year. */
export function annualReactionEvents<T extends { periodEnd: string | null }>(
  events: T[],
  set: Pick<StoredFactSet, "years">,
): T[] {
  const yearEnds = new Set(set.years.map((y) => y.e));
  return events.filter((e) => e.periodEnd !== null && yearEnds.has(e.periodEnd));
}

/** Fewer than this many annual reaction points and the card is hidden. */
export const ANNUAL_REACTION_MIN = 3;
