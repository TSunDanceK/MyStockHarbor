// app/api/market/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Quote = {
  symbol: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  previous_close?: string;
  percent_change?: string;
  volume?: string;
  status?: string;
  message?: string;
};

type Row = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

type Payload = {
  updatedAt: string;
  scope: string; // IMPORTANT: label what universe this is
  universeSize: number;
  topTraded: Row[];
  topMovers: Row[];
  topRanges: Row[];
};

/* ----------------------------- caching ----------------------------- */

// Cache a bit longer to keep dashboard snappy + reduce API usage.
const CACHE_MS = 5 * 60_000; // 5 minutes
let cache: { at: number; payload: Payload } | null = null;

/* ----------------------------- universe ---------------------------- */
/**
 * This defines the universe your "Market Overview" uses.
 * It's NOT the whole market — it's a curated universe.
 *
 * We include:
 * 1) Your dropdown tickers (PRESET_TICKERS)
 * 2) Your pickers universe tickers (PRESET_UNIVERSE from /api/pickers route)
 * 3) A few extra large caps / commonly searched (optional)
 *
 * You can expand this list safely, but:
 * - More symbols = more API calls (chunked), more chance of rate limiting.
 */

// Your dropdown tickers (from DashboardClient PRESET_TICKERS)
const PRESET_TICKERS: string[] = [
  "AAPL","ABBV","ABT","ADBE","AMZN","AVGO","BAC","BRK.B","COST","CRM","CSCO","CVX","DIS","GOOGL","HD",
  "INTC","JNJ","JPM","KO","LLY","MA","MCD","META","MRK","MSFT","NFLX","NVDA","ORCL","PEP","PG","PYPL",
  "QCOM","SBUX","T","TGT","TSLA","TXN","UNH","V","VZ","WFC","WMT","XOM",
];

// Your pickers universe list (copied from app/api/pickers/route.ts PRESET_UNIVERSE)
const PICKERS_UNIVERSE: string[] = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","BRK.B","AVGO","LLY","JPM","V","UNH","XOM","PG","MA",
  "COST","HD","MRK","ABBV","CRM","NFLX","ORCL","BAC","KO","PEP","ADBE","TMO","WMT","CSCO","ACN","MCD","ABT",
  "CVX","LIN","AMD","NKE","DHR","TXN","INTC","QCOM","PM","IBM","NOW","SBUX","CAT","GE","AMAT","LOW",
];

// OPTIONAL: a few extra popular names (keep small)
const EXTRA: string[] = [
  "SPY","QQQ","IWM","DIA", // ETFs (if Twelve Data returns them on your plan)
  "GOOG","BRK.A","PLTR","SNOW","SHOP","UBER","PANW","CRWD","TSM","ASML",
];

function buildUniverse(): string[] {
  const set = new Set<string>();

  for (const s of [...PRESET_TICKERS, ...PICKERS_UNIVERSE, ...EXTRA]) {
    const sym = String(s || "").trim().toUpperCase();
    if (sym) set.add(sym);
  }

  return Array.from(set);
}

/* ----------------------------- helpers ----------------------------- */

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractQuotesFromBatch(json: any): Quote[] {
  if (!json || typeof json !== "object") return [];

  // If top-level is an error
  if (typeof json.status === "string" && json.status === "error") return [];

  // If it's already an array or { data: [...] }
  if (Array.isArray(json)) return json as Quote[];
  if (Array.isArray(json.data)) return json.data as Quote[];

  // Most common for batch: key-value object
  // e.g. { "AAPL": {...}, "MSFT": {...} } OR request wrappers
  const out: Quote[] = [];

  for (const [, v] of Object.entries(json)) {
    if (!v || typeof v !== "object") continue;

    const vv: any = v;

    // request-style wrapper: { status:"ok", data:{...} }
    if (vv.status === "ok" && vv.data && typeof vv.data === "object") {
      if (typeof vv.data.symbol === "string") out.push(vv.data as Quote);
      continue;
    }

    // direct quote object
    if (typeof vv.symbol === "string") {
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

async function fetchBatchQuotes(apiKey: string, symbols: string[]): Promise<Quote[]> {
  // TwelveData accepts comma-separated in one request, but URLs can get huge.
  // Chunk to avoid URL-length failures and reduce random errors.
  const CHUNK_SIZE = 40;

  const parts = chunk(symbols, CHUNK_SIZE);
  const all: Quote[] = [];

  for (const p of parts) {
    const joined = p.join(",");
    const url =
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(joined)}&apikey=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();

    const quotes = extractQuotesFromBatch(json);
    all.push(...quotes);
  }

  return all;
}

/* -------------------------------- GET -------------------------------- */

export async function GET() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing TWELVEDATA_API_KEY env var." }, { status: 500 });
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  try {
    const universe = buildUniverse();

    // Safety cap so you don’t accidentally nuke your API quota.
    // You can increase this later if your Twelve Data plan allows it.
    const MAX_UNIVERSE = 200;
    const capped = universe.slice(0, MAX_UNIVERSE);

    const quotes = await fetchBatchQuotes(apiKey, capped);

    const rows: Row[] = quotes
      .map((q) => {
        const open = toNum(q.open);
        const high = toNum(q.high);
        const low = toNum(q.low);
        const close = toNum(q.close);
        const pct = toNum(q.percent_change);
        const vol = toNum(q.volume);

        // daily range %: (high-low) / denom
        let rangePct: number | null = null;
        const denom =
          open && open > 0 ? open : close && close > 0 ? close : null;

        if (denom && high != null && low != null) {
          rangePct = ((high - low) / denom) * 100;
        }

        return {
          symbol: String(q.symbol || "").toUpperCase(),
          changePct: pct,
          rangePct,
          last: close,
          volume: vol,
        };
      })
      .filter((r) => r.symbol && (r.last != null || r.volume != null || r.changePct != null));

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

    const payload: Payload = {
      updatedAt: new Date().toISOString(),
      scope: "Curated Universe (Dashboard + Pickers + Extras)",
      universeSize: capped.length,
      topTraded,
      topMovers,
      topRanges,
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch {
    const payload: Payload = {
      updatedAt: new Date().toISOString(),
      scope: "Curated Universe (Dashboard + Pickers + Extras)",
      universeSize: 0,
      topTraded: [],
      topMovers: [],
      topRanges: [],
    };
    return NextResponse.json(payload);
  }
}
