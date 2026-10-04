// MARKET MOOD, WRITTEN NIGHTLY (#563 COWORK #96): the tiingo-eod route hands a
// complete night's in-memory bars here (its onBars hook). One computation
// (lib/marketMood.ts), ONE SET, then revalidateTag(MOOD_TAG) so the SPX page's
// cached read picks it up. No Redis read, no Tiingo call, no history read.
//
// The stored value is computed scores by date only (no price, bar or volume),
// under msh:tiingo: like everything Tiingo-derived.
import { Redis } from "@upstash/redis";
import { revalidateTag } from "next/cache";
import { computeMarketMood, type MoodBar } from "../marketMood";
import { MOOD_TAG, TIINGO_EOD_TTL_SECONDS, TIINGO_MOOD_KEY } from "./marketData/keys";
import { uniqueEtfs } from "../curatedSymbols";
import { POOL_BENCHMARK_ETFS } from "./pricePool";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

/** The ETFs kept out of the stock tallies (52-week highs/lows, up/down volume). */
export const MOOD_EXCLUDE: readonly string[] = [...uniqueEtfs, ...POOL_BENCHMARK_ETFS];

export type MoodWrite = { mood: string; moodAsOf?: string; moodReading?: number | null; moodInputs?: number; moodMs?: number };

/** Compute and store tonight's series. Never throws into the night: the result says what happened. */
export async function writeMarketMood(bars: ReadonlyMap<string, readonly MoodBar[]>): Promise<MoodWrite> {
  if (!redis) return { mood: "skipped: no Redis" };
  const t = Date.now();
  try {
    const m = computeMarketMood(bars, MOOD_EXCLUDE);
    if (!m) return { mood: "skipped: SPY's year of bars missing" };
    await redis.set(TIINGO_MOOD_KEY, JSON.stringify(m), { ex: TIINGO_EOD_TTL_SECONDS });
    revalidateTag(MOOD_TAG, "max");
    const last = m.days[m.days.length - 1];
    return { mood: "written", moodAsOf: m.asOf, moodReading: last?.r ?? null, moodInputs: last?.n ?? 0, moodMs: Date.now() - t };
  } catch (error) {
    return { mood: `threw: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}` };
  }
}
