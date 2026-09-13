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
  const row = SNAPSHOT.rows?.[upper];
  if (!row) return null;
  const sector = clean(row.sector);
  const industry = clean(row.industry);
  return sector || industry ? { sector, industry } : null;
}

export type ResolvedProfile = StaticProfileRow & {
  /** Which leg answered. For logging and for the check script, not for render. */
  source: "cache" | "snapshot" | "none";
};

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
 */
export function resolveProfile(
  symbol: string,
  cached: { sector?: string | null; industry?: string | null } | null | undefined
): ResolvedProfile {
  const cachedSector = clean(cached?.sector);
  const cachedIndustry = clean(cached?.industry);
  // EITHER FIELD COUNTS AS A CACHE HIT. A row with a sector and no industry is
  // still the fresher answer for the sector, and bucketFor degrades from
  // industry to sector on its own.
  if (cachedSector || cachedIndustry) {
    return { sector: cachedSector, industry: cachedIndustry, source: "cache" };
  }

  const upper = String(symbol ?? "").trim().toUpperCase();
  const snap = staticProfileFor(upper);
  if (snap) return { ...snap, source: "snapshot" };

  console.warn(
    `[static-profile] ${upper}: no cached sector and none in data/static-profile.json — ` +
      `regenerate it (relay task "static-profile"). The card falls back to the generated ` +
      `data card and the symbol will not appear on a sector page until it is there.`
  );
  return { sector: null, industry: null, source: "none" };
}
