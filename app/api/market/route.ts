import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Quote = {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  previous_close?: string;
  percent_change?: string; // (close - previous_close)/previous_close * 100
};

type Row = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
};

const CACHE_MS = 60_000; // 1 minute

let cache: { at: number; payload: any } | null = null;

// Keep this list aligned with your PRESET_TICKERS (tickers only)
const PRESET_SYMBOLS: string[] = [
  "AAPL","ABBV","ABT","ADBE","AMZN","AVGO","BAC","BRK.B","COST","CRM","CSCO","CVX","DIS","GOOGL","HD",
  "INTC","JNJ","JPM","KO","LLY","MA","MCD","META","MRK","MSFT","NFLX","NVDA","ORCL","PEP","PG","PYPL",
  "QCOM","SBUX","T","TGT","TSLA","TXN","UNH","V","VZ","WFC","WMT","XOM",
];

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

function normalizeQuoteResponse(json: any): Quote[] {
  // Twelve Data single symbol returns an object; batch may return {data:[...]} or an array.
  if (!json) return [];
  if (Array.isArray(json)) return json as Quote[];
  if (Array.isArray(json.data)) return json.data as Quote[];
  if (typeof json.symbol === "string") return [json as Quote];
  return [];
}

export async function GET() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing TWELVEDATA_API_KEY env var." },
      { status: 500 }
    );
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  // Batch quote (comma-separated symbols) is supported for /quote. :contentReference[oaicite:2]{index=2}
  const symbols = PRESET_SYMBOLS.join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  const quotes = normalizeQuoteResponse(json);

  const rows: Row[] = quotes.map((q) => {
    const open = toNum(q.open);
    const high = toNum(q.high);
    const low = toNum(q.low);
    const close = toNum(q.close);
    const pct = toNum(q.percent_change);

    // daily range %: (high-low)/open * 100 (fallback to close)
    let rangePct: number | null = null;
    const denom = (open && open > 0) ? open : (close && close > 0 ? close : null);
    if (denom && high != null && low != null) {
      rangePct = ((high - low) / denom) * 100;
    }

    return {
      symbol: q.symbol,
      changePct: pct,
      rangePct,
      last: close,
    };
  });

  const topRanges = [...rows]
    .filter((r) => r.rangePct != null)
    .sort((a, b) => (b.rangePct! - a.rangePct!))
    .slice(0, 10);

  const topMovers = [...rows]
    .filter((r) => r.changePct != null)
    .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
    .slice(0, 5);

  const payload = {
    updatedAt: new Date().toISOString(),
    topRanges,
    topMovers,
  };

  cache = { at: Date.now(), payload };
  return NextResponse.json(payload);
}
