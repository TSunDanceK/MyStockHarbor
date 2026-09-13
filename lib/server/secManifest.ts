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
  /**
   * A ticker-map row WITH an exchange column was seen for this symbol.
   *
   * This is what separates "SEC records no venue for this filer" from "we have
   * never had a map that could tell us". Both leave `exchange` null, and the
   * histogram would otherwise file 216 real blank-venue rows under the same
   * bucket as symbols nothing has ever looked up.
   */
  exchangeKnown?: boolean;
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
  /**
   * This symbol's CIK now appears in the ticker map under a DIFFERENT ticker.
   * A corporate reticker, not a delisting -- BK -> BNY, EQR -> VMRK, both
   * observed 2026-09-13. Recorded so the migration is attributable; the
   * universe rename itself is a separate decision (see the CIK-keying note in
   * data/sec/README.md).
   */
  retickeredTo?: string | null;
  /**
   * WHY this symbol needs re-reading, so step 3 can spend differently on each.
   *
   * 6-K IS 89% OF THE PERIODIC SIGNAL AND IS NOT A PERIODIC REPORT. Measured
   * over 2026-09-08..11: of 55 periodic filers, 2 filed a 10-K, 4 a 10-Q and 49
   * a 6-K -- HSBC, GSK, SNN and BIDU each filed one on all four days. 6-K is the
   * foreign-private-issuer catch-all: press releases, director dealings, AGM
   * notices, buyback announcements.
   *
   * Narrowing the form set is NOT the fix. ARM is an FPI and reports its
   * quarter through a 6-K, so dropping 6-K would silently lose the quarterly
   * numbers for the very page this project was audited against, while appearing
   * to work. Instead the RE-READ is made conditional, and this field is what
   * tells step 3 which kind of re-read to do.
   */
  reverifyReason?: "periodic-report" | "amendment" | "unconfirmed" | null;
  /** When re-reading was first requested. The queue drains oldest-first. */
  enqueuedAt?: number | null;
};

export type SecManifest = {
  version: 1;
  /** Last daily index date (YYYYMMDD) successfully processed. */
  lastIndexDate: string | null;
  /**
   * Consecutive index FAILURES -- a refusal, a 5xx, a timeout. Reset on any
   * parse. An ABSENT day never touches this: see consecutiveIndexAbsent.
   */
  consecutiveIndexFailures: number;
  /**
   * Consecutive days with no index published, counted SEPARATELY.
   *
   * Absence is normal -- every weekend and every market holiday -- so feeding it
   * into the failure counter alarms on days when nothing is wrong: a cron
   * walking one day at a time through Thanksgiving or Christmas reaches four
   * consecutive absences without anything being broken. Measured, not
   * suspected: a Saturday-only run took the counter 0 -> 1.
   *
   * But it is still counted, because a silent block that happened to answer
   * with a small 403 body would otherwise look like absence forever and never
   * alarm at all. There is no ten-day stretch with no EDGAR publication, so
   * that is the implausibility threshold -- a different question from "is SEC
   * refusing us", asked separately.
   */
  consecutiveIndexAbsent?: number;
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
    reverifyReason: null,
    enqueuedAt: null,
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
    consecutiveIndexAbsent: 0,
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
 *
 * THE ESCAPE HATCH IS `?applyMapChanges=1` ON THE JOB, and it is named here so
 * this is not a mystery in six months. SEC can legitimately change more than
 * the threshold in one week -- an index reconstitution, a wave of renames -- and
 * without an override the guard would refuse every week forever while the map
 * silently never updated. Each refusal is reported, so it would not be
 * invisible; the override is how a human says "I have looked, apply it".
 * It bypasses BOTH guards, deliberately: they fail together on a bad map and a
 * human who has checked one has checked the other.
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
  opts: { now?: number; override?: boolean } = {}
): CikChangeResult {
  const now = opts.now ?? Date.now();
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
  if (changes.length > threshold && !opts.override) {
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
        `The previous CIKs stand. Inspect the changes below, then re-run with ?applyMapChanges=1 once the map is trusted.`,
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
  /** Absent under this ticker, but the CIK is in the map under another. */
  retickered: { symbol: string; cik: string; nowTicker: string }[];
  /**
   * Absent AND never had a CIK, so there is no identity to look up. Strictly
   * less evidence than an absence with a CIK, so no delisting clock is started.
   */
  unresolvable: string[];
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
  opts: { now?: number; override?: boolean } = {}
): DelistingResult {
  const now = opts.now ?? Date.now();
  const entries = Object.entries(manifest.symbols);
  const threshold = mapChangeThreshold(entries.length);

  const newlyAbsent: string[] = [];
  const stillAbsent: string[] = [];
  const reappeared: string[] = [];
  const retickered: DelistingResult["retickered"] = [];
  const unresolvable: string[] = [];

  // CIK -> the ticker(s) it is listed under now. THE CIK IS THE STABLE IDENTITY
  // and the ticker is a label, so a symbol that has vanished under its own name
  // while its CIK is still in the file has been RENAMED, not delisted. Built
  // from the map itself rather than from a hardcoded table: a table would encode
  // one September 2026 snapshot and answer wrongly, silently, forever.
  const tickersByCik = new Map<string, string[]>();
  for (const [ticker, e] of cikByTicker) {
    const list = tickersByCik.get(e.cik) ?? [];
    list.push(ticker);
    tickersByCik.set(e.cik, list);
  }

  for (const [symbol, entry] of entries) {
    const present = cikByTicker.has(symbol);
    if (present) {
      if (entry.notInTickerMapSince || entry.absentRefreshCount || entry.delisted || entry.retickeredTo) {
        reappeared.push(symbol);
      }
      continue;
    }

    // A SYMBOL THAT NEVER RESOLVED HAS NO IDENTITY TO TRACE. Its CIK is null, so
    // neither the reticker check nor a delisting inference has anything to work
    // with -- and absence from the ticker file is not proof of deregistration.
    // Reported, and deliberately given no clock: less evidence must not produce
    // a more confident verdict.
    if (!entry.cik) {
      unresolvable.push(symbol);
      continue;
    }

    // Prefer a successor whose spelling is not a class/preferred variant of
    // itself; among BNY and BNY-PK, BNY is the ordinary-share successor.
    const successors = (tickersByCik.get(entry.cik) ?? []).filter((t) => t !== symbol);
    if (successors.length) {
      const best = successors.slice().sort((a, b) => a.length - b.length)[0];
      retickered.push({ symbol, cik: entry.cik, nowTicker: best });
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
  if (newlyAbsent.length > threshold && !opts.override) {
    return {
      applied: false,
      newlyAbsent,
      stillAbsent,
      reappeared,
      newlyDelisted: [],
      retickered,
      unresolvable,
      threshold,
      suspectedPartialMap: true,
      note:
        `${newlyAbsent.length} symbols newly absent from the ticker map in one refresh, over the threshold of ${threshold}. ` +
        `NOTHING WAS APPLIED -- no absence recorded, no counter incremented, no symbol marked delisted. ` +
        `Delisting happens a few names at a time, so a batch this size means the map is partial rather than the market having emptied. ` +
        `The map passed validation, which is exactly why this second guard exists. Re-run with ?applyMapChanges=1 once the map is trusted.`,
    };
  }

  const newlyDelisted: string[] = [];

  for (const change of retickered) {
    const entry = manifest.symbols[change.symbol];
    // A MIGRATION, NOT A DELISTING. The absence clock is cleared rather than
    // advanced, so this can never contribute to newlyDelisted.
    entry.retickeredTo = change.nowTicker;
    entry.notInTickerMapSince = null;
    entry.absentRefreshCount = 0;
    entry.delisted = false;
    console.warn(
      `[sec-manifest] RETICKER ${change.symbol} -> ${change.nowTicker} (CIK ${change.cik} unchanged). ` +
        `Filings and stored facts are retained; this is a rename, not a delisting.`
    );
  }

  for (const symbol of reappeared) {
    const entry = manifest.symbols[symbol];
    entry.retickeredTo = null;
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
    retickered,
    unresolvable,
    threshold,
    suspectedPartialMap: false,
    note:
      newlyDelisted.length || newlyAbsent.length || reappeared.length || retickered.length || unresolvable.length
        ? `${newlyAbsent.length} newly absent, ${stillAbsent.length} still absent, ${reappeared.length} reappeared, ` +
          `${newlyDelisted.length} newly delisted, ${retickered.length} retickered, ${unresolvable.length} unresolvable (no CIK)`
        : null,
  };
}

// ── Exchange ────────────────────────────────────────────────────────────────

export type ExchangeResult = {
  updated: { symbol: string; previous: string | null; next: string }[];
  filled: number;
  unchanged: number;
  /** Rows SEC lists with a BLANK exchange. A real answer, not missing data. */
  noVenueRecorded: number;
  sourceHasExchangeColumn: boolean;
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
  cikByTicker: Map<string, TickerEntry>,
  opts: { sourceHasExchangeColumn: boolean }
): ExchangeResult {
  const updated: ExchangeResult["updated"] = [];
  let filled = 0;
  let unchanged = 0;
  let noVenueRecorded = 0;

  // A SOURCE WITH NO EXCHANGE COLUMN WRITES NOTHING AT ALL.
  //
  // The legacy company_tickers.json has no such column, so every entry parses
  // with exchange null. Treating those nulls as observations would blank the
  // venue for the entire universe the first time a run fell back to the
  // committed file -- and would then claim, via exchangeKnown, that SEC records
  // no venue for any of them.
  if (!opts.sourceHasExchangeColumn) {
    return {
      updated: [],
      filled: 0,
      unchanged: 0,
      noVenueRecorded: 0,
      sourceHasExchangeColumn: false,
      histogram: exchangeHistogram(manifest),
    };
  }

  for (const [symbol, entry] of Object.entries(manifest.symbols)) {
    const fresh = cikByTicker.get(symbol);
    // ABSENT FROM THE MAP IS NOT THE SAME AS BLANK IN THE MAP. Absence is a gap
    // (or a delisting, handled elsewhere); a blank cell is SEC saying it has no
    // venue for a filer it does list. Only the second is an observation.
    if (!fresh) continue;

    // The row exists and the file has the column, so whatever it says -- a
    // venue or a blank -- is authoritative.
    entry.exchangeKnown = true;

    if (!fresh.exchange) {
      // MEASURED 2026-09-13: 216 of 10,426 rows carry a blank exchange. That is
      // a real row and a real answer, not missing data and not an error. It is
      // recorded as such rather than being counted as a failure to resolve.
      noVenueRecorded++;
      entry.exchange = null;
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

  return {
    updated,
    filled,
    unchanged,
    noVenueRecorded,
    sourceHasExchangeColumn: true,
    histogram: exchangeHistogram(manifest),
  };
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
    // THREE OUTCOMES, NOT TWO. A venue; SEC listing the filer with no venue
    // (216 rows, measured); and never having had a map that could say. The last
    // two both leave `exchange` null and mean entirely different things -- one
    // is an answer, the other is a gap in our own coverage.
    const key = entry.exchange ?? (entry.exchangeKnown ? "(none recorded)" : "(unknown)");
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// ── The re-read queue ───────────────────────────────────────────────────────
//
// THERE IS NO CONDITIONAL CHECK, AND THAT IS MEASURED RATHER THAN ASSUMED.
// Do not add an If-Modified-Since here later and take the silence for success.
//
// Probed 2026-09-13 against ARM, HSBC and AAPL (scripts/sec-reread-probe.mjs,
// relay task `sec-reread`), every conditional paired with a negative control:
//
//   companyfacts   Last-Modified ABSENT, ETag ABSENT   on all three
//   submissions    Last-Modified ABSENT, ETag ABSENT   on all three
//
// No validator is offered anywhere, so a conditional request is not something
// that works badly here -- it is something that cannot be expressed. This
// re-tests build-brief §3.7 rather than trusting it.
//
// THE isXBRL FLAG WAS THE OTHER CANDIDATE AND IT SPLITS THE WRONG WAY:
//
//   ARM    23 of 23 6-Ks tagged   -> gates nothing, every 6-K re-reads anyway
//   HSBC    0 of 25 6-Ks tagged   -> a quarter reported via 6-K is
//                                    indistinguishable from a press release
//
// It over-triggers on one filer and under-triggers on the other. No threshold
// fixes both, and a filer-specific rule is a heuristic that fails silently on
// the filer nobody tested. So a 6-K costs a full re-read, and the DRAIN RATE is
// the only lever. That is a deliberate acceptance, not an oversight.
//
// WHY THAT IS AFFORDABLE, measured over the same four days:
//   49 distinct 6-K filers + 75 distinct 8-K filers / 4 days ~= 30 events/day
//   ~150 KB wire each (ARM 50,774 · HSBC ~113,000 · AAPL 271,819)
//   => 4-5 MB/day against 10 requests/SECOND and no daily cap
// Bandwidth and rate limit are both non-issues.

/**
 * How many re-reads one drain invocation may perform.
 *
 * SIZED AGAINST WORK PER DOCUMENT, AND THE MEASUREMENT MOVED THE ANSWER.
 * Parse time was expected to be the binding constraint; measured, it is not.
 * A synthetic companyfacts-shaped document of AAPL's decoded size:
 *
 *   3.80 MB decoded · JSON.parse median 21 ms · ~182 MB/s
 *   heap delta 5.7 MB, about 1.5x the decoded size · 24,840 fact rows
 *
 * So a full day's ~30 re-reads is well under a second of parse. What the
 * numbers actually constrain is CONCURRENCY, not count: ten documents parsed in
 * parallel is ~57 MB of live heap on top of everything else the function holds,
 * and the decoded document must never be retained -- extract, keep the ~20 KB
 * fact set, discard (build brief §4: never store raw companyfacts).
 *
 * 40 per invocation therefore clears a normal day many times over while leaving
 * the 300 s budget dominated by network round-trips, which at ~0.5-1 s each is
 * the real per-symbol cost. The backfill is what makes a backlog large, and it
 * drains over days by design rather than in one run.
 *
 * MEASURED IN THE AGENT SANDBOX, NOT IN A VERCEL FUNCTION. Treat as an order of
 * magnitude; re-measure in situ before raising it.
 */
export const SEC_REREAD_DRAIN_PER_RUN = 40;

/** Re-read one document at a time. See the heap figures above. */
export const SEC_REREAD_CONCURRENCY = 1;

/**
 * The queue, read straight off the manifest.
 *
 * THE MANIFEST IS THE QUEUE. A separate Redis structure would add commands to
 * every run against a budget of three, and the flag already says who is waiting.
 * Ordered so the drain has nothing left to decide:
 *
 *   amendment        first -- a restatement changes charts already published
 *   periodic-report  next  -- the quarter actually landed
 *   unconfirmed      last  -- a 6-K or 8-K that probably carries nothing
 *
 * and oldest-first within each, so nothing starves behind a busy filer.
 */
export function secRereadQueue(
  manifest: SecManifest,
  limit = SEC_REREAD_DRAIN_PER_RUN
): { symbol: string; reason: string; enqueuedAt: number | null }[] {
  const rank = { amendment: 0, "periodic-report": 1, unconfirmed: 2 } as Record<string, number>;
  return Object.entries(manifest.symbols)
    .filter(([, e]) => e.needsReverify && e.cik)
    .map(([symbol, e]) => ({
      symbol,
      reason: e.reverifyReason ?? "unconfirmed",
      enqueuedAt: e.enqueuedAt ?? null,
    }))
    .sort(
      (a, b) =>
        (rank[a.reason] ?? 3) - (rank[b.reason] ?? 3) ||
        (a.enqueuedAt ?? 0) - (b.enqueuedAt ?? 0) ||
        (a.symbol < b.symbol ? -1 : 1)
    )
    .slice(0, limit);
}
