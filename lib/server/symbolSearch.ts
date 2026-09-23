import { getSearchIndex, normalise, type IndexRow, type SymbolRow } from "./searchIndex";

export type { SymbolRow };

// Symbol/company search.
//
// OFF FMP SINCE 2026-09-23 (Relay B, #553). This used FMP's /stable/search-symbol
// and /stable/search-name -- two metered calls per uncached query -- and now
// searches a local index of the Nasdaq Trader symbol directory (stocks AND
// ETFs) with the committed SEC ticker file as its fallback; see
// lib/server/searchIndex.ts for the sources and for how the three bugs below
// are kept out. The ranking in this file is unchanged.
//
// History / gotcha: this route previously downloaded Nasdaq Trader's
// nasdaqlisted.txt + otherlisted.txt on every uncached request and searched
// them locally. That had three fatal bugs:
//   1. It dropped any name containing "ADS"/"ADR"/"DEPOSITARY", which silently
//      excluded legitimate US-listed companies -- ARM ("Arm Holdings plc
//      American Depositary Shares") could never be found at all.
//   2. Its loose fallback matched the query as a bare substring anywhere in the
//      company name, so "arm" matched "Ph-ARM-aceuticals" and returned ~30
//      pharma companies as top hits.
//   3. It fetched two large text files per request just to do a string search.
// Do not reintroduce name-substring matching or name-based exclusion filters
// here; rank by symbol/word-prefix instead (see rankResult below).
//
// Extracted out of app/api/symbols/route.ts so it can be called in-process
// (no HTTP self-fetch) by server-rendered callers that have no browser
// session -- e.g. lib/insightSnapshots.ts building a new Insight post's SEO
// snapshot. A server-to-server fetch to the public /api/symbols route carries
// no browser BotID header and gets misclassified as bot traffic once that
// route is BotID-guarded (see claude/pickers-firewall-selfblock-2026-07-17.md
// for the same failure mode hitting other routes previously). app/api/symbols
// /route.ts's GET handler calls this function too, so the public endpoint and
// any in-process caller always return identically-ranked results.

// US exchanges only: a result is a promise that the page behind it can chart.
// The directory lists every US venue; IEX-only listings are left out, as they
// were under FMP. "NYSE ARCA" and "CBOE" are where most ETFs list -- FMP filed
// them under "AMEX", so they were always in this set under another name.
const ALLOWED_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "CBOE"]);

// Widely-searched large caps + index ETFs. Used only as a tiebreak *within* a
// relevance tier, never to override it. Without this, "micro" put MicroAlgo,
// Microsemi and MicroVision above Microsoft -- all of them match "Micro" just
// as literally, so structural ranking alone can't separate them, and FMP's own
// result order doesn't reliably favour the mega cap. Adding a symbol here only
// helps it beat equally-relevant matches; it can never jump an exact-symbol hit.
const POPULAR_SYMBOLS = new Set([
  "AAPL", "ABBV", "ABT", "ADBE", "AMD", "AMZN", "ARM", "AVGO", "BA", "BAC",
  "BRK.B", "C", "CAT", "COIN", "COST", "CRM", "CSCO", "CVX", "DIA", "DIS",
  "F", "GE", "GM", "GOOG", "GOOGL", "GS", "HD", "IBM", "INTC", "IWM",
  "JNJ", "JPM", "KO", "LLY", "MA", "MCD", "META", "MRK", "MSFT", "MU",
  "NFLX", "NKE", "NVDA", "ORCL", "PEP", "PFE", "PG", "PLTR", "PYPL", "QCOM",
  "QQQ", "RIVN", "SBUX", "SHOP", "SMCI", "SNAP", "SOFI", "SPY", "T", "TGT",
  "TSLA", "TSM", "TXN", "UBER", "UNH", "V", "VZ", "WFC", "WMT", "XOM",
]);

// Preferred series (ARR-PC), warrants, units and rights. These share their
// parent company's name, so they match name queries exactly as well as the
// common stock does and can outrank it -- a warrant (VENAW, "MicroAlgo Inc.")
// was the top hit for "micro". Demoted rather than dropped: they're real
// tradable symbols, just almost never what a name search is looking for.
function isDerivativeSymbol(symbol: string) {
  if (symbol.includes("-")) return true;
  if (symbol.length === 5 && /[WUR]$/.test(symbol)) return true;
  return false;
}

// Structural relevance, lower = better. Deliberately has no "name contains
// query anywhere" tier -- that's what produced the Pharmaceuticals-for-"arm"
// results. A word inside the name starting with the query (e.g. "Advanced
// Micro Devices" for "micro") is a real match and is ranked, just below a name
// that leads with it (e.g. "Microsoft Corporation").
/** Returned for "no structural match"; such rows are not returned (rankIndex). */
export const NO_MATCH = 1000;

// NO MATCH is not returned (see rankIndex). The name fields are
// precomputed on the index row (searchIndex.toIndexRow), not per query.
export function rankResult(item: IndexRow, query: string) {
  const q = normalise(query);
  if (!q) return 99;

  const symbol = item.symbol.toUpperCase();
  const symbolNorm = item.symbolNorm;
  const nameNorm = item.nameNorm;

  let base: number;

  if (symbolNorm === q) base = 0;
  else if (symbolNorm.startsWith(q)) base = 10;
  else if (nameNorm.startsWith(q)) base = 20;
  else {
    const words = item.nameWords;
    if (words.some((word) => word.startsWith(q))) base = 30;
    else if (symbolNorm.includes(q)) base = 40;
    else base = 50;
  }

  // An exact ticker match is always the top hit -- typing "ARM" means ARM.
  if (base === 0) return 0;
  // NO MATCH AT ALL. Under FMP every row had come back from a search, so 50 was
  // "matched by FMP, not by our tiers" and still ranked last. Against the whole
  // index it means no match, and it is decided on the BASE tier, before the
  // popularity bonus -- otherwise a popular ticker (50 - 5 = 45) would appear in
  // every search.
  if (base === 50) return NO_MATCH;

  let score = base;
  if (POPULAR_SYMBOLS.has(symbol)) score -= 5;
  if (isDerivativeSymbol(symbol)) score += 4;
  return score;
}

// Small, deliberately narrow set of USD crypto pairs for the dashboard's
// crypto mode. Kept as a static allow-list (rather than pulling FMP's full
// cryptocurrency-list endpoint) since the dashboard toggle only supports a
// handful of majors for now — see DashboardClient's CRYPTO_PRESETS.
const CRYPTO_USD_PAIRS: SymbolRow[] = [
  { symbol: "BTCUSD", name: "Bitcoin", exchange: "CRYPTO" },
  { symbol: "ETHUSD", name: "Ethereum", exchange: "CRYPTO" },
  { symbol: "SOLUSD", name: "Solana", exchange: "CRYPTO" },
  { symbol: "TRXUSD", name: "TRON", exchange: "CRYPTO" },
];

function searchCryptoPairs(q: string) {
  if (!q) return CRYPTO_USD_PAIRS;

  return CRYPTO_USD_PAIRS.filter(
    (row) => row.symbol.includes(q) || row.name.toUpperCase().includes(q)
  );
}


/**
 * Rank the index for `q`. PURE, so the check can run it on fixture rows.
 *
 * TIEBREAK: FMP's own result order used to break ties within a tier. With no
 * vendor order, a tie goes to the SHORTER symbol, then alphabetical -- a
 * shorter ticker for the same name is almost always the common stock ahead of a
 * class, unit or series.
 */
export function rankIndex(rows: IndexRow[], q: string, limit = 20): SymbolRow[] {
  const scored: { row: IndexRow; rank: number }[] = [];
  for (const row of rows) {
    if (!ALLOWED_EXCHANGES.has(row.exchange)) continue;
    const rank = rankResult(row, q);
    if (rank < NO_MATCH) scored.push({ row, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.row.symbol.length - b.row.symbol.length || a.row.symbol.localeCompare(b.row.symbol))
    .slice(0, limit)
    .map(({ row }) => ({ symbol: row.symbol, name: row.name, exchange: row.exchange }));
}

// `q` should already be trimmed/uppercased by the caller (matches the
// convention app/api/symbols/route.ts used before this was extracted). `type`
// of "crypto" returns the static crypto pairs.
export async function searchSymbols(q: string, type: string): Promise<SymbolRow[]> {
  if (type === "crypto") return searchCryptoPairs(q);
  if (!q) return [];
  return rankIndex(await getSearchIndex(), q);
}
