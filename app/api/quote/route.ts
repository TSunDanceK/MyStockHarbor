import { NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Quote = {
  symbol: string;
  price: number | null;
  marketCap: number | null;
  name: string | null;
  pe: number | null;
  priceAvg50: number | null;
  priceAvg200: number | null;
  exchange: string | null;
  date: string | null;
  time: string | null;
  source: string;
  // Added for the trader quote-snapshot header: day range, volume vs average,
  // previous close and change. All come from the same stable/quote call
  // already being made — no extra API cost.
  open: number | null;
  previousClose: number | null;
  change: number | null;
  changePercentage: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  volume: number | null;
  avgVolume: number | null;
};

function emptyQuote(symbol: string): Quote {
  return {
    symbol,
    price: null,
    marketCap: null,
    name: null,
    pe: null,
    priceAvg50: null,
    priceAvg200: null,
    exchange: null,
    date: null,
    time: null,
    source: "financialmodelingprep.com",
    open: null,
    previousClose: null,
    change: null,
    changePercentage: null,
    dayLow: null,
    dayHigh: null,
    yearLow: null,
    yearHigh: null,
    volume: null,
    avgVolume: null,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    return NextResponse.json(emptyQuote(symbol), { status: 500 });
  }

  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });

    if (!res.ok) throw new Error(`FMP quote failed: ${res.status}`);

    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    const now = new Date();

    const payload: Quote = {
      symbol: str(row?.symbol) ?? symbol,
      price: num(row?.price),
      marketCap: num(row?.marketCap),
      name: str(row?.name),
      pe: num(row?.pe),
      priceAvg50: num(row?.priceAvg50),
      priceAvg200: num(row?.priceAvg200),
      exchange: str(row?.exchange),
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 19),
      source: "financialmodelingprep.com",
      open: num(row?.open),
      previousClose: num(row?.previousClose),
      change: num(row?.change),
      changePercentage: num(row?.changePercentage),
      dayLow: num(row?.dayLow),
      dayHigh: num(row?.dayHigh),
      yearLow: num(row?.yearLow),
      yearHigh: num(row?.yearHigh),
      volume: num(row?.volume),
      avgVolume: num(row?.avgVolume),
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(emptyQuote(symbol), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
