// The share-dilution chart's series, from the stored SEC fact set.
//
// ── WHAT THIS REPLACED ────────────────────────────────────────────────────
// fetchShareHistory in app/stock/[symbol]/page.tsx read FMP's
// stable/income-statement for `weightedAverageShsOut` — not a price, and so not
// something Tiingo takes over; it would simply have stopped when FMP went
// (brief 2026-09-22 §2.2). The stored set carries the same concept as
// `sharesBasic` (us-gaap WeightedAverageNumberOfSharesOutstandingBasic, or its
// ifrs-full equivalent), so the chart moves onto a read the page already makes.
//
// ── WHY THERE ARE FEWER POINTS THAN FMP GAVE ─────────────────────────────
// FMP returned up to 28 periods. The store retains SEC_QUARTER_WINDOW quarters
// (12) and SEC_YEAR_WINDOW years (6), and a derived Q4 carries NO share count:
// a weighted average is never differenced (FieldKind "duration-average"), so
// every fourth quarter is a gap rather than a point. A 10-Q filer therefore
// yields about nine quarterly points. That is reported in the PR rather than
// papered over; widening retention is a separate decision.
//
// PURE — no I/O — so the check suite can run it on committed fixtures.
import type { StoredFactSet, StoredPeriod } from "./secFactCodec";
import { valueOf } from "./secFactCodec";

export type ShareHistoryPoint = { date: string; shares: number };

export type ShareHistory = {
  points: ShareHistoryPoint[];
  /** Which series the points are: quarters, or fiscal years as the fallback. */
  basis: "quarter" | "year";
};

/** The chart needs a spread to draw a trend; fewer than this is no chart. */
export const MIN_SHARE_POINTS = 3;

const seriesOf = (periods: StoredPeriod[]): ShareHistoryPoint[] =>
  periods
    .map((p) => ({ date: p.e, shares: valueOf(p, "sharesBasic") }))
    .filter((p): p is ShareHistoryPoint => typeof p.shares === "number" && p.shares > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

/**
 * Quarters first (finer-grained), fiscal years when quarters give too few
 * points — the same preference fetchShareHistory had against FMP.
 */
export function buildShareHistory(set: StoredFactSet | null): ShareHistory | null {
  if (!set) return null;
  const quarters = seriesOf(set.quarters ?? []);
  if (quarters.length >= MIN_SHARE_POINTS) return { points: quarters, basis: "quarter" };
  const years = seriesOf(set.years ?? []);
  if (years.length >= MIN_SHARE_POINTS) return { points: years, basis: "year" };
  return null;
}
