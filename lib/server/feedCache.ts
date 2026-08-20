// Shared read path for the small FMP-backed calendar feeds (`ipoCalendar`,
// `indexChanges`) whose pages are a single list and nothing else.
//
// Why this exists
// ---------------
// Both feeds previously returned a bare `T[]`, which cannot express failure.
// A swallowed fetch error, a missing FMP_API_KEY and a genuinely empty market
// all arrived at the page as `[]`, so the page asserted "nothing scheduled" in
// every case. Observed in production 2026-08-20: /upcoming-ipos rendered "No
// confirmed IPOs are currently scheduled in the next 30 days" AND "No
// confirmed IPOs listed in the last 30 days" on a cold instance; an immediate
// reload showed 2 upcoming and 12+ recent. See claude/silent-failure-traps.md.
//
// Three things are fixed here together, because fixing any one alone still
// leaves the page lying:
//
// 1. `Feed<T>` carries `ok`, so an empty list can be distinguished from a
//    failed read at every call site. This is the root fix -- the other two are
//    only reachable once the type can say "I don't know".
// 2. Every degradation logs unconditionally via console.*, NOT via
//    lib/server/timing.ts. Those helpers are gated on MSH_TIMING === "1",
//    which is not set in production, so routing this through them would leave
//    the failure exactly as invisible as it was.
// 3. The cache is Redis-backed as well as in-process. The old cache was a
//    module-level object, so it died with the lambda instance: every cold
//    start re-fetched, and any failure on that first request rendered empty
//    with no warm copy to fall back on. Redis makes the warm copy survive
//    instance recycling, which is what makes stale-on-error actually reachable
//    rather than theoretical.

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

// Where the items came from. Only `unavailable` means "we have no idea what
// the real answer is" -- `stale` still carries real upstream data, just old.
export type FeedSource = "fresh" | "memory" | "redis" | "stale" | "unavailable";

export type Feed<T> = {
  items: T[];
  // True when `items` reflects a real answer from upstream at some point.
  // False ONLY when the read failed and there was no cached copy to serve, in
  // which case `items` is [] and means nothing. A page must not describe an
  // empty list as "nothing scheduled" unless this is true.
  ok: boolean;
  source: FeedSource;
};

type Entry<T> = { at: number; items: T[] };

const memory: Record<string, Entry<unknown>> = {};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const REDIS_PREFIX = "msh:feed";

// How long a cached copy is considered fresh enough to serve without
// re-fetching.
const FRESH_MS = 30 * 60_000;

// How long a copy is retained in Redis for stale-on-error use. Much longer
// than FRESH_MS on purpose: after FRESH_MS the entry stops being served
// directly, but staying in Redis is what lets a failed fetch degrade to real
// (if old) data instead of to an empty page.
const STALE_TTL_SECONDS = 24 * 60 * 60;

function isFresh(entry: Entry<unknown> | undefined): boolean {
  return !!entry && Date.now() - entry.at < FRESH_MS;
}

async function readRedis<T>(key: string): Promise<Entry<T> | undefined> {
  if (!redis) return undefined;
  try {
    const value = await redis.get<Entry<T>>(`${REDIS_PREFIX}:${key}`);
    if (value && Array.isArray(value.items) && typeof value.at === "number") {
      return value;
    }
    return undefined;
  } catch (err) {
    // A Redis outage must degrade to the direct fetch, never break the page.
    console.error(`[feed:${key}] redis read failed:`, err);
    return undefined;
  }
}

async function writeRedis<T>(key: string, entry: Entry<T>): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(`${REDIS_PREFIX}:${key}`, entry, { ex: STALE_TTL_SECONDS });
  } catch (err) {
    console.error(`[feed:${key}] redis write failed:`, err);
  }
}

/**
 * Read a feed through memory -> Redis -> upstream, degrading to stale data and
 * then to an explicit `ok: false` rather than to a silent empty list.
 *
 * `fetchItems` should throw on any failure (non-ok status, missing API key,
 * parse failure). Throwing is how it reports "I could not answer"; returning
 * [] means "upstream says there are genuinely none", and the two are treated
 * as the different things they are.
 */
export async function readFeed<T>(
  key: string,
  fetchItems: () => Promise<T[]>
): Promise<Feed<T>> {
  const mem = memory[key] as Entry<T> | undefined;
  if (isFresh(mem)) {
    return { items: mem!.items, ok: true, source: "memory" };
  }

  const stored = await readRedis<T>(key);
  if (isFresh(stored)) {
    memory[key] = stored as Entry<unknown>;
    return { items: stored!.items, ok: true, source: "redis" };
  }

  // Freshest real data available if the fetch below fails. Both may be stale;
  // prefer whichever is newer.
  const fallback =
    mem && stored ? (mem.at >= stored.at ? mem : stored) : mem ?? stored;

  try {
    const items = await fetchItems();
    const entry: Entry<T> = { at: Date.now(), items };
    memory[key] = entry as Entry<unknown>;
    await writeRedis(key, entry);
    return { items, ok: true, source: "fresh" };
  } catch (err) {
    if (fallback) {
      const ageMin = Math.round((Date.now() - fallback.at) / 60_000);
      console.error(
        `[feed:${key}] upstream read failed, serving stale copy ${ageMin}m old:`,
        err
      );
      return { items: fallback.items, ok: true, source: "stale" };
    }

    // The case that produced the production bug: cold instance, no cached
    // copy, failed read. Previously this returned [] and the page asserted
    // the market was empty. It is now loud, and the caller can tell.
    console.error(
      `[feed:${key}] upstream read failed with NO cached copy -- page will ` +
        `render as unavailable, not empty:`,
      err
    );
    return { items: [], ok: false, source: "unavailable" };
  }
}

/**
 * Log when a feed reports a successful-but-empty result that is almost
 * certainly not a real empty. Some windows are effectively never empty in
 * reality (e.g. "IPOs that listed in the last 30 days"), so an empty one is a
 * free monitor for an upstream problem that did not surface as an error --
 * a parser drifting off FMP's field names, or a silently changed schema.
 *
 * Gated on source === "fresh" deliberately. The interesting event is the
 * upstream READ returning nothing, which happens once per cache fill; a
 * memory or Redis hit just replays that same answer. Without the gate a
 * genuinely empty window logs on every page view for the life of the cache
 * entry, which buries the signal in its own repetition and makes the log
 * volume a function of traffic rather than of anything going wrong.
 *
 * `stale` is excluded for the same reason -- it is a replay of an older read,
 * and its failure was already logged loudly by readFeed when it happened.
 */
export function warnIfImplausiblyEmpty(feed: Feed<unknown>, key: string, why: string): void {
  if (feed.ok && feed.source === "fresh" && feed.items.length === 0) {
    console.warn(`[feed:${key}] upstream read returned an EMPTY list. ${why}`);
  }
}
