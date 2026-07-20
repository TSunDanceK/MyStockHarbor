// app/api/benchmarks/route.ts
import { NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";

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
const cache = new Map<string, { at: number; payload: BenchPayload }>();

function toNum(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}

const BENCH_DEFS_STOCK = [
  { key: "spy", label: "S&P 500 (via SPY)",     symbol: "SPY" },
  { key: "ndx", label: "Nasdaq 100 (via QQQ)",  symbol: "QQQ" },
  { key: "dia", label: "Dow Jones (via DIA)",    symbol: "DIA" },
  { key: "iwm", label: "Russell 2000 (via IWM)", symbol: "IWM" },
] as const;

const BENCH_DEFS_CRYPTO = [
  { key: "btc", label: "Bitcoin (BTC)",  symbol: "BTCUSD" },
  { key: "eth", label: "Ethereum (ETH)", symbol: "ETHUSD" },
  { key: "sol", label: "Solana (SOL)",   symbol: "SOLUSD" },
  { key: "trx", label: "TRON (TRX)",     symbol: "TRXUSD" },
] as const;

function getBenchDefs(scope: string) {
  return scope === "crypto" ? BENCH_DEFS_CRYPTO : BENCH_DEFS_STOCK;
}

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scope = (searchParams.get("scope") || "stock").toLowerCase() === "crypto" ? "crypto" : "stock";

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const cached = cache.get(scope);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.payload, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  }

  const apiKey = process.env.FMP_API_KEY;
  const defs = getBenchDefs(scope);

  if (!apiKey) {
    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        scope: scope === "crypto" ? "Crypto Benchmarks (FMP)" : "Benchmarks (FMP)",
        items: [],
      } satisfies BenchPayload,
      { status: 500 }
    );
  }

  // Fire all 4 in parallel — same pattern as the working /api/quote route
  const rows = await Promise.all(defs.map((d) => fetchFmpQuote(d.symbol, apiKey)));

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19);

  const items: BenchItem[] = defs.map((d, i) => {
    const r = rows[i];
    return {
      key: d.key,
      label: d.label,
      symbol: d.symbol,
      date: r ? dateStr : null,
      time: r ? timeStr : null,
      close: toNum(r?.price),
      prevClose: toNum(r?.previousClose),
      // FMP's /stable/quote endpoint returns `changePercentage` (no "s").
      // `changesPercentage` was the legacy v3 field name — kept as a
      // defensive fallback in case a symbol ever routes through an
      // older response shape.
      changePct: toNum(r?.changePercentage ?? r?.changesPercentage),
    };
  });

  const payload: BenchPayload = {
    updatedAt: now.toISOString(),
    scope: scope === "crypto" ? "Crypto Benchmarks (FMP)" : "Benchmarks (FMP)",
    items,
  };

  cache.set(scope, { at: Date.now(), payload });

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
