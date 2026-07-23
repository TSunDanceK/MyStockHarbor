import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY debug route. Round 3: the production discovery loop
// (app/api/market/route.ts, fetchFmpConstituentSymbols) calls the LEGACY
// api/v3/sp500_constituent / api/v3/nasdaq_constituent endpoints, which just
// came back 403 "Legacy Endpoint ... no longer supported ... prior August 31,
// 2025." Finding the current stable-API replacement so that call can be
// fixed. DELETE THIS FILE once verified.

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
    ["stable_sp500_constituent_hyphen", `https://financialmodelingprep.com/stable/sp500-constituent?apikey=${k}`],
    ["stable_nasdaq_constituent_hyphen", `https://financialmodelingprep.com/stable/nasdaq-constituent?apikey=${k}`],
    ["stable_dowjones_constituent_hyphen", `https://financialmodelingprep.com/stable/dowjones-constituent?apikey=${k}`],
    ["stable_sp500_constituent_underscore", `https://financialmodelingprep.com/stable/sp500_constituent?apikey=${k}`],
    ["stable_index_constituents_gspc", `https://financialmodelingprep.com/stable/index-constituents?symbol=%5EGSPC&apikey=${k}`],
    ["stable_sp500_constituent_no_hyphen", `https://financialmodelingprep.com/stable/sp500constituent?apikey=${k}`],
  ];

  const results = await Promise.all(
    candidates.map(([label, url]) => probe(url, label))
  );

  return NextResponse.json({ results });
}
