// THE STORED EOD WINDOW, shared by the nightly job (jobs.ts) and the stock-page
// cold fill (coldFill.ts), so both store the same series for a symbol. Pure: no
// Redis, no Tiingo. jobs.ts re-exports these for its checks.

/**
 * The window we keep, as today's FMP history does: MAX_CACHED_HISTORY_DAYS is a
 * BAR count (1,400 sessions), not calendar days.
 *
 * FIXED 2026-09-30 (#553 step 2). This read 1,400 CALENDAR days, about 960
 * bars. The step 2 parity run caught it: Weekly MA200 (200 weekly closes) went
 * 39 -> 0 on Tiingo's bars, and the all-time-high screens saw a shorter past.
 * So the request now covers EOD_WINDOW_BARS sessions (252 a year, plus 2%) and
 * the stored series keeps the last EOD_WINDOW_BARS of them.
 */
export const EOD_WINDOW_BARS = 1400;
export const EOD_WINDOW_DAYS = Math.ceil(((EOD_WINDOW_BARS * 365.25) / 252) * 1.02);
/**
 * Fewer bars than this is not a history, and is not stored (mirrors
 * historyCache's MIN_QUALIFIED_POINTS). Measured on the first night
 * (2026-09-26, CODE-B #50): Tiingo answered BK with 5 rows since 2022 and the
 * job stored them as BK's history, which a chart or MA200 would have read as
 * the whole record. A short answer now deletes the key instead, so a reader
 * falls back to FMP rather than to a truncated series.
 */
export const EOD_MIN_BARS = 30;

export function eodStartDate(nowMs: number): string {
  return new Date(nowMs - EOD_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}
