// THE STOCK PAGE CHART'S FAIR VALUE GAP ZONES (#553 COWORK #140, step 2; ruled in #144).
//
// PURE: the page's own daily bars in, the zones the chart may draw out. The
// detector is lib/ta/fairValueGaps.ts at the ruled defaults (>= 0.5x ATR(14),
// 250 bars); the chart shows the nearest 2 above and 2 below the latest close.
// Nothing here fetches: these are the bars the page already holds.
//
// COMPLETED SESSIONS ONLY. Tiingo's newest point can be today's partial bar
// ("today so far (IEX)"); its range is still moving, so it neither forms nor
// fills a gap here until the session closes.
//
// scripts/check-chart-gaps.mjs holds the rules and mutants.
import { utcDay } from "@/lib/utcDate";
import { FVG_DEFAULTS, fairValueGaps, nearestGaps, type FvgBar } from "@/lib/ta/fairValueGaps";

export type GapInputBar = { date: string; close: number; high?: number; low?: number; label?: string };

export type ChartGapZone = {
  kind: "bullish" | "bearish";
  lower: number;
  upper: number;
  /** The chart index the box starts at: the middle candle's, or 0 when it is older than the chart's window. */
  startIndex: number;
  /** The middle candle's date, "14 Mar". */
  from: string;
};

export type ChartGaps = { zones: ChartGapZone[]; reason: string | null };

/** "No unfilled gaps in the last 12 months": 250 sessions is about a year. */
export const NO_GAPS_REASON = "No unfilled gaps in the last 12 months";
export const PER_SIDE = 2;

const isPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const dayMonth = (iso: string) => utcDay(iso)?.replace(/ \d{4}$/, "") ?? iso;

/**
 * The zones for a chart that draws `chartDates` (ascending), detected on
 * `bars` (the page's full history). With none, the toggle's reason.
 */
export function chartGapZones(bars: readonly GapInputBar[], chartDates: readonly string[]): ChartGaps {
  const done: FvgBar[] = bars
    .filter((b) => !b.label && isPrice(b.high) && isPrice(b.low) && isPrice(b.close))
    .map((b) => ({ date: b.date, high: b.high as number, low: b.low as number, close: b.close }));
  if (done.length < 3 || !chartDates.length) return { zones: [], reason: NO_GAPS_REASON };
  const price = done[done.length - 1].close;
  const shown = nearestGaps(fairValueGaps(done, FVG_DEFAULTS), price, PER_SIDE);
  const first = chartDates[0];
  const zones: ChartGapZone[] = [];
  for (const g of shown) {
    const at = chartDates.indexOf(g.date);
    // Older than the chart's window: the box starts at its left edge.
    const startIndex = at >= 0 ? at : g.date < first ? 0 : -1;
    if (startIndex < 0) continue;
    zones.push({ kind: g.kind, lower: g.lower, upper: g.upper, startIndex, from: dayMonth(g.date) });
  }
  return { zones, reason: zones.length ? null : NO_GAPS_REASON };
}

/** The readout's words for a point inside a zone: "In a bullish gap (from 14 Mar)". */
export const inGapWords = (z: ChartGapZone) => `In a ${z.kind} gap (from ${z.from})`;

/** The zone a chart point (bar index, price) sits in, if any: after the box's start, between its edges. */
export function zoneAt(zones: readonly ChartGapZone[], index: number, value: number): ChartGapZone | null {
  return zones.find((z) => index >= z.startIndex && value >= z.lower && value <= z.upper) ?? null;
}
