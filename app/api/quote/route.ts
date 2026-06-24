import { NextResponse } from "next/server";

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
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();

  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { symbol, price: null, marketCap: null, name: null, pe: null, priceAvg50: null, priceAvg200: null, exchange: null, date: null, time: null, source: "financialmodelingprep.com" } satisfies Quote,
      { status: 500 }
    );
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
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { symbol, price: null, marketCap: null, name: null, pe: null, priceAvg50: null, priceAvg200: null, exchange: null, date: null, time: null, source: "financialmodelingprep.com" } satisfies Quote,
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
