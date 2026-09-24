// THE MULTI-CLASS NEEDS-REVIEW LIST (#552 COWORK #37, addendum).
//
// A filer whose cover states its share count per class, with no plain total,
// no cited map entry and no one-for-one statement in its own filing, is
// recorded here with the reason and the classes. A daily workflow
// (.github/workflows/cover-review.yml) posts the open entries on #552 so a
// person can read the filing and, if the weights are clear, add the map row.
//
// NOTHING STICKS. An entry is only a pointer: the workflow re-reads each
// symbol's stored set and drops any that now carries a usable cover or has a
// map entry, and withClassCover deletes the field whenever it resolves a cover
// for the symbol. One hash, one field per symbol, no TTL needed because a
// resolved field is removed and an unresolved one is still true.
//
// Redis cost: one HSET per refused re-read, one HDEL per resolved multi-class
// re-read. Never on a render's read path.
import { Redis } from "@upstash/redis";
import { canWriteSecState, noteSecWriteBlocked } from "./secWriteGate";

export const SEC_COVER_REVIEW_HASH = "msh:sec:cover-review:v1";

export type CoverReviewEntry = {
  why: string;
  classes: string[];
  accession: string | null;
  at: string;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

export async function recordCoverReview(symbol: string, entry: Omit<CoverReviewEntry, "at">): Promise<void> {
  if (!redis) return;
  if (!canWriteSecState()) return noteSecWriteBlocked("cover-review");
  try {
    await redis.hset(SEC_COVER_REVIEW_HASH, { [symbol.toUpperCase()]: { ...entry, at: new Date().toISOString() } });
  } catch (err) {
    console.warn("[sec-cover-review] record failed", symbol, err);
  }
}

export async function clearCoverReview(symbol: string): Promise<void> {
  if (!redis || !canWriteSecState()) return;
  try {
    await redis.hdel(SEC_COVER_REVIEW_HASH, symbol.toUpperCase());
  } catch (err) {
    console.warn("[sec-cover-review] clear failed", symbol, err);
  }
}
