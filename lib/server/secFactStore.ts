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
import { SEC_FACTS_INDEX_KEY, SEC_FACTS_PREFIX, dotDashSpellings } from "./secManifest";
import { secFieldsHash } from "./secFields";
import { canWriteSecState, noteSecWriteBlocked } from "./secWriteGate";
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
    // DOT OR DASH, WHICHEVER IT WAS WRITTEN UNDER (#552 COWORK #147 1a). A set
    // is keyed by the spelling that wrote it (the manifest's BRK.B, a cold
    // fill's BRK-B), and a reader asking by the other found nothing: some of
    // warm-pickers-sec's `noFactSet` were spelling misses, not missing data.
    // The asked spelling first, so a hit costs the one GET it always did; a
    // miss on a dotted or dashed ticker costs one more.
    let raw: StoredFactSet | null = null;
    for (const spelling of dotDashSpellings(symbol)) {
      raw = await redis.get<StoredFactSet>(factKey(spelling));
      if (raw) break;
    }
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
/**
 * Whether ANY set is stored for this symbol — one EXISTS, no payload read.
 * For page metadata (`noindex` while a cold symbol is not yet read), where the
 * set itself is not needed. Null when Redis cannot answer.
 */
export async function factSetExists(symbol: string): Promise<boolean | null> {
  if (!redis) return null;
  try {
    // Either spelling (see readFactSet): one EXISTS over both keys.
    return (await redis.exists(...dotDashSpellings(symbol).map(factKey))) > 0;
  } catch {
    return null;
  }
}

/**
 * For the sitemap's daily regeneration, in ONE pipelined round trip: whether
 * each symbol has a stored set, and when its figures last changed. Null when
 * Redis cannot answer — the caller must treat that as "unknown", never as
 * "none stored".
 */
export async function factSetPresence(
  symbols: string[],
): Promise<{ exists: Map<string, boolean>; changedAt: Map<string, number> } | null> {
  if (!redis) return null;
  const syms = symbols.map((s) => s.toUpperCase());
  if (!syms.length) return { exists: new Map(), changedAt: new Map() };
  try {
    const p = redis.pipeline();
    for (const s of syms) p.exists(...dotDashSpellings(s).map(factKey));
    p.hmget(SEC_FIGURES_CHANGED_KEY, ...syms);
    const out = (await p.exec()) as unknown[];
    const stamps = (out[syms.length] ?? {}) as Record<string, unknown> | null;
    const changedAt = new Map<string, number>();
    for (const s of syms) {
      const v = Number(stamps?.[s]);
      if (Number.isFinite(v) && v > 0) changedAt.set(s, v);
    }
    return { exists: new Map(syms.map((s, i) => [s, Number(out[i]) > 0])), changedAt };
  } catch {
    return null;
  }
}

/**
 * WHEN EACH SYMBOL'S STORED FIGURES LAST CHANGED (ms), one small hash — the
 * sitemap's `lastmod` for /stock/X/earnings (#535 COWORK #21 §3). Stamped by
 * writeFactSet, and every caller writes only on a change (sec-facts' `changed`
 * branch, the filing job's fill, a cold fill's first read), so a re-read that
 * finds nothing new never moves it. NOT the manifest: that 0.5 MB value is
 * kept off everything but the job routes (check-sec-daily-index).
 */
export const SEC_FIGURES_CHANGED_KEY = "msh:sec:figures-changed:v1";

export async function writeFactSet(set: StoredFactSet): Promise<boolean> {
  if (!redis) return false;
  // A PREVIEW RENDERS FROM THE SET IT HOLDS AND KEEPS NOTHING. See secWriteGate.
  if (!canWriteSecState()) { noteSecWriteBlocked("writeFactSet"); return false; }
  try {
    await redis.set(factKey(set.symbol), set);
    // INDEXED ON EVERY WRITE (#552 COWORK #59): the daily index reads this set
    // to give every stored set a manifest entry. A failed SADD is reported, not
    // fatal -- the set is stored, and the drift probe counts what is missing.
    try {
      await redis.sadd(SEC_FACTS_INDEX_KEY, set.symbol.toUpperCase());
    } catch (err) {
      console.error("[sec-facts] index add failed", set.symbol, err);
    }
    try {
      await redis.hset(SEC_FIGURES_CHANGED_KEY, { [set.symbol.toUpperCase()]: Date.now() });
    } catch {
      // The sitemap then omits lastmod for this symbol; the set is stored.
    }
    return true;
  } catch (err) {
    console.error("[sec-facts] write failed", set.symbol, err);
    return false;
  }
}

