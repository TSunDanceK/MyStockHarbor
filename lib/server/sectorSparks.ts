// THE /sector CARDS' 3-MONTH LINES, BUILT BY THE NIGHTLY EOD JOB (#553 COWORK
// #157, ruled in #167).
//
// The job already holds every constituent's bars in memory, so it computes the
// 11 lines there (lib/sectorSeries.ts: the cards' own method, cap-weighted over
// the same top sampled names) and stores ONE small key. The sector table reads
// it with its own build. Percentages only: no close or bar is stored here, and
// nothing reaches a public JSON route.
//
// Commands: +1 SET a night (a complete night only), +1 GET per sector-table
// build (cached 15 minutes, so at most ~96 a day).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { SECTORS } from "@/lib/sectors";
import { getSectorIndex } from "./sectorUniverse";
import { readSecTiingoCaps } from "./tiingoPool";
import { sectorSeries, type SectorSpark } from "../sectorSeries";
import { toDashed } from "../symbolSpellings.mjs";
import type { EodBar } from "./marketData/types";

export const SECTOR_SPARK_KEY = "msh:sector-spark:v1";
const SECTOR_SPARK_TTL_SECONDS = 3 * 24 * 60 * 60;
/** The cards' sample: the same top names the returns are weighted over (sectorPanels.ts). */
export const SECTOR_SPARK_SAMPLE = 25;

export type StoredSectorSparks = { asOf: string; at: number; sectors: Record<string, SectorSpark> };

/** Build the 11 lines from the night's bars. Pure apart from the index and cap reads. */
export async function buildSectorSparks(bars: Map<string, EodBar[]>, nowMs: number): Promise<StoredSectorSparks | null> {
  const index = await getSectorIndex();
  const members = Object.fromEntries(SECTORS.map((s) => [s.slug, (index.bySlug[s.slug] ?? []).slice(0, SECTOR_SPARK_SAMPLE)]));
  const caps = await readSecTiingoCaps([...new Set(Object.values(members).flat())], nowMs).catch(() => new Map<string, number | null>());
  const closesOf = (s: string) => bars.get(toDashed(s))?.map((b) => [b[0], b[4]] as const);
  const sectors: Record<string, SectorSpark> = {};
  let asOf = "";
  for (const sector of SECTORS) {
    const line = sectorSeries(members[sector.slug], closesOf, (s) => caps.get(s) ?? null);
    if (!line) continue;
    sectors[sector.slug] = line;
    if (line.to > asOf) asOf = line.to;
  }
  return Object.keys(sectors).length ? { asOf, at: nowMs, sectors } : null;
}

const readClient =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** The stored lines, read with the sector table's own build (1 GET). Null on a miss or an error; never throws. */
export async function readSectorSparks(): Promise<StoredSectorSparks | null> {
  if (!readClient) return null;
  try {
    const got = await readClient.get<StoredSectorSparks>(SECTOR_SPARK_KEY);
    return got && typeof got === "object" && got.sectors && typeof got.sectors === "object" ? got : null;
  } catch {
    return null;
  }
}

/** The job's step: build and store, never failing the job. Returns what it did, for the run summary. */
export async function writeSectorSparks(r: Redis, bars: Map<string, EodBar[]>, nowMs: number): Promise<{ sectors: number; ms: number } | { error: string }> {
  const t = Date.now();
  try {
    const built = await buildSectorSparks(bars, nowMs);
    if (!built) return { sectors: 0, ms: Date.now() - t };
    await r.set(SECTOR_SPARK_KEY, built, { ex: SECTOR_SPARK_TTL_SECONDS });
    return { sectors: Object.keys(built.sectors).length, ms: Date.now() - t };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : "unknown" };
  }
}
