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
import type { TickerEntry } from "./secTickerMap";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export const SEC_MANIFEST_KEY = "msh:sec:manifest:v1";

/** Bumped when the scoring basis changes, so a score move can be attributed. */
export const SEC_SCORE_VERSION = 1;

export type SecManifestEntry = {
  cik: string | null;
  /**
   * Listing venue, from company_tickers_exchange.json. Observed: Nasdaq, NYSE,
   * OTC. Null when unknown.
   *
   * CARRIED FROM THE FIRST WRITE even though nothing consumes it yet. Step 3
   * and the page will: if the bars deal lands Nasdaq-only, NYSE symbols lose
   * their price history and the Price Reaction card has to be dropped FOR THOSE
   * SYMBOLS -- a per-symbol decision conditional on this field, not a global
   * flag. Retrofitting it across a populated manifest is a migration, and a
   * migration that half-succeeds leaves symbols whose exchange is unknown
   * indistinguishable from symbols genuinely not on an exchange.
   */
  exchange: string | null;
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
  /**
   * First time this symbol was absent from a freshly validated ticker map.
   * Cleared the moment it reappears -- a symbol that blinks out for one refresh
   * has not been delisted, it has been missed.
   */
  notInTickerMapSince?: number | null;
  /** Consecutive successful REFRESHES with the symbol still absent. Not runs. */
  absentRefreshCount?: number;
  /**
   * Probably delisted. The page uses this to present the filings as HISTORY
   * rather than as current -- a delisted company's numbers are not wrong, they
   * are over, and showing them undated is the actual failure. Nothing is ever
   * deleted on the strength of it: the filings remain the best record of what
   * that company filed, and a delisted issuer can still file (a final 10-K, a
   * Form 25 or 15) so the daily index keeps matching it.
   */
  delisted?: boolean;
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

export function emptyEntry(cik: string | null, exchange: string | null = null): SecManifestEntry {
  return {
    cik,
    exchange,
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
    notInTickerMapSince: null,
    absentRefreshCount: 0,
    delisted: false,
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
  cikByTicker: Map<string, TickerEntry>,
  tickerMapPresent: boolean
): SeedResult {
  const withoutCik: string[] = [];
  let added = 0;

  for (const symbol of universe) {
    const found = cikByTicker.get(symbol) ?? null;
    const cik = found?.cik ?? null;
    if (!cik) withoutCik.push(symbol);
    const existing = manifest.symbols[symbol];
    if (existing) {
      // Fill what was missing last time without touching anything else.
      if (!existing.cik && cik) existing.cik = cik;
      if (!existing.exchange && found?.exchange) existing.exchange = found.exchange;
      continue;
    }
    manifest.symbols[symbol] = emptyEntry(cik, found?.exchange ?? null);
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
 * How many map-derived changes in one run before the run refuses to apply any
 * of them. SHARED by CIK reassignment and by delisting detection, because both
 * are inferences drawn from the same file and both are wrong in the same way
 * when that file is partial.
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
export function mapChangeThreshold(symbolCount: number): number {
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
  cikByTicker: Map<string, TickerEntry>,
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
    // ONLY THE CIK IS CONSIDERED HERE. Exchange is reconciled separately and
    // deliberately does NOT enter this path -- see reconcileExchanges.
    if (!entry.cik) {
      entry.cik = fresh.cik;
      filled++;
      continue;
    }
    if (entry.cik !== fresh.cik) {
      changes.push({ symbol, previousCik: entry.cik, newCik: fresh.cik, at: now });
    }
  }

  const threshold = mapChangeThreshold(Object.keys(manifest.symbols).length);
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

// ── Delisting ───────────────────────────────────────────────────────────────

/**
 * Consecutive successful refreshes a symbol must be absent for before it is
 * called delisted.
 *
 * COUNTED IN REFRESHES, NOT RUNS, and that distinction is the whole mechanism.
 * The job runs daily but only refreshes the ticker map weekly, so counting runs
 * would call a symbol delisted after three DAYS against a map that was fetched
 * once. Three refreshes is three weeks of the symbol genuinely not being in
 * SEC's file.
 */
export const DELIST_REFRESHES = 3;

export type DelistingResult = {
  applied: boolean;
  newlyAbsent: string[];
  stillAbsent: string[];
  reappeared: string[];
  newlyDelisted: string[];
  threshold: number;
  suspectedPartialMap: boolean;
  note: string | null;
};

/**
 * Reconcile the manifest against a freshly validated ticker map, for absence.
 *
 * ONLY CALL THIS WHEN A REFRESH ACTUALLY SUCCEEDED. Absence from the committed
 * fallback means nothing -- that file is smaller than the live map by
 * construction, and counting against it would march the whole universe toward
 * "delisted" at one strike per deploy. The caller gates on the refresh result;
 * this function cannot tell which map it was handed.
 *
 * NOTHING IS EVER DELETED. A delisted company's filings are still the best
 * record of what that company filed; the flag changes how the page PRESENTS
 * them, not whether they exist.
 */
export function reconcileDelistings(
  manifest: SecManifest,
  cikByTicker: Map<string, TickerEntry>,
  now = Date.now()
): DelistingResult {
  const entries = Object.entries(manifest.symbols);
  const threshold = mapChangeThreshold(entries.length);

  const newlyAbsent: string[] = [];
  const stillAbsent: string[] = [];
  const reappeared: string[] = [];

  for (const [symbol, entry] of entries) {
    const present = cikByTicker.has(symbol);
    if (present) {
      if (entry.notInTickerMapSince || entry.absentRefreshCount || entry.delisted) reappeared.push(symbol);
      continue;
    }
    if (entry.notInTickerMapSince) stillAbsent.push(symbol);
    else newlyAbsent.push(symbol);
  }

  // THE SPIKE GUARD, on NEWLY absent only.
  //
  // A valid-but-partial map -- one that clears the 5,000-ticker floor while
  // still missing thousands of real rows -- would otherwise start the delisting
  // clock on all of them at once, and three refreshes later mark them delisted
  // together. Guarding on newly absent rather than on the standing absent set
  // matters: a handful of genuinely delisted symbols stay absent forever, and a
  // guard that counted them would jam permanently after the first few.
  if (newlyAbsent.length > threshold) {
    return {
      applied: false,
      newlyAbsent,
      stillAbsent,
      reappeared,
      newlyDelisted: [],
      threshold,
      suspectedPartialMap: true,
      note:
        `${newlyAbsent.length} symbols newly absent from the ticker map in one refresh, over the threshold of ${threshold}. ` +
        `NOTHING WAS APPLIED -- no absence recorded, no counter incremented, no symbol marked delisted. ` +
        `Delisting happens a few names at a time, so a batch this size means the map is partial rather than the market having emptied. ` +
        `The map passed validation, which is exactly why this second guard exists.`,
    };
  }

  const newlyDelisted: string[] = [];

  for (const symbol of reappeared) {
    const entry = manifest.symbols[symbol];
    // CLEARED THE MOMENT IT REAPPEARS. A symbol missing from one refresh and
    // back in the next was missed, not delisted, and must not carry a strike.
    entry.notInTickerMapSince = null;
    entry.absentRefreshCount = 0;
    entry.delisted = false;
  }

  for (const symbol of newlyAbsent) {
    const entry = manifest.symbols[symbol];
    entry.notInTickerMapSince = now;
    entry.absentRefreshCount = 1;
  }

  for (const symbol of stillAbsent) {
    const entry = manifest.symbols[symbol];
    entry.absentRefreshCount = (entry.absentRefreshCount ?? 1) + 1;
    if (!entry.delisted && entry.absentRefreshCount >= DELIST_REFRESHES) {
      entry.delisted = true;
      newlyDelisted.push(symbol);
      console.warn(
        `[sec-manifest] DELISTED ${symbol}: absent from the ticker map for ${entry.absentRefreshCount} consecutive refreshes ` +
          `since ${new Date(entry.notInTickerMapSince ?? now).toISOString()}. Filings retained and presented as history.`
      );
    }
  }

  return {
    applied: true,
    newlyAbsent,
    stillAbsent,
    reappeared,
    newlyDelisted,
    threshold,
    suspectedPartialMap: false,
    note:
      newlyDelisted.length || newlyAbsent.length || reappeared.length
        ? `${newlyAbsent.length} newly absent, ${stillAbsent.length} still absent, ${reappeared.length} reappeared, ${newlyDelisted.length} newly delisted`
        : null,
  };
}

// ── Exchange ────────────────────────────────────────────────────────────────

export type ExchangeResult = {
  updated: { symbol: string; previous: string | null; next: string }[];
  filled: number;
  unchanged: number;
  /** Entries the map carried no exchange for. NOT cleared -- see below. */
  noExchangeInMap: number;
  histogram: Record<string, number>;
};

/**
 * Update the exchange field from a resolved ticker map.
 *
 * AN EXCHANGE CHANGE IS NOT AN INVALIDATION, and keeping it out of
 * reconcileCiks is the point rather than an organisational preference. A
 * company moving NYSE -> Nasdaq keeps its CIK, keeps its filings and keeps
 * every number already stored; nothing about the fact set is suspect. Routing
 * it through the invalidation path would discard a perfectly good fact set and
 * re-fetch it from SEC because a venue changed. Only a CIK change means the
 * data might belong to somebody else.
 *
 * So this function has no threshold, no guard and no destructive branch: it
 * writes a field. The spike guards exist where an inference could be wrong and
 * expensive; this is an observation being copied.
 *
 * A KNOWN EXCHANGE IS NEVER OVERWRITTEN WITH NULL. The legacy committed file
 * carries no exchange column at all, so a run that fell back to it would
 * otherwise blank the field for the whole universe -- absence in the source is
 * not a move to "no exchange".
 */
export function reconcileExchanges(
  manifest: SecManifest,
  cikByTicker: Map<string, TickerEntry>
): ExchangeResult {
  const updated: ExchangeResult["updated"] = [];
  let filled = 0;
  let unchanged = 0;
  let noExchangeInMap = 0;

  for (const [symbol, entry] of Object.entries(manifest.symbols)) {
    const fresh = cikByTicker.get(symbol);
    if (!fresh) continue;
    if (!fresh.exchange) {
      noExchangeInMap++;
      continue;
    }
    if (!entry.exchange) {
      entry.exchange = fresh.exchange;
      filled++;
      continue;
    }
    if (entry.exchange !== fresh.exchange) {
      updated.push({ symbol, previous: entry.exchange, next: fresh.exchange });
      entry.exchange = fresh.exchange;
      continue;
    }
    unchanged++;
  }

  return { updated, filled, unchanged, noExchangeInMap, histogram: exchangeHistogram(manifest) };
}

/**
 * What share of the universe sits on each venue.
 *
 * Needed BEFORE the Nasdaq-only bars negotiation concludes rather than after:
 * the size of the NYSE slice is the size of the population that would lose its
 * price history, and therefore the cost of the deal. Counted from the MANIFEST
 * rather than from the ticker map, because the universe is the thing being
 * priced, not SEC's whole file.
 */
export function exchangeHistogram(manifest: SecManifest): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of Object.values(manifest.symbols)) {
    const key = entry.exchange ?? "(unknown)";
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}
