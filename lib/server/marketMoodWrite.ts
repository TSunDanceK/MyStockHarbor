// MARKET MOOD, WRITTEN NIGHTLY (#563 COWORK #96): the tiingo-eod route hands a
// complete night's in-memory bars here (its onBars hook). One computation
// (lib/marketMood.ts), ONE SET, then revalidateTag(MOOD_TAG) so the SPX page's
// cached read picks it up. No Redis read, no Tiingo call, no history read.
//
// The stored value is computed scores by date only (no price, bar or volume),
// under msh:tiingo: like everything Tiingo-derived.
//
// THE FIRST READING (#563 COWORK #97): until a complete night has run with this
// code, there is no stored reading. An "already-complete" run (every night,
// weekends included) therefore seeds it ONCE from the bars already stored:
// 1 GET to see it's missing, 1 GET for the universe, ~105 MGETs of 25 histories,
// the same computation, the same single SET. With a reading on file it is 1 GET.
import { Redis } from "@upstash/redis";
import { revalidateTag } from "next/cache";
import { computeMarketMood, type MoodBar } from "../marketMood";
import { MOOD_TAG, TIINGO_EOD_TTL_SECONDS, TIINGO_MOOD_KEY, TIINGO_UNIVERSE_KEY, tiingoEodKey } from "./marketData/keys";
import { parseTiingoUniverse } from "./tiingoUniverse";
import { toDashed } from "../symbolSpellings.mjs";
import { uniqueEtfs } from "../curatedSymbols";
import { POOL_BENCHMARK_ETFS } from "./pricePool";
import { JOB_REDIS_OPTS } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv(JOB_REDIS_OPTS) : null;

/** The ETFs kept out of the stock tallies (52-week highs/lows, up/down volume). */
export const MOOD_EXCLUDE: readonly string[] = [...uniqueEtfs, ...POOL_BENCHMARK_ETFS];

export type MoodWrite = { mood: string; moodAsOf?: string; moodReading?: number | null; moodInputs?: number; moodMs?: number; moodSeedReads?: number };

/** The one write: compute, SET, revalidate. */
async function store(r: Redis, bars: ReadonlyMap<string, readonly MoodBar[]>, t: number, how: string): Promise<MoodWrite> {
  const m = computeMarketMood(bars, MOOD_EXCLUDE);
  if (!m) return { mood: "skipped: SPY's year of bars missing" };
  await r.set(TIINGO_MOOD_KEY, JSON.stringify(m), { ex: TIINGO_EOD_TTL_SECONDS });
  revalidateTag(MOOD_TAG, "max");
  const last = m.days[m.days.length - 1];
  return { mood: how, moodAsOf: m.asOf, moodReading: last?.r ?? null, moodInputs: last?.n ?? 0, moodMs: Date.now() - t };
}

const failed = (error: unknown): MoodWrite => ({ mood: `threw: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}` });

/** Compute and store tonight's series. Never throws into the night: the result says what happened. */
export async function writeMarketMood(bars: ReadonlyMap<string, readonly MoodBar[]>): Promise<MoodWrite> {
  if (!redis) return { mood: "skipped: no Redis" };
  try {
    return await store(redis, bars, Date.now(), "written");
  } catch (error) {
    return failed(error);
  }
}

/** Histories read per MGET when seeding (about 2 MB a response at ~80 KB a history). */
export const SEED_MGET_CHUNK = 25;

/**
 * An already-complete night: seed the reading from the stored bars if none is
 * on file (#97), else nothing. Stops before writing anything once `deadline`
 * (epoch ms) passes, leaving it to the next run. Never throws into the night.
 */
export async function seedMarketMoodIfMissing(deadline = Infinity): Promise<MoodWrite> {
  if (!redis) return { mood: "skipped: no Redis" };
  const t = Date.now();
  try {
    if ((await redis.get<unknown>(TIINGO_MOOD_KEY)) !== null) return { mood: "on file" };
    const universe = parseTiingoUniverse(await redis.get<unknown>(TIINGO_UNIVERSE_KEY));
    if (!universe) return { mood: "seed skipped: no universe stored" };
    const symbols = [...new Set([...universe.symbols, "SPY", "TLT", "HYG", "LQD"])];
    const bars = new Map<string, MoodBar[]>();
    let reads = 2;
    for (let i = 0; i < symbols.length; i += SEED_MGET_CHUNK) {
      if (Date.now() > deadline) return { mood: "seed stopped: time (the next run tries again)", moodSeedReads: reads };
      const chunk = symbols.slice(i, i + SEED_MGET_CHUNK);
      const rows = await redis.mget<unknown[]>(...chunk.map((s) => tiingoEodKey(toDashed(s))));
      reads++;
      rows.forEach((row, k) => {
        const v = typeof row === "string" ? JSON.parse(row) : row;
        const b = (v as { bars?: MoodBar[] } | null)?.bars;
        if (Array.isArray(b) && b.length >= 30) bars.set(chunk[k], b);
      });
    }
    return { ...(await store(redis, bars, t, "seeded from the stored bars")), moodSeedReads: reads };
  } catch (error) {
    return failed(error);
  }
}
