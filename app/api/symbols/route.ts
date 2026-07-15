import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400;

type SymbolRow = {
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

const FMP_BASE = "https://financialmodelingprep.com/stable";

// The Starter plan's *market data* (quotes/history) is US-only, even though the
// search endpoints return global listings. Searching "microsoft" returns the
// Hong Kong, Frankfurt and Brussels listings ahead of MSFT, and picking one of
// those would open a chart page with no data behind it. Restrict to the US
// exchanges the rest of the site can actually chart.
const ALLOWED_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX"]);

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
    const res = await fetch(
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

// Structural relevance. Deliberately has no "name contains query anywhere"
// tier -- that's what produced the Pharmaceuticals-for-"arm" results. A word
// inside the name starting with the query (e.g. "Advanced Micro Devices" for
// "micro") is a real match and is ranked, just below a name that leads with it
// (e.g. "Microsoft Corporation").
function rankResult(item: SymbolRow, query: string) {
  const q = normalise(query);
  if (!q) return 99;

  const symbol = normalise(item.symbol);
  const nameUpper = item.name.toUpperCase();
  const nameNorm = normalise(item.name);

  if (symbol === q) return 0;
  if (symbol.startsWith(q)) return 10;
  if (nameNorm.startsWith(q)) return 20;

  const words = nameUpper.split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.some((word) => word.startsWith(q))) return 30;

  if (symbol.includes(q)) return 40;

  return 50;
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

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toUpperCase();
  const type = (searchParams.get("type") || "").trim().toLowerCase();

  if (type === "crypto") {
    return NextResponse.json({ results: searchCryptoPairs(q) }, { headers: CACHE_HEADERS });
  }

  if (!q) {
    return NextResponse.json({ results: [] }, { headers: CACHE_HEADERS });
  }

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

  const results = merged
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map((entry) => entry.row)
    .slice(0, 20);

  return NextResponse.json({ results }, { headers: CACHE_HEADERS });
}
