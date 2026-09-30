// PAGES FOR RETICKERED SYMBOLS REDIRECT TO THE LIVE TICKER (#553 COWORK #73, #75).
//
// SEC moved BK's CIK (1390777) to BNY and EQR's (906107) to VMRK; Tiingo
// support confirmed both. /stock/BK and /stock/EQR still rendered full
// technical pages built from the dead tickers' old price history ("BK:
// Uptrend ... RSI 68"), different from /stock/BNY and /stock/VMRK -- a live,
// misleading page. A permanent redirect sends the old URL, and its earnings
// page, to the company's current ticker.
//
// ONLY RETICKERS. A delisted or acquired ticker (EA, WBS, ...) has no successor
// and keeps its SEC pages; it is never listed here.
//
// Every letter case is caught: the stock route uppercases whatever it is given
// (so /stock/bk rendered the same page), and Next matches redirect sources
// case-insensitively -- check-retick-redirects proves both on Next's own
// matcher. Next's redirects() runs before middleware.ts, so these answer first.

/** [old ticker, current ticker], each a CIK-confirmed reticker. */
export const RETICK_REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ["BK", "BNY"],
  ["EQR", "VMRK"],
];

export type RedirectEntry = { source: string; destination: string; permanent: true };

/** The next.config redirects: the stock page and its earnings page, per reticker. */
export function retickRedirects(pairs = RETICK_REDIRECTS): RedirectEntry[] {
  return pairs.flatMap(([from, to]) => [
    { source: `/stock/${from}`, destination: `/stock/${to}`, permanent: true as const },
    { source: `/stock/${from}/earnings`, destination: `/stock/${to}/earnings`, permanent: true as const },
  ]);
}
