// app/api/benchmarks/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always fresh, no ISR cache

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

// In-process cache: avoids hammering FMP on every render but still
// refreshes every 5 min (survives across requests on the same lambda instance)
const CACHE_MS = 5 * 60_000;
let cache: { at: number; payload: BenchPayload } | null = null;

function toNum(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}

const BENCH_DEFS = [
  { key: "spy", label: "S&P 500 (via SPY)",      symbol: "SPY" },
  { key: "ndx", label: "Nasdaq 100 (via QQQ)",   symbol: "QQQ" },
  { key: "dia", label: "Dow Jones (via DIA)",     symbol: "DIA" },
  { key: "iwm", label: "Russell 2000 (via IWM)",  symbol: "IWM" },
] as const;

export async function GET() {
  // Return in-process cached payload if still fresh
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  }

  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        scope: "Benchmarks (FMP)",
        items: [],
      } satisfies BenchPayload,
      { status: 500 }
    );
  }

  try {
    const symbols = BENCH_DEFS.map((d) => d.symbol).join(",");
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
      symbols
    )}&apikey=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!res.ok) throw new Error(`FMP benchmarks failed: ${res.status}`);

    const json = (await res.json()) as any[];
    const rows = Array.isArray(json) ? json : [];

    const bySymbol = new Map<string, any>(
      rows.map((r) => [String(r?.symbol ?? "").toUpperCase(), r])
    );

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19);

    const items: BenchItem[] = BENCH_DEFS.map((d) => {
      const r = bySymbol.get(d.symbol.toUpperCase());
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
  } catch {
    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        scope: "Benchmarks (FMP)",
        items: [],
      } satisfies BenchPayload,
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
