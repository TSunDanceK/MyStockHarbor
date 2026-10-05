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
// hand (the warm targets, POOL_BENCHMARK_ETFS, POOL_VIDEO_TICKERS, and -- step
// 5b -- every symbol with a stock page, STOCK_PAGE_SYMBOLS below), with no FMP
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
import { poolField, PRICE_POOL_KEY, POOL_BENCHMARK_ETFS, POOL_VIDEO_TICKERS } from "./pricePool";
import companyNameSnapshot from "@/data/company-names.json";
import { priorityStocks, uniqueEtfs } from "../curatedSymbols";
import { MOOD_ETFS } from "../marketMood";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

/**
 * EVERY SYMBOL WITH A STOCK PAGE (step 5b, #553 COWORK #98 ruling 2, the owner's
 * widening). /stock/[symbol] renders for any ticker, so "has a stock page" is
 * taken as the two committed lists the site itself treats as its stock pages:
 *
 *   data/company-names.json   the stock page's committed name floor
 *                             (companyNameSnapshot.ts): 2,610 symbols, the same
 *                             set as data/sec/registrants.json ("every profiled
 *                             symbol"), i.e. every page with an About block
 *   curatedSymbols            priorityStocks + uniqueEtfs: the sitemap's
 *                             /stock/{sym} entries and the /stocks A-Z directory
 *                             (161, including the 32 ETFs the name file lacks)
 *
 * 2,580 after the debt filter (61 notes dropped), counted from the repo on
 * 2026-10-02. Committed files, so the list needs no Redis read, no FMP call
 * and no visitor.
 */
export const STOCK_PAGE_SYMBOLS: readonly string[] = [
  ...Object.keys((companyNameSnapshot as { rows?: Record<string, string> }).rows ?? {}),
  ...priorityStocks,
  ...uniqueEtfs,
];

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
 * The stored universe's symbols (1 GET), or [] when absent or unreadable. For
 * warm-pickers-sec (#553 COWORK #110): the pool overlay caps a row only from
 * the pickers SEC hash, so the hash must cover what the overlay prices.
 */
export async function readTiingoUniverseSymbols(): Promise<string[]> {
  if (!redis) return [];
  try {
    return parseTiingoUniverse(await redis.get<unknown>(TIINGO_UNIVERSE_KEY))?.symbols ?? [];
  } catch {
    return [];
  }
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

/**
 * Off market hours, re-write the universe when the stored key is older than
 * this. 6 h against the 4-day TTL: at most ~4 re-writes a closed day.
 */
export const TIINGO_UNIVERSE_REFRESH_SECONDS = 6 * 60 * 60;

/**
 * Pure: should an off-hours run re-write the key, given Redis's TTL reply?
 * -2 (absent) and -1 (no expiry; never written that way) both say yes.
 */
export function universeNeedsRefresh(ttlSeconds: number): boolean {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) return true;
  return ttlSeconds <= TIINGO_UNIVERSE_TTL_SECONDS - TIINGO_UNIVERSE_REFRESH_SECONDS;
}

export type OffHoursUniverseResult = { written: boolean; reason: string; symbols?: number };

/**
 * THE UNIVERSE OUTSIDE THE MARKET WINDOW (#553 COWORK #119/#120).
 *
 * The in-session write in warm-price-pool sits after the market gate, so a
 * universe change merged on a weekend (5b, Sat 3 Oct) never reached the key:
 * jobs.ts fell back to the pool's HKEYS (~760) and warm-pickers-sec read no
 * universe at all. This runs on the gate's closed path instead, with no target
 * derivation and no FMP call: the pool's fields stand in for the warm targets
 * (they are what in-session runs priced), plus the ETFs, the video tickers and
 * every stock page, exactly the in-session sources.
 *
 * Cost: 1 TTL per closed run; when the key is absent or older than
 * TIINGO_UNIVERSE_REFRESH_SECONDS, +1 HKEYS +1 SET (~15 KB). Never an empty
 * list (writeTiingoUniverse refuses one). Never throws.
 */
export async function refreshTiingoUniverseOffHours(nowMs = Date.now()): Promise<OffHoursUniverseResult> {
  if (!redis) return { written: false, reason: "no-redis" };
  try {
    const ttl = await redis.ttl(TIINGO_UNIVERSE_KEY);
    if (!universeNeedsRefresh(ttl)) return { written: false, reason: "fresh" };
    const poolKeys = (await redis.hkeys(PRICE_POOL_KEY)).map(String);
    const plan = planTiingoUniverse({
      pool: poolKeys,
      etfs: POOL_BENCHMARK_ETFS,
      video: POOL_VIDEO_TICKERS,
      stockPages: STOCK_PAGE_SYMBOLS,
      // Market Mood's inputs (#563 COWORK #96), as on the in-session write.
      mood: MOOD_ETFS,
    });
    const written = await writeTiingoUniverse(plan, nowMs);
    return { written, reason: ttl === -2 ? "absent" : "stale", symbols: plan.symbols.length };
  } catch {
    return { written: false, reason: "redis-error" };
  }
}
