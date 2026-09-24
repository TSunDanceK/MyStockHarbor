// Sector and industry for a symbol: the lookup, and the SEC SIC leg it falls to.
//
// ── 2026-09-23 (#552, COWORK #4): THE FMP SNAPSHOT LEG IS GONE ─────────────
// This file used to import data/static-profile.json, a snapshot of FMP's
// sector and industry for 2,619 symbols taken while the licence was live. The
// owner's ruling is that no FMP data is stored, the repo included, so the file
// is deleted and the lookup falls straight from the cached value to the SEC
// SIC leg. COWORK #3 replaces the SIC leg's labels with our own mapping.
//
// ── LOOKUP ORDER: CACHE, THEN SIC, THEN NULL ───────────────────────────────
// The cached value wins because it is newer (its FMP source is Relay B's to
// remove). A symbol in neither yields NULL — never a guess, never a default
// sector.
//
// ── WHAT IS DELIBERATELY NOT IN HERE ───────────────────────────────────────
// No marketCap, no beta, no 52-week range, no dividend, no description. Those
// are readings, or another party's prose, and come from elsewhere.
import cikMap from "@/data/cik-map.json";
import registrantsFile from "@/data/sec/registrants.json";
import classificationFile from "@/data/sec/sic-classification.json";
import overridesFile from "@/data/sec/classification-overrides.json";
import { lookupSpellingIn } from "@/lib/symbolSpellings.mjs";

export type StaticProfileRow = {
  sector: string | null;
  industry: string | null;
};

const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Where ONE field's value came from (brief 2026-09-22 §2.4 item 2, from
 * BRIEF-taxonomy-sic-mapping-2026-09-14 §4). Cheap to carry now, costly to
 * retrofit once rows from three legs are mixed in a store.
 */
export type ProfileFieldSource = "fmp-cache" | "sic" | "filing" | "none";

export type ResolvedProfile = StaticProfileRow & {
  /** Which leg answered. For logging and for the check script, not for render. */
  source: "cache" | "sic" | "filing" | "none";
  sectorSource: ProfileFieldSource;
  industrySource: ProfileFieldSource;
  /** On a "filing" answer: the filing date of the 10-K/20-F text it came from. */
  filedOn?: string | null;
};

// ── THE SEC LEG: FOR EVERY SYMBOL WITH NO CACHED ROW (#552 COWORK #3/#22) ────
//
// Our own mapping, in the Pickers label set, from SEC data only:
//   1. an OVERRIDE from the filer's own 10-K Item 1 / 20-F text
//      (data/sec/classification-overrides.json, built by
//      scripts/build-sic-classification.mjs from data/sec/classification-rules.json),
//      recorded with the matched phrase and the filing date;
//   2. else the SIC TABLE (data/sec/sic-classification.json): the code's
//      hand-assigned sector and industry, or the 2-digit major group's sector
//      for a code the table does not list;
//   3. else nothing: the card hides, and the helper lists the symbol.
// No vendor label is read anywhere on this leg. Replaced the FMP-voted
// data/sec/sic-sector.json and SEC's raw SIC descriptions as industries.
type RegistrantRow = { sic?: string | null };
type ClassRow = { sector: string | null; industry: string | null };
type OverrideRow = ClassRow & { filedOn?: string | null };

const REGISTRANTS = (registrantsFile as unknown as { rows: Record<string, RegistrantRow> }).rows ?? {};
const CLASSIFICATION = classificationFile as unknown as {
  codes: Record<string, ClassRow>;
  majorGroups: Record<string, string | null>;
};
const OVERRIDES = (overridesFile as unknown as { overrides: Record<string, OverrideRow> }).overrides ?? {};

/** The SEC leg for a symbol, or null. No I/O: every file is bundled. */
export function sicProfileFor(symbol: string): (StaticProfileRow & { from: "filing" | "sic"; filedOn?: string | null }) | null {
  const upper = String(symbol ?? "").trim().toUpperCase();
  if (!upper) return null;
  // THE DOT/DASH BRIDGE: registrants.json and the overrides spell a share class
  // with a dash (BRK-B) while /stock/BRK.B uses a dot. lookupSpellingIn is the
  // one owner of that rule (lib/symbolSpellings.mjs); this calls it.
  const o = lookupSpellingIn(OVERRIDES, upper)?.value;
  if (o && (clean(o.sector) || clean(o.industry))) {
    return { sector: clean(o.sector), industry: clean(o.industry), from: "filing", filedOn: o.filedOn ?? null };
  }
  const code = lookupSpellingIn(REGISTRANTS, upper)?.value?.sic;
  if (!code) return null;
  const row = CLASSIFICATION.codes[code];
  const sector = clean(row?.sector) ?? clean(row ? null : CLASSIFICATION.majorGroups[code.slice(0, 2)]);
  const industry = clean(row?.industry);
  return sector || industry ? { sector, industry, from: "sic" } : null;
}

/**
 * Sector and industry for a symbol: cached value, then SEC SIC, then null.
 *
 * ── THE REFRESH TRIGGER IS A LOG LINE, exactly as the CIK map's is ─────────
 * A symbol in neither leg is the event that says registrants.json needs
 * regenerating — it means something entered the universe after it was read. There is no calendar reminder and no polling, because there is nothing
 * to poll: the answer only changes when the universe does, and a miss IS that
 * change announcing itself.
 *
 * A MISS MAKES NO NETWORK REQUEST. It returns nulls, which is the whole point:
 * the failure mode is a missing picture, never a request storm.
 *
 * ── WHAT A MISS LOOKS LIKE ON THE PAGE, so nobody files it as a bug ────────
 * No sector means no bucket, which means the news cards draw the generated data
 * card instead of a library illustration — the documented §6 fallback, already
 * the normal case for any symbol whose fundamentals have not been warmed. And
 * the symbol does not appear on a sector page, because sector membership is
 * built from the same field. Both are graceful, both are visible in the log
 * line below, and neither is silent.
 *
 * PER-SYMBOL ONLY. A caller resolving a whole universe wants resolveProfileBulk
 * further down, which reports its misses once instead of once each.
 */
export function resolveProfile(
  symbol: string,
  cached: { sector?: string | null; industry?: string | null } | null | undefined
): ResolvedProfile {
  const resolved = resolveQuiet(symbol, cached);
  if (resolved.source === "none") console.warn(missLine(symbol));
  return resolved;
}

/** The lookup without the log line. Both public entry points share it. */
function resolveQuiet(
  symbol: string,
  cached: { sector?: string | null; industry?: string | null } | null | undefined
): ResolvedProfile {
  const cachedSector = clean(cached?.sector);
  const cachedIndustry = clean(cached?.industry);
  // EITHER FIELD COUNTS AS A CACHE HIT. A row with a sector and no industry is
  // still the fresher answer for the sector, and bucketFor degrades from
  // industry to sector on its own.
  if (cachedSector || cachedIndustry) {
    return {
      sector: cachedSector, industry: cachedIndustry, source: "cache",
      sectorSource: cachedSector ? "fmp-cache" : "none",
      industrySource: cachedIndustry ? "fmp-cache" : "none",
    };
  }

  // 2026-09-23 (#552): the FMP snapshot leg that sat here is removed.
  const sec = sicProfileFor(symbol);
  if (sec) {
    const src = sec.from;
    return {
      sector: sec.sector, industry: sec.industry, source: src,
      sectorSource: sec.sector ? src : "none",
      industrySource: sec.industry ? src : "none",
      ...(src === "filing" ? { filedOn: sec.filedOn ?? null } : {}),
    };
  }

  return { sector: null, industry: null, source: "none", sectorSource: "none", industrySource: "none" };
}

/**
 * The date the answering leg's classification was captured, as YYYY-MM-DD, or
 * null. The /stock source line credits it as "classification as of {date}"
 * whichever leg answered, so the wording reads the same for every symbol
 * (owner's wording, follow-up to #517/#518):
 *
 *   cache     the fundamentals row's updatedAt — when the warm wrote it. The
 *             row does not record which leg the warm itself resolved from, so
 *             this is when the value was last confirmed, not first taken.
 *   sic       data/sec/registrants.json's asOf, the day the SIC code was read.
 *   filing    the filing date of the 10-K/20-F text the override came from.
 *
 * A cache row with no parseable updatedAt yields null — never another leg's
 * date, which would credit the value to a source it did not come from.
 */
export const REGISTRANTS_SIC_AS_OF: string | null =
  (registrantsFile as unknown as { asOf?: string }).asOf ?? null;

export function classificationAsOf(
  resolved: Pick<ResolvedProfile, "source" | "filedOn">,
  cachedUpdatedAt: string | null | undefined
): string | null {
  const day = (v: string | null | undefined) => {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
    return m ? m[1] : null;
  };
  if (resolved.source === "cache") return day(cachedUpdatedAt);
  if (resolved.source === "sic") return day(REGISTRANTS_SIC_AS_OF);
  if (resolved.source === "filing") return day(resolved.filedOn);
  return null;
}

function missLine(symbol: string): string {
  const upper = String(symbol ?? "").trim().toUpperCase();
  return (
    `[static-profile] ${upper}: no cached sector and no ` +
    `SIC row in data/sec/registrants.json — regenerate registrants (relay task ` +
    `"sec-registrants"). The card falls back to the ` +
    `generated data card and the symbol will not appear on a sector page until it is there.`
  );
}

/**
 * The same lookup over many symbols, with the misses reported ONCE.
 *
 * ── WHY THIS EXISTS AND IS NOT JUST A LOOP ─────────────────────────────────
 * lib/server/sectorUniverse.ts resolves the entire candidate universe on every
 * index rebuild — hundreds of symbols, most of them missing from the cache once
 * it has aged. Calling resolveProfile in that loop would emit hundreds of
 * identical warn lines per rebuild, and a refresh trigger that scrolls past is
 * not a refresh trigger: the CIK map's works precisely because a miss is rare
 * enough to stand out. So the bulk path counts them and says it once.
 *
 * THE COUNT IS THE SIGNAL, not the individual symbols, so only the first few are
 * named. A jump from 3 misses to 300 is the thing worth seeing, and it is the
 * thing a per-symbol wall would bury.
 */
export function resolveProfileBulk(
  entries: Iterable<{
    symbol: string;
    cached?: { sector?: string | null; industry?: string | null } | null;
  }>,
  context: string
): Map<string, ResolvedProfile> {
  const out = new Map<string, ResolvedProfile>();
  const missed: string[] = [];

  for (const entry of entries) {
    const upper = String(entry?.symbol ?? "").trim().toUpperCase();
    if (!upper) continue;
    const resolved = resolveQuiet(upper, entry.cached);
    out.set(upper, resolved);
    if (resolved.source === "none") missed.push(upper);
  }

  if (missed.length) {
    console.warn(
      `[static-profile] ${context}: ${missed.length} of ${out.size} symbols have no cached ` +
        `sector and no SIC row in data/sec/registrants.json — ` +
        `regenerate registrants (relay task "sec-registrants"). They will not appear on a sector ` +
        `page and their cards fall back to the generated data card. First ${Math.min(10, missed.length)}: ` +
        `${missed.slice(0, 10).join(", ")}`
    );
  }

  return out;
}

/**
 * CIK coverage: how many profiled symbols the SEC adapter can actually serve.
 *
 * WHY THIS IS A NUMBER ON A PAGE RATHER THAN A LOG LINE. A symbol with no CIK
 * gets [] from the SEC leg on every render, forever, and says so only through a
 * per-request console.warn. That made a 73.5% gap invisible for as long as it
 * existed (claude/cik-map-coverage-2026-09-14.md): 1,924 of 2,619 profiled
 * symbols had no entry, because the map was built against the PICKERS universe
 * while the adapter is called for any symbol with a stock page.
 *
 * Both inputs are JSON imported at build time, so this is arithmetic over two
 * module-level objects — no Redis, no fetch, and safe on a page that must stay
 * cheap.
 */
const CIK_BY_SYMBOL = cikMap as unknown as Record<string, string>;

/**
 * Coverage as a FUNCTION over both maps, not as three constants.
 *
 * WHY IT IS A FUNCTION. The first version computed the constants inline, and a
 * mutation replacing the membership count with `Math.min(mapSize, profileSize)`
 * SURVIVED the checker — because the CIK map is a strict subset of the snapshot
 * today, so the shortcut returns the same number. It stops being the same number
 * the moment the map is widened past the snapshot, at which point the figure
 * quietly goes wrong (and `missing` goes negative) with nothing to catch it.
 *
 * A constant can only be compared against the data that produced it. A function
 * can be handed a case where the two implementations disagree — which is exactly
 * what scripts/check-static-profile.mjs now does. Same lesson as
 * classifyProviderStats in lib/server/news/providerStats.ts.
 */
export function cikCoverage(
  rows: Record<string, unknown>,
  ciks: Record<string, unknown>
): { mapSize: number; profiled: number; covered: number; missing: number } {
  const symbols = Object.keys(rows);
  // MEMBERSHIP, symbol by symbol. Not a difference of totals: the two agree only
  // while every CIK symbol is also a profiled one, and nothing enforces that.
  const covered = symbols.filter((symbol) => symbol in ciks).length;
  return {
    mapSize: Object.keys(ciks).length,
    profiled: symbols.length,
    covered,
    missing: symbols.length - covered,
  };
}

// PROFILED = the symbols registrants.json holds (the FMP snapshot's rows were
// the denominator until 2026-09-23, #552).
const COVERAGE = cikCoverage(REGISTRANTS, CIK_BY_SYMBOL);

/** How many symbols carry a registrant row — the CIK coverage denominator. */
export const PROFILED_SIZE: number = COVERAGE.profiled;

export const CIK_MAP_SIZE: number = COVERAGE.mapSize;
export const CIK_COVERED: number = COVERAGE.covered;
/** Profiled symbols with no CIK — each one a permanently empty SEC leg. */
export const CIK_MISSING: number = COVERAGE.missing;
