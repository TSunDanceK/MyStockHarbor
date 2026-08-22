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

import { Redis } from "@upstash/redis";
import { fmpFetch } from "./fmpUsage";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { withRedisTimeout } from "./redisGuardTimeout";
import { timingCache, beginTiming } from "./timing";

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

// Durable second layer behind the per-instance Map above.
//
// The Map is scoped to one serverless instance and dies with it, and
// fetchFmpQuote passes cache:"no-store" so the Next Data Cache cannot help
// either. A miss therefore costs FOUR live FMP calls, on a code path that
// both / and /dashboard render through -- so at real traffic most renders
// were paying that, which is the TTFB story rather than any route config.
// Redis makes one instance's fetch serve every other instance.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const REDIS_PREFIX = "msh:benchmarks";

// Retained well beyond CACHE_MS on purpose. After 5 minutes an entry stops
// being served as fresh, but keeping it lets a failed FMP round degrade to
// real (if slightly old) prices instead of to a payload of nulls.
const REDIS_TTL_SECONDS = 24 * 60 * 60;

type RedisEntry = { at: number; payload: BenchPayload };

// A payload whose every row is null is what a total FMP failure produces.
// It must never be cached: before this module had a shared cache it poisoned
// one instance for 5 minutes, but writing it to Redis would poison EVERY
// instance, and for as long as the entry lives. Adding a durable cache
// without this check would make an outage worse, not better.
function hasRealData(payload: BenchPayload): boolean {
  return payload.items.some((item) => item.close !== null);
}

async function readRedis(scope: string): Promise<RedisEntry | null> {
  if (!redis) {
    timingCache("benchmarks", "redis", "skip", "no-credentials");
    return null;
  }
  const entry = await withRedisTimeout(
    () => redis.get<RedisEntry>(`${REDIS_PREFIX}:${scope}`),
    null,
    "benchmarks",
    `scope=${scope}`
  );
  if (!entry || typeof entry.at !== "number" || !entry.payload) {
    timingCache("benchmarks", "redis", "miss", scope);
    return null;
  }
  timingCache("benchmarks", "redis", "hit", scope);
  return entry;
}

async function writeRedis(scope: string, entry: RedisEntry): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(`${REDIS_PREFIX}:${scope}`, entry, { ex: REDIS_TTL_SECONDS });
  } catch (err) {
    // Never fail a render over a cache write.
    console.error(`[benchmarks] redis write failed scope=${scope}:`, err);
  }
}

const FRESH_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

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
    const res = await fmpFetch(url, {
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
  const endTiming = beginTiming("benchmarks", "getBenchmarksData");
  try {
    return await getBenchmarksDataInner(scopeInput);
  } finally {
    endTiming();
  }
}

async function getBenchmarksDataInner(
  scopeInput?: string | null
): Promise<BenchmarksDataResult> {
  const scope = normalizeScope(scopeInput);

  const cached = cache.get(scope);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    timingCache("benchmarks", "memcache", "hit", scope);
    return { data: cached.payload, headers: FRESH_HEADERS };
  }

  timingCache("benchmarks", "memcache", "miss", scope);

  // Second layer: another instance's recent fetch, or this instance's own
  // from before it was recycled. Promoted into the Map so the rest of this
  // instance's requests do not re-read Redis.
  const stored = await readRedis(scope);
  if (stored && Date.now() - stored.at < CACHE_MS) {
    cache.set(scope, { at: stored.at, payload: stored.payload });
    return { data: stored.payload, headers: FRESH_HEADERS };
  }

  const apiKey = process.env.FMP_API_KEY;
  const defs = getBenchDefs(scope);

  if (!apiKey) {
    // A stale-but-real payload beats an empty one even here: the page shows
    // real prices with an older timestamp rather than four blank tiles.
    if (stored) {
      console.error("[benchmarks] FMP_API_KEY is not set -- serving stale cached payload");
      return { data: stored.payload, headers: {} };
    }
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

  // Total FMP failure. Serve the stale copy rather than four blank tiles,
  // and do NOT cache the null payload -- see hasRealData.
  if (!hasRealData(payload)) {
    if (stored) {
      const ageMin = Math.round((Date.now() - stored.at) / 60_000);
      console.error(
        `[benchmarks] all ${defs.length} FMP quotes failed for scope=${scope}; ` +
          `serving stale cached payload ${ageMin}m old`
      );
      return { data: stored.payload, headers: {} };
    }
    console.error(
      `[benchmarks] all ${defs.length} FMP quotes failed for scope=${scope} ` +
        `with no cached copy -- returning a payload of nulls, not caching it`
    );
    return { data: payload, headers: {}, status: 500 };
  }

  const entry: RedisEntry = { at: Date.now(), payload };
  cache.set(scope, entry);
  await writeRedis(scope, entry);

  return { data: payload, headers: FRESH_HEADERS };
}
