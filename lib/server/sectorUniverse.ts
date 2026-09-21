import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

import { PRESET_UNIVERSE } from "./presetUniverse";
import { readDynamicUniverse } from "./dynamicUniverseCache";
import {
  readCachedFundamentalsBulk,
  readCachedScreenerFundamentals,
} from "./fundamentalsCache";
import { SECTORS, sectorSlugFromLabel } from "@/lib/sectors";
import { resolveProfileBulk } from "@/lib/server/staticProfile";

// ---------------------------------------------------------------------------
// Sector -> constituents, built entirely from caches we already fill.
//
// ZERO FMP CALLS. Every input here is Redis-only:
//   * readDynamicUniverse()            -- the rolling ~700-symbol universe
//   * PRESET_UNIVERSE                  -- the 100 mega-caps, guaranteed slots
//   * readCachedFundamentalsBulk()     -- {marketCap, sector} per symbol (26h)
//   * readCachedScreenerFundamentals() -- same two fields, wider coverage (30h)
//
// The data was always there; what was missing was a reverse index. Redis holds
// per-symbol keys with no sector -> symbols mapping and nothing SCANs, so the
// index has to be derived by reading an enumerable symbol list and grouping in
// process. That is ~2 round-trips plus two mgets, which is too much to repeat
// on every page render, so the built index is cached back to Redis under one
// key with a short TTL and re-derived on miss.
//
// COVERAGE IS DELIBERATELY REPORTED, NOT HIDDEN. warmFundamentals backfills
// profiles at PROFILE_MAX_PER_RUN = 120 per run, so at any moment some slice of
// the universe has no sector cached. A sector page that silently drops those
// symbols looks complete while being wrong, so getSectorIndex() carries the
// classified/total counts and the pages surface them.
// ---------------------------------------------------------------------------

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export const SECTOR_INDEX_KEY = "msh:sector-index:v1";
// Sector membership and market-cap ordering are near-static; the inputs
// themselves only refresh daily-ish. Six hours keeps the page cheap while still
// picking up newly-classified symbols within a trading day.
const SECTOR_INDEX_TTL_SECONDS = 6 * 60 * 60;

/** How many constituents any single sector keeps. Ordered by market cap. */
const MAX_CONSTITUENTS_PER_SECTOR = 120;

export type SectorIndex = {
  /** slug -> constituent symbols, largest market cap first. */
  bySlug: Record<string, string[]>;
  /** Symbols considered. */
  total: number;
  /** Symbols with a recognised sector. */
  classified: number;
  builtAt: number;
};

function emptyIndex(): SectorIndex {
  const bySlug: Record<string, string[]> = {};
  for (const sector of SECTORS) bySlug[sector.slug] = [];
  return { bySlug, total: 0, classified: 0, builtAt: Date.now() };
}

function cleanSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

/**
 * The enumerable symbol list to classify: the rolling dynamic universe plus the
 * preset mega-caps. The preset list matters because it is NOT guaranteed to be
 * in the dynamic universe (warmTargets.ts unions them for the same reason), and
 * dropping, say, BRK.B out of Financial Services because it happened to age out
 * of the dynamic set would be an obvious hole on a sector page.
 */
async function getCandidateSymbols(): Promise<string[]> {
  let dynamic: string[] = [];

  try {
    dynamic = (await readDynamicUniverse()).map((entry) => entry.symbol);
  } catch {
    // Fail open: the preset universe alone still produces usable sector pages.
  }

  return Array.from(
    new Set([...PRESET_UNIVERSE, ...dynamic].map(cleanSymbol).filter(Boolean))
  );
}

async function buildSectorIndex(): Promise<SectorIndex> {
  const symbols = await getCandidateSymbols();
  const index = emptyIndex();
  index.total = symbols.length;

  if (!symbols.length) return index;

  // Both reads are Redis-only mgets. The screener rows cover more symbols; the
  // fundamentals rows are fresher. Prefer whichever actually has a sector, and
  // fall through to the committed snapshot when neither does — see below.
  const [fundamentals, screener] = await Promise.all([
    readCachedFundamentalsBulk(symbols).catch(() => new Map()),
    readCachedScreenerFundamentals(symbols).catch(() => new Map()),
  ]);

  // ── THE SNAPSHOT IS THE THIRD LEG, ADDED AT STEP 7 ───────────────────────
  // Both reads above are caches with a TTL, and after the flip there is no FMP
  // call left to refill them. A symbol whose rows have both expired used to
  // recover on the next warm; now it would simply fall out of its sector page
  // and stay out. data/static-profile.json is the floor that stops that.
  //
  // BULK, NOT resolveProfile IN THE LOOP: this runs over the whole candidate
  // universe, so a per-symbol warn would be hundreds of lines per rebuild and
  // the refresh trigger would be buried in its own output. resolveProfileBulk
  // says it once with a count.
  // WHICHEVER CACHE LEG MAPS, not merely whichever is non-empty. The original
  // read was `slug(fund.sector) ?? slug(scr.sector)`, so a fundamentals row
  // carrying a label SECTORS does not know already fell through to the screener
  // row; collapsing that to `fund.sector ?? scr.sector` would have quietly
  // dropped the second chance. Resolving the slug first keeps it, and an
  // unmappable label on both legs now passes null so the snapshot gets its turn
  // rather than the symbol simply vanishing.
  //
  // NO `industry` PASSED HERE, deliberately: resolveProfile counts EITHER field
  // as a cache hit, so a row with an industry and no sector would report "cache"
  // with a null sector and suppress the snapshot leg — for a caller that reads
  // nothing but the sector. Sector membership is the only question on this path.
  const cachedSectorFor = (symbol: string): string | null => {
    const fund = fundamentals.get(symbol)?.sector ?? null;
    if (sectorSlugFromLabel(fund)) return fund;
    const scr = screener.get(symbol)?.sector ?? null;
    return sectorSlugFromLabel(scr) ? scr : null;
  };

  const resolved = resolveProfileBulk(
    symbols.map((symbol) => ({ symbol, cached: { sector: cachedSectorFor(symbol) } })),
    "sector index"
  );

  const buckets = new Map<string, Array<{ symbol: string; marketCap: number }>>();
  for (const sector of SECTORS) buckets.set(sector.slug, []);

  for (const symbol of symbols) {
    const fund = fundamentals.get(symbol) ?? null;
    const scr = screener.get(symbol) ?? null;

    const slug = sectorSlugFromLabel(resolved.get(symbol)?.sector ?? null);

    if (!slug) continue;

    const marketCap =
      typeof fund?.marketCap === "number" && Number.isFinite(fund.marketCap)
        ? fund.marketCap
        : typeof scr?.marketCap === "number" && Number.isFinite(scr.marketCap)
          ? scr.marketCap
          : 0;

    buckets.get(slug)?.push({ symbol, marketCap });
    index.classified += 1;
  }

  for (const [slug, rows] of buckets) {
    index.bySlug[slug] = rows
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, MAX_CONSTITUENTS_PER_SECTOR)
      .map((row) => row.symbol);
  }

  index.builtAt = Date.now();
  return index;
}

function isUsableIndex(value: unknown): value is SectorIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as SectorIndex;
  return Boolean(candidate.bySlug && typeof candidate.bySlug === "object");
}

/**
 * The cached sector index. Reads the Redis rollup, rebuilds on miss, and writes
 * the rebuild back with a TTL. Never throws -- a total failure returns an empty
 * index and the pages render their "coverage is thin" state rather than 500ing.
 */
export async function getSectorIndex(): Promise<SectorIndex> {
  if (redis) {
    try {
      const cached = await redis.get<SectorIndex>(SECTOR_INDEX_KEY);
      if (isUsableIndex(cached)) return cached;
    } catch {
      // fall through to a rebuild
    }
  }

  let built: SectorIndex;

  try {
    built = await buildSectorIndex();
  } catch {
    return emptyIndex();
  }

  if (redis && built.classified > 0) {
    try {
      await redis.set(SECTOR_INDEX_KEY, built, { ex: SECTOR_INDEX_TTL_SECONDS });
    } catch {
      // Best-effort: an unwritten rollup just means the next render rebuilds.
    }
  }

  return built;
}

/**
 * Constituent symbols for one sector, largest market cap first.
 * `limit` bounds how many come back (the news fetch only wants the top slice).
 */
export async function getSectorConstituents(
  slug: string,
  limit = MAX_CONSTITUENTS_PER_SECTOR
): Promise<string[]> {
  const index = await getSectorIndex();
  const symbols = index.bySlug[slug] ?? [];
  return symbols.slice(0, Math.max(0, limit));
}

/** Constituent counts for every sector, for the /sector index page. */
export async function getSectorConstituentCounts(): Promise<Record<string, number>> {
  const index = await getSectorIndex();
  const out: Record<string, number> = {};

  for (const sector of SECTORS) {
    out[sector.slug] = (index.bySlug[sector.slug] ?? []).length;
  }

  return out;
}
