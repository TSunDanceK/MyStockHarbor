// lib/server/benchmarksBuilder.ts
//
// Core data-building logic for /api/benchmarks, extracted so
// app/dashboard/page.tsx can read the payload in-process via
// getBenchmarksData() instead of doing an HTTP self-fetch to its own (now
// BotID-guarded) /api/benchmarks route. That self-fetch carries no browser
// BotID header and would otherwise itself be read as bot traffic and
// 403'd -- the exact previously-proven failure mode documented in
// claude/pickers-firewall-selfblock-2026-07-17.md. app/api/benchmarks/
// route.ts's GET handler calls getBenchmarksData() too, so the public
// endpoint and SSR share the same in-memory cache Map defined in this
// module and stay perfectly consistent.

export type BenchScope = "stock" | "crypto";

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

export type BenchPayload = {
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

function normalizeScope(scopeInput?: string | null): BenchScope {
  return String(scopeInput ?? "").trim().toLowerCase() === "crypto" ? "crypto" : "stock";
}

export type BenchmarksDataResult = {
  data: BenchPayload;
  headers: Record<string, string>;
  status?: number;
};

// Shares the in-memory `cache` Map defined above with /api/benchmarks's
// GET handler (same module), so the public endpoint and SSR stay
// perfectly consistent. See module header comment.
export async function getBenchmarksData(
  scopeInput?: string | null
): Promise<BenchmarksDataResult> {
  const scope = normalizeScope(scopeInput);

  const cached = cache.get(scope);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return {
      data: cached.payload,
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    };
  }

  const apiKey = process.env.FMP_API_KEY;
  const defs = getBenchDefs(scope);

  if (!apiKey) {
    const payload: BenchPayload = {
      updatedAt: new Date().toISOString(),
      scope: scope === "crypto" ? "Crypto Benchmarks (FMP)" : "Benchmarks (FMP)",
      items: [],
    };

    return { data: payload, headers: {}, status: 500 };
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

  return {
    data: payload,
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  };
}
