import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Quote = {
  symbol: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  previous_close?: string;
  percent_change?: string;
  volume?: string;
  status?: string; // sometimes present
  message?: string; // sometimes present
};

type Row = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

const CACHE_MS = 60_000; // 1 minute
let cache: { at: number; payload: any } | null = null;

// Keep this aligned with your preset list (tickers only)
const PRESET_SYMBOLS: string[] = [
  "AAPL","ABBV","ABT","ADBE","AMZN","AVGO","BAC","BRK.B","COST","CRM","CSCO","CVX","DIS","GOOGL","HD",
  "INTC","JNJ","JPM","KO","LLY","MA","MCD","META","MRK","MSFT","NFLX","NVDA","ORCL","PEP","PG","PYPL",
  "QCOM","SBUX","T","TGT","TSLA","TXN","UNH","V","VZ","WFC","WMT","XOM",
];

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

function extractQuotesFromBatch(json: any): Quote[] {
  if (!json || typeof json !== "object") return [];

  // If top-level is an error
  if (typeof json.status === "string" && json.status === "error") return [];

  // If it's already an array or { data: [...] }
  if (Array.isArray(json)) return json as Quote[];
  if (Array.isArray(json.data)) return json.data as Quote[];

  // Most common for batch: key-value object
  // Examples:
  // { "AAPL": { ...quote... }, "MSFT": { ... } }
  // or { "AAPL": { "status":"ok", ...quote... }, "BAD": { "status":"error", ... } }
  // or { "request_1": { "status":"ok", "data": {...} } } style
  const out: Quote[] = [];

  for (const [, v] of Object.entries(json)) {
    if (!v || typeof v !== "object") continue;

    // request-style wrapper: { status:"ok", data:{...} }
    const vv: any = v;
    if (vv.status === "ok" && vv.data && typeof vv.data === "object") {
      out.push(vv.data as Quote);
      continue;
    }

    // direct quote object (maybe has status/message fields too)
    if (typeof (vv as any).symbol === "string") {
      if (vv.status && vv.status === "error") continue;
      out.push(vv as Quote);
      continue;
    }

    // ok wrapper but fields on same level
    if (vv.status === "ok" && typeof vv.symbol === "string") {
      out.push(vv as Quote);
      continue;
    }
  }

  return out;
}

export async function GET() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing TWELVEDATA_API_KEY env var." }, { status: 500 });
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  const symbols = PRESET_SYMBOLS.join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();

    const quotes = extractQuotesFromBatch(json);

    const rows: Row[] = quotes.map((q) => {
      const open = toNum(q.open);
      const high = toNum(q.high);
      const low = toNum(q.low);
      const close = toNum(q.close);
      const pct = toNum(q.percent_change);
      const vol = toNum(q.volume);

      // daily range %: (high-low) / denom
      let rangePct: number | null = null;
      const denom = open && open > 0 ? open : close && close > 0 ? close : null;
      if (denom && high != null && low != null) rangePct = ((high - low) / denom) * 100;

      return {
        symbol: q.symbol,
        changePct: pct,
        rangePct,
        last: close,
        volume: vol,
      };
    });

    const topTraded = [...rows]
      .filter((r) => r.volume != null)
      .sort((a, b) => (b.volume! - a.volume!))
      .slice(0, 10);

    const topMovers = [...rows]
      .filter((r) => r.changePct != null)
      .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
      .slice(0, 5);

    const topRanges = [...rows]
      .filter((r) => r.rangePct != null)
      .sort((a, b) => (b.rangePct! - a.rangePct!))
      .slice(0, 10);

    const payload = {
      updatedAt: new Date().toISOString(),
      topTraded,
      topMovers,
      topRanges, // kept (optional)
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ updatedAt: new Date().toISOString(), topTraded: [], topMovers: [], topRanges: [] });
  }
}
