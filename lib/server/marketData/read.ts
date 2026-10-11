// THE READ LAYER: the Vercel Data Cache in front of Redis (#553 COWORK #56 §3, #57 §3).
//
// Redis is the single source of truth, written only by the two jobs. Pages
// read through these cached functions, so Redis is read on a CACHE MISS
// (roughly once per region per TTL, or after a job revalidates the tag), not
// once per page view. That is what keeps Upstash cost flat as traffic grows.
//
//   what                 entry            tags                      safety TTL
//   the quote pool       ONE blob          prices                    1 h
//   one symbol's history one per symbol    eod, eod:<SYM>            24 h
//   the newest bar each  ONE blob          eod                       24 h   (step 5)
//
// ONE POOL BLOB, not 844 entries: ~844 rows is ~100 KB, far under the item
// limit, and it keeps data-cache writes to about one per region per hour.
// History is PER SYMBOL because the whole universe (~36 MB compact) would not
// fit one entry.
//
// NEVER A LIVE TIINGO CALL. This file does not import the adapter
// (scripts/check-tiingo-callers.mjs). If Redis is down, a stale entry keeps
// serving with its own timestamp; a read that finds nothing returns null and
// the surface stays on FMP (COWORK #56, failure behaviour).
//
// Step 1: nothing calls these yet. Each surface switches in its own PR.
import { unstable_cache } from "next/cache";
import { Redis } from "@upstash/redis";
import { EOD_TAG, PRICES_TAG, TIINGO_EOD_LAST_KEY, TIINGO_QUOTES_KEY, TIINGO_QUOTES_META_FIELD, eodSymbolTag, tiingoEodKey } from "./keys";
import type { StoredEod, StoredQuote } from "./types";
import { parseEodLast, type EodLast } from "./eodLast";
import { toDashed } from "../../symbolSpellings.mjs";
import { PAGE_READ_CACHE } from "../redisCacheMode";

export const POOL_CACHE_SECONDS = 60 * 60;
export const EOD_CACHE_SECONDS = 24 * 60 * 60;

// PAGE_READ_CACHE since step 2 (#553): the Pickers pages now reach this file
// through pickersBuilder -> pickerHistory, and a bare (no-store) client on a
// prerendered route throws DYNAMIC_SERVER_USAGE (scripts/check-page-read-cache).
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv(PAGE_READ_CACHE) : null;

export type TiingoPool = { at: number | null; rows: Record<string, StoredQuote> };

/** Parse an HGETALL result (the client may already have parsed each value). Exported for the checks. */
export function parsePoolHash(raw: Record<string, unknown> | null): TiingoPool {
  const rows: Record<string, StoredQuote> = {};
  let at: number | null = null;
  for (const [field, value] of Object.entries(raw ?? {})) {
    let v: unknown = value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { continue; } }
    if (!v || typeof v !== "object") continue;
    if (field === TIINGO_QUOTES_META_FIELD) { at = Number((v as { at?: unknown }).at) || null; continue; }
    const q = v as StoredQuote;
    if (typeof q.price === "number" && q.price > 0) rows[field] = q;
  }
  return { at, rows };
}

async function loadPool(): Promise<TiingoPool | null> {
  if (!redis) return null;
  const raw = await redis.hgetall<Record<string, unknown>>(TIINGO_QUOTES_KEY);
  return raw ? parsePoolHash(raw) : null;
}

/** The whole quote pool, from the Data Cache. 1 HGETALL per miss. */
export const readTiingoPool = unstable_cache(loadPool, ["tiingo-pool-v1"], {
  tags: [PRICES_TAG],
  revalidate: POOL_CACHE_SECONDS,
});

/** One symbol's history, from the Data Cache. 1 GET per miss. */
export function readTiingoHistory(symbol: string): Promise<StoredEod | null> {
  const sym = toDashed(symbol);
  return unstable_cache(
    async (): Promise<StoredEod | null> => {
      if (!redis) return null;
      const raw = await redis.get<StoredEod | string>(tiingoEodKey(sym));
      if (!raw) return null;
      const v = typeof raw === "string" ? (JSON.parse(raw) as StoredEod) : raw;
      return Array.isArray(v?.bars) ? v : null;
    },
    ["tiingo-eod-v1", sym],
    { tags: [EOD_TAG, eodSymbolTag(sym)], revalidate: EOD_CACHE_SECONDS }
  )();
}

export type TiingoEodLast = Record<string, EodLast>;

/** Parse an HGETALL of TIINGO_EOD_LAST_KEY, dropping junk. Exported for the checks. */
export function parseEodLastHash(raw: Record<string, unknown> | null): TiingoEodLast {
  const rows: TiingoEodLast = {};
  for (const [field, value] of Object.entries(raw ?? {})) {
    const r = parseEodLast(value);
    if (r) rows[field] = r;
  }
  return rows;
}

async function loadEodLast(): Promise<TiingoEodLast | null> {
  if (!redis) return null;
  const raw = await redis.hgetall<Record<string, unknown>>(TIINGO_EOD_LAST_KEY);
  return raw ? parseEodLastHash(raw) : null;
}

/**
 * Every symbol's newest stored bar and its summary (marketData/eodLast.ts), from
 * the Data Cache. ONE blob, tagged eod so the nightly job's revalidateTag
 * replaces it; 1 HGETALL per miss (step 5, #553 COWORK #98).
 */
export const readTiingoEodLast = unstable_cache(loadEodLast, ["tiingo-eod-last-v1"], {
  tags: [EOD_TAG],
  revalidate: EOD_CACHE_SECONDS,
});
