// ── POSITIVE LAST EARNINGS: HIDDEN 2026-09-27 (#553 COWORK #64) ────────────
// The screener is ranked on FMP earnings-surprise fields (EPS surprise, revenue
// surprise), which end with FMP on 14 Oct and which the site no longer shows
// anywhere else: the earnings pages run on SEC filings and carry no estimates.
// A version re-based on filed figures would largely duplicate Strong Earnings
// Growth, so it is hidden rather than rebuilt. Hidden, not deleted: the page,
// the section builder and the filter all stay in the code, and setting
// NEXT_PUBLIC_POSITIVE_LAST_EARNINGS_ENABLED=1 (then redeploying) is the whole
// un-hide. Anything other than "1" keeps it hidden.
export const POSITIVE_LAST_EARNINGS_ENABLED = process.env.NEXT_PUBLIC_POSITIVE_LAST_EARNINGS_ENABLED === "1";

export const POSITIVE_LAST_EARNINGS_PATH = "/stocks-with-positive-last-earnings";
/** Where the hidden page 301s: the closest live screener. */
export const POSITIVE_LAST_EARNINGS_REDIRECT = "/stocks-with-strong-earnings-growth";

/** Whether a nav link or list entry should be left out while hidden. */
export function positiveLastEarningsHidden(href: string, enabled = POSITIVE_LAST_EARNINGS_ENABLED): boolean {
  return !enabled && href === POSITIVE_LAST_EARNINGS_PATH;
}
