// lib/curatedSymbols.ts
//
// Shared curated ticker/ETF lists used across the site:
//  - app/sitemap.ts imports these as the priority discovery set submitted
//    to Google (mega caps, retail-interest names, recognizable mid caps,
//    major ETFs) rather than the full long-tail symbol universe.
//  - getRelatedSymbols() below powers the "Explore More Stocks" module
//    rendered on every /stock/[symbol] page (see
//    app/components/RelatedStocks.tsx), giving every stock page — including
//    long-tail symbols that never make these curated lists — a small,
//    stable, always-present set of links to OTHER stock pages. Unlike the
//    links inside picker/bottleneck results, these don't depend on the
//    symbol appearing in a live, time-limited result set.
//
// This file is the single source of truth for these arrays — do not
// redefine them inline elsewhere.

export const coreMegaCaps = [
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "BRK.B", "AVGO",
  "LLY", "JPM", "V", "MA", "COST", "UNH", "HD", "PG", "XOM", "CVX", "MRK",
  "ABBV", "PEP", "KO", "WMT", "T", "VZ", "ORCL", "CRM", "ADBE", "CSCO",
  "INTC", "AMD", "QCOM", "TXN", "MCD", "SBUX", "PYPL", "BAC", "WFC", "TGT",
  "DIS",
];

export const retailInterestStocks = [
  "PLTR", "SOFI", "RIVN", "LCID", "NIO", "HOOD", "COIN", "DKNG", "AFRM",
  "UPST", "ROKU", "SNAP", "PINS", "U", "SHOP", "SQ", "RDDT", "MSTR", "MARA",
  "RIOT", "HIMS", "CAVA", "DUOL", "CELH", "ARM", "SMCI", "PATH", "CVNA",
  "CHWY", "ETSY",
];

export const recognizableMidCaps = [
  "F", "GM", "UBER", "LYFT", "ABNB", "NET", "CRWD", "PANW", "SNOW", "ZS",
  "DDOG", "OKTA", "DOCU", "MDB", "TWLO", "HUBS", "ESTC", "TEAM", "ZM", "BILL",
  "TTD", "INTU", "NOW", "ADSK", "ANET", "MU", "KLAC", "LRCX", "AMAT", "ON",
  "MRVL", "DELL", "HPQ", "CSX", "UAL", "DAL", "AAL", "CCL", "RCL", "MAR",
  "HLT", "CMG", "NKE", "LOW", "CAT", "DE", "GE", "BA", "RTX", "PFE", "BMY",
  "GILD", "AMGN", "ISRG", "BKNG", "MELI", "EBAY", "WDAY",
];

export const etfs = [
  "SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "ARKK", "XLF", "XLE", "XLK",
  "XLP", "XLY", "XLV", "XLRE", "XLI", "XLC", "XLB", "XLU", "SMH", "SOXX",
  "IBIT", "HODL", "ARKW", "VUG", "SCHD", "DGRO", "JEPI", "JEPQ", "GLD",
  "SLV", "TLT", "HYG",
];

export const priorityStocks = Array.from(
  new Set([...coreMegaCaps, ...retailInterestStocks, ...recognizableMidCaps])
);

export const uniqueEtfs = Array.from(new Set(etfs));

// ── Related-stocks selection ("Explore More Stocks" module) ────────────────

type CategoryEntry = { list: string[] };

const CATEGORY_LISTS: CategoryEntry[] = [
  { list: coreMegaCaps },
  { list: retailInterestStocks },
  { list: recognizableMidCaps },
  { list: uniqueEtfs },
];

// General mixed fallback for symbols that aren't in any curated category
// (long-tail tickers) — mega caps + retail-interest names + ETFs.
const GENERAL_MIX = Array.from(
  new Set([...coreMegaCaps, ...retailInterestStocks, ...uniqueEtfs])
);

// Deterministic, allocation-light hash so a given symbol always rotates to
// the same starting offset within a list. No Math.random()/Date.now() —
// this needs to be stable across requests/builds for consistent internal
// linking signal, not "fresh" on every render.
function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Returns a copy of `list` rotated to start at a deterministic offset
// derived from `symbol` (does not mutate the input).
function rotate<T>(list: T[], symbol: string): T[] {
  if (list.length === 0) return list;
  const offset = hashSymbol(symbol) % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

/**
 * Picks a small set of OTHER stock symbols to link to from a given stock's
 * page — the data source behind the "Explore More Stocks" internal-linking
 * module (app/components/RelatedStocks.tsx).
 *
 * Selection logic (deterministic — no randomness):
 *  - If `symbol` belongs to one of the curated category lists (mega caps,
 *    retail-interest names, recognizable mid caps, ETFs), prefer other
 *    symbols from that SAME category first, then fill from the broader
 *    priority list and ETF list.
 *  - Otherwise (a long-tail ticker not in any curated list), fall back to a
 *    general mixed set: mega caps, then retail-interest names, then ETFs.
 * The current symbol is always excluded from its own related list. Each
 * source list is rotated by a hash of `symbol` before sampling, so
 * different symbols surface a different-but-stable slice of the list
 * instead of every page linking to the exact same first N names.
 */
export function getRelatedSymbols(symbol: string, count = 10): string[] {
  const upper = symbol.toUpperCase();
  const own = CATEGORY_LISTS.find(({ list }) => list.includes(upper));

  const ordered: string[] = [];
  const seen = new Set<string>([upper]);

  const addFrom = (list: string[]) => {
    for (const candidate of rotate(list, upper)) {
      if (ordered.length >= count) break;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      ordered.push(candidate);
    }
  };

  if (own) {
    addFrom(own.list);
    if (ordered.length < count) addFrom(priorityStocks);
    if (ordered.length < count) addFrom(uniqueEtfs);
  } else {
    addFrom(coreMegaCaps);
    if (ordered.length < count) addFrom(retailInterestStocks);
    if (ordered.length < count) addFrom(uniqueEtfs);
    if (ordered.length < count) addFrom(GENERAL_MIX);
  }

  return ordered.slice(0, count);
}
