// WHICH SYMBOLS THE TIINGO JOBS FETCH, WRITTEN WITHOUT FMP
// (step 5, #553 COWORK #98 ruling 2).
//
// THE PROBLEM. The Tiingo quote and EOD jobs took their universe from the price
// pool's fields (HKEYS msh:price-pool:v1). Those fields are kept alive by
// warm-price-pool, which returned 500 BEFORE its keep-alive whenever
// FMP_API_KEY was unset -- so on the FMP-off test the pool's 12 h TTL would
// lapse and both Tiingo jobs would wake to "empty universe".
//
// THE FIX. A symbols-only key, msh:tiingo:universe:v1, written by the
// warm-price-pool route on every in-session run from what it already has in
// hand (the warm targets, POOL_BENCHMARK_ETFS, POOL_VIDEO_TICKERS), with no FMP
// call and whether or not FMP_API_KEY is set. jobs.ts universe() reads it first
// and falls back to the pool's HKEYS only while it is absent. Debt listings and
// PRICE_EXCLUDED are dropped here; jobs.ts drops them again, and applies the
// retick guard (it needs SEC's live map and the last-seen CIKs), on whichever
// list it read.
//
// NOT A PRICE. Symbols only, so it is not raw Tiingo data -- but it sits under
// msh:tiingo: anyway, so the termination purge leaves nothing Tiingo-shaped
// behind (contract §7).
//
// No Tiingo call and no adapter import from here (check-tiingo-callers): the
// warm-price-pool route may not reach Tiingo.
import { Redis } from "@upstash/redis";
import { TIINGO_UNIVERSE_KEY, TIINGO_UNIVERSE_TTL_SECONDS } from "./marketData/keys";
import { isDebtListing } from "./marketData/universe";
import { isPriceExcluded } from "../priceExcluded.mjs";
import { poolField } from "./pricePool";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

export type TiingoUniversePlan = {
  symbols: string[];
  /** How many symbols each source contributed (before the union), for the run record. */
  sources: Record<string, number>;
  dropped: { debt: number; excluded: number };
};

export type StoredTiingoUniverse = { at: number; symbols: string[]; sources?: Record<string, number> };

/**
 * Pure. The union of every source, in pool spelling (dashed, upper-case), less
 * debt listings and PRICE_EXCLUDED, sorted.
 */
export function planTiingoUniverse(parts: Record<string, readonly string[]>): TiingoUniversePlan {
  const all = new Set<string>();
  const sources: Record<string, number> = {};
  for (const [name, list] of Object.entries(parts)) {
    sources[name] = list.length;
    for (const s of list) {
      const f = poolField(s);
      if (f) all.add(f);
    }
  }
  let debt = 0;
  let excluded = 0;
  const symbols = [...all]
    .filter((s) => {
      if (isDebtListing(s)) { debt++; return false; }
      if (isPriceExcluded(s)) { excluded++; return false; }
      return true;
    })
    .sort();
  return { symbols, sources, dropped: { debt, excluded } };
}

/** Pure: a stored value, or null when absent, malformed or empty (the caller then falls back). */
export function parseTiingoUniverse(raw: unknown): StoredTiingoUniverse | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const symbols = (v as { symbols?: unknown }).symbols;
  if (!Array.isArray(symbols)) return null;
  const clean = symbols.map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean);
  if (!clean.length) return null;
  return { at: Number((v as { at?: unknown }).at) || 0, symbols: clean, sources: (v as StoredTiingoUniverse).sources };
}

/**
 * One SET with a TTL (1 command, ~6 B a symbol). Never writes an empty list:
 * jobs.ts would then fall back to the pool's fields anyway, and an empty key
 * would hide that a source failed. Returns whether the write landed.
 */
export async function writeTiingoUniverse(plan: TiingoUniversePlan, nowMs = Date.now()): Promise<boolean> {
  if (!redis || !plan.symbols.length) return false;
  try {
    const value: StoredTiingoUniverse = { at: nowMs, symbols: plan.symbols, sources: plan.sources };
    await redis.set(TIINGO_UNIVERSE_KEY, JSON.stringify(value), { ex: TIINGO_UNIVERSE_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}
