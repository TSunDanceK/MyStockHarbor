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

// ── CIK reassignment ────────────────────────────────────────────────────────

/** Where step 3 will store the extracted fact set. Named here because this is
 *  the module that has to discard one. */
export const SEC_FACTS_PREFIX = "msh:sec:facts:v1";
// Registered in symbolEviction.PER_SYMBOL_KEYS, so evicting a delisted symbol
// deletes its fact set with everything else.
//
// A GAP THIS DOES NOT CLOSE, recorded rather than left to be discovered: the
// manifest is ONE key, so the eviction sweep -- which works per-symbol prefix --
// cannot remove an entry from it. seedManifest only adds, so a symbol that
// leaves the universe keeps its manifest entry. That is bounded (an entry is
// small) but it is not nothing: a stale entry is a symbol whose CIK is still
// being reconciled, and therefore still a reassignment candidate. Pruning needs
// the same spike guard as reconcileCiks -- a transiently short universe read
// must not empty the manifest -- so it belongs with the eviction integration
// rather than bolted on here.

export type CikChange = {
  symbol: string;
  previousCik: string;
  newCik: string;
  at: number;
};

export type CikChangeResult = {
  changes: CikChange[];
  applied: boolean;
  /** Symbols that had no CIK and just got one. Not a reassignment. */
  filled: number;
  /** Symbols the map does not carry. Not a reassignment either. */
  absentFromMap: number;
  suspectedMapShapeChange: boolean;
  threshold: number;
  note: string | null;
};

/**
 * How many CIK changes in one run before the run refuses to apply any of them.
 *
 * A REASSIGNMENT IS ONE SYMBOL AT A TIME. A ticker being reused by a different
 * company is rare and independent across symbols, so several dozen in one night
 * is not the market doing something unusual -- it is the map source having
 * changed shape, or a partial payload that got past validation. Applying them
 * would discard that many fact sets on the strength of a bad file, and the
 * discard is the expensive half: the data has to be re-fetched from SEC.
 *
 * So above the threshold NOTHING is applied, the old CIKs stand, and the run
 * says so loudly. A genuine mass reassignment -- which would be unprecedented --
 * needs a human to look, which is the correct cost for an irreversible sweep.
 */
export function reassignmentThreshold(symbolCount: number): number {
  return Math.max(5, Math.ceil(symbolCount * 0.01));
}

/**
 * Reconcile the manifest's CIKs against a freshly resolved ticker map.
 *
 * A CIK CHANGE UNDER AN EXISTING SYMBOL IS AN INVALIDATION, NOT AN UPDATE. The
 * stored fact set under that symbol may belong to a different company entirely,
 * so it is discarded rather than merged: contentHash, lastAccession, lastFiled
 * and the amendment state are all cleared and the symbol is re-enqueued for a
 * clean fetch. A genuine ticker move and a reassignment are indistinguishable
 * here and both need exactly this treatment, so no attempt is made to tell them
 * apart.
 *
 * A symbol ABSENT from the map is left alone. Absence is a gap in the map --
 * the committed fallback is smaller than the live one, and a delisting removes
 * a row -- and clearing state on absence would wipe the store every time the
 * fallback was used.
 */
export function reconcileCiks(
  manifest: SecManifest,
  cikByTicker: Map<string, string>,
  now = Date.now()
): CikChangeResult {
  const changes: CikChange[] = [];
  let filled = 0;
  let absentFromMap = 0;

  for (const [symbol, entry] of Object.entries(manifest.symbols)) {
    const fresh = cikByTicker.get(symbol);
    if (!fresh) {
      absentFromMap++;
      continue;
    }
    if (!entry.cik) {
      entry.cik = fresh;
      filled++;
      continue;
    }
    if (entry.cik !== fresh) {
      changes.push({ symbol, previousCik: entry.cik, newCik: fresh, at: now });
    }
  }

  const threshold = reassignmentThreshold(Object.keys(manifest.symbols).length);
  if (changes.length > threshold) {
    return {
      changes,
      applied: false,
      filled,
      absentFromMap,
      suspectedMapShapeChange: true,
      threshold,
      note:
        `${changes.length} CIK changes in one run, over the threshold of ${threshold}. NOTHING WAS APPLIED. ` +
        `Reassignment happens one symbol at a time, so a batch this size means the map source changed shape ` +
        `rather than the market doing something unusual -- and applying it would discard ${changes.length} fact sets. ` +
        `The previous CIKs stand. Inspect the changes below, then re-run with force once the map is trusted.`,
    };
  }

  for (const change of changes) {
    const entry = manifest.symbols[change.symbol];
    if (!entry) continue;
    // LOUD, AND WITH BOTH CIKs. This is the only record that a symbol's history
    // was discarded, and the pair is what makes it investigable afterwards.
    console.warn(
      `[sec-manifest] CIK CHANGE ${change.symbol}: ${change.previousCik} -> ${change.newCik}. ` +
        `Discarding the stored fact set -- it may belong to a different company.`
    );
    entry.cik = change.newCik;
    entry.contentHash = null;
    entry.lastAccession = null;
    entry.lastFiled = null;
    entry.lastAmendment = null;
    entry.ambiguousSameDayFilings = null;
    entry.verifiedAt = null;
    // Re-enqueued for a clean fetch.
    entry.needsReverify = true;
  }

  return {
    changes,
    applied: changes.length > 0,
    filled,
    absentFromMap,
    suspectedMapShapeChange: false,
    threshold,
    note: changes.length ? `${changes.length} symbol(s) invalidated and re-enqueued` : null,
  };
}

/**
 * Discard the stored fact sets for reassigned symbols.
 *
 * Bounded by the reassignment count, which the threshold above keeps small. A
 * DEL on a key step 3 has not written yet is harmless, and doing it now means
 * the invalidation is complete the day the fact sets start existing rather than
 * depending on someone remembering to add it.
 */
export async function discardFactSets(symbols: string[]): Promise<number> {
  if (!redis || symbols.length === 0) return 0;
  try {
    return await redis.del(...symbols.map((s) => `${SEC_FACTS_PREFIX}:${s}`));
  } catch (err) {
    console.error("[sec-manifest] fact-set discard failed", err);
    return 0;
  }
}
