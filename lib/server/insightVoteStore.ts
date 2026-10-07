// THE READER VOTE'S STORE (#563 COWORK #132/#133, PR 2). One hash per post per
// window, three counters (higher / sideways / lower). Nothing else is stored:
// no IP, no user id; one-vote-per-window is the browser cookie (lib/insightVote.ts).
//
// COMMANDS:
//   a page render          0   the page never reads a tally; the card asks only
//                              after a vote, or when the cookie says this browser
//                              voted in the current window
//   the page data refill   1   HGETALL of the closed window, for "how readers
//                              called it" (cached with the page, 6 h)
//   a vote                 3   HINCRBY + EXPIRE + HGETALL, one pipelined round trip
//   a returning voter      1   HGETALL
//
// PREVIEWS VOTE INTO THEIR OWN KEYS. A preview renders the same card, and Cowork
// tries it there; a reviewer's click is not a reader's read, so anything but
// production writes under VOTE_PREVIEW_PREFIX and never touches the real tallies.
import { Redis } from "@upstash/redis";
import { isProductionDeployment } from "./deployTarget";
import { PAGE_READ_CACHE, PAGE_TIMEOUT_OPTS } from "./redisCacheMode";
import { EMPTY_TALLY, isVoteChoice, type VoteChoice, type VoteTally } from "@/lib/insightVote";

export const VOTE_PREFIX = "msh:insights:vote:v1:";
export const VOTE_PREVIEW_PREFIX = "msh:insights:vote:preview:v1:";
/** A window lasts about a quarter; a closed one is read for one more window, then left to expire. */
export const VOTE_TTL_SECONDS = 400 * 24 * 60 * 60;

const configured = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
/** The page's read of a CLOSED window (stable until the next report): the prerender-safe cache mode. */
const pageRedis = configured ? Redis.fromEnv(PAGE_READ_CACHE) : null;
/** The route's vote and live tally: no-store, so a count is never served from a cache. */
const routeRedis = configured ? Redis.fromEnv(PAGE_TIMEOUT_OPTS) : null;

export const voteKey = (slug: string, windowId: string, production = isProductionDeployment()) =>
  `${production ? VOTE_PREFIX : VOTE_PREVIEW_PREFIX}${slug}:${windowId}`;

export function toTally(raw: unknown): VoteTally {
  const t = { ...EMPTY_TALLY };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(v);
      if (isVoteChoice(k) && Number.isFinite(n) && n > 0) t[k] = Math.floor(n);
    }
  }
  return t;
}

/**
 * One window's tally; null when the store can't be read (never a made-up zero).
 * `live` is the route's read (no-store); the page reads a closed window through the cache.
 */
export async function readVoteTally(slug: string, windowId: string, live = false): Promise<VoteTally | null> {
  const redis = live ? routeRedis : pageRedis;
  if (!redis) return null;
  try {
    return toTally(await redis.hgetall(voteKey(slug, windowId)));
  } catch (err) {
    console.error("[insight-vote] read failed", slug, windowId, err);
    return null;
  }
}

/** Count one vote and return the window's tally after it; null when the store can't be written. */
export async function castVote(slug: string, windowId: string, choice: VoteChoice): Promise<VoteTally | null> {
  const redis = routeRedis;
  if (!redis) return null;
  const key = voteKey(slug, windowId);
  try {
    const p = redis.pipeline();
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

/** The results-announcement dates on a stored report-dates record (newest first as stored). */
export const announcedDates = (rec: { events?: { announcedOn?: string | null }[] } | null | undefined): string[] =>
  (rec?.events ?? []).map((e) => e.announcedOn ?? "").filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
