import { fmpFetch } from "./fmpUsage";

export type SymbolRow = {
  symbol: string;
  name: string;
  exchange: string;
};

// Symbol/company search, backed by FMP's two /stable search endpoints.
//
// Both are needed and neither is sufficient alone (verified against live data
// via app/api/debug/symbol-search/route.ts):
//   - /stable/search-symbol  matches TICKERS. "arm" -> ARM (Arm Holdings),
//     but "microsoft" -> 0 results.
//   - /stable/search-name    matches COMPANY NAMES. "microsoft" -> MSFT,
//     but "arm" -> mostly OTC/crypto noise and no ARM.
// So we query both in parallel, merge, filter, and rank.
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

const FMP_BASE = "https://financialmodelingprep.com/stable";

// The Starter plan's *market data* (quotes/history) is US-only, even though the
// search endpoints return global listings. Searching "microsoft" returns the
// Hong Kong, Frankfurt and Brussels listings ahead of MSFT, and picking one of
// those would open a chart page with no data behind it. Restrict to the US
// exchanges the rest of the site can actually chart.
const ALLOWED_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX"]);

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

function getFmpApiKey() {
  return (
    process.env.FMP_API_KEY ||
    process.env.FINANCIAL_MODELING_PREP_API_KEY ||
    process.env.NEXT_PUBLIC_FMP_API_KEY
  );
}

function normalise(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

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

type FmpSearchRow = {
  symbol?: string;
  name?: string;
  exchange?: string;
  exchangeShortName?: string;
  exchangeFullName?: string;
};

async function fetchFmpSearch(path: string, query: string): Promise<SymbolRow[]> {
  const apiKey = getFmpApiKey();
  if (!apiKey || !query) return [];

  try {
    const res = await fmpFetch(
      `${FMP_BASE}/${path}?query=${encodeURIComponent(query)}&limit=50&apikey=${apiKey}`,
      { next: { revalidate: 86400 } }
    );

    if (!res.ok) return [];

    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];

    return (data as FmpSearchRow[])
      .map((row) => ({
        symbol: String(row.symbol ?? "").toUpperCase().trim(),
        name: String(row.name ?? "").trim(),
        exchange: String(row.exchange ?? row.exchangeShortName ?? "").toUpperCase().trim(),
      }))
      .filter((row) => row.symbol && row.name);
  } catch {
    return [];
  }
}

// Structural relevance, lower = better. Deliberately has no "name contains
// query anywhere" tier -- that's what produced the Pharmaceuticals-for-"arm"
// results. A word inside the name starting with the query (e.g. "Advanced
// Micro Devices" for "micro") is a real match and is ranked, just below a name
// that leads with it (e.g. "Microsoft Corporation").
function rankResult(item: SymbolRow, query: string) {
  const q = normalise(query);
  if (!q) return 99;

  const symbol = item.symbol.toUpperCase();
  const symbolNorm = normalise(item.symbol);
  const nameUpper = item.name.toUpperCase();
  const nameNorm = normalise(item.name);

  let base: number;

  if (symbolNorm === q) base = 0;
  else if (symbolNorm.startsWith(q)) base = 10;
  else if (nameNorm.startsWith(q)) base = 20;
  else {
    const words = nameUpper.split(/[^A-Z0-9]+/).filter(Boolean);
    if (words.some((word) => word.startsWith(q))) base = 30;
    else if (symbolNorm.includes(q)) base = 40;
    else base = 50;
  }

  // An exact ticker match is always the top hit -- typing "ARM" means ARM.
  if (base === 0) return 0;

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

// `q` should already be trimmed/uppercased by the caller (matches the
// convention app/api/symbols/route.ts used before this was extracted). `type`
// of "crypto" returns the static crypto pairs instead of hitting FMP.
export async function searchSymbols(q: string, type: string): Promise<SymbolRow[]> {
  if (type === "crypto") return searchCryptoPairs(q);

  if (!q) return [];

  // search-symbol first so that, where two sources return the same ticker, the
  // ticker-match copy wins deduplication and the merge order below already
  // reflects "symbol match beats name match" before ranking is applied.
  const [symbolMatches, nameMatches] = await Promise.all([
    fetchFmpSearch("search-symbol", q),
    fetchFmpSearch("search-name", q),
  ]);

  const seen = new Set<string>();

  const merged = [...symbolMatches, ...nameMatches]
    .filter((row) => {
      if (!ALLOWED_EXCHANGES.has(row.exchange)) return false;
      if (seen.has(row.symbol)) return false;
      seen.add(row.symbol);
      return true;
    })
    // Keep each row's position in the merged list: FMP returns its own
    // relevance ordering, which is a better tiebreak within a rank tier than
    // sorting alphabetically (alphabetical is precisely what used to bury
    // MSFT below MBOT/MCHP for the query "micro").
    .map((row, index) => ({ row, index, rank: rankResult(row, q) }));

  return merged
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map((entry) => entry.row)
    .slice(0, 20);
}
