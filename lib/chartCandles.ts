// THE STOCK CHART'S CANDLE VIEW (#553 COWORK #165). PURE: the bars the chart
// already holds in, candle shapes and words out. No fetch, no Redis.
//
//   candleOf       one stored daily bar as a candle: open (else the previous
//                  close), high and low widened to hold the body, green when
//                  close >= open, and "partial" for today's unfinished bar.
//   candleFit      how many of the latest sessions fit at >= 3 px each in the
//                  plot's on-screen width; all of them when they fit. Never
//                  weekly candles in disguise: fewer days, said in the footer.
//   candleWords    the readout's O/H/L/C line.
//   CHART_MODE_KEY the browser's remembered choice (localStorage, try/catch).
//
// scripts/check-chart-candles.mjs runs every rule, with mutants.

export type CandleInputBar = { date: string; close: number; open?: number; high?: number; low?: number; label?: string };

export type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  up: boolean;
  /** Today's partial session ("today so far"): drawn hollow, never as a finished day. */
  partial: boolean;
  /** The stored bar had no open; the previous close stands in. */
  openMissing: boolean;
};

export type ChartMode = "line" | "candles";

export const CHART_MODE_KEY = "msh:stock-chart-mode";
export const CHART_MODE_DEFAULT: ChartMode = "line";
/** The narrowest candle drawn, in CSS pixels. */
export const CANDLE_MIN_PX = 3;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function candleOf(bars: readonly CandleInputBar[], i: number): Candle {
  const b = bars[i];
  const prev = i > 0 ? bars[i - 1].close : null;
  const openMissing = !num(b.open);
  const open = num(b.open) ? b.open : num(prev) ? prev : b.close;
  const close = b.close;
  const high = Math.max(num(b.high) ? b.high : -Infinity, open, close);
  const low = Math.min(num(b.low) ? b.low : Infinity, open, close);
  return { open, high, low, close, up: close >= open, partial: Boolean(b.label), openMissing };
}

/** How many of the latest sessions to draw: all when each gets >= minPx, else as many as fit. */
export function candleFit(plotPx: number, n: number, minPx = CANDLE_MIN_PX): number {
  if (!num(plotPx) || plotPx <= 0 || n < 1) return n;
  const fit = Math.floor(plotPx / minPx);
  return Math.max(2, Math.min(n, fit));
}

/** The footer's words when the candle view shows fewer sessions than the line. */
export function candleFitWords(shown: number, total: number): string | null {
  return shown < total ? `Last ${shown} sessions shown in candle view` : null;
}

const money = (v: number) => v.toFixed(2);

/** "O 101.20 · H 103.00 · L 100.50 · C 102.40" ("O —" when the bar had no open). */
export function candleWords(c: Candle): string {
  return `O ${c.openMissing ? "—" : money(c.open)} · H ${money(c.high)} · L ${money(c.low)} · C ${money(c.close)}`;
}

/** The stored choice, or the default when storage is missing, empty, unknown or throws. */
export function readChartMode(storage: Pick<Storage, "getItem"> | null | undefined): ChartMode {
  try {
    return storage?.getItem(CHART_MODE_KEY) === "candles" ? "candles" : CHART_MODE_DEFAULT;
  } catch {
    return CHART_MODE_DEFAULT;
  }
}

export function writeChartMode(storage: Pick<Storage, "setItem"> | null | undefined, mode: ChartMode): void {
  try {
    storage?.setItem(CHART_MODE_KEY, mode);
  } catch {
    // private window, blocked storage: the choice just isn't remembered
  }
}
