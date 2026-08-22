// One Redis sorted set per dataset, scored by last-refresh timestamp.
//
// Three consumers, one piece of bookkeeping (claude/cache-health-page-spec-2026-08-22.md):
//   * warm jobs claim the STALEST N instead of rotating blindly, so every FMP
//     call is spent on something that actually needed refreshing
//   * the cache health page reads coverage and staleness off the same sets with
//     O(1) aggregate commands, never a scan
//   * the byte meter (lib/server/fmpUsage.ts) sits beside it, bucketing spend
//
// A NOTE ON THE SPEC'S CITATION, because it matters for what this file is.
// The spec says "pricePool.ts already does exactly this". pricePool does the
// stalest-first BEHAVIOUR, but by `hmget`-ing every row of the universe and
// sorting in memory -- not from a sorted set. That is fine for a warm job that
// wants the rows anyway; it is exactly the scan the health page must not do.
// So this is new plumbing rather than a copy of pricePool's, and pricePool is a
// candidate to migrate onto it later rather than a template.
//
// WHY DEFERRALS GET THEIR OWN SET, which is the subtle part. The obvious way to
// defer a failing symbol is to push its score forward so it sorts to the back.
// That works for the queue and quietly corrupts the health page: the score IS
// the "last refreshed" reading, so a deferred symbol would report as freshly
// refreshed when nothing refreshed it. A delisted ticker would show green.
//
// So `score` only ever means "when this was last successfully refreshed", and
// deferral lives in a second, small sorted set scored by when the deferral
// expires. One extra Redis read per claim, and the health page keeps telling
// the truth -- including a deferred COUNT, which is itself the signal that a
// dataset has symbols nothing can refresh.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const QUEUE_PREFIX = "msh:staleness:v1";
const DEFER_PREFIX = "msh:staleness-defer:v1";

/**
 * The datasets with real bookkeeping, and the TTL each is SUPPOSED to hold to.
 *
 * `ttlSeconds` is the policy the health page judges a row against, and it is
 * per dataset on purpose: a 30-day-old profile is healthy, a 30-day-old price
 * is a fault. A single global "stale = 24h" rule would report most of this page
 * wrong (spec, "What it shows").
 *
 * This registry is the ONLY place a dataset is declared. A dataset absent from
 * here is absent from the page -- which is why the page renders a registry
 * entry with no queue as "not instrumented" rather than skipping it. An
 * uninstrumented dataset that simply does not appear is indistinguishable from
 * a healthy one, and that is the exact failure this whole page exists to end
 * (claude/traps/absence-needs-the-producer-to-have-run.md).
 */
export const DATASETS = {
  fundamentals: {
    label: "Fundamentals (market cap, P/E)",
    ttlSeconds: 60 * 60 * 26,
    note: "warm-fundamentals, hourly",
  },
  profile: {
    label: "Profile (industry, sector)",
    ttlSeconds: 60 * 60 * 24 * 30,
    note: "warm-fundamentals; effectively static, 30d is healthy",
  },
  screenerFundamentals: {
    label: "Screener fundamentals",
    ttlSeconds: 60 * 60 * 30,
    note: "warm-screener-fundamentals, daily 06:50",
  },
  pricePool: {
    label: "Price pool",
    ttlSeconds: 60 * 15,
    note: "warm-price-pool, every 3 min — NOT yet on a staleness set",
  },
  dailyHistory: {
    label: "Daily history",
    ttlSeconds: 60 * 60 * 12,
    note: "historyCache — NOT yet on a staleness set",
  },
  earnings: {
    label: "Earnings",
    ttlSeconds: 60 * 60 * 24 * 7,
    note: "warm-earnings — NOT yet on a staleness set",
  },
} as const;

export type DatasetKey = keyof typeof DATASETS;

const queueKey = (dataset: DatasetKey) => `${QUEUE_PREFIX}:${dataset}`;
const deferKey = (dataset: DatasetKey) => `${DEFER_PREFIX}:${dataset}`;

/**
 * Record that these symbols were just successfully refreshed.
 *
 * Also clears any deferral: a symbol that just worked is not failing any more.
 * Fails open and silent -- this is bookkeeping beside the real work, and a warm
 * job must never fail because its progress note did.
 */
export async function markRefreshed(
  dataset: DatasetKey,
  symbols: string[],
  atMs = Date.now()
): Promise<void> {
  if (!redis || !symbols.length) return;
  try {
    const members = symbols.map((s) => ({ score: atMs, member: s }));
    const p = redis.pipeline();
    // Upstash's zadd takes (key, ...members); chunked so one enormous warm run
    // cannot build a single oversized command.
    for (let i = 0; i < members.length; i += 500) {
      const slice = members.slice(i, i + 500);
      p.zadd(queueKey(dataset), slice[0], ...slice.slice(1));
    }
    p.zrem(deferKey(dataset), ...symbols);
    await p.exec();
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

/**
 * Register symbols that belong to this dataset but have never been refreshed.
 *
 * Scored 0 so they sort to the very front of the queue and count as stale
 * everywhere. `nx` so this can be called with the whole universe on every run
 * without ever overwriting a real refresh time with 0.
 *
 * This is what makes COVERAGE meaningful: without it the set only ever contains
 * symbols that already succeeded, so a dataset missing half the universe would
 * report 100% fresh on the half it has.
 */
export async function registerSymbols(dataset: DatasetKey, symbols: string[]): Promise<void> {
  if (!redis || !symbols.length) return;
  try {
    const p = redis.pipeline();
    for (let i = 0; i < symbols.length; i += 500) {
      const slice = symbols.slice(i, i + 500).map((s) => ({ score: 0, member: s }));
      p.zadd(queueKey(dataset), { nx: true }, slice[0], ...slice.slice(1));
    }
    await p.exec();
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

/**
 * Defer a symbol that failed, so it stops holding the front of the queue.
 *
 * THE RULE THIS IMPLEMENTS (spec, queue rule 1): a delisted ticker that always
 * fails is permanently the stalest thing in the set, so "do the stalest first"
 * silently becomes "retry the broken ones forever" and the genuinely stale tail
 * is never reached. Same treatment #337 gave profiles with no industry: mark,
 * come back in a week.
 *
 * Deliberately does NOT touch the refresh score. The symbol stays as stale as
 * it truly is, and the health page keeps reporting it as such.
 */
export async function deferSymbol(
  dataset: DatasetKey,
  symbol: string,
  seconds = 60 * 60 * 24 * 7
): Promise<void> {
  if (!redis || !symbol) return;
  try {
    await redis.zadd(deferKey(dataset), { score: Date.now() + seconds * 1000, member: symbol });
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

/**
 * The `limit` stalest symbols that are not currently deferred.
 *
 * Reads a slack window (limit + deferred count) rather than exactly `limit`, so
 * a run whose front is entirely deferred still returns real work instead of a
 * short list. Bounded: the window is capped so this can never become a scan.
 *
 * Returns [] on any failure, which degrades the caller to whatever ordering it
 * used before rather than stopping it.
 */
export async function claimStalest(
  dataset: DatasetKey,
  limit: number
): Promise<string[]> {
  if (!redis || limit <= 0) return [];
  try {
    const now = Date.now();
    // Drop expired deferrals first, so the defer set cannot grow without bound
    // and a symbol whose week is up returns to contention.
    await redis.zremrangebyscore(deferKey(dataset), 0, now);

    const deferred = new Set(
      ((await redis.zrange<string[]>(deferKey(dataset), 0, -1)) ?? []).map(String)
    );

    // Slack for the deferred entries, hard-capped so this stays O(window).
    const window = Math.min(limit + deferred.size + 25, limit * 4 + 100);
    const candidates = ((await redis.zrange<string[]>(queueKey(dataset), 0, window - 1)) ?? []).map(
      String
    );

    const out: string[] = [];
    for (const sym of candidates) {
      if (out.length >= limit) break;
      if (deferred.has(sym)) continue;
      out.push(sym);
    }
    return out;
  } catch {
    return [];
  }
}

export type DatasetHealth = {
  dataset: DatasetKey;
  label: string;
  ttlSeconds: number;
  note: string;
  /** Symbols tracked in this dataset's queue. 0 means NOT INSTRUMENTED. */
  tracked: number;
  /** Tracked symbols whose last refresh is older than this dataset's own TTL. */
  stale: number;
  /** Tracked symbols never refreshed at all (score 0). */
  never: number;
  /** Currently deferred after repeated failure. */
  deferred: number;
  /** Oldest refresh timestamp among tracked symbols, ms. Null if none. */
  oldestMs: number | null;
  instrumented: boolean;
};

/**
 * Aggregates for one dataset. Four O(log n) commands, no scan, no per-symbol
 * read -- the whole reason the queue exists in this shape.
 */
export async function readDatasetHealth(dataset: DatasetKey): Promise<DatasetHealth> {
  const def = DATASETS[dataset];
  const base: DatasetHealth = {
    dataset,
    label: def.label,
    ttlSeconds: def.ttlSeconds,
    note: def.note,
    tracked: 0,
    stale: 0,
    never: 0,
    deferred: 0,
    oldestMs: null,
    instrumented: false,
  };
  if (!redis) return base;

  try {
    const cutoff = Date.now() - def.ttlSeconds * 1000;
    const [tracked, stale, never, deferred, oldest] = await Promise.all([
      redis.zcard(queueKey(dataset)),
      // `1` excludes the never-refreshed (score 0) so the two counts do not
      // double-report the same symbols; `never` carries those separately.
      redis.zcount(queueKey(dataset), 1, cutoff),
      redis.zcount(queueKey(dataset), 0, 0),
      redis.zcard(deferKey(dataset)),
      redis.zrange<(string | number)[]>(queueKey(dataset), 0, 0, { withScores: true }),
    ]);

    const oldestScore = Array.isArray(oldest) && oldest.length >= 2 ? Number(oldest[1]) : null;
    const trackedN = Number(tracked) || 0;

    return {
      ...base,
      tracked: trackedN,
      stale: Number(stale) || 0,
      never: Number(never) || 0,
      deferred: Number(deferred) || 0,
      oldestMs: oldestScore && oldestScore > 0 ? oldestScore : null,
      instrumented: trackedN > 0,
    };
  } catch {
    return base;
  }
}

export async function readAllDatasetHealth(): Promise<DatasetHealth[]> {
  const keys = Object.keys(DATASETS) as DatasetKey[];
  return Promise.all(keys.map(readDatasetHealth));
}
