// THE STOCK PAGE CHART'S READOUT (#553 COWORK #136).
//
// PURE: the bars the chart already draws in, one readout out. Hovering,
// touch-dragging or arrow-stepping picks a bar index; with none picked the
// readout shows the last bar, labelled "Latest close". Nothing here fetches:
// the readout is the same stored series the chart line is drawn from.
//
// Every string is built by hand from UTC fields (utcDay) and toFixed, never
// toLocale*(), so the server render and the browser's first render match.
//
// scripts/check-chart-readout.mjs runs it, with mutants.
import { utcDay } from "@/lib/utcDate";

export type ReadoutBar = {
  date: string;
  close: number;
  /** Tiingo's partial bar: "today so far (IEX), 14:05 ET". */
  label?: string;
  ma50: number | null;
  ma200: number | null;
};

export type ChartReadout = {
  index: number;
  isLatest: boolean;
  /** "Latest close", "Latest price" (a partial bar is not a close) or "Close". */
  heading: string;
  /** "2 Oct 2026", or "2 Oct 2026, today so far (IEX), 14:05 ET". */
  date: string;
  close: string;
  /** vs the previous bar's close; null on the first bar. */
  change: { text: string; dir: "up" | "down" | "flat" } | null;
  ma50: string | null;
  ma200: string | null;
};

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const money = (v: number) => v.toFixed(2);

/** The bar index to show: `picked` clamped into the series, or the last bar when nothing is picked. */
export function shownIndex(picked: number | null, n: number): number {
  if (n < 1) return -1;
  if (picked === null || !Number.isFinite(picked)) return n - 1;
  return Math.min(n - 1, Math.max(0, Math.round(picked)));
}

/** The readout for the bar at `picked` (null = the latest bar). Null for an empty series. */
export function chartReadout(series: readonly ReadoutBar[], picked: number | null): ChartReadout | null {
  const i = shownIndex(picked, series.length);
  if (i < 0) return null;
  const bar = series[i];
  const isLatest = i === series.length - 1;
  const day = utcDay(bar.date) ?? bar.date;
  const prev = i > 0 ? series[i - 1].close : null;
  let change: ChartReadout["change"] = null;
  if (num(prev) && prev > 0 && num(bar.close)) {
    const d = bar.close - prev;
    const pct = (d / prev) * 100;
    // Rounded to the shown precision first, so "+0.00" never shows as up.
    const dir = Number(d.toFixed(2)) > 0 ? "up" : Number(d.toFixed(2)) < 0 ? "down" : "flat";
    const sign = dir === "up" ? "+" : dir === "down" ? "-" : "";
    change = { text: `${sign}${money(Math.abs(d))} (${sign}${Math.abs(pct).toFixed(2)}%)`, dir };
  }
  return {
    index: i,
    isLatest,
    heading: isLatest ? (bar.label ? "Latest price" : "Latest close") : "Close",
    date: bar.label ? `${day}, ${bar.label}` : day,
    close: num(bar.close) ? money(bar.close) : "—",
    change,
    ma50: num(bar.ma50) ? money(bar.ma50) : null,
    ma200: num(bar.ma200) ? money(bar.ma200) : null,
  };
}

/**
 * The next picked index for a key press, or undefined when the key isn't the
 * chart's. ←/→ step one bar (from the latest when nothing is picked), Home/End
 * jump to the ends, Esc returns to the latest (null).
 */
export function stepIndex(picked: number | null, key: string, n: number): number | null | undefined {
  if (n < 1) return undefined;
  const at = shownIndex(picked, n);
  switch (key) {
    case "ArrowLeft": return Math.max(0, at - 1);
    case "ArrowRight": return Math.min(n - 1, at + 1);
    case "Home": return 0;
    case "End": return n - 1;
    case "Escape": return null;
    default: return undefined;
  }
}

/**
 * The bar under a pointer. `fraction` is the pointer's position across the
 * chart box (0 = left edge, 1 = right edge); the plot spans padL..width-padR
 * of the viewBox, and bars are evenly spaced across it.
 */
export function indexAtFraction(fraction: number, n: number, box: { width: number; padL: number; padR: number }): number {
  if (n < 2) return 0;
  const vx = fraction * box.width;
  const t = (vx - box.padL) / (box.width - box.padL - box.padR);
  return Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
}
