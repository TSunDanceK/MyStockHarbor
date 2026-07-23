import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY debug route, same pattern as the removed /api/debug/quote-shape.
// Probes the 3 FMP "market performance" bucket endpoints (biggest-gainers,
// biggest-losers, most-actives) on the live Starter-plan key to confirm plan
// access + exact JSON field shape before wiring them into the price pool.
// No auth gate: this only returns public market-mover tickers/prices (the same
// data any visitor could see on Yahoo/Google Finance) and never echoes the FMP
// key itself. DELETE THIS FILE once verified.

async function probe(path: string, apiKey: string) {
  const url = `https://financialmodelingprep.com/stable/${path}?apikey=${encodeURIComponent(
    apiKey
  )}`;
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
      path,
      status: res.status,
      ok: res.ok,
      isArray: Array.isArray(json),
      count: Array.isArray(json) ? json.length : null,
      sample: Array.isArray(json) ? json.slice(0, 3) : json,
    };
  } catch (e: any) {
    return {
      path,
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

  const results = await Promise.all([
    probe("biggest-gainers", apiKey),
    probe("biggest-losers", apiKey),
    probe("most-actives", apiKey),
  ]);

  return NextResponse.json({ results });
}
