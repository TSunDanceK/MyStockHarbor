// News as a stored dataset: Redis is the source a page render reads, and FMP is
// touched only when the store is cold or due.
//
// Design of record: claude/news-as-stored-dataset-spec-2026-08-22.md. The
// merge/pin/cap rules live in newsMerge.ts, which imports nothing so the tests
// can exercise the real thing; this file is the I/O half.
//
// POPULATION IS LAZY, AND THAT IS THE LOAD-BEARING CONSTRAINT. First visit to a
// symbol populates it, later visits read Redis, and a symbol nobody views costs
// nothing. There is deliberately NO cron and no vercel.json entry: warming 755
// symbols of news hourly would dwarf every other consumer on the account, which
// is the opposite of the problem this solves.
//
// DEPENDENCIES ARE INJECTED, not imported. lib/stock-news-data.ts owns the FMP
// request shape, the #343 similarity dedup and the earnings matcher, and it is
// the caller here -- importing any of them back would be a cycle. Passing them
// in also keeps the one implementation of dedup shared rather than copied.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { markRefreshed } from "./stalenessQueue";
import {
  capNews,
  countAdded,
  incrementalFrom,
  mergeNewsItems,
  selectEarningsPin,
  type NewsMergeItem,
} from "./newsMerge";

// PAGE_READ_CACHE, because this client is on a PRERENDERED route's read path.
//
// This module is reached from app/stock/[symbol]/news/page.tsx, which #381's
// route table shows as SSG. @upstash/redis defaults every REST call to
// cache: "no-store", and a no-store fetch on a prerendered route throws
// DYNAMIC_SERVER_USAGE at request time -- a 500, not a fallback to dynamic.
// That is the #310 configuration, and #310 was a 3.5-hour outage.
//
// It shipped bare in #380. The reason it was not caught is that nothing checked:
// the same defect had just been found by hand in lib/youtube.ts (#383), which
// makes this the second time. scripts/check-page-read-cache.mjs now asserts the
// rule for every Redis construction in the repo, so a third is a failing check
// rather than another manual scan.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const NEWS_KEY_PREFIX = "msh:news:v1:";
const SECTOR_NEWS_KEY_PREFIX = "msh:sector-news:v1:";

/**
 * How long a stored record is served before a view triggers a refresh.
 *
 * Matches the 3600 the render path was raised to in August. That raise was a
 * mitigation for having no store at all; now that one exists it becomes the
 * genuine refresh interval, and the difference is that a view inside the window
 * now costs zero FMP calls rather than one cache-decided call.
 */
const NEWS_REFRESH_SECONDS = 60 * 60;

/**
 * MUST OUTLIVE THE PIN. The earnings pin holds an article for up to 7 days, so
 * a key TTL of 7 days or less would evict the record -- and the pin with it --
 * before the pin's own rule released it, quietly making the backstop the
 * primary rule.
 */
const NEWS_KEY_TTL_SECONDS = 8 * 24 * 60 * 60;

const STATS_KEY_PREFIX = "msh:news:v1:stats:";
const STATS_TTL_SECONDS = 8 * 24 * 60 * 60;

type StoredNews<T> = {
  items: T[];
  fetchedAt: number;
};

export type NewsRefreshMode = "cold" | "incremental" | "cached";

export type NewsRefreshResult<T> = {
  items: T[];
  mode: NewsRefreshMode;
  added: number;
};

const symbolKey = (symbol: string) => `${NEWS_KEY_PREFIX}${symbol.toUpperCase()}`;
const sectorKey = (slug: string) => `${SECTOR_NEWS_KEY_PREFIX}${slug.toLowerCase()}`;

function statsKey(nowMs: number) {
  return `${STATS_KEY_PREFIX}${new Date(nowMs).toISOString().slice(0, 10)}`;
}

/**
 * COLD AND INCREMENTAL ARE COUNTED SEPARATELY, on purpose.
 *
 * A refresh that adds zero articles on a quiet hour is healthy, so the added
 * count alone cannot tell a working store from a broken one. What distinguishes
 * them is the ratio: if cold fetches dominate, records are being missed or
 * evicted and every refresh is paying full price while the totals still look
 * unremarkable. That is the failure this instrumentation exists to make visible.
 */
async function recordRefreshStats(mode: NewsRefreshMode, added: number, nowMs: number) {
  if (!redis || mode === "cached") return;

  try {
    const key = statsKey(nowMs);
    const p = redis.pipeline();
    p.hincrby(key, mode === "cold" ? "coldFetches" : "incrementalFetches", 1);
    p.hincrby(key, "itemsAdded", added);
    p.expire(key, STATS_TTL_SECONDS);
    await p.exec();
  } catch {
    // Instrumentation must never be the reason a page fails to render.
  }
}

export async function readNewsStats(nowMs = Date.now()) {
  if (!redis) return null;
  try {
    return await redis.hgetall<Record<string, number>>(statsKey(nowMs));
  } catch {
    return null;
  }
}

async function readStored<T>(key: string): Promise<StoredNews<T> | null> {
  if (!redis) return null;
  try {
    const entry = await redis.get<StoredNews<T>>(key);
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.items)) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeStored<T>(key: string, items: T[], nowMs: number) {
  if (!redis) return;
  try {
    await redis.set(key, { items, fetchedAt: nowMs } satisfies StoredNews<T>, {
      ex: NEWS_KEY_TTL_SECONDS,
    });
  } catch {
    // A failed write costs the next view a refetch, not correctness.
  }
}

type RefreshDeps<T extends NewsMergeItem> = {
  /** `from` is null on a cold start, meaning "the endpoint's default window". */
  fetchWindow: (from: string | null) => Promise<T[]>;
  /** The #343 similarity dedup, passed in so there stays one implementation of it. */
  dedupe: (items: T[]) => T[];
  /** Whether an article qualifies for the earnings pin. Omitted for sector news, which has no pin. */
  isEarnings?: (item: T) => boolean;
};

async function readOrRefresh<T extends NewsMergeItem>(
  key: string,
  deps: RefreshDeps<T>,
  nowMs: number
): Promise<NewsRefreshResult<T>> {
  const stored = await readStored<T>(key);
  const storedItems = stored?.items ?? [];

  if (stored && nowMs - stored.fetchedAt < NEWS_REFRESH_SECONDS * 1000) {
    return { items: storedItems, mode: "cached", added: 0 };
  }

  // The anchor is the newest article HELD, not the last time we fetched. If
  // refreshes are missed for a day the window still starts from the last
  // article actually in the store, so the gap self-heals instead of being
  // stepped over.
  const from = incrementalFrom(storedItems[0]?.pubDate ?? null);
  const mode: NewsRefreshMode = from ? "incremental" : "cold";

  let fetched: T[] = [];
  try {
    fetched = await deps.fetchWindow(from);
  } catch {
    // Serve what we have. An upstream failure must not empty a populated store.
    return { items: storedItems, mode: "cached", added: 0 };
  }

  const merged = deps.dedupe(mergeNewsItems(storedItems, fetched));
  const added = countAdded(storedItems, merged);
  const pin = deps.isEarnings ? selectEarningsPin(merged, deps.isEarnings, nowMs) : null;
  const kept = capNews(merged, pin);

  await writeStored(key, kept, nowMs);
  await recordRefreshStats(mode, added, nowMs);

  return { items: kept, mode, added };
}

/**
 * Marked in the WRAPPERS, with the dataset key written out literally, rather
 * than passed into readOrRefresh as a variable.
 *
 * check-cache-health-page.mjs asserts that every registered dataset has
 * something that actually writes to its queue, and it does that by grepping for
 * the literal key. A variable satisfies the compiler and defeats the check, so
 * registering a dataset nothing ever marks would pass silently -- which is the
 * exact failure that assertion exists to catch. Two short call sites are worth
 * keeping it honest.
 */
async function markViewed(dataset: "news" | "sectorNews", member: string, nowMs: number) {
  try {
    if (dataset === "news") await markRefreshed("news", [member], nowMs);
    else await markRefreshed("sectorNews", [member], nowMs);
  } catch {
    // Health reporting is not worth failing a render for.
  }
}

export async function readOrRefreshSymbolNews<T extends NewsMergeItem>(
  symbol: string,
  deps: RefreshDeps<T>,
  nowMs = Date.now()
) {
  const upper = symbol.toUpperCase();
  const result = await readOrRefresh(symbolKey(upper), deps, nowMs);

  // Only a real refresh marks. A cached read proves the store is warm, not that
  // it is fresh, and marking on it would keep the staleness set green forever.
  if (result.mode !== "cached") await markViewed("news", upper, nowMs);

  return result;
}

export async function readOrRefreshSectorNews<T extends NewsMergeItem>(
  slug: string,
  deps: Omit<RefreshDeps<T>, "isEarnings">,
  nowMs = Date.now()
) {
  // NO EARNINGS PIN for sector news -- the spec is explicit, and pinning one
  // constituent's earnings article inside a sector feed would misrepresent it
  // as sector-wide coverage.
  const lower = slug.toLowerCase();
  const result = await readOrRefresh(sectorKey(lower), deps, nowMs);

  if (result.mode !== "cached") await markViewed("sectorNews", lower, nowMs);

  return result;
}
