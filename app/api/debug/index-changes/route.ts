import { NextResponse } from "next/server";

// Debug-only route (same shape as app/api/debug/ipo-calendar/route.ts) to
// inspect the raw shape of FMP's historical index-constituent responses
// and the batch-quote response. FMP's own docs pages don't expose a full
// field list/example for these endpoints from this environment, so this
// route exists to confirm actual field names against live data once a
// real FMP_API_KEY is available (this sandbox has none), rather than
// guessing. Not linked from anywhere in the UI.

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

export async function GET(request: Request) {
  if (!FMP_API_KEY) {
    return NextResponse.json(
      { error: "Missing FMP_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const base = "https://financialmodelingprep.com/stable";

  const sp500 = await fetchJson(
    `${base}/historical-sp500-constituent?apikey=${FMP_API_KEY}`
  );
  const nasdaq = await fetchJson(
    `${base}/historical-nasdaq-constituent?apikey=${FMP_API_KEY}`
  );
  const dowJones = await fetchJson(
    `${base}/historical-dowjones-constituent?apikey=${FMP_API_KEY}`
  );

  // Only fetch a quote sample if the caller supplies symbols, so this
  // route doesn't burn an extra call on every debug hit.
  const quoteSymbols = searchParams.get("symbols");
  const batchQuote = quoteSymbols
    ? await fetchJson(
        `${base}/batch-quote?symbols=${encodeURIComponent(quoteSymbols)}&apikey=${FMP_API_KEY}`
      )
    : null;

  return NextResponse.json({
    checkedEndpoints: [
      "/stable/historical-sp500-constituent",
      "/stable/historical-nasdaq-constituent",
      "/stable/historical-dowjones-constituent",
      "/stable/batch-quote (only if ?symbols= is passed)",
    ],
    sp500Sample: Array.isArray(sp500.json) ? sp500.json.slice(0, 3) : sp500,
    nasdaqSample: Array.isArray(nasdaq.json) ? nasdaq.json.slice(0, 3) : nasdaq,
    dowJonesSample: Array.isArray(dowJones.json) ? dowJones.json.slice(0, 3) : dowJones,
    batchQuote,
    note: "API key is not returned by this debug route. Pass ?symbols=AAPL,MSFT to also sample the batch-quote response.",
  });
}
