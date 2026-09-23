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
// yields about nine quarterly points. So the extractor now stores ONE extra
// series, fiscal-year basic shares for every year in the payload
// (StoredFactSet.as). The chart COMBINES the two: yearly points up to the
// first stored quarter, then every stored quarter — retention itself is not
// widened (owner, #517, second decision; the first shape — years, then only
// the quarters after the last fiscal year-end — gave ONDS and ABVX fewer
// points than quarters alone, relay 35780595913).
//
// PURE — no I/O — so the check suite can run it on committed fixtures.
import type { StoredFactSet, StoredPeriod } from "./secFactCodec";
import { valueOf } from "./secFactCodec";

export type ShareHistoryPoint = { date: string; shares: number };

export type ShareHistory = {
  points: ShareHistoryPoint[];
  /**
   * Which series the points are. "annual+quarters" is the long history: the
   * fiscal years in the payload (StoredFactSet.as) that end before the first
   * stored quarter, then every stored quarter. "quarter" / "year" are the fallback for a
   * set written before `as` existed.
   */
  basis: "annual+quarters" | "quarter" | "year";
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
  // ── THE LONG HISTORY, WHERE THE SET CARRIES IT ────────────────────────────
  // Yearly points back as far as companyfacts goes UP TO THE FIRST STORED
  // QUARTER, then every stored quarter — the owner's shape (2026-09-22, #517),
  // chosen over widening retention. A year that ends on or after the first
  // quarter is left to the quarters, so no stretch is drawn twice.
  if (set.as?.length) {
    const quarters = seriesOf(set.quarters ?? []);
    const firstQuarter = quarters[0]?.date ?? "9999-12-31";
    const years = set.as
      .filter(([date, v]) => typeof v === "number" && v > 0 && date < firstQuarter)
      .map(([date, shares]) => ({ date, shares }));
    const points = [...years, ...quarters];
    if (points.length >= MIN_SHARE_POINTS) return { points, basis: "annual+quarters" };
  }
  const quarters = seriesOf(set.quarters ?? []);
  if (quarters.length >= MIN_SHARE_POINTS) return { points: quarters, basis: "quarter" };
  const years = seriesOf(set.years ?? []);
  if (years.length >= MIN_SHARE_POINTS) return { points: years, basis: "year" };
  return null;
}
