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

    const symbol = (cols[0] || "").trim();
    const name = (cols[1] || "").trim();

    // Exchange handling: in otherlisted.txt, exchange is cols[2] (N/A/P/Z etc.)
    // in nasdaqlisted.txt, exchange isn’t directly a letter; we’ll label it NASDAQ.
    let exchange = "NASDAQ/Other";
    if (cols.length >= 3 && /^[A-Z]$/.test((cols[2] || "").trim())) {
      exchange = (cols[2] || "").trim();
    }

    // Keep only simple root symbols
    if (!/^[A-Z.\-]+$/.test(symbol)) continue;

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

async function fetchFmpExactSymbol(symbol: string): Promise<SymbolRow | null> {
  const apiKey =
    process.env.FMP_API_KEY ||
    process.env.FINANCIAL_MODELING_PREP_API_KEY ||
    process.env.NEXT_PUBLIC_FMP_API_KEY;

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toUpperCase();

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

const exactSymbolMatches = all.filter(
  (r) => r.symbol.toUpperCase() === q
);

const startingSymbolMatches = all.filter(
  (r) =>
    r.symbol.toUpperCase().startsWith(q) &&
    r.symbol.toUpperCase() !== q
);

const nameMatches = all.filter(
  (r) =>
    !r.symbol.toUpperCase().startsWith(q) &&
    r.name.toUpperCase().includes(q)
);

const results = [
  ...exactSymbolMatches,
  ...startingSymbolMatches,
  ...nameMatches,
].slice(0, 25);

  return NextResponse.json(
    { results },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
      },
    }
  );
}
