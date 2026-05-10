import { NextResponse } from "next/server";

type FmpSearchItem = {
  symbol?: string;
  name?: string;
  exchange?: string;
  exchangeShortName?: string;
  stockExchange?: string;
  type?: string;
};

type StockSearchResult = {
  symbol: string;
  name: string;
  exchange: string;
};

const FMP_BASE = "https://financialmodelingprep.com/stable";

function cleanQuery(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9. -]/g, "")
    .trim()
    .slice(0, 40);
}

function cleanSymbol(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .trim();
}

function normalise(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function rankResult(item: StockSearchResult, query: string) {
  const q = normalise(query);
  const symbol = normalise(item.symbol);
  const name = normalise(item.name);

  if (!q) return 999;

  if (symbol === q) return 0;
  if (symbol.startsWith(q)) return 10;
  if (name.startsWith(q)) return 20;
  if (symbol.includes(q)) return 30;
  if (name.includes(q)) return 40;

  const first = q[0];
  if (symbol.startsWith(first)) return 50;
  if (name.startsWith(first)) return 60;

  return 90;
}

function isUsStockLike(item: FmpSearchItem) {
  const symbol = cleanSymbol(item.symbol);
  if (!symbol || symbol.includes("^") || symbol.includes("/") || symbol.length > 8) {
    return false;
  }

  const exchange = String(
    item.exchangeShortName || item.exchange || item.stockExchange || ""
  ).toUpperCase();

  const type = String(item.type || "").toLowerCase();

  if (type && !type.includes("stock") && !type.includes("common")) {
    return false;
  }

  if (!exchange) return true;

  return (
    exchange.includes("NASDAQ") ||
    exchange.includes("NYSE") ||
    exchange.includes("AMEX") ||
    exchange.includes("ETF")
  );
}

export async function GET(request: Request) {
  const apiKey = process.env.FMP_API_KEY;
  const { searchParams } = new URL(request.url);
  const query = cleanQuery(searchParams.get("query") || "");

  if (!query || query.length < 1) {
    return NextResponse.json({ results: [] });
  }

  if (!apiKey) {
    return NextResponse.json(
      { results: [], error: "FMP_API_KEY is not configured." },
      { status: 200 }
    );
  }

  const url = `${FMP_BASE}/search-symbol?query=${encodeURIComponent(
    query
  )}&apikey=${apiKey}`;

  try {
    const response = await fetch(url, {
      next: { revalidate: 60 * 60 },
    });

    if (!response.ok) {
      return NextResponse.json({ results: [] });
    }

    const json = (await response.json()) as unknown;

    const rows = Array.isArray(json) ? (json as FmpSearchItem[]) : [];

    const seen = new Set<string>();

    const results = rows
      .filter(isUsStockLike)
      .map((item): StockSearchResult => {
        const symbol = cleanSymbol(item.symbol);
        const exchange = String(
          item.exchangeShortName || item.exchange || item.stockExchange || ""
        ).trim();

        return {
          symbol,
          name: String(item.name || symbol).trim(),
          exchange,
        };
      })
      .filter((item) => {
        if (!item.symbol || seen.has(item.symbol)) return false;
        seen.add(item.symbol);
        return true;
      })
      .sort((a, b) => {
        const rankDelta = rankResult(a, query) - rankResult(b, query);
        if (rankDelta !== 0) return rankDelta;

        const symbolLengthDelta = a.symbol.length - b.symbol.length;
        if (symbolLengthDelta !== 0) return symbolLengthDelta;

        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 10);

    return NextResponse.json({
      query,
      results,
    });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
