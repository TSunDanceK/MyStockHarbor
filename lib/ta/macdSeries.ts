// THE MINI MACD CHART'S DATA (#563 COWORK #74): the last ~30 sessions of MACD
// (12, 26, 9), its signal line and their gap (the histogram), the session it
// last crossed, and how long it has been on its current side.
//
// THE PAGE KEEPS ONLY THE LATEST READING (StockSymbolPageClient's buildMacd),
// so this rebuilds the series from the SAME closes with the SAME arithmetic:
// EMAs seeded with the simple average of their first `period` values, the
// signal line an EMA(9) of the MACD values from the first defined one.
// scripts/check-levels-signals.mjs lifts the page's own buildMacd and asserts
// this series ends on exactly its MACD, signal and histogram. The indicator
// code itself is not touched.
//
// SAME CLOSES AS THE PILL, so the chart and the pill never disagree: the page's
// history, which on Tiingo can end with today's labelled partial bar.

/** How many sessions the mini chart shows. */
export const MACD_WINDOW = 30;

export type MacdPoint = { date: string; macd: number; signal: number; hist: number };
export type MacdSeries = {
  points: MacdPoint[];
  /** Index in `points` of the session where the histogram last changed sign, or null when it didn't in the window. */
  crossIndex: number | null;
  /** How many sessions in a row, ending at the latest, MACD has been on its current side of the signal line. */
  run: number;
  /** True when that run fills the whole window (it is at least this long, maybe longer). */
  runFillsWindow: boolean;
};

const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);

/** The page's EMA, line for line: null until `period` values, then seeded by their average. */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let cur = avg(values.slice(0, period));
  out[period - 1] = cur;
  for (let i = period; i < values.length; i++) { cur = (values[i] - cur) * k + cur; out[i] = cur; }
  return out;
}

/** MACD (12, 26, 9) over the bars' closes, as the page computes it, with dates. */
export function macdSeries(bars: readonly { date: string; close: number }[], window = MACD_WINDOW): MacdSeries | null {
  const closes = bars.map((b) => b.close);
  if (closes.length < 35) return null;
  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
  const line = closes.map((_, i) => (e12[i] !== null && e26[i] !== null ? (e12[i] as number) - (e26[i] as number) : null));
  const first = line.findIndex((v) => v !== null);
  if (first < 0) return null;
  const macdVals = line.slice(first) as number[];
  const sig = emaSeries(macdVals, 9);
  const all: MacdPoint[] = [];
  macdVals.forEach((m, j) => {
    const s = sig[j];
    if (s !== null) all.push({ date: bars[first + j].date, macd: m, signal: s, hist: m - s });
  });
  if (!all.length) return null;
  const sideOf = (h: number) => (h > 0 ? 1 : h < 0 ? -1 : 0);
  const now = sideOf(all[all.length - 1].hist);
  let run = 0;
  for (let i = all.length - 1; i >= 0 && sideOf(all[i].hist) === now && now !== 0; i--) run++;
  const points = all.slice(-window);
  // The last session whose side differs from the one before it, inside the window.
  let crossIndex: number | null = null;
  for (let i = points.length - 1; i >= 1; i--) {
    if (sideOf(points[i].hist) !== sideOf(points[i - 1].hist)) { crossIndex = i; break; }
  }
  return { points, crossIndex, run, runFillsWindow: run >= points.length };
}

/** "for 6 sessions", "for 30+ sessions", "for 1 session". */
export function runWords(s: MacdSeries): string {
  if (s.runFillsWindow) return `for ${s.points.length}+ sessions`;
  return `for ${s.run} session${s.run === 1 ? "" : "s"}`;
}
