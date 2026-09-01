// Market-wide reference payloads, shared across lambda instances.
//
// THE PROBLEM THESE TWO HAVE IN COMMON. stock-list (3.04 MB) and the monthly
// earnings-calendar (697 KB) are large, market-wide and barely-changing, and
// both sat in a module-level Map plus Next's per-instance fetch cache. Neither
// layer is shared, so every cold lambda refetched the whole payload: 108
// fetches per 30 days each, ~294 MB and ~73 MB respectively.
//
// Redis is the layer they were missing -- one fetch serves every instance until
// the TTL expires, rather than one per instance per revalidate window.
//
// THE IN-PROCESS CACHE STAYS IN FRONT. It is free, it is correct, and it saves
// a Redis round-trip on a warm instance. This is a third layer under it, not a
// replacement for it.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const REFERENCE_KEY_PREFIX = "msh:reference:v1:";

/**
 * stock-list is the symbol -> companyName dictionary the earnings calendar
 * joins against for display names.
 *
 * MONTHLY, and that is a measured choice rather than a cautious one (probe Q8).
 * What changes this dictionary is new listings -- 150-300 US IPOs a year against
 * 38,829 rows, well under 0.1% a week -- plus rarer renames. The consumer uses
 * it for a NAME, so the cost of staleness is a calendar row showing a ticker
 * instead of a company name: cosmetic, and self-correcting at the next refresh.
 * Weekly would be 4x the fetches of a 3 MB payload for that.
 *
 * DO NOT replace this with the screener. That was a withdrawn recommendation:
 * the calendar is market-wide and returns dates without names, and the
 * screener's 1,000 rows cannot cover 38,829 symbols.
 */
export const REFERENCE_TTL_MONTHLY_SECONDS = 30 * 24 * 60 * 60;

/**
 * The earnings calendar changes at most daily -- FMP's own rows carry a daily
 * lastUpdated -- so a shorter TTL buys refreshes nothing downstream can see.
 *
 * This one matters beyond its own cost: it is the trigger every fundamentals
 * refresh is due to read, so it wants to be served from the shared cache before
 * anything depends on it.
 */
export const REFERENCE_TTL_DAILY_SECONDS = 24 * 60 * 60;

/** Null when absent or unreadable -- the caller refetches rather than failing. */
export async function readReference<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const value = await redis.get<T>(`${REFERENCE_KEY_PREFIX}${key}`);
    return value ?? null;
  } catch {
    return null;
  }
}

export async function writeReference<T>(key: string, value: T, ttlSeconds: number) {
  if (!redis) return;
  try {
    await redis.set(`${REFERENCE_KEY_PREFIX}${key}`, value, { ex: ttlSeconds });
  } catch {
    // Best effort: a failed write costs the next cold instance a refetch, which
    // is exactly what happened before this cache existed.
  }
}
