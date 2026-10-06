// EACH SECTOR'S NEWS TONE, KEPT FOR THE /sector CARDS (#553 COWORK #157 item 3).
//
// The tone is the score each /sector/{slug}/news page already computes
// (lib/sector-news-data.ts). Nothing stored it, so the index page could not
// show it without rebuilding all 11 -- new news reads. Now the build that
// computes it also records {label, score, at} in one small hash, and /sector
// reads the hash once per regeneration. No AI and no news call is added.
//
// Commands: at most 1 HSET per sector news build (the Data Cache keeps each
// for an hour, so <= 11 x 24 = 264 a day) and 1 HGETALL per /sector
// regeneration (ISR 30 minutes: ~48 a day). A sector with no headlines writes
// nothing; a preview writes and reads its own hash (sectorToneKey).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import type { StoredTone } from "../sectorCards";

export const SECTOR_TONE_BASE_KEY = "msh:sector-tone:v1";
/**
 * A preview reads and writes its OWN hash (#553 COWORK #166), so the chip can
 * be checked on a preview without a preview ever touching production's tones.
 */
export function sectorToneKey(env = process.env.VERCEL_ENV): string {
  return env === "preview" ? `${SECTOR_TONE_BASE_KEY}:preview` : SECTOR_TONE_BASE_KEY;
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export async function recordSectorTone(slug: string, label: string, score: number, nowMs = Date.now()): Promise<void> {
  if (!redis) return;
  try {
    await redis.hset(sectorToneKey(), { [slug]: { label, score, at: nowMs } satisfies StoredTone });
  } catch {
    // best-effort: the card omits the chip rather than show a stale one
  }
}

export async function readSectorTones(): Promise<Record<string, StoredTone>> {
  if (!redis) return {};
  try {
    return ((await redis.hgetall<Record<string, StoredTone>>(sectorToneKey())) ?? {}) as Record<string, StoredTone>;
  } catch {
    return {};
  }
}
