// FAIR VALUE GAPS ON DAILY BARS (#553 COWORK #140; CODE-A #137 §2).
//
// PURE: bars in, the gaps that are still open out. No fetch, no cache; the
// stock-page chart and the census (scripts/fvg-census.mjs) run it on the bars
// they already hold, and C's Price zones may import it later as an input.
//
// THE THREE-CANDLE RULE. For candles c1, c2, c3 in a row:
//   bullish  c3.low  > c1.high   the zone is [c1.high, c3.low]
//   bearish  c3.high < c1.low    the zone is [c3.high, c1.low]
// c2 (the middle candle) is the move that left the gap; the chart draws the
// zone from c2 to the right edge.
//
// INVALIDATION (the owner's rule). The first later bar whose range ENTERS the
// zone removes it: low < zone.upper and high > zone.lower. A bar that only
// touches an edge has not entered. Only unfilled gaps are returned.
//
// SIZE. A gap counts only when its height is at least `minAtr` x ATR(14) at
// c3 (Wilder's ATR, as lib/ta/confluence.ts atr computes it on the bars up to
// c3), so a stock's ordinary noise isn't drawn as gaps.
//
// LOOKBACK. Only gaps whose c1 lies within the last `lookback` bars.
//
// scripts/check-fair-value-gaps.mjs holds the fixtures and a mutant per rule.

export type FvgBar = { date: string; high: number; low: number; close: number };

export type FairValueGap = {
  kind: "bullish" | "bearish";
  lower: number;
  upper: number;
  /** Index of the middle candle (c2) in the bars given; the zone is drawn from here. */
  index: number;
  /** The middle candle's date. */
  date: string;
  /** ATR(14) at c3, the size test's yardstick. */
  atr: number;
};

export type FvgOptions = { lookback?: number; minAtr?: number };
export const FVG_DEFAULTS = { lookback: 250, minAtr: 0.5 } as const;

const isPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Wilder's ATR(period) at every index, null until there are `period` true
 * ranges (index `period`). The value at i equals confluence.atr(bars.slice(0, i + 1)).
 */
export function atrSeries(bars: readonly FvgBar[], period = 14): (number | null)[] {
  const out: (number | null)[] = bars.map(() => null);
  let sum = 0, a: number | null = null;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].close;
    if (!isPrice(b.high) || !isPrice(b.low) || !isPrice(pc)) return out.map(() => null);
    const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    if (i <= period) {
      sum += tr;
      if (i === period) a = sum / period;
    } else if (a !== null) {
      a = (a * (period - 1) + tr) / period;
    }
    out[i] = i >= period ? a : null;
  }
  return out;
}

/** The unfilled gaps in `bars` (ascending by date), oldest first. */
export function fairValueGaps(bars: readonly FvgBar[], opts: FvgOptions = {}): FairValueGap[] {
  const lookback = opts.lookback ?? FVG_DEFAULTS.lookback;
  const minAtr = opts.minAtr ?? FVG_DEFAULTS.minAtr;
  const n = bars.length;
  if (n < 3) return [];
  const atr = atrSeries(bars);
  const out: FairValueGap[] = [];
  for (let c3 = Math.max(2, n - lookback + 2); c3 < n; c3++) {
    const c1 = bars[c3 - 2], b3 = bars[c3];
    let kind: FairValueGap["kind"] | null = null, lower = 0, upper = 0;
    if (b3.low > c1.high) { kind = "bullish"; lower = c1.high; upper = b3.low; }
    else if (b3.high < c1.low) { kind = "bearish"; lower = b3.high; upper = c1.low; }
    if (!kind) continue;
    const a = atr[c3];
    if (a === null || !(upper - lower >= minAtr * a)) continue;
    let filled = false;
    for (let j = c3 + 1; j < n && !filled; j++) if (bars[j].low < upper && bars[j].high > lower) filled = true;
    if (!filled) out.push({ kind, lower, upper, index: c3 - 1, date: bars[c3 - 1].date, atr: a });
  }
  return out;
}

/**
 * The gaps a chart shows: the nearest `perSide` above the price and the
 * nearest `perSide` below it, by distance from the price to the zone's
 * nearer edge. An unfilled gap never contains the latest close (the latest
 * bar would have entered it), so every gap is on one side.
 */
export function nearestGaps(gaps: readonly FairValueGap[], price: number, perSide = 2): FairValueGap[] {
  const above = gaps.filter((g) => g.lower > price).sort((x, y) => x.lower - y.lower).slice(0, perSide);
  const below = gaps.filter((g) => g.upper < price).sort((x, y) => y.upper - x.upper).slice(0, perSide);
  return [...below, ...above].sort((x, y) => x.index - y.index);
}

/** Distance from the price to a gap's nearer edge, as a fraction of the price. */
export const gapDistance = (g: FairValueGap, price: number): number =>
  g.lower > price ? (g.lower - price) / price : g.upper < price ? (price - g.upper) / price : 0;
