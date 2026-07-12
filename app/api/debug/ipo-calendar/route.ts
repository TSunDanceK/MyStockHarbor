import { NextResponse } from "next/server";

// Debug-only route (same shape as app/api/debug/earnings/[symbol]/route.ts)
// to inspect the raw shape of FMP's IPO calendar response. FMP's own docs
// pages don't expose a full field list/example for this endpoint from this
// environment, so this route exists to confirm actual field names against
// live data once a real FMP_API_KEY is available (this sandbox has none),
// rather than guessing. Not linked from anywhere in the UI.

const FMP_API_KEY = process.env.FMP_API_KEY;

async function fetchJson(url: string) {
  const response = await fetch(url, { next: { revalidate: 0 } });
  const text = await response.text();

  try {
    return { ok: response.ok, status: response.status, json: JSON.parse(text) };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      json: null,
      rawText: text.slice(0, 2000),
    };
  }
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!FMP_API_KEY) {
    return NextResponse.json(
      { error: "Missing FMP_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const from = searchParams.get("from") || toIsoDate(now);
  const to = searchParams.get("to") || toIsoDate(in60Days);

  const base = "https://financialmodelingprep.com/stable";
  const url = `${base}/ipos-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
    to
  )}&apikey=${FMP_API_KEY}`;

  const ipoCalendar = await fetchJson(url);

  return NextResponse.json({
    checkedEndpoint: "/stable/ipos-calendar",
    from,
    to,
    ipoCalendar,
    note: "API key is not returned by this debug route.",
  });
}
