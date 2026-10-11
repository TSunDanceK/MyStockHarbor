// THE READER VOTE'S ROUTE-ONLY CLIENT (#563 COWORK #132/#133, PR 2): the vote
// and a returning voter's live tally. No-store, so a count is never served from a
// cache. Only app/api/insights/vote imports this file: a page that reached a
// no-store client would opt out of prerendering (scripts/check-page-read-cache.mjs).
import { Redis } from "@upstash/redis";
import { PAGE_TIMEOUT_OPTS } from "./redisCacheMode";
import { VOTE_TTL_SECONDS, toTally, voteKey } from "./insightVoteStore";
import type { VoteChoice, VoteTally } from "@/lib/insightVote";

const routeRedis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv(PAGE_TIMEOUT_OPTS) : null;

/** The current tally of one window, live; null when the store can't be read. */
export async function readLiveTally(slug: string, windowId: string): Promise<VoteTally | null> {
  if (!routeRedis) return null;
  try {
    return toTally(await routeRedis.hgetall(voteKey(slug, windowId)));
  } catch (err) {
    console.error("[insight-vote] live read failed", slug, windowId, err);
    return null;
  }
}

/** Count one vote and return the window's tally after it; null when the store can't be written. */
export async function castVote(slug: string, windowId: string, choice: VoteChoice): Promise<VoteTally | null> {
  if (!routeRedis) return null;
  const key = voteKey(slug, windowId);
  try {
    const p = routeRedis.pipeline();
    p.hincrby(key, choice, 1);
    p.expire(key, VOTE_TTL_SECONDS);
    p.hgetall(key);
    const out = (await p.exec()) as unknown[];
    return toTally(out[2]);
  } catch (err) {
    console.error("[insight-vote] write failed", slug, windowId, err);
    return null;
  }
}
