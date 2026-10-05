// THE STOCK PAGE'S HEADER STRIP (#563 COWORK #99 §4, from CODE-A #137 §4): the
// small pure pieces behind the Price, Day range, Trend score, Volume and RSI
// tiles. No new data: everything is the quote and the daily history the page
// already holds. Exported for scripts/check-header-strip.mjs.

export type Direction = "up" | "down" | "flat";

/** The change's direction; null when there is no change on file. */
export function changeDirection(change: number | null | undefined): Direction | null {
  if (typeof change !== "number" || !Number.isFinite(change)) return null;
  return change > 0 ? "up" : change < 0 ? "down" : "flat";
}

/** ▲ up, ▼ down; nothing for an unchanged price (the "+0.00" says it). */
export const ARROW: Record<Direction, string> = { up: "▲", down: "▼", flat: "" };

/** The screen-reader words for the change, so direction is never colour or glyph alone. */
export function changeAria(change: number | null | undefined, pct: number | null | undefined): string | null {
  const d = changeDirection(change);
  if (d === null || typeof pct !== "number" || !Number.isFinite(pct)) return null;
  if (d === "flat") return "Unchanged today";
  return `${d === "up" ? "Up" : "Down"} ${Math.abs(change as number).toFixed(2)} (${Math.abs(pct).toFixed(2)}%) today`;
}

/** Where `value` sits between `low` and `high`, 0–100 and clamped; 50 for a flat range; null without all three. */
export function rangePosition(low: number | null | undefined, high: number | null | undefined, value: number | null | undefined): number | null {
  if (![low, high, value].every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  const lo = low as number, hi = high as number, v = value as number;
  if (hi < lo) return null;
  if (hi === lo) return 50;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

/** RSI(14) on its 0–100 scale (the 30 and 70 lines are drawn on the same scale). */
export const rsiPosition = (rsi: number | null | undefined) => rangePosition(0, 100, rsi);

/** Today's volume against its average, on a 0–2× scale (1× is the middle). */
export function volumePosition(volume: number | null | undefined, avg: number | null | undefined): number | null {
  if (typeof avg !== "number" || !(avg > 0)) return null;
  return rangePosition(0, 2, typeof volume === "number" ? volume / avg : null);
}

/** SVG polyline points for `values` in a w × h box, min at the bottom; null with fewer than 2 finite values. */
export function sparkPoints(values: readonly number[], w = 100, h = 30): string | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  return v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(2)},${(h - ((x - lo) / span) * h).toFixed(2)}`).join(" ");
}

// ── THE CELLS' MINI-GRAPHICS (#563 COWORK #112) ─────────────────────────────
// Decorative geometry for the five other stat cells, matching the Trend score's
// faint line. Pure: the page's own bars, quote, RSI and P/E in; numbers in a
// 100-wide box out (y grows downward). The figures beside them are the content.

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** y in a box of height h for v on [lo, hi], hi at the top. */
const yOn = (v: number, lo: number, hi: number, h: number) => (hi > lo ? h - ((v - lo) / (hi - lo)) * h : h / 2);

/**
 * Today's candle on the 52-week range (both as y in % of the track, 0 = the
 * 52-week high): the wick low–high, the body open–last (at least MIN_BODY_PCT
 * tall, so a flat day still draws), green when last ≥ open. Without a 52-week
 * range the day's own range fills the track. Null without the day's figures.
 */
export const MIN_BODY_PCT = 2;
export function dayCandle(q: { open?: number | null; high?: number | null; low?: number | null; last?: number | null; yearLow?: number | null; yearHigh?: number | null }):
  { wickTop: number; wickBottom: number; bodyTop: number; bodyBottom: number; lastY: number; up: boolean; onYear: boolean } | null {
  const { high, low, last } = q;
  if (!fin(high) || !fin(low) || !fin(last) || high < low) return null;
  const open = fin(q.open) ? q.open : last;
  const onYear = fin(q.yearLow) && fin(q.yearHigh) && q.yearHigh > q.yearLow;
  const lo = onYear ? Math.min(q.yearLow as number, low) : low, hi = onYear ? Math.max(q.yearHigh as number, high) : high;
  const y = (v: number) => (hi > lo ? ((hi - v) / (hi - lo)) * 100 : 50);
  let bodyTop = y(Math.max(open, last)), bodyBottom = y(Math.min(open, last));
  if (bodyBottom - bodyTop < MIN_BODY_PCT) { const mid = (bodyTop + bodyBottom) / 2; bodyTop = mid - MIN_BODY_PCT / 2; bodyBottom = mid + MIN_BODY_PCT / 2; }
  return { wickTop: y(high), wickBottom: y(low), bodyTop, bodyBottom, lastY: y(last), up: last >= open, onYear };
}

/**
 * The last `n` sessions' volume as bar heights (% of the box, tallest = 100 on
 * a scale that also holds the average), the average's y (% from the top), and
 * which bar is the latest. Sessions without volume (today's partial bar carries
 * none) are left out. Null with fewer than 2 bars.
 */
export function volumeBars(vols: readonly (number | null | undefined)[], avg: number | null | undefined, n = 30): { heights: number[]; avgY: number | null } | null {
  const v = vols.filter((x): x is number => fin(x) && x >= 0).slice(-n);
  if (v.length < 2) return null;
  const top = Math.max(...v, fin(avg) ? avg : 0) || 1;
  return { heights: v.map((x) => (x / top) * 100), avgY: fin(avg) && avg > 0 ? 100 - (avg / top) * 100 : null };
}

/**
 * The last `n` RSI(14) readings as a polyline on a FIXED 0–100 scale (so 70 and
 * 30 sit where they always do) in a 100 × h box, with the 70 / 30 lines' y and
 * the last point. Null with fewer than 2 readings.
 */
export function rsiPane(series: readonly (number | null)[], n = 60, h = 30): { points: string; y70: number; y30: number; last: { x: number; y: number; v: number } } | null {
  const v = series.filter(fin).slice(-n);
  if (v.length < 2) return null;
  const pts = v.map((r, i) => ({ x: (i / (v.length - 1)) * 100, y: yOn(r, 0, 100, h) }));
  const end = pts[pts.length - 1];
  return { points: pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "), y70: yOn(70, 0, 100, h), y30: yOn(30, 0, 100, h), last: { x: end.x, y: end.y, v: v[v.length - 1] } };
}


/**
 * The P/E against its sector median on a number line from 0 (both as % of the
 * line): the scale ends 25% past the larger, so neither sits on the edge.
 * `below` when the stock's P/E is under the median. Null for a missing,
 * negative or zero P/E or median (no diagram: the word stays, as before).
 */
export function peLine(pe: number | null | undefined, median: number | null | undefined): { stock: number; median: number; below: boolean } | null {
  if (!fin(pe) || !fin(median) || !(pe > 0) || !(median > 0)) return null;
  const top = Math.max(pe, median) * 1.25;
  return { stock: (pe / top) * 100, median: (median / top) * 100, below: pe < median };
}

/**
 * The last `n` sessions' closes (and today's price, when it is a later one) as a
 * polyline in a 100 × h box, with the previous close's y on the same scale.
 * Daily closes only: no intraday line is drawn. Null with fewer than 2 points.
 */
export function priceSpark(closes: readonly number[], prevClose: number | null | undefined, n = 5, h = 30): { points: string; prevY: number | null; up: boolean | null } | null {
  const v = closes.filter(fin).slice(-n);
  if (v.length < 2) return null;
  const lo = Math.min(...v, fin(prevClose) ? prevClose : Infinity), hi = Math.max(...v, fin(prevClose) ? prevClose : -Infinity);
  const points = v.map((x, i) => `${((i / (v.length - 1)) * 100).toFixed(2)},${yOn(x, lo, hi, h).toFixed(2)}`).join(" ");
  const last = v[v.length - 1];
  return { points, prevY: fin(prevClose) ? yOn(prevClose, lo, hi, h) : null, up: fin(prevClose) ? last >= prevClose : null };
}
