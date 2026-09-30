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
// EVERY LETTER CASE IS LISTED, because the deployment matches case-SENSITIVELY
// (#553 COWORK #78: /stock/bk rendered the stale page on the preview). Next's
// buildCustomRoute compiles each source with sensitive:false but writes only the
// regex SOURCE into the routes manifest, so the "i" flag never reaches the
// router. The stock route itself uppercases whatever it is given, so every
// spelling is live and every spelling needs its own entry: 2^n per ticker.
//
// EVERY SUBROUTE TOO (/news, /earnings, anything added later): an exact entry
// for the page and a `/:path+` entry for everything under it. Not one `:path*`
// entry: an empty path* can leave a trailing slash on the destination, which
// costs a second redirect.
//
// check-retick-redirects pins the generated list and tests it against the
// regexes Next writes into the manifest, matched as the deployment matches them.
// Next's redirects() runs before middleware.ts, so these answer first.

/** [old ticker, current ticker], each a CIK-confirmed reticker. */
export const RETICK_REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ["BK", "BNY"],
  ["EQR", "VMRK"],
];

export type RedirectEntry = { source: string; destination: string; permanent: true };

/** Every upper/lower-case spelling of a ticker (letters only vary; 2^letters). */
export function caseVariants(ticker: string): string[] {
  let out = [""];
  for (const ch of ticker) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    out = lo === up ? out.map((p) => p + ch) : out.flatMap((p) => [p + up, p + lo]);
  }
  return out;
}

/** The next.config redirects: every spelling of each old ticker, the page and everything under it. */
export function retickRedirects(pairs = RETICK_REDIRECTS): RedirectEntry[] {
  return pairs.flatMap(([from, to]) =>
    caseVariants(from).flatMap((v) => [
      { source: `/stock/${v}`, destination: `/stock/${to}`, permanent: true as const },
      { source: `/stock/${v}/:path+`, destination: `/stock/${to}/:path+`, permanent: true as const },
    ])
  );
}
