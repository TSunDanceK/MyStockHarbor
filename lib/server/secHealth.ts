// THE SEC PIPELINE'S NUMBERS, in aggregates only.
//
// ── WHY THIS IS NOT A MANIFEST READ ───────────────────────────────────────
// Almost everything an owner wants to know about the pipeline — how many
// symbols are populated, how deep each queue is, how many sets changed — is
// already computed by the cron, which has the manifest open anyway, and is
// already stored in its job-run record. The cache-health page reads job runs
// regardless, so those numbers cost ZERO additional commands.
//
// The manifest itself is 417 KB. Reading it here to recompute what the cron
// already counted would be the most expensive thing on a page whose stated rule
// is that every read is an aggregate and nothing scales with the universe.
//
// SO THIS MODULE READS ONLY WHAT THE CRON CANNOT KNOW: live counters that move
// between runs. Four commands, all O(1), none of them enumerating anything.
import { Redis } from "@upstash/redis";
import {
  SEC_COLD_QUEUE_KEY,
  SEC_COLD_FETCHES_PER_MINUTE,
  SEC_COLD_QUEUE_MAX,
  coldExhaustionKey,
  coldRateKey,
} from "./secColdFetch";
import { SEC_COLD_CIK_KEY, SEC_COLD_CIK_MAX } from "./secColdCik";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

export type SecHealth = {
  /** Symbols waiting for the cron to populate them. ZCARD. */
  coldQueue: number;
  coldQueueMax: number;
  /** CIKs the cold path recorded, not yet folded into the manifest. HLEN. */
  coldCikPending: number;
  coldCikMax: number;
  /**
   * Cold fetches in the CURRENT minute, against the cap.
   *
   * A SNAPSHOT OF A MOVING NUMBER, and near-zero is the expected reading: the
   * bucket resets every minute and most minutes have no cold fetch at all. It
   * is here to show the cap is live, not to be watched.
   */
  minuteFetches: number;
  minuteCap: number;
  /** Times the budget was spent, today and yesterday (UTC). */
  exhaustedToday: number;
  exhaustedYesterday: number;
  /** False when Redis is absent — rendered as "unknown", never as zero. */
  available: boolean;
};

const EMPTY: SecHealth = {
  coldQueue: 0,
  coldQueueMax: SEC_COLD_QUEUE_MAX,
  coldCikPending: 0,
  coldCikMax: SEC_COLD_CIK_MAX,
  minuteFetches: 0,
  minuteCap: SEC_COLD_FETCHES_PER_MINUTE,
  exhaustedToday: 0,
  exhaustedYesterday: 0,
  available: false,
};

/**
 * KEYS BUILT BY THE SHIPPED HELPERS, never retyped. A hand-written prefix is
 * how the first annual-filer census reported 759 of 759 symbols unpopulated: a
 * GET on a key that does not exist and a symbol that was never populated are
 * the same null, so the wrong key reads as a finding.
 */
export async function readSecHealth(): Promise<SecHealth> {
  if (!redis) return EMPTY;
  try {
    const yesterday = new Date(Date.now() - 86400000);
    const [queue, cik, minute, today, prior] = await Promise.all([
      redis.zcard(SEC_COLD_QUEUE_KEY),
      redis.hlen(SEC_COLD_CIK_KEY),
      redis.get<number>(coldRateKey()),
      redis.get<number>(coldExhaustionKey()),
      redis.get<number>(coldExhaustionKey(yesterday)),
    ]);
    return {
      coldQueue: Number(queue ?? 0),
      coldQueueMax: SEC_COLD_QUEUE_MAX,
      coldCikPending: Number(cik ?? 0),
      coldCikMax: SEC_COLD_CIK_MAX,
      minuteFetches: Number(minute ?? 0),
      minuteCap: SEC_COLD_FETCHES_PER_MINUTE,
      exhaustedToday: Number(today ?? 0),
      exhaustedYesterday: Number(prior ?? 0),
      available: true,
    };
  } catch {
    // A health panel must never be the thing that breaks the health page.
    return EMPTY;
  }
}
