import { NextResponse } from "next/server";

// Debug-only probe: which FMP endpoints powering potential new screener tabs
// (Analysts, Dividends, Performance, Valuation-forward) are reachable on the
// current plan, and what fields they return. Not linked anywhere; key never
// returned. Hit with ?symbol=AAPL.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FMP_API_KEY = process.env.FMP_API_KEY;

async function probe(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: res.ok, status: res.status, rawText: text.slice(0, 200) };
    }
    const rows = Array.isArray(json) ? json : json ? [json] : [];
    const first = rows[0] as Record<string, unknown> | undefined;
    return {
      ok: res.ok,
      status: res.status,
      count: rows.length,
      fields: first ? Object.keys(first) : [],
      first: first ?? null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "fetch failed" };
  }
}

export async function GET(request: Request) {
  if (!FMP_API_KEY) {
    return NextResponse.json({ error: "Missing FMP_API_KEY" }, { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "AAPL";
  const s = encodeURIComponent(symbol);
  const key = encodeURIComponent(FMP_API_KEY);
  const base = "https://financialmodelingprep.com/stable";

  const [
    priceTargetSummary,
    gradesConsensus,
    analystEstimates,
    dividends,
    priceChange,
    ratingSnapshot,
  ] = await Promise.all([
    probe(`${base}/price-target-summary?symbol=${s}&apikey=${key}`),
    probe(`${base}/grades-consensus?symbol=${s}&apikey=${key}`),
    probe(`${base}/analyst-estimates?symbol=${s}&period=annual&limit=1&apikey=${key}`),
    probe(`${base}/dividends?symbol=${s}&limit=4&apikey=${key}`),
    probe(`${base}/stock-price-change?symbol=${s}&apikey=${key}`),
    probe(`${base}/ratings-snapshot?symbol=${s}&apikey=${key}`),
  ]);

  return NextResponse.json({
    "price-target-summary": priceTargetSummary,
    "grades-consensus": gradesConsensus,
    "analyst-estimates": analystEstimates,
    "dividends": dividends,
    "stock-price-change": priceChange,
    "ratings-snapshot": ratingSnapshot,
  });
}
