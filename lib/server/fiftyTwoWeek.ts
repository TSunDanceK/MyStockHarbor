// THE 52-WEEK RANGE, ONE HELPER FOR THE WHOLE STOCK PAGE (#553 COWORK #80 §1,
// step 5).
//
// KO's header read "52wk $65.84–$92.49" while its profile row read "$65.35 –
// $92.49": the header took FMP's quote yearLow/yearHigh, the profile row the
// daily bars. Both now come from here -- the profile row
// (stockProfile.composeCompanyProfile) and, on Tiingo, the header
// (tiingoQuote.yearRange) -- over the same bars.
//
// Pure, no imports: lifted whole by scripts/check-stock-profile.mjs.

/**
 * The 52-week range from bars the page already loaded. 252 trading days is a
 * year; fewer bars than that is a range over what exists, which for a recent
 * listing is still the true range since listing — but under ~a month it is not
 * a meaningful "52-week" figure and the row hides.
 */
export const RANGE_BARS = 252;
export const RANGE_MIN_BARS = 20;
export function fiftyTwoWeekRange(
  points: { close: number; high?: number; low?: number }[]
): { low: number; high: number } | null {
  const window = points.slice(-RANGE_BARS).filter((p) => Number.isFinite(p.close));
  if (window.length < RANGE_MIN_BARS) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const p of window) {
    const lo = Number.isFinite(p.low) ? (p.low as number) : p.close;
    const hi = Number.isFinite(p.high) ? (p.high as number) : p.close;
    if (lo < low) low = lo;
    if (hi > high) high = hi;
  }
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}
