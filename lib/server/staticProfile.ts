// The committed static-profile snapshot, and the lookup that reads it.
//
// ── WHY A COMMITTED FILE AT ALL ────────────────────────────────────────────
// Sector and industry are not decoration: bucketFor() turns them into a news
// card's illustration, and lib/server/sectorUniverse.ts turns them into a
// sector page's membership. Today they come from FMP, cached in Redis for 30
// days. After step 7 there is no free source with FMP's taxonomy, so a symbol
// whose cache has expired — or a symbol that enters the universe later — would
// have no sector at all and no way to get one.
//
// So the facts are snapshotted while the licence is live. They are facts, not
// readings: a company's sector does not move.
//
// ── LOOKUP ORDER: CACHE, THEN SNAPSHOT, THEN NULL ──────────────────────────
// The cached FMP value wins because it is newer and because a reclassification
// should take effect without a redeploy. The snapshot is the floor under it.
// A symbol in neither yields NULL — never a guess, never a default sector.
//
// ── WHAT IS DELIBERATELY NOT IN HERE ───────────────────────────────────────
// No marketCap, no beta, no 52-week range, no dividend. Those are readings,
// not facts, and freezing a reading puts a stale number on a live page — worse
// than an absent row, because a reader cannot tell it is stale. They keep
// coming from the price pipeline. scripts/check-static-profile.mjs asserts the
// snapshot file contains none of them.
//
// NO DESCRIPTION EITHER, and the reason is not staleness. Every other field
// here is a fact; FMP's description is their authored prose, and shipping it
// in our repo is taking their writing rather than their data. The candidate
// replacement is the 10-K Item 1 business section, which is the company's own
// filing and public domain as a government record — reachable through the SEC
// adapter built in step 5, which already resolves a symbol to a CIK and lists
// its filings. That is a separate piece of work and is not started here.
import snapshotFile from "@/data/static-profile.json";
import cikMap from "@/data/cik-map.json";
import registrantsFile from "@/data/sec/registrants.json";
import sicSectorFile from "@/data/sec/sic-sector.json";
import { lookupSpellingIn } from "@/lib/symbolSpellings.mjs";

export type StaticProfileRow = {
  sector: string | null;
  industry: string | null;
};

type SnapshotFile = {
  asOf: string;
  rows: Record<string, { sector?: string | null; industry?: string | null }>;
};

const SNAPSHOT = snapshotFile as unknown as SnapshotFile;

/** When the snapshot was taken. Every row shares it; nothing here decays fast. */
export const SNAPSHOT_AS_OF: string = SNAPSHOT.asOf;

/** How many symbols the snapshot covers. Exported for the check script. */
export const SNAPSHOT_SIZE: number = Object.keys(SNAPSHOT.rows ?? {}).length;

const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** The snapshot's row for a symbol, or null. No I/O: the file is bundled. */
export function staticProfileFor(symbol: string): StaticProfileRow | null {
  const upper = String(symbol ?? "").trim().toUpperCase();
  if (!upper) return null;
  // ── THE DOT/DASH BRIDGE, AND BRK.B IS WHY ────────────────────────────────
  // The snapshot is keyed the way FMP spells a share class, with a DASH:
  // `BRK-A`, `BRK-B`. lib/curatedSymbols.ts spells the same company with a DOT
  // — "BRK.B" is in the megacap list — and so does data/company-names.json. So
  // /stock/BRK.B/news asked for a key the snapshot does not hold, got no
  // industry and no sector, and fell to the generated ticker card, while
  // /stock/BRK-B/news worked. Nothing failed; one spelling of one company was
  // quietly worse than the other.
  //
  // lookupSpellingIn is the module that already owns this, and the header of
  // lib/symbolSpellings.mjs records that this repo once had SEVEN copies of the
  // dot/dash dance. This is not an eighth: it is that helper, called.
  const found = lookupSpellingIn(SNAPSHOT.rows ?? {}, upper);
  const row = found?.value;
  if (!row) return null;
  const sector = clean(row.sector);
  const industry = clean(row.industry);
  return sector || industry ? { sector, industry } : null;
}

/**
 * Where ONE field's value came from (brief 2026-09-22 §2.4 item 2, from
 * BRIEF-taxonomy-sic-mapping-2026-09-14 §4). Cheap to carry now, costly to
 * retrofit once rows from three legs are mixed in a store.
 */
export type ProfileFieldSource = "fmp-cache" | "fmp-snapshot" | "sic" | "none";

export type ResolvedProfile = StaticProfileRow & {
  /** Which leg answered. For logging and for the check script, not for render. */
  source: "cache" | "snapshot" | "sic" | "none";
  sectorSource: ProfileFieldSource;
  industrySource: ProfileFieldSource;
};

// ── THE SIC LEG: AFTER THE SNAPSHOT, FOR SYMBOLS IT DOES NOT COVER ─────────
//
// A symbol that entered the universe after 2026-09-13 has no cached FMP row
// and no snapshot row, and so no sector page. SEC files every registrant under
// a SIC code (data/sec/registrants.json), and data/sec/sic-sector.json maps
// codes to FMP's sector labels by MEASURED majority over the 2,587 symbols that
// carry both — scripts/build-sic-sector.mjs. A code the evidence does not
// support maps to null ("unclassified"), and the miss is reported, never
// guessed.
//
// INDUSTRY IS SEC's OWN DESCRIPTION, NOT AN FMP LABEL (taxonomy brief option
// C). "Semiconductors & Related Devices" is not FMP's "Semiconductors", and the
// one page that filters on an industry string (/semiconductor-stocks) would
// not match it. That is deliberate: inventing FMP labels from SIC codes is the
// owner's call, after seeing the list of strings pages filter on.
type RegistrantRow = { sic?: string | null; sicDescription?: string | null };

/**
 * SIC CODES WHOSE INDUSTRY IS AN FMP LABEL A PAGE FILTERS ON — the whole table.
 *
 * ONE ROW, BY OWNER DECISION (2026-09-22, on #517). The only industry string
 * any Pickers page presets is "Semiconductors" (/semiconductor-stocks), and a
 * SIC-only symbol would otherwise carry SEC's "Semiconductors & Related
 * Devices", which the preset does not match. Every other SIC-only symbol keeps
 * SEC's own description. A row is added here only by the same kind of decision,
 * with its source recorded, never inferred.
 */
export const SIC_INDUSTRY_LABELS: Record<string, { label: string; source: string }> = {
  "3674": {
    label: "Semiconductors",
    source:
      "owner decision 2026-09-22 (#517): SIC 3674 \"Semiconductors & Related Devices\" -> the " +
      "FMP industry label /semiconductor-stocks presets on",
  },
};
const REGISTRANTS = (registrantsFile as unknown as { rows: Record<string, RegistrantRow> }).rows ?? {};
const SIC_SECTOR = (sicSectorFile as unknown as { codes: Record<string, { sector: string | null }> }).codes ?? {};

/** The SIC leg for a symbol, or null. No I/O: both files are bundled. */
export function sicProfileFor(symbol: string): StaticProfileRow | null {
  const upper = String(symbol ?? "").trim().toUpperCase();
  // EXACT KEY, like staticProfileFor: registrants.json is keyed by the same
  // symbols as the snapshot (it is generated from them).
  const reg = REGISTRANTS[upper];
  if (!reg?.sic) return null;
  const sector = clean(SIC_SECTOR[reg.sic]?.sector);
  const industry = SIC_INDUSTRY_LABELS[reg.sic]?.label ?? clean(reg.sicDescription);
  return sector || industry ? { sector, industry } : null;
}

/**
 * Sector and industry for a symbol: cached FMP value, then snapshot, then null.
 *
 * ── THE REFRESH TRIGGER IS A LOG LINE, exactly as the CIK map's is ─────────
 * A symbol in neither leg is the event that says the snapshot needs
 * regenerating — it means something entered the universe after the snapshot was
 * taken. There is no calendar reminder and no polling, because there is nothing
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

  const snap = staticProfileFor(symbol);
  if (snap) {
    return {
      ...snap, source: "snapshot",
      sectorSource: snap.sector ? "fmp-snapshot" : "none",
      industrySource: snap.industry ? "fmp-snapshot" : "none",
    };
  }

  // THIRD, AND ONLY FOR A SYMBOL NEITHER FMP LEG KNOWS. It never overrides a
  // snapshot row, so every symbol the snapshot covers resolves exactly as it
  // did before this leg existed.
  const sic = sicProfileFor(symbol);
  if (sic) {
    return {
      ...sic, source: "sic",
      sectorSource: sic.sector ? "sic" : "none",
      industrySource: sic.industry ? "sic" : "none",
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
 *   snapshot  SNAPSHOT_AS_OF, the day data/static-profile.json was captured.
 *   sic       data/sec/registrants.json's asOf, the day the SIC code was read.
 *
 * A cache row with no parseable updatedAt yields null — never another leg's
 * date, which would credit the value to a source it did not come from.
 */
export const REGISTRANTS_SIC_AS_OF: string | null =
  (registrantsFile as unknown as { asOf?: string }).asOf ?? null;

export function classificationAsOf(
  resolved: Pick<ResolvedProfile, "source">,
  cachedUpdatedAt: string | null | undefined
): string | null {
  const day = (v: string | null | undefined) => {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
    return m ? m[1] : null;
  };
  if (resolved.source === "cache") return day(cachedUpdatedAt);
  if (resolved.source === "snapshot") return day(SNAPSHOT_AS_OF);
  if (resolved.source === "sic") return day(REGISTRANTS_SIC_AS_OF);
  return null;
}

function missLine(symbol: string): string {
  const upper = String(symbol ?? "").trim().toUpperCase();
  return (
    `[static-profile] ${upper}: no cached sector, none in data/static-profile.json and no ` +
    `SIC row in data/sec/registrants.json — regenerate registrants (relay task ` +
    `"sec-registrants", then node scripts/build-sic-sector.mjs). The card falls back to the ` +
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
        `sector, none in data/static-profile.json and no SIC row in data/sec/registrants.json — ` +
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

const COVERAGE = cikCoverage(SNAPSHOT.rows ?? {}, CIK_BY_SYMBOL);

export const CIK_MAP_SIZE: number = COVERAGE.mapSize;
export const CIK_COVERED: number = COVERAGE.covered;
/** Profiled symbols with no CIK — each one a permanently empty SEC leg. */
export const CIK_MISSING: number = COVERAGE.missing;
