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
// nothing, and a preview never writes (production's tones are what it reads).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import type { StoredTone } from "../sectorCards";

export const SECTOR_TONE_KEY = "msh:sector-tone:v1";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export async function recordSectorTone(slug: string, label: string, score: number, nowMs = Date.now()): Promise<void> {
  if (!redis || process.env.VERCEL_ENV === "preview") return;
  try {
    await redis.hset(SECTOR_TONE_KEY, { [slug]: { label, score, at: nowMs } satisfies StoredTone });
  } catch {
    // best-effort: the card omits the chip rather than show a stale one
  }
}

export async function readSectorTones(): Promise<Record<string, StoredTone>> {
  if (!redis) return {};
  try {
    return ((await redis.hgetall<Record<string, StoredTone>>(SECTOR_TONE_KEY)) ?? {}) as Record<string, StoredTone>;
  } catch {
    return {};
  }
}
