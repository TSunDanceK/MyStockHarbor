// The "Who is spending" record's store (Relay C, #563 COWORK #1 D1). The page
// imports THIS module only; the builder (./capexSpendingJob) reads the SEC
// fact sets and must not be pulled into the page bundle.
//
// REDIS: one key. The job (daily cron, weekly rebuild) does 1 GET a day, and
// on a rebuild ~27 MGETs of fact sets (100 keys each) and 1 SET; the
// page does 1 GET per hourly render.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import type { SpendingRecord } from "./capexSpendingCore";

export const SPENDING_KEY = "msh:capex:spending:v1";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export async function readSpendingRecord(): Promise<SpendingRecord | null> {
  if (!redis) return null;
  try {
    const r = await redis.get<SpendingRecord>(SPENDING_KEY);
    return r && r.v === 1 && Array.isArray(r.sectors) ? r : null;
  } catch {
    return null;
  }
}

export async function writeSpendingRecord(record: SpendingRecord): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(SPENDING_KEY, record);
    return true;
  } catch {
    return false;
  }
}
