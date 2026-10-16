// THE COVERAGE LINE'S WORDING, PURE (no store, no Next import), so the checks
// can load it; lib/server/siteCoverage.ts reads the counts and re-exports these.

/** Listing venues that count as "US-listed" here. OTC and no-venue rows do not. */
const LISTED_EXCHANGES: ReadonlySet<string> = new Set(["NASDAQ", "NYSE", "CBOE"]);

export type SiteCoverage = { stockPages: number | null; pickers: number | null };

/** Pure: exchange-listed tickers in a ticker map. */
export function listedTickerCount(entries: Iterable<{ exchange: string | null }>): number {
  let n = 0;
  for (const e of entries) if (e.exchange && LISTED_EXCHANGES.has(e.exchange.toUpperCase())) n++;
  return n;
}

/** Pure: "over 7,000" / "about 1,000" -- rounded down, never up. */
export function hedgedCount(n: number): string {
  const step = n >= 2000 ? 1000 : 100;
  const floored = Math.floor(n / step) * step;
  if (floored <= 0) return `about ${n.toLocaleString("en-US")}`;
  return `${floored < n ? "over" : "about"} ${floored.toLocaleString("en-US")}`;
}

/** Pure: the one coverage sentence. A missing count drops its number, never invents one. */
export function coverageLine(c: SiteCoverage): string {
  const pages = c.stockPages ? `${hedgedCount(c.stockPages)} stock analysis pages` : "stock analysis pages for US-listed stocks";
  const pickers = c.pickers ? `${hedgedCount(c.pickers)} stocks in the pickers and screeners` : "a large, liquid set of stocks in the pickers and screeners";
  return `MyStockHarbor covers ${pages}, earnings pages built from SEC EDGAR filings for US-listed filers, and ${pickers}.`;
}

/**
 * Pure: the same coverage, short enough for a meta description (under 160
 * characters). Null when either count is unreadable: the caller keeps its own.
 */
export function coverageDescription(c: SiteCoverage): string | null {
  if (!c.stockPages || !c.pickers) return null;
  return `Free stock analysis: ${hedgedCount(c.stockPages)} stock analysis pages, earnings from SEC EDGAR filings, and ${hedgedCount(c.pickers)} stocks in the pickers and screeners.`;
}
