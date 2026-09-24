// The "Federal contracts" record's store (Relay C, #563 COWORK #1 D5):
// the committed alias list, the universe names, USAspending fetches, and the
// one Redis key. Logic in ./capexContractsCore.
//
// SOURCE AND TERMS: USAspending.gov (federal spending data, a US government
// work; API code CC0). Displayed with attribution; recipient names come from
// SAM.gov registrations.
//
// REDIS: one key. The weekly job does 1 SET (+ the job-run stamp); the page
// does 1 GET per hourly render. About 25 commands a day, ~6 KB stored.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import type { ContractsRecord } from "./capexContractsCore";

// The page imports THIS module only; the builder (./capexContractsJob) carries
// the SEC name files and must not be pulled into the page bundle.
export const CONTRACTS_KEY = "msh:capex:contracts:v1";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export async function readContractsRecord(): Promise<ContractsRecord | null> {
  if (!redis) return null;
  try {
    const r = await redis.get<ContractsRecord>(CONTRACTS_KEY);
    return r && r.v === 1 && Array.isArray(r.rows) ? r : null;
  } catch {
    return null;
  }
}

export async function writeContractsRecord(record: ContractsRecord): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(CONTRACTS_KEY, record);
    return true;
  } catch {
    return false;
  }
}

