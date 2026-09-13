// The SEC pipeline's single piece of state.
//
// ONE KEY, ONE GET, ONE SET. Not one key per symbol, and that is a billing fact
// rather than a preference: historyCache.ts:150 already records it -- "a pipeline
// of 700 GETs is 700 billed commands, where 18 chunked MGETs are 18". Upstash
// bills commands, and writes are already 76% of the command count on this
// account. A per-symbol manifest would make the daily job 700 reads and up to
// 700 writes; this makes it two commands plus nothing.
//
// The whole manifest is a few hundred KB at 700 symbols, comfortably inside
// Upstash's 10 MB per-request ceiling -- the constraint upstash-request-size
// records. If the universe ever grows far enough that it is not, the answer is
// chunking by byte size (lib/server/chunkByBytes.ts exists for exactly that),
// not a key per symbol.
//
// NO TTL, EVER. A TTL means eviction, eviction means a cold key, and a cold key
// means a render that has to fetch -- the failure already recorded in
// pool-ttl-died-behind-the-market-gate. Freshness is expressed as the
// `needsReverify` flag, never as an expiry.

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export const SEC_MANIFEST_KEY = "msh:sec:manifest:v1";

/** Bumped when the scoring basis changes, so a score move can be attributed. */
export const SEC_SCORE_VERSION = 1;

export type SecManifestEntry = {
  cik: string | null;
  /** Accession of the most recent PERIODIC filing seen for this symbol. */
  lastAccession: string | null;
  /** Filing date (YYYYMMDD) of that accession. */
  lastFiled: string | null;
  /** Hash of the extracted fact set. Step 3 populates it; null until then. */
  contentHash: string | null;
  nextExpected: string | null;
  nextExpectedSource: "announcement" | "cadence" | null;
  verifiedAt: number | null;
  needsReverify: boolean;
  scoreVersion: number;
  /**
   * Set when a `/A` form was seen. A restatement is not the same event as a
   * fresh report -- 3.8 requires it be recorded rather than folded in, because
   * it changes charts that have already been published.
   */
  lastAmendment?: { accession: string; form: string; filed: string } | null;
  /**
   * More than one periodic filing on the same day, which ARM does routinely.
   * The daily index carries no reportDate, so which one is the period report
   * cannot be decided here -- see secDailyIndex.ts. Flagged for step 3.
   */
  ambiguousSameDayFilings?: string[] | null;
};

export type SecManifest = {
  version: 1;
  /** Last daily index date (YYYYMMDD) successfully processed. */
  lastIndexDate: string | null;
  /** Consecutive index fetch failures. Reset on ANY success. See 3.6. */
  consecutiveIndexFailures: number;
  seededAt: number | null;
  updatedAt: number | null;
  symbols: Record<string, SecManifestEntry>;
};

export function emptyEntry(cik: string | null): SecManifestEntry {
  return {
    cik,
    lastAccession: null,
    lastFiled: null,
    contentHash: null,
    nextExpected: null,
    nextExpectedSource: null,
    verifiedAt: null,
    needsReverify: false,
    scoreVersion: SEC_SCORE_VERSION,
    lastAmendment: null,
    ambiguousSameDayFilings: null,
  };
}

export function emptyManifest(): SecManifest {
  return {
    version: 1,
    lastIndexDate: null,
    consecutiveIndexFailures: 0,
    seededAt: null,
    updatedAt: null,
    symbols: {},
  };
}

/**
 * THE ONLY READ. Returns null when Redis is not configured, which is a distinct
 * outcome from an empty manifest -- a caller that cannot tell those apart would
 * seed on every run in an environment with no database.
 */
export async function readManifest(): Promise<SecManifest | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get<SecManifest>(SEC_MANIFEST_KEY);
    if (!raw || typeof raw !== "object") return emptyManifest();
    return { ...emptyManifest(), ...raw, symbols: raw.symbols ?? {} };
  } catch (err) {
    // A read failure is NOT an empty manifest. Returning one here would let the
    // caller seed over live state, and the seed would then be written back as
    // truth -- the failure-as-absence trap, with a write on the end of it.
    console.error("[sec-manifest] read failed", err);
    return null;
  }
}

/** THE ONLY WRITE. */
export async function writeManifest(manifest: SecManifest): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(SEC_MANIFEST_KEY, { ...manifest, updatedAt: Date.now() });
    return true;
  } catch (err) {
    console.error("[sec-manifest] write failed", err);
    return false;
  }
}

export type SeedResult = {
  seeded: boolean;
  symbols: number;
  withCik: number;
  withoutCik: string[];
  tickerMapPresent: boolean;
};

/**
 * Seed the manifest from the current analysis universe.
 *
 * Mutates `manifest` in place and reports what it did; the caller owns the
 * single write. Symbols already present keep their state -- reseeding must
 * never clear a lastAccession.
 *
 * A symbol with no CIK is KEPT, with `cik: null`, and named in `withoutCik`.
 * Dropping it would make the universe silently smaller than it is; a null CIK
 * simply never matches the daily index, and the count says so out loud.
 */
export function seedManifest(
  manifest: SecManifest,
  universe: string[],
  cikByTicker: Map<string, string>,
  tickerMapPresent: boolean
): SeedResult {
  const withoutCik: string[] = [];
  let added = 0;

  for (const symbol of universe) {
    const cik = cikByTicker.get(symbol) ?? null;
    if (!cik) withoutCik.push(symbol);
    const existing = manifest.symbols[symbol];
    if (existing) {
      // Fill a CIK that was missing last time without touching anything else.
      if (!existing.cik && cik) existing.cik = cik;
      continue;
    }
    manifest.symbols[symbol] = emptyEntry(cik);
    added++;
  }

  if (added > 0 && manifest.seededAt === null) manifest.seededAt = Date.now();

  return {
    seeded: added > 0,
    symbols: Object.keys(manifest.symbols).length,
    withCik: Object.values(manifest.symbols).filter((e) => e.cik).length,
    withoutCik,
    tickerMapPresent,
  };
}

/** CIK (zero-padded, 10 digits) -> symbol, for intersecting the daily index. */
export function symbolsByCik(manifest: SecManifest): Map<string, string> {
  const out = new Map<string, string>();
  for (const [symbol, entry] of Object.entries(manifest.symbols)) {
    if (!entry.cik) continue;
    // The index prints the CIK unpadded; the manifest stores it padded. Both
    // spellings are registered so the join cannot fail on leading zeros -- the
    // exact class of key mismatch that cost a day on the segments probe.
    out.set(entry.cik, symbol);
    out.set(String(Number(entry.cik)), symbol);
  }
  return out;
}
