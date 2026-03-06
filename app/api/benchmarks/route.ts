// app/api/benchmarks/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type StooqRow = {
  symbol?: string;
  date?: string;
  time?: string;
  open?: string;
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
  /**
   * Stooq JSON quote endpoint
   * Fields:
   * s = symbol, d = date, t = time, o = open, c = close
   * (previous_close sometimes exists; if not, we'll fallback to open)
   */
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2oc&h&e=json`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const json = (await res.json()) as any;
  const row = Array.isArray(json?.symbols) ? json.symbols[0] : null;
  if (!row || typeof row !== "object") return null;

  return row as StooqRow;
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  // Use free Stooq symbols for broad market benchmarks
  const defs = [
    { key: "spy", label: "S&P 500 (via SPY)", symbol: "spy.us" },
   { key: "ndx", label: "Nasdaq 100 (NDX)", symbol: "ndx.us" },
    { key: "dia", label: "Dow Jones (via DIA)", symbol: "dia.us" },
    { key: "iwm", label: "Russell 2000 (via IWM)", symbol: "iwm.us" },
  ] as const;

  try {
    const rows = await Promise.all(defs.map((d) => fetchStooqQuote(d.symbol)));

    const items: BenchItem[] = defs.map((d, i) => {
      const r = rows[i];

      const close = toNum(r?.close);
      const prev = toNum((r as any)?.previous_close);
      const open = toNum((r as any)?.open);

      // If Stooq doesn't give previous_close, use open as a best-effort daily-move proxy
      const base = prev ?? open ?? null;

      const changePct =
        close != null && base != null && base !== 0 ? ((close - base) / base) * 100 : null;

      return {
        key: d.key,
        label: d.label,
        symbol: d.symbol,
        date: typeof r?.date === "string" ? r!.date! : null,
        time: typeof r?.time === "string" ? r!.time! : null,
        close,
        prevClose: base,
        changePct,
      };
    });

    const payload: BenchPayload = {
      updatedAt: new Date().toISOString(),
      scope: "Benchmarks (Stooq, free)",
      items,
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch {
    const payload: BenchPayload = {
      updatedAt: new Date().toISOString(),
     scope: "Benchmarks (Stooq, free)",
      items: [],
    };
    return NextResponse.json(payload);
  }
}
