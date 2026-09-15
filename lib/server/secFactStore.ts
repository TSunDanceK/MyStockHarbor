// The stored fact set in Redis: one key per symbol, one GET per page render.
//
// ONE BLOB, NOT PER-FIELD KEYS. The precedent is already in the tree at
// historyCache.ts:150 -- "700 GETs is 700 billed commands, where 18 chunked
// MGETs are 18." Upstash bills per command, so a page that reads 46 fields as 46
// keys costs 46 commands for what one SET wrote. See sec-pipeline-spec §2.
//
// THE CODEC IS NOT HERE. lib/server/secFactCodec.ts holds the positional
// encoding, the content hash and the by-name readers, with no Redis import, so
// a relay probe can run the whole render path against real filings. This file is
// the I/O and nothing else.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { SEC_FACTS_PREFIX } from "./secManifest";
import { secFieldsHash } from "./secFields";
import type { StoredFactSet } from "./secFactCodec";

export * from "./secFactCodec";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export const factKey = (symbol: string) => `${SEC_FACTS_PREFIX}:${symbol.toUpperCase()}`;

/**
 * Read one symbol's fact set, or null.
 *
 * `null` covers three different situations and the caller must not care which:
 * never populated, evicted, or written by a build whose field order differs.
 * All three mean "this page has no SEC data to render", and the page's job is to
 * say so rather than to render zeroes.
 */
export async function readFactSet(symbol: string): Promise<StoredFactSet | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get<StoredFactSet>(factKey(symbol));
    if (!raw || typeof raw !== "object") return null;
    // THE GATE. Not a warning, not a best-effort decode: a mismatch means the
    // positional arrays mean something else, and reading them anyway is the
    // silent-wrong-number failure this whole design is built against.
    if (raw.h !== secFieldsHash()) {
      console.warn(
        `[sec-facts] ${symbol}: stored fieldsHash ${raw.h} != ${secFieldsHash()} — treating as a miss`
      );
      return null;
    }
    if (!Array.isArray(raw.quarters)) return null;
    return raw;
  } catch (err) {
    console.error("[sec-facts] read failed", symbol, err);
    return null;
  }
}

/**
 * Write one symbol's fact set.
 *
 * NO TTL. The SEC brief's rule is "never expire, never evict" for live symbols:
 * a filing is a permanent fact and re-fetching one costs ~150 KB of wire with no
 * conditional check available (sec-reread-no-cheap-check, 23 of 23). Deletion is
 * symbolEviction's job -- SEC_FACTS_PREFIX is registered in PER_SYMBOL_KEYS, so
 * a delisted symbol's fact set goes with the rest of its state.
 */
export async function writeFactSet(set: StoredFactSet): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(factKey(set.symbol), set);
    return true;
  } catch (err) {
    console.error("[sec-facts] write failed", set.symbol, err);
    return false;
  }
}

