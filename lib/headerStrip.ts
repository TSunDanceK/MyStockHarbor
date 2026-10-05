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
