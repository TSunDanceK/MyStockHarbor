import { NextResponse } from "next/server";

// Debug-only probe (mirrors app/api/debug/index-changes) to confirm, against
// live data on the current FMP plan, which quote/ratios endpoints are reachable
// and which fields (especially PE) each returns. Not linked from anywhere.
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
  const symbols = searchParams.get("symbols");
  if (!symbols) {
    return NextResponse.json({ note: "Pass ?symbols=AAPL,MSFT to probe." });
  }
  const first = symbols.split(",")[0];
  const s = encodeURIComponent(first);
  const key = encodeURIComponent(FMP_API_KEY);

  const [ratiosTtm, keyMetricsTtm, income] = await Promise.all([
    probe(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${s}&apikey=${key}`),
    probe(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${s}&apikey=${key}`),
    probe(`https://financialmodelingprep.com/stable/income-statement?symbol=${s}&period=quarter&limit=4&apikey=${key}`),
  ]);

  return NextResponse.json({
    "stable/ratios-ttm": ratiosTtm,
    "stable/key-metrics-ttm": keyMetricsTtm,
    "stable/income-statement (quarter,4)": income,
  });
}
