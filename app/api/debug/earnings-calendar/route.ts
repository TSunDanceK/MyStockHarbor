import { NextResponse } from "next/server";

import { fmpFetch } from "@/lib/server/fmpUsage";
// Debug-only route (same shape as app/api/debug/ipo-calendar/route.ts) to
// confirm the earnings-calendar endpoint is actually reachable on the
// current FMP subscription and see its real field names, before building
// any UI on top of it. The historical index-constituent endpoints turned
// out to be plan-restricted (HTTP 402) despite looking like they should be
// covered, so this check happens first every time now. Not linked from
// anywhere in the UI.

const FMP_API_KEY = process.env.FMP_API_KEY;

async function fetchJson(url: string) {
  const response = await fmpFetch(url, { next: { revalidate: 0 } });
  const text = await response.text();

  try {
    return { ok: response.ok, status: response.status, json: JSON.parse(text) };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      json: null,
      rawText: text.slice(0, 1000),
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
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const from = searchParams.get("from") || toIsoDate(now);
  const to = searchParams.get("to") || toIsoDate(in14Days);

  const base = "https://financialmodelingprep.com/stable";
  const url = `${base}/earnings-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
    to
  )}&apikey=${FMP_API_KEY}`;

  const earningsCalendar = await fetchJson(url);

  // Also check whether a bulk symbol->name/exchange list is reachable, since
  // earnings-calendar rows only carry symbol/date/EPS/revenue -- no company
  // name or exchange -- and enriching ~2000+ rows one profile call at a time
  // isn't viable. If this is accessible, one cached daily fetch could supply
  // name+exchange for every row instead.
  const stockList = await fetchJson(`${base}/stock-list?apikey=${FMP_API_KEY}`);
  const findSymbol = (searchParams.get("findSymbol") || "").trim().toUpperCase();
  const stockListMatch =
    findSymbol && Array.isArray(stockList.json)
      ? (stockList.json as Array<Record<string, unknown>>).find(
          (row) => String(row.symbol ?? "").toUpperCase() === findSymbol
        )
      : null;

  // Checking whether a bulk-but-cheaper quote endpoint exists: batch-quote
  // (full) is confirmed 402 on this plan (see app/api/debug/index-changes).
  // batch-quote-short might be a separate, lower tier -- if reachable it
  // could solve "rank ~2000 daily reporters by liquidity" in one call
  // instead of one quote call per symbol just to find out which ones matter.
  const quoteSymbols = (searchParams.get("symbols") || "AAPL,MSFT,DANOY").trim();
  const batchQuoteShort = await fetchJson(
    `${base}/batch-quote-short?symbols=${encodeURIComponent(quoteSymbols)}&apikey=${FMP_API_KEY}`
  );

  return NextResponse.json({
    checkedEndpoint: "/stable/earnings-calendar",
    from,
    to,
    status: earningsCalendar.status,
    ok: earningsCalendar.ok,
    count: Array.isArray(earningsCalendar.json) ? earningsCalendar.json.length : null,
    sample: Array.isArray(earningsCalendar.json)
      ? earningsCalendar.json.slice(0, 5)
      : earningsCalendar,
    stockList: {
      status: stockList.status,
      ok: stockList.ok,
      count: Array.isArray(stockList.json) ? stockList.json.length : null,
      sample: Array.isArray(stockList.json) ? stockList.json.slice(0, 5) : stockList,
      findSymbolMatch: stockListMatch,
    },
    batchQuoteShort: {
      status: batchQuoteShort.status,
      ok: batchQuoteShort.ok,
      body: batchQuoteShort.json ?? batchQuoteShort.rawText,
    },
    note: "API key is not returned by this debug route.",
  });
}
