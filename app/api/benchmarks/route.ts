// app/api/benchmarks/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type StooqRow = {
  symbol?: string;
  date?: string;
  time?: string;
  close?: string;
  previous_close?: string;
};

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

const CACHE_MS = 60_000; // 1 min
let cache: { at: number; payload: BenchPayload } | null = null;

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

async function fetchStooqQuote(symbol: string): Promise<StooqRow | null> {
  // Stooq JSON quote endpoint
  // Example: https://stooq.com/q/l/?s=spy.us&f=sd2t2ohlcv&h&e=json
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=json`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const json = (await res.json()) as any;

  // Typical: { "symbols": [ { ... } ] }
  const row = Array.isArray(json?.symbols) ? json.symbols[0] : null;
  if (!row || typeof row !== "object") return null;

  return row as StooqRow;
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  // ✅ Benchmarks via ETFs (Stooq is reliable with *.us)
  const defs = [
    { key: "spx", label: "S&P 500 (via SPY)", symbol: "spy.us" },
    { key: "ndx", label: "Nasdaq 100 (via QQQ)", symbol: "qqq.us" },
  ] as const;

  try {
    const rows = await Promise.all(defs.map((d) => fetchStooqQuote(d.symbol)));

    const items: BenchItem[] = defs.map((d, i) => {
      const r = rows[i];

      const close = toNum(r?.close);
      const prev = toNum(r?.previous_close);

      const changePct =
        close != null && prev != null && prev !== 0 ? ((close - prev) / prev) * 100 : null;

      return {
        key: d.key,
        label: d.label,
        symbol: d.symbol,
        date: typeof r?.date === "string" ? r!.date! : null,
        time: typeof r?.time === "string" ? r!.time! : null,
        close,
        prevClose: prev,
        changePct,
      };
    });

    const payload: BenchPayload = {
      updatedAt: new Date().toISOString(),
      scope: "Benchmarks (Stooq, free, via ETFs)",
      items,
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch {
    const payload: BenchPayload = {
      updatedAt: new Date().toISOString(),
      scope: "Benchmarks (Stooq, free, via ETFs)",
      items: [],
    };
    return NextResponse.json(payload);
  }
}
