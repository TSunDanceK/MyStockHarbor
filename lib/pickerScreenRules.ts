// SCREEN MEMBERSHIP RULES RULED ON IN #553 COWORK #186 (the #169 audit).
//
// Pure, no imports, safe in a client bundle: the picker page, the /pickers hub
// and the build all read these, so a rule lives once and a check can run it on
// fixtures (scripts/check-picker-screen-rules.mjs).

/** The Buy Signals page: above MA200 AND at least 2 more bullish conditions. */
export const BUY_SIGNAL_MIN_SCORE = 3;

/** `buyScore` is getBuySignalCount (lib/signalCounts.ts), which counts aboveMA200 itself. */
export function qualifiesBuySignal(buyScore: number): boolean {
  return buyScore >= BUY_SIGNAL_MIN_SCORE;
}

export type SellSignalEvents = {
  overbought?: boolean;
  bearishRsiDivergence?: boolean;
  bearishMacdDivergence?: boolean;
};

/**
 * The Sell Signals page: 2 or more of the 5 bearish conditions, at least one
 * of them NOT a plain state. Below MA50 and below MA200 are states a falling
 * stock sits in for months; overbought and a bearish divergence are the
 * readings. `sellScore` is the page's own count of the 5.
 */
export function qualifiesSellSignal(r: SellSignalEvents, sellScore: number): boolean {
  return sellScore >= 2 && !!(r.overbought || r.bearishRsiDivergence || r.bearishMacdDivergence);
}

/** ATR spike, alternative B (#553 COWORK #186 ruling 4; the 60-session census, run 37544678360). */
export const ATR_SPIKE_TR_MULTIPLE = 2;

type Bar = { close: number; high?: number; low?: number };

/**
 * Today's true range is at least 2x the PRIOR session's ATR(14): a single wide
 * day against the range the stock had been keeping. `atr14` is the series for
 * the same bars. The old rule (ATR14 >= 1.5x its own 20-day mean) lagged
 * itself and flagged nothing on 45 of 60 sessions.
 */
export function trueRangeSpike(points: readonly Bar[], atr14: readonly (number | null)[]): boolean {
  const n = points.length;
  if (n < 2 || atr14.length !== n) return false;
  const last = points[n - 1];
  const prevClose = points[n - 2].close;
  const prevAtr = atr14[n - 2];
  const h = last.high, l = last.low;
  if (typeof h !== "number" || typeof l !== "number" || !Number.isFinite(h) || !Number.isFinite(l)) return false;
  if (typeof prevAtr !== "number" || !Number.isFinite(prevAtr) || prevAtr <= 0) return false;
  const tr = Number.isFinite(prevClose) ? Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose)) : h - l;
  return tr >= ATR_SPIKE_TR_MULTIPLE * prevAtr;
}
