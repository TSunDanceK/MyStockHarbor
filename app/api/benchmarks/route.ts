// app/api/benchmarks/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BenchItem = {
  key: string;
  label: string;
  symbol: string;
  date: string | null;
  time: string | null;
  close: number | null;
  prevClose: number | null;
  changePct: number | null;
};

type BenchPayload = {
  updatedAt: string;
  scope: string;
  items: BenchItem[];
};

const CACHE_MS = 5 * 60_000;
let cache: { at: number; payload: BenchPayload } | null = null;

function toNum(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}

const BENCH_DEFS = [
  { key: "spy", label: "S&P 500 (via SPY)",     symbol: "SPY" },
  { key: "ndx", label: "Nasdaq 100 (via QQQ)",  symbol: "QQQ" },
  { key: "dia", label: "Dow Jones (via DIA)",    symbol: "DIA" },
  { key: "iwm", label: "Russell 2000 (via IWM)", symbol: "IWM" },
] as const;

async function fetchFmpQuote(symbol: string, apiKey: string): Promise<any | null> {
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    // FMP returns an array for /stable/quote
    const row = Array.isArray(json) ? json[0] : json;
    return row ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  }

  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { updatedAt: new Date().toISOString(), scope: "Benchmarks (FMP)", items: [] } satisfies BenchPayload,
      { status: 500 }
    );
  }

  // Fire all 4 in parallel — same pattern as the working /api/quote route
  const rows = await Promise.all(BENCH_DEFS.map((d) => fetchFmpQuote(d.symbol, apiKey)));

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19);

  const items: BenchItem[] = BENCH_DEFS.map((d, i) => {
    const r = rows[i];
    return {
      key: d.key,
      label: d.label,
      symbol: d.symbol,
      date: r ? dateStr : null,
      time: r ? timeStr : null,
      close: toNum(r?.price),
      prevClose: toNum(r?.previousClose),
      changePct: toNum(r?.changesPercentage),
    };
  });

  const payload: BenchPayload = {
    updatedAt: now.toISOString(),
    scope: "Benchmarks (FMP)",
    items,
  };

  cache = { at: Date.now(), payload };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
