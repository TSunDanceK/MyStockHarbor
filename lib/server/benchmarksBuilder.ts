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

import { CRYPTO_MODE_ENABLED } from "../cryptoMode";
import { timingCache, beginTiming } from "./timing";
import { readTiingoPool, readTiingoHistory } from "./marketData/read";
import { pickSurfacePrice } from "./tiingoSurfacePrice";
import { closeBefore, stockPageOnTiingo } from "./tiingoQuote";

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
  /** Tiingo path only: "last IEX trade, 14:05 ET" | "close, 1 Oct 2026" (#553 COWORK #56). */
  priceLabel?: string | null;
};

export type BenchPayload = {
  updatedAt: string;
  scope: string;
  items: BenchItem[];
  /** "tiingo" when the tiles are Tiingo prices; the dashboard then shows the linked credit. */
  provider?: "tiingo";
};

const CACHE_MS = 5 * 60_000;

/** The panel's label when no tile has a price (#553 COWORK #210): the tiles are hidden. */
export const BENCHMARKS_UNAVAILABLE = "Benchmark prices are unavailable right now";
const cache = new Map<string, { at: number; payload: BenchPayload }>();

// A payload whose every row is null has nothing to show: the Tiingo read then
// answers null and the tiles are hidden (see the end of getBenchmarksDataInner).
function hasRealData(payload: BenchPayload): boolean {
  return payload.items.some((item) => item.close !== null);
}

const FRESH_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

// ETFs, NAMED AS ETFs (#553 COWORK #32 §3, owner ruling): the tile is the fund,
// not the index. Tiingo licenses no index levels, and an "index level" is never
// computed from the ETF price times a ratio. On both providers, since the tiles
// were always these four ETFs.
export const BENCH_DEFS_STOCK = [
  { key: "spy", label: "SPY · S&P 500 ETF",      symbol: "SPY" },
  { key: "ndx", label: "QQQ · Nasdaq 100 ETF",   symbol: "QQQ" },
  { key: "dia", label: "DIA · Dow Jones ETF",    symbol: "DIA" },
  { key: "iwm", label: "IWM · Russell 2000 ETF", symbol: "IWM" },
] as const;

/**
 * STEP 4 (#553 COWORK #71), behind PRICE_PROVIDER_STOCK_PAGE: the four ETF rows
 * from the Tiingo pool (SPY/QQQ/DIA/IWM are pool members since #666) and their
 * stored closes, through the Data Cache. Each tile is the newer of the IEX trade
 * and the close, labelled; its change is against the previous session's
 * consolidated close. Null when no tile has a price: the tiles are then hidden.
 */
async function getBenchmarksTiingo(nowMs: number): Promise<BenchPayload | null> {
  const [pool, ...histories] = await Promise.all([
    readTiingoPool().catch(() => null),
    ...BENCH_DEFS_STOCK.map((d) => readTiingoHistory(d.symbol).catch(() => null)),
  ]);
  const items: BenchItem[] = BENCH_DEFS_STOCK.map((d, i) => {
    const row = pool?.rows[d.symbol] ?? null;
    const bars = histories[i]?.bars ?? [];
    const surface = pickSurfacePrice(row, bars, nowMs);
    const prev = surface
      ? closeBefore(bars, surface.date) ?? (surface.kind === "iex" && row?.prevClose ? row.prevClose : null)
      : null;
    const time = surface?.kind === "iex" ? /\d\d:\d\d/.exec(surface.label)?.[0] ?? null : null;
    return {
      key: d.key,
      label: d.label,
      symbol: d.symbol,
      date: surface?.date ?? null,
      time,
      close: surface?.price ?? null,
      prevClose: prev,
      changePct: surface && prev ? ((surface.price - prev) / prev) * 100 : null,
      priceLabel: surface?.label ?? null,
    };
  });
  const payload: BenchPayload = { updatedAt: new Date(nowMs).toISOString(), scope: "Benchmarks", items, provider: "tiingo" };
  return hasRealData(payload) ? payload : null;
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

  // Crypto mode hidden 2026-09-27 (lib/cryptoMode.ts, #553 COWORK #62): no FMP
  // call, no Redis read, an empty payload the dashboard would render as nothing.
  if (scope === "crypto" && !CRYPTO_MODE_ENABLED) {
    return { data: { updatedAt: new Date().toISOString(), scope, items: [] }, headers: FRESH_HEADERS };
  }

  const cached = cache.get(scope);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    timingCache("benchmarks", "memcache", "hit", scope);
    return { data: cached.payload, headers: FRESH_HEADERS };
  }

  timingCache("benchmarks", "memcache", "miss", scope);

  // The Tiingo tiles. Held in this instance's Map only, never written to
  // msh:benchmarks:* -- a Tiingo price must not be stored outside msh:tiingo:
  // (contract §7, the purge). The Data Cache shares the reads across
  // instances.
  if (scope === "stock" && stockPageOnTiingo()) {
    const tiingo = await getBenchmarksTiingo(Date.now()).catch(() => null);
    if (tiingo) {
      cache.set(scope, { at: Date.now(), payload: tiingo });
      return { data: tiingo, headers: FRESH_HEADERS };
    }
  }

  // NO FMP FALLBACK, AND NO 500 (2026-10-12, #553 COWORK #210). FMP ended with
  // the key; this was its quote fetch, and the msh:benchmarks:* layer that only
  // ever held FMP payloads (a Tiingo price is never written there). With no
  // Tiingo price -- the pool and all four histories empty, STOCK_PAGE off
  // Tiingo, or the crypto scope switched on -- the tiles are HIDDEN: no items,
  // a 200, and the panel's label saying why. Not cached, so the next request
  // asks Tiingo again.
  return {
    data: { updatedAt: "", scope: BENCHMARKS_UNAVAILABLE, items: [] },
    headers: {},
  };
}
