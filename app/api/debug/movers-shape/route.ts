import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY debug route. Round 2: checking whether FMP's Starter plan exposes
// a BULK "all quotes for this exchange/index" endpoint (legacy v3
// /api/v3/quotes/{exchange} and similar), which would return real S&P
//500/Nasdaq-100 constituent prices in one call -- a much better fit for the
// price pool than the market-wide gainers/losers buckets (which skew to
// penny stocks not in our analyzed universe). DELETE THIS FILE once verified.

async function probe(url: string, label: string) {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      label,
      status: res.status,
      ok: res.ok,
      isArray: Array.isArray(json),
      count: Array.isArray(json) ? json.length : null,
      sample: Array.isArray(json) ? json.slice(0, 3) : json,
      rawSnippet: !Array.isArray(json) && typeof text === "string" ? text.slice(0, 300) : undefined,
    };
  } catch (e: any) {
    return {
      label,
      status: null,
      ok: false,
      error: e?.message ? String(e.message) : "fetch failed",
    };
  }
}

export async function GET(_req: NextRequest) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing FMP_API_KEY env var." },
      { status: 500 }
    );
  }
  const k = encodeURIComponent(apiKey);

  const candidates: [string, string][] = [
    ["v3_quotes_nasdaq", `https://financialmodelingprep.com/api/v3/quotes/nasdaq?apikey=${k}`],
    ["v3_quotes_nyse", `https://financialmodelingprep.com/api/v3/quotes/nyse?apikey=${k}`],
    ["v3_quote_sp500_index", `https://financialmodelingprep.com/api/v3/quote/%5EGSPC?apikey=${k}`],
    ["stable_batch_exchange_quote_nasdaq", `https://financialmodelingprep.com/stable/batch-exchange-quote?exchange=NASDAQ&apikey=${k}`],
    ["stable_sp500_constituent", `https://financialmodelingprep.com/api/v3/sp500_constituent?apikey=${k}`],
    ["stable_index_list", `https://financialmodelingprep.com/stable/index-list?apikey=${k}`],
  ];

  const results = await Promise.all(
    candidates.map(([label, url]) => probe(url, label))
  );

  return NextResponse.json({ results });
}
