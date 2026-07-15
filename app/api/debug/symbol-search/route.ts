import { NextResponse } from "next/server";

// Debug-only route (same shape as app/api/debug/ipo-calendar/route.ts) to
// confirm which of FMP's /stable search endpoints are actually reachable on
// the current subscription, and what field names they return. The historical
// index-constituent endpoints turned out to be plan-restricted (HTTP 402), so
// this verifies search-symbol / search-name before the symbol search route is
// rebuilt on top of them. Not linked from anywhere in the UI.

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
      rawText: text.slice(0, 500),
    };
  }
}

export async function GET(request: Request) {
  if (!FMP_API_KEY) {
    return NextResponse.json(
      { error: "Missing FMP_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") || "microsoft").trim();
  const base = "https://financialmodelingprep.com/stable";
  const q = encodeURIComponent(query);

  const searchSymbol = await fetchJson(
    `${base}/search-symbol?query=${q}&limit=10&apikey=${FMP_API_KEY}`
  );
  const searchName = await fetchJson(
    `${base}/search-name?query=${q}&limit=10&apikey=${FMP_API_KEY}`
  );

  return NextResponse.json({
    query,
    checkedEndpoints: ["/stable/search-symbol", "/stable/search-name"],
    searchSymbol: {
      status: searchSymbol.status,
      ok: searchSymbol.ok,
      count: Array.isArray(searchSymbol.json) ? searchSymbol.json.length : null,
      sample: Array.isArray(searchSymbol.json) ? searchSymbol.json.slice(0, 5) : searchSymbol,
    },
    searchName: {
      status: searchName.status,
      ok: searchName.ok,
      count: Array.isArray(searchName.json) ? searchName.json.length : null,
      sample: Array.isArray(searchName.json) ? searchName.json.slice(0, 5) : searchName,
    },
    note: "API key is not returned by this debug route. Pass ?query=arm to test other terms.",
  });
}
