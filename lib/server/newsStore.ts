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
// THE WRITES DO NOT BLOCK THE READER. Three Redis writes hang off a refresh --
// the store itself, the refresh counters and the staleness mark -- and a render
// consumes none of them: it already holds `kept` in memory before any of them
// runs. They used to be awaited in the render's critical path anyway, so every
// cold view paid three sequential Redis round trips for data nobody was waiting
// on. They now go through next/server's after().
//
// after() AND NOT A DETACHED PROMISE. A floating promise in a serverless
// function is not "background work", it is work that may be killed the instant
// the response is sent -- so the store would sometimes not be written and the
// next view would refetch, which is the failure this dataset exists to avoid.
// after() is the platform's contract for "run this, the response does not wait".
// Next 16 exports it directly; no dependency was added for it.
//
// DEPENDENCIES ARE INJECTED, not imported. lib/stock-news-data.ts owns the FMP
// request shape, the #343 similarity dedup and the earnings matcher, and it is
// the caller here -- importing any of them back would be a cycle. Passing them
// in also keeps the one implementation of dedup shared rather than copied.
import { after } from "next/server";
import {
  classifyProviderStats,
  PROVIDER_STAT_PREFIX,
  type NewsProviderStats,
} from "./news/providerStats";
import { beginTiming, timingCache } from "./timing";
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
/**
 * CONFIGURED IS NOT CONTRIBUTED, and for two days the difference was the whole
 * story.
 *
 * /cache-health said "gnews + wire + sec" the entire time GlobeNewswire was
 * being tarpitted and returning literally nothing. The panel was not lying —
 * those three ARE registered — it was answering a question nobody was asking.
 * A registered adapter that returns zero items looks exactly like a registered
 * adapter that works, and the only thing that separates them is a count.
 *
 * So the fan-out's output is attributed per provider and counted here. `fetched`
 * is the WINDOW the adapters returned, not what survived dedup and the cap:
 * "did this adapter answer with anything" is the question, and attributing
 * post-dedup survivors would mix it with "was this adapter first to the story",
 * which is a different fact and would read as a failure when a wire release is
 * correctly collapsed into the Google News copy of itself.
 *
 * Field names are prefixed so they cannot collide with the counters above if a
 * provider is ever named `itemsAdded`.
 */
async function recordRefreshStats(
  mode: NewsRefreshMode,
  added: number,
  nowMs: number,
  byProvider: Map<string, number> = new Map()
) {
  if (!redis || mode === "cached") return;

  try {
    const key = statsKey(nowMs);
    const p = redis.pipeline();
    p.hincrby(key, mode === "cold" ? "coldFetches" : "incrementalFetches", 1);
    p.hincrby(key, "itemsAdded", added);
    // EVERY ACTIVE PROVIDER, INCLUDING THE ZEROES. A provider that returned
    // nothing must still write its row, or "contributed 0" and "not registered"
    // become the same absent key — which is precisely the ambiguity this exists
    // to remove. hincrby by 0 creates the field.
    for (const [providerId, count] of byProvider) {
      p.hincrby(key, `${PROVIDER_STAT_PREFIX}${providerId}`, count);
    }
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

/**
 * Today's per-provider item counts, as a three-state result.
 *
 * The Redis read is here; the classification is in
 * lib/server/news/providerStats.ts because a harness cannot load this file —
 * see that file's header for why that mattered.
 */
export async function readNewsProviderStats(nowMs = Date.now()): Promise<NewsProviderStats> {
  return classifyProviderStats(await readNewsStats(nowMs));
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
  /**
   * Which adapter an item came from, and which adapters were asked.
   *
   * Optional because this store is generic over T and the sector/dashboard
   * callers have no reason to care. Passed as a pair rather than derived from
   * the items, because the adapters that returned NOTHING are the ones worth
   * counting and they leave no item to read an id off.
   */
  attribution?: {
    activeIds: () => string[];
    providerOf: (item: T) => string | null;
  };
};

async function readOrRefresh<T extends NewsMergeItem>(
  key: string,
  deps: RefreshDeps<T>,
  nowMs: number
): Promise<NewsRefreshResult<T>> {
  // The whole store operation, and the Redis read on its own. The pair is what
  // separates "Redis was slow" from "the adapters were slow" -- a single total
  // cannot, and that ambiguity is the reason this instrumentation exists.
  const endTotal = beginTiming("news", `store ${key}`);
  const endRead = beginTiming("news", `redisRead ${key}`);
  const stored = await readStored<T>(key);
  endRead();
  const storedItems = stored?.items ?? [];

  if (stored && nowMs - stored.fetchedAt < NEWS_REFRESH_SECONDS * 1000) {
    // THE CHEAP PATH, and the one that should dominate. A render inside the
    // refresh window makes no upstream call at all, so a measurement that does
    // not separate these from cold ones is measuring the wrong population.
    timingCache("news", `store ${key}`, "hit", `items=${storedItems.length}`);
    endTotal();
    return { items: storedItems, mode: "cached", added: 0 };
  }
  timingCache("news", `store ${key}`, "miss");

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
    endTotal();
    return { items: storedItems, mode: "cached", added: 0 };
  }

  const merged = deps.dedupe(mergeNewsItems(storedItems, fetched));
  const added = countAdded(storedItems, merged);
  const pin = deps.isEarnings ? selectEarningsPin(merged, deps.isEarnings, nowMs) : null;
  const kept = capNews(merged, pin);

  // OUT OF THE BLOCKING PATH. `kept` is already in hand; the reader needs
  // nothing these produce. Both swallow their own errors, so after() can never
  // surface a failure into the response either.
  // Counted from `fetched` (what the adapters returned this pass), seeded with
  // a zero for every active adapter so a silent one is visible as a zero rather
  // than as an absent field.
  const byProvider = new Map<string, number>();
  if (deps.attribution) {
    for (const id of deps.attribution.activeIds()) byProvider.set(id, 0);
    for (const item of fetched) {
      const id = deps.attribution.providerOf(item);
      if (id) byProvider.set(id, (byProvider.get(id) ?? 0) + 1);
    }
  }

  after(async () => {
    await writeStored(key, kept, nowMs);
    await recordRefreshStats(mode, added, nowMs, byProvider);
  });

  // ENDS BEFORE THE WRITES, deliberately: they are after() now, so counting
  // them would report a blocking cost the reader no longer pays.
  endTotal();
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
  // Deferred like the other two writes: health reporting is not something a
  // reader waits on.
  if (result.mode !== "cached") after(() => markViewed("news", upper, nowMs));

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

  if (result.mode !== "cached") after(() => markViewed("sectorNews", lower, nowMs));

  return result;
}
