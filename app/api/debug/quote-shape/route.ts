import { NextResponse } from "next/server";

// Debug-only probe (mirrors app/api/debug/index-changes) to confirm, against
// live data on the current FMP plan, which quote endpoints are reachable and
// which fields (especially `pe`) each returns. Not linked from anywhere.
// The API key is never returned. Hit with ?symbols=AAPL,MSFT to run.

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
      return { ok: res.ok, status: res.status, rawText: text.slice(0, 300) };
    }
    const rows = Array.isArray(json) ? json : json ? [json] : [];
    const first = rows[0] as Record<string, unknown> | undefined;
    return {
      ok: res.ok,
      status: res.status,
      count: rows.length,
      fields: first ? Object.keys(first) : [],
      hasPe: first ? "pe" in first : false,
      sample: first
        ? {
            symbol: first.symbol,
            price: first.price,
            pe: first.pe,
            marketCap: first.marketCap,
            volume: first.volume,
            changePercentage: first.changePercentage,
            changesPercentage: first.changesPercentage,
          }
        : null,
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
  const symbols = searchParams.get("symbols");
  if (!symbols) {
    return NextResponse.json({ note: "Pass ?symbols=AAPL,MSFT to probe." });
  }
  const first = symbols.split(",")[0];
  const key = encodeURIComponent(FMP_API_KEY);

  const [stableSingle, stableBatch, v3Batch] = await Promise.all([
    probe(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(first)}&apikey=${key}`),
    probe(`https://financialmodelingprep.com/stable/batch-quote?symbols=${encodeURIComponent(symbols)}&apikey=${key}`),
    probe(`https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbols)}?apikey=${key}`),
  ]);

  return NextResponse.json({
    "stable/quote (single)": stableSingle,
    "stable/batch-quote": stableBatch,
    "api/v3/quote (comma batch)": v3Batch,
  });
}
