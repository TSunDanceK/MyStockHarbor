// app/api/market/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type Row = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

type MarketPayload = {
  updatedAt: string;
  topTraded: Row[];
  topMovers: Row[];
  topRanges: Row[];
};

const CACHE_MS = 60_000; // 1 minute (keep)
let cache: { at: number; payload: MarketPayload } | null = null;

// Keep aligned with your dashboard preset list (tickers only)
const PRESET_SYMBOLS: string[] = [
  "AAPL","ABBV","ABT","ADBE","AMZN","AVGO","BAC","BRK.B","COST","CRM","CSCO","CVX","DIS","GOOGL","HD",
  "INTC","JNJ","JPM","KO","LLY","MA","MCD","META","MRK","MSFT","NFLX","NVDA","ORCL","PEP","PG","PYPL",
  "QCOM","SBUX","T","TGT","TSLA","TXN","UNH","V","VZ","WFC","WMT","XOM",
];

function originFromReq(req: NextRequest) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

// small p-limit (no deps)
function pLimit(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

async function fetchHistory(origin: string, symbol: string, days: number) {
  const u = `${origin}/api/history?symbol=${encodeURIComponent(symbol)}&days=${days}`;
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error("history fetch failed");

  const data = (await res.json()) as { symbol: string; points: any[] };
  const ptsRaw = Array.isArray(data.points) ? data.points : [];

  const pts: Point[] = ptsRaw
    .map((p: any) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close));

  return pts;
}

function buildRow(symbol: string, pts: Point[]): Row | null {
  if (!pts.length) return null;

  const lastPt = pts[pts.length - 1];
  const prevPt = pts.length >= 2 ? pts[pts.length - 2] : null;

  const last = toNum(lastPt.close);
  const prev = prevPt ? toNum(prevPt.close) : null;

  // % change vs previous close
  let changePct: number | null = null;
  if (last != null && prev != null && prev > 0) {
    changePct = ((last - prev) / prev) * 100;
  }

  // daily range %: (high-low) / denom
  const high = toNum(lastPt.high);
  const low = toNum(lastPt.low);

  let rangePct: number | null = null;
  const denom = last != null && last > 0 ? last : prev != null && prev > 0 ? prev : null;
  if (denom && high != null && low != null) {
    rangePct = ((high - low) / denom) * 100;
  }

  const volume = toNum(lastPt.volume);

  return { symbol, changePct, rangePct, last, volume };
}

export async function GET(req: NextRequest) {
  // 1) cache
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  const origin = originFromReq(req);

  // Use enough days to guarantee “previous close” exists
  const days = 10;

  // Concurrency cap so we don’t slam your own /api/history
  const limit = pLimit(8);

  const rows: Row[] = [];

  await Promise.all(
    PRESET_SYMBOLS.map((symbol) =>
      limit(async () => {
        try {
          const pts = await fetchHistory(origin, symbol, days);
          const row = buildRow(symbol, pts);
          if (row) rows.push(row);
        } catch {
          // ignore per-symbol failures
        }
      })
    )
  );

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

  const payload: MarketPayload = {
    updatedAt: new Date().toISOString(),
    topTraded,
    topMovers,
    topRanges,
  };

  cache = { at: Date.now(), payload };
  return NextResponse.json(payload);
}
