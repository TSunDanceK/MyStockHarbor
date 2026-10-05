// MARKET MOOD, READ BY THE SPX PAGE (#563 COWORK #96): the stored series
// through the Data Cache, tagged MOOD_TAG so the nightly write replaces it;
// 1 GET per miss. In-process only: no route or JSON export serves it
// (scripts/check-market-mood.mjs). Null when absent or malformed, and the
// card then says the reading is unavailable rather than inventing one.
import { unstable_cache } from "next/cache";
import { Redis } from "@upstash/redis";
import { parseStoredMood, type StoredMood } from "../marketMood";
import { MOOD_TAG, TIINGO_MOOD_KEY } from "./marketData/keys";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv(PAGE_READ_CACHE) : null;

async function loadMood(): Promise<StoredMood | null> {
  if (!redis) return null;
  try {
    return parseStoredMood(await redis.get<unknown>(TIINGO_MOOD_KEY));
  } catch {
    return null;
  }
}

export const readMarketMood = unstable_cache(loadMood, ["tiingo-mood-v1"], { tags: [MOOD_TAG], revalidate: 24 * 60 * 60 });
