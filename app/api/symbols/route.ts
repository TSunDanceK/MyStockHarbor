import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400;

type SymbolRow = {
  symbol: string;
  name: string;
  exchange: string;
};

// Very small parser for the Nasdaq Trader symbol directory format (pipe-delimited)
function parseNasdaqSymbolFile(text: string) {
  const lines = text.split("\n");
  const out: SymbolRow[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip headers/footers
    if (trimmed.startsWith("Symbol|") || trimmed.startsWith("ACT Symbol|")) continue;
    if (trimmed.startsWith("File Creation Time")) continue;

    const cols = trimmed.split("|");
    if (cols.length < 2) continue;

    const rawSymbol = (cols[0] || "").trim();
    const symbol = rawSymbol.replace(/\$/g, ".");
    const name = (cols[1] || "").trim();

    // Exchange handling: in otherlisted.txt, exchange is cols[2] (N/A/P/Z etc.)
    // in nasdaqlisted.txt, exchange isn't directly a letter; we'll label it NASDAQ.
    let exchange = "NASDAQ/Other";
    if (cols.length >= 3 && /^[A-Z]$/.test((cols[2] || "").trim())) {
      exchange = (cols[2] || "").trim();
    }

    // Keep only normal equity-style symbols.
    if (!/^[A-Z][A-Z.\-]*$/.test(symbol)) continue;

    // Remove test issues, warrants, units, rights, notes (debt instruments), preferreds,
    // ETFs/funds and other non-common-stock entries.
    // Note: "TRUST" is intentionally excluded here because many real operating companies
    // (e.g. Real Estate companies, banks) have "Trust" in their name yet are common stock.
    // We only skip purely structural instruments.
    const upperName = name.toUpperCase();

    const nonStockNameParts = [
      "ETF",
      "FUND",
      "ETN",
      "WARRANT",
      "DEPOSITARY",
      "ADR",
      "ADS",
    ];

    if (symbol.includes("#")) continue;
    if (symbol.includes("+")) continue;
    if (symbol.includes("^")) continue;
    if (symbol.includes("=")) continue;

    if (nonStockNameParts.some((part) => upperName.includes(part))) {
      continue;
    }

    out.push({ symbol, name, exchange });
  }

  // Deduplicate
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.symbol)) return false;
    seen.add(r.symbol);
    return true;
  });
}

async function fetchSymbolDirectory(url: string) {
  const res = await fetch(url, {
    next: { revalidate: 86400 },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch symbol directory: ${url}`);
  }

  return res.text();
}

function getFmpApiKey() {
  return (
    process.env.FMP_API_KEY ||
    process.env.FINANCIAL_MODELING_PREP_API_KEY ||
    process.env.NEXT_PUBLIC_FMP_API_KEY
  );
}

async function fetchFmpExactSymbol(symbol: string): Promise<SymbolRow | null> {
  const apiKey = getFmpApiKey();

  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(
        symbol
      )}?apikey=${apiKey}`,
      { next: { revalidate: 86400 } }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as Array<{
      symbol?: string;
      companyName?: string;
      exchangeShortName?: string;
    }>;

    const row = Array.isArray(data) ? data[0] : null;

    if (!row?.symbol || !row?.companyName) return null;

    return {
      symbol: row.symbol.toUpperCase(),
      name: row.companyName,
      exchange: row.exchangeShortName || "FMP",
    };
  } catch {
    return null;
  }
}

async function fetchFmpSearchSymbols(query: string): Promise<SymbolRow[]> {
  const apiKey = getFmpApiKey();

  // Allow single-letter searches — FMP handles them fine for exact-symbol lookups
  if (!apiKey || query.length < 1) return [];

  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/search?query=${encodeURIComponent(
        query
      )}&limit=25&apikey=${apiKey}`,
      { next: { revalidate: 86400 } }
    );

    if (!res.ok) return [];

    const data = (await res.json()) as Array<{
      symbol?: string;
      name?: string;
      exchangeShortName?: string;
      stockExchange?: string;
    }>;

    return Array.isArray(data)
      ? data
          .map((row) => ({
            symbol: String(row.symbol ?? "").toUpperCase(),
            name: String(row.name ?? ""),
            exchange: String(row.exchangeShortName ?? row.stockExchange ?? "FMP"),
          }))
          .filter((row) => row.symbol && row.name)
      : [];
  } catch {
    return [];
  }
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toUpperCase();
  const type = (searchParams.get("type") || "").trim().toLowerCase();

  if (type === "crypto") {
    const results = searchCryptoPairs(q);

    return NextResponse.json(
      { results },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
        },
      }
    );
  }

  const [nasdaqTxt, otherTxt] = await Promise.all([
    fetchSymbolDirectory("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"),
    fetchSymbolDirectory("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"),
  ]);

  const all = [...parseNasdaqSymbolFile(nasdaqTxt), ...parseNasdaqSymbolFile(otherTxt)];

  if (!q) {
    return NextResponse.json(
      { results: all.slice(0, 50) },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
        },
      }
    );
  }

  const [fmpExact, fmpSearch] = await Promise.all([
    fetchFmpExactSymbol(q),
    fetchFmpSearchSymbols(q),
  ]);

  const exactSymbolMatches = all.filter(
    (r) => r.symbol.toUpperCase() === q
  );

  const startingSymbolMatches = all.filter(
    (r) =>
      r.symbol.toUpperCase().startsWith(q) &&
      r.symbol.toUpperCase() !== q
  );

  const startingNameMatches = all.filter(
    (r) =>
      !r.symbol.toUpperCase().startsWith(q) &&
      r.name.toUpperCase().startsWith(q)
  );

  const wordStartingNameMatches = all.filter((r) => {
    const symbol = r.symbol.toUpperCase();
    const name = r.name.toUpperCase();

    if (symbol.startsWith(q)) return false;
    if (name.startsWith(q)) return false;

    return name
      .split(/[\s,.-]+/)
      .some((word) => word.startsWith(q));
  });

  const looseNameMatches = all.filter((r) => {
    const symbol = r.symbol.toUpperCase();
    const name = r.name.toUpperCase();

    if (symbol.startsWith(q)) return false;
    if (name.startsWith(q)) return false;
    if (name.split(/[\s,.-]+/).some((word) => word.startsWith(q))) return false;

    return name.includes(q);
  });

  const seen = new Set<string>();

  // FMP exact profile is the most reliable source — put it first so its
  // company name wins deduplication for any symbol, including short tickers
  // like K, C, F that NASDAQ directory names may strip or mislabel.
  const results = [
    ...(fmpExact ? [fmpExact] : []),
    ...fmpSearch,
    ...exactSymbolMatches,
    ...startingSymbolMatches,
    ...startingNameMatches,
    ...wordStartingNameMatches,
    ...looseNameMatches,
  ]
    .filter((r) => {
      const key = r.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);

  return NextResponse.json(
    { results },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
      },
    }
  );
}
