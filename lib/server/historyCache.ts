import { Redis } from "@upstash/redis";
import { markRefreshed } from "./stalenessQueue";
import { fmpFetch } from "./fmpUsage";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { timingCache, beginTiming } from "./timing";

export type Point = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type HistoryCacheEntry = {
  symbol: string;
  status: "qualified" | "non_qualified";
  checkedAt: number;
  source: "fmp";
  daily?: Point[];
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const REDIS_HISTORY_PREFIX = "msh:history:v7";
// ORDERING CONSTRAINT FOR WHOEVER RAISES THIS. Points already in Redis carrying
// a close of 0 -- written before the typeof allowlist in toFiniteNumber landed
// -- stay until their TTL expires. At 6h that self-heals within a day and needs
// no action. At 24h it does not: the blast radius of every stale zero bar
// becomes four times longer.
//
// So the order is load-bearing. Before raising this value: the parser fix must
// be LIVE, and the history namespace must be FLUSHED. Raising it first turns a
// bug that expires by itself into one that persists a day per symbol.
const REDIS_HISTORY_TTL_SECONDS = 6 * 60 * 60;
const MIN_QUALIFIED_POINTS = 30;

// The FMP "full" history endpoint is bounded to ~5 years of daily bars on
// this account's plan (roughly 1,250-1,260 trading days) regardless of what
// this app asks for -- confirmed against the actual plan, not assumed. This
// trim is a defensive ceiling in case that ever changes (a plan upgrade, or
// FMP altering the endpoint's behavior), set comfortably above the real
// 5-year window rather than at the old 5500-day (~21 year) value, which
// never actually fired and just meant every cached entry -- and therefore
// every Redis pull of it, including the bulk multi-symbol reads in
// getDailyHistoryBulk -- carried no real ceiling on its size. Also see
// app/api/history/route.ts's `days` clamp (currently 5000), the largest
// single-symbol consumer -- that clamp is about how much of the cached
// history a request is allowed to ask for, not how much gets cached.
const MAX_CACHED_HISTORY_DAYS = 1400;

const HISTORY_LOCK_PREFIX = "msh:history-lock:v1";
const HISTORY_LOCK_TTL_SECONDS = 45;

const FMP_CALL_COUNTER_PREFIX = "msh:fmp-calls:v1";
const FMP_SAFE_CALLS_PER_MINUTE = 300;
const FMP_WAIT_STEP_MS = 400;
const FMP_MAX_WAIT_MS = 20_000;

type FmpHistoricalRow = {
  date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
};

type FmpHistoricalResponse = FmpHistoricalRow[] | { Error?: string };

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return { weekday, year, month, day, hour, minute };
}

function getNextMondayOpenUtcMsFromEastern(date = new Date()) {
  const { weekday, year, month, day } = getEasternParts(date);

  const weekdayIndex =
    weekday === "Sun"
      ? 0
      : weekday === "Mon"
        ? 1
        : weekday === "Tue"
          ? 2
          : weekday === "Wed"
            ? 3
            : weekday === "Thu"
              ? 4
              : weekday === "Fri"
                ? 5
                : weekday === "Sat"
                  ? 6
                  : 0;

  const jsDate = new Date(Date.UTC(year, month - 1, day));
  const daysUntilMonday =
    weekdayIndex === 0 ? 1 : weekdayIndex === 6 ? 2 : weekdayIndex === 5 ? 3 : 0;

  jsDate.setUTCDate(jsDate.getUTCDate() + daysUntilMonday);

  const mondayYear = jsDate.getUTCFullYear();
  const mondayMonth = String(jsDate.getUTCMonth() + 1).padStart(2, "0");
  const mondayDay = String(jsDate.getUTCDate()).padStart(2, "0");

  const easternOpen = `${mondayYear}-${mondayMonth}-${mondayDay}T09:30:00-05:00`;
  return new Date(easternOpen).getTime();
}

function getRedisHistoryTtlSeconds(now = new Date()) {
  const { weekday, hour, minute } = getEasternParts(now);
  const totalMinutes = hour * 60 + minute;
  const fridayCloseMinutes = 16 * 60;

  const isFridayAfterClose = weekday === "Fri" && totalMinutes >= fridayCloseMinutes;
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  if (isFridayAfterClose || isWeekend) {
    const mondayOpenUtcMs = getNextMondayOpenUtcMsFromEastern(now);
    const diffSeconds = Math.ceil((mondayOpenUtcMs - now.getTime()) / 1000);
    return Math.max(60, diffSeconds);
  }

  return REDIS_HISTORY_TTL_SECONDS;
}

function getHistoryRedisKey(symbol: string) {
  return `${REDIS_HISTORY_PREFIX}:${String(symbol).trim().toUpperCase()}`;
}

function getHistoryLockKey(symbol: string) {
  return `${HISTORY_LOCK_PREFIX}:${String(symbol).trim().toUpperCase()}`;
}

function normalizeSymbol(symbol: string) {
  return String(symbol).trim().toUpperCase();
}

function buildFmpSymbol(symbol: string) {
  return normalizeSymbol(symbol).replace(/\./g, "-");
}

function toFiniteNumber(value: unknown) {
  // TYPEOF ALLOWLIST, matching ipoCalendar.ts, indexChanges.ts,
  // stockDataCache.ts, quoteData.ts and marketState.ts. This file was the only
  // coercion helper in lib/server/ that ran Number() first, and it was wrong for
  // it -- one file diverged from a pattern five siblings already applied.
  //
  // WHY A DENYLIST COULD NOT WORK HERE. Number() coerces far more than the empty
  // shapes anyone thinks to list. Measured, all producing a finite number from
  // something that is not a price:
  //
  //   null -> 0      "" -> 0       " " -> 0      "\n" -> 0
  //   []   -> 0      false -> 0    true -> 1     [7]  -> 7
  //
  // The last two are the reason this is an allowlist and not a longer set of
  // guards: `true` becomes a price of 1, and a single-element ARRAY becomes its
  // element -- a bar invented out of a shape that was never a number. A closed
  // form is right about the cases nobody thought of; an enumerated one is only
  // ever right about the cases someone did.
  //
  // A fake zero here is not cosmetic: it drags a 200-day mean, prints a gap on
  // the chart, and next to collapseDuplicateDates' last-wins rule it would
  // REPLACE the real bar for its date.
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// HOW OFTEN DOES THAT ACTUALLY HAPPEN?
//
// Calling the zero-bar bug "latent" was an assumption about FMP's payload, not
// a measurement -- the same shape as calling an unprobed endpoint "probably
// fine". This counts it.
//
// A counter that has fired at least once and then goes quiet is evidence. A
// counter that has never run is not
// (claude/traps/absence-needs-the-producer-to-have-run.md), which is why the
// value is reported alongside the number of rows PARSED: zero drops out of zero
// rows says nothing, zero drops out of 900k rows says the bug was genuinely
// latent.
//
// Module state, read-and-reset by the job route. Same shape as fmpUsage's
// buffer and for the same reason: this must not cost a Redis round-trip per
// parsed row.
let historyRowsParsed = 0;
let historyRowsDroppedNoClose = 0;
const historyDropSymbols = new Set<string>();
const MAX_DROP_SYMBOLS = 12;

export function readHistoryDropCounts(): {
  rowsParsed: number;
  rowsDroppedNoClose: number;
  symbols: string[];
} {
  const out = {
    rowsParsed: historyRowsParsed,
    rowsDroppedNoClose: historyRowsDroppedNoClose,
    symbols: [...historyDropSymbols],
  };
  historyRowsParsed = 0;
  historyRowsDroppedNoClose = 0;
  historyDropSymbols.clear();
  return out;
}

function parseFmpHistoricalRows(rows: FmpHistoricalRow[] | undefined, symbol = "") {
  if (!Array.isArray(rows) || rows.length === 0) return [] as Point[];

  const daily: Point[] = [];
  historyRowsParsed += rows.length;

  for (const row of rows) {
    const date = typeof row.date === "string" ? row.date.trim() : "";
    const open = toFiniteNumber(row.open);
    const close = toFiniteNumber(row.close);
    const high = toFiniteNumber(row.high);
    const low = toFiniteNumber(row.low);
    const volume = toFiniteNumber(row.volume);

    if (!date || close === null) {
      // Counted, not just skipped. Before the typeof allowlist above these rows
      // did NOT reach here -- Number(null) is 0, so they became bars priced at
      // zero. The counter is what turns "we think that never happened" into
      // something known either way.
      if (date && close === null) {
        historyRowsDroppedNoClose += 1;
        if (symbol && historyDropSymbols.size < MAX_DROP_SYMBOLS) historyDropSymbols.add(symbol);
      }
      continue;
    }

    daily.push({
      date,
      open: open ?? undefined,
      close,
      high: high ?? undefined,
      low: low ?? undefined,
      volume: volume ?? undefined,
    });
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));

  return collapseDuplicateDates(daily);
}

/**
 * One Point per calendar date. Last occurrence after the sort wins.
 *
 * WHY THIS HAS TO EXIST. Nothing upstream guarantees FMP returns one row per
 * date, and nothing downstream survives it if they do not. Every indicator in
 * this codebase reads the series POSITIONALLY -- movingAverage(closes, 200)
 * takes 200 array slots, not 200 trading days -- so a duplicated date silently
 * shifts every window by one and changes MA, RSI, MACD, Bollinger, ATR and the
 * support/resistance detector at once. Nothing throws. The chart still renders.
 * The numbers are just wrong, by an amount nobody can see
 * (claude/traps/a-visible-failure-is-not-a-harmless-one.md).
 *
 * It is a live risk TODAY, before any intraday-synthesis work: the sort above
 * has always ordered by date and never collapsed on it.
 *
 * LAST WINS, and the reason is determinism rather than a claim about which row
 * is better. Two rows for one date carry no signal about which is more correct,
 * and Array.prototype.sort is stable, so "last after the sort" is "last in
 * FMP's own response order" -- a rule that produces the same series every time
 * from the same payload. An arbitrary winner would make the same input yield
 * different indicators on different runs, which is worse than either choice.
 *
 * When a synthesised intraday bar is eventually appended, it is appended after
 * everything else and therefore wins its date here for free -- which is the
 * REPLACE semantics that work needs, arrived at without a special case. That is
 * a convenience, not the reason this exists: the guard is required whichever way
 * the today-bar probe answers.
 */
function collapseDuplicateDates(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && previous.date === point.date) {
      out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

function getMinuteBucketParts(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const minute = String(now.getUTCMinutes()).padStart(2, "0");

  return {
    bucket: `${year}${month}${day}${hour}${minute}`,
    secondsRemaining: 60 - now.getUTCSeconds(),
  };
}

function getFmpCounterKey(now = new Date()) {
  const { bucket } = getMinuteBucketParts(now);
  return `${FMP_CALL_COUNTER_PREFIX}:${bucket}`;
}

export async function reserveFmpCallSlot() {
  if (!redis) return;

  const startedAt = Date.now();

  while (true) {
    const now = new Date();
    const key = getFmpCounterKey(now);
    const { secondsRemaining } = getMinuteBucketParts(now);

    try {
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.expire(key, Math.max(2, secondsRemaining + 2));
      }

      if (current <= FMP_SAFE_CALLS_PER_MINUTE) {
        return;
      }
    } catch {
      return;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= FMP_MAX_WAIT_MS) {
      throw new Error("FMP call guard wait timeout");
    }

    await sleep(FMP_WAIT_STEP_MS);
  }
}

export async function getFmpMinuteUsage() {
  if (!redis) return 0;

  try {
    const current = await redis.get<number>(getFmpCounterKey(new Date()));
    return typeof current === "number" && Number.isFinite(current) ? current : 0;
  } catch {
    return 0;
  }
}

export async function hasFmpCapacity(requiredCalls = 1, minHeadroomCalls = 0) {
  const current = await getFmpMinuteUsage();
  return current + requiredCalls + minHeadroomCalls <= FMP_SAFE_CALLS_PER_MINUTE;
}

async function acquireHistoryLock(symbol: string) {
  if (!redis) return "no-redis";

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const key = getHistoryLockKey(symbol);

  try {
    const result = await redis.set(key, token, {
      nx: true,
      ex: HISTORY_LOCK_TTL_SECONDS,
    });

    if (result === "OK") return token;
    return null;
  } catch {
    return null;
  }
}

async function releaseHistoryLock(symbol: string, token: string | null) {
  if (!redis || !token || token === "no-redis") return;

  const key = getHistoryLockKey(symbol);

  try {
    const current = await redis.get<string>(key);
    if (current === token) {
      await redis.del(key);
    }
  } catch {
    // fail open
  }
}

async function waitForHistoryCache(symbol: string, maxWaitMs = 12_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const cached = await readHistoryEntry(symbol);
    if (cached) return cached;
    await sleep(300);
  }

  return null;
}

export async function readHistoryEntry(symbol: string) {
  const normalized = normalizeSymbol(symbol);

  if (!redis) {
    timingCache("history", "redis", "skip", "no-credentials");
    return null;
  }

  try {
    const entry = await redis.get<HistoryCacheEntry>(getHistoryRedisKey(normalized));

    // Each of these rejections means the caller falls through to a live FMP
    // fetch behind a 45s lock, with concurrent requests WAITING on it. The
    // reason is logged because "miss" and "miss because the entry was there
    // but stale-shaped" want different fixes.
    if (!entry || typeof entry !== "object") {
      timingCache("history", "redis", "miss", `${normalized} absent`);
      return null;
    }
    if (entry.symbol !== normalized) {
      timingCache("history", "redis", "miss", `${normalized} symbol-mismatch`);
      return null;
    }
    if (entry.status !== "qualified" && entry.status !== "non_qualified") {
      timingCache("history", "redis", "miss", `${normalized} status=${entry.status}`);
      return null;
    }
    if (entry.source !== "fmp") {
      timingCache("history", "redis", "miss", `${normalized} source=${entry.source}`);
      return null;
    }

    timingCache("history", "redis", "hit", normalized);
    return entry;
  } catch {
    timingCache("history", "redis", "miss", `${normalized} threw`);
    return null;
  }
}

export async function writeHistoryEntry(symbol: string, entry: HistoryCacheEntry) {
  const normalized = normalizeSymbol(symbol);

  if (!redis) return;

  try {
    await markRefreshed("dailyHistory", [normalized]);
    await redis.set(getHistoryRedisKey(normalized), entry, {
      ex: getRedisHistoryTtlSeconds(),
    });
  } catch {
    // fail open
  }
}

export async function fetchAndCacheDailyHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const fmpSymbol = buildFmpSymbol(normalized);
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    throw new Error("Missing FMP_API_KEY environment variable");
  }

  await reserveFmpCallSlot();

const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(
  fmpSymbol
)}&apikey=${encodeURIComponent(apiKey)}`;

  // `cache: "no-store"` here used to opt every route that reached this call out
  // of static rendering entirely -- the same class of bailout @upstash/redis
  // caused via its own no-store default (see lib/server/redisCacheMode.ts and
  // claude/picker-pages-isr-2026-08-20.md). It only fires on a Redis miss, so it
  // is intermittent and invisible: the route silently renders per request.
  //
  // Redis remains the real cache for this data, with its own market-aware TTL
  // (getRedisHistoryTtlSeconds). This short Next revalidate is not a second
  // cache tier of any consequence -- it exists so the call stops forcing the
  // route dynamic, and it dedupes a burst of identical misses inside one render
  // pass. It is deliberately far shorter than the Redis TTL, so Redis still
  // decides when this data is stale.
  const res = await fmpFetch(url, {
    next: { revalidate: 300 },
    headers: {
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`FMP history request failed with status ${res.status} for ${normalized}`);
  }

  const payload = (await res.json()) as FmpHistoricalResponse;

  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "Error" in payload &&
    typeof payload.Error === "string" &&
    payload.Error.trim()
  ) {
    throw new Error(`FMP history error for ${normalized}: ${payload.Error}`);
  }

  const parsed = parseFmpHistoricalRows(Array.isArray(payload) ? payload : undefined, normalized);
  const daily =
    parsed.length > MAX_CACHED_HISTORY_DAYS
      ? parsed.slice(-MAX_CACHED_HISTORY_DAYS)
      : parsed;

  if (daily.length >= MIN_QUALIFIED_POINTS) {
    const entry: HistoryCacheEntry = {
      symbol: normalized,
      status: "qualified",
      checkedAt: Date.now(),
      source: "fmp",
      daily,
    };

    await writeHistoryEntry(normalized, entry);
    return entry;
  }

  const entry: HistoryCacheEntry = {
    symbol: normalized,
    status: "non_qualified",
    checkedAt: Date.now(),
    source: "fmp",
  };

  await writeHistoryEntry(normalized, entry);
  return entry;
}

export async function getDailyHistory(symbol: string) {
  const endTiming = beginTiming("history", "getDailyHistory");
  try {
    return await getDailyHistoryInner(symbol);
  } finally {
    endTiming();
  }
}

async function getDailyHistoryInner(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = await readHistoryEntry(normalized);

  if (cached) {
    if (cached.status === "qualified" && Array.isArray(cached.daily)) {
      return cached.daily;
    }

    return [] as Point[];
  }

  const lockToken = await acquireHistoryLock(normalized);

  if (!lockToken) {
    const waited = await waitForHistoryCache(normalized);

    if (waited) {
      if (waited.status === "qualified" && Array.isArray(waited.daily)) {
        return waited.daily;
      }

      return [] as Point[];
    }
  }

  try {
    const fresh = await fetchAndCacheDailyHistory(normalized);

    if (fresh.status === "qualified" && Array.isArray(fresh.daily)) {
      return fresh.daily;
    }

    return [] as Point[];
  } finally {
    await releaseHistoryLock(normalized, lockToken);
  }
}

// Small local concurrency limiter, same shape as the one in
// pickersBuilder.ts -- kept local here rather than shared/exported so this
// module has no dependency on the picker builder. Used to cap how many
// concurrent FMP fetches getDailyHistoryBulk's cache-miss fallback can
// trigger at once (e.g. right after a Redis flush, when a large fraction
// of a 200-symbol universe could otherwise all miss simultaneously).
function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

// Batch version of getDailyHistory(): reads the whole requested symbol list's
// cached history in a single Redis round-trip instead of one individual REST
// call per symbol -- for a 200-symbol universe this was ~200 separate
// Upstash calls just to check "is this already cached" before any FMP fetch
// even happens. Only symbols that miss the bulk read (no entry yet, or a
// corrupt/unexpected entry shape) fall back to the existing single-symbol
// getDailyHistory() path, which still handles the distributed lock + FMP
// fetch + wait-for-other-request's-fetch logic exactly as before. On a warm
// cache (the common case, given the 6h TTL and the daily warm-up cron) this
// fallback runs for zero or very few symbols.
//
// This uses a Redis *pipeline* of individual GETs, not MGET. Both send the
// whole batch to Upstash as a single HTTP round-trip, so neither costs extra
// network calls -- the difference is how the reply is measured. MGET
// combines every key's value into one single command reply; on a warm cache
// with the full ~200+ symbol universe, that single reply routinely blew past
// Upstash's per-pull size ceiling (this is what triggered a "single pull
// exceeded 10MB" warning from Upstash in production). A pipeline sends the
// same N commands in one request, but Upstash measures and returns each
// command's reply separately, so no single reply is ever larger than one
// symbol's cached history -- the batch as a whole is unbounded, but no
// individual piece of it is, which is what the size ceiling actually cares
// about.
export async function getDailyHistoryBulk(
  symbols: string[]
): Promise<Map<string, Point[]>> {
  const result = new Map<string, Point[]>();

  const normalized = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))
  );
  if (!normalized.length) return result;

  if (!redis) {
    const limitNoRedis = createLimiter(10);
    await Promise.all(
      normalized.map((symbol) =>
        limitNoRedis(async () => {
          result.set(symbol, await getDailyHistory(symbol));
        })
      )
    );
    return result;
  }

  const keys = normalized.map((symbol) => getHistoryRedisKey(symbol));
  let entries: (HistoryCacheEntry | null)[] = normalized.map(() => null);

  try {
    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.get<HistoryCacheEntry | null>(key);
    }
    entries = await pipeline.exec<(HistoryCacheEntry | null)[]>();
  } catch {
    // Best-effort; every symbol just falls through to the per-symbol path.
  }

  const misses: string[] = [];

  normalized.forEach((symbol, i) => {
    const entry = entries[i];

    if (
      entry &&
      typeof entry === "object" &&
      entry.symbol === symbol &&
      (entry.status === "qualified" || entry.status === "non_qualified") &&
      entry.source === "fmp"
    ) {
      result.set(
        symbol,
        entry.status === "qualified" && Array.isArray(entry.daily) ? entry.daily : []
      );
    } else {
      misses.push(symbol);
    }
  });

  if (misses.length) {
    const limit = createLimiter(10);
    await Promise.all(
      misses.map((symbol) =>
        limit(async () => {
          result.set(symbol, await getDailyHistory(symbol));
        })
      )
    );
  }

  return result;
}

/**
 * Cache-ONLY bulk history read: the pipelined half of getDailyHistoryBulk with
 * the on-miss fetch removed. Added 2026-08-07 for the sector breadth panel,
 * which needs closes for ~20 symbols on a page render and must NEVER spend an
 * FMP call to get them -- getDailyHistoryBulk's miss path would fire up to one
 * fetch per uncached symbol, which is fine for a cron and wrong for a render.
 * Uncached symbols are simply absent from the returned map; the caller reports
 * how many it actually had.
 */
export async function getCachedDailyHistoryBulk(
  symbols: string[]
): Promise<Map<string, Point[]>> {
  const result = new Map<string, Point[]>();

  const normalized = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))
  );
  if (!normalized.length || !redis) return result;

  try {
    const pipeline = redis.pipeline();
    for (const symbol of normalized) {
      pipeline.get<HistoryCacheEntry | null>(getHistoryRedisKey(symbol));
    }

    const entries = await pipeline.exec<(HistoryCacheEntry | null)[]>();

    normalized.forEach((symbol, i) => {
      const entry = entries[i];
      if (
        entry &&
        typeof entry === "object" &&
        entry.symbol === symbol &&
        entry.status === "qualified" &&
        Array.isArray(entry.daily) &&
        entry.daily.length
      ) {
        result.set(symbol, entry.daily);
      }
    });
  } catch {
    // Best-effort: an empty map means the caller shows fewer names, not an error.
  }

  return result;
}

export async function getCachedDailyHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = await readHistoryEntry(normalized);

  if (
    cached &&
    cached.status === "qualified" &&
    Array.isArray(cached.daily)
  ) {
    return cached.daily;
  }

  return [] as Point[];
}

export async function ensureQualifiedHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = await readHistoryEntry(normalized);

  if (cached) {
    return cached.status === "qualified";
  }

  const daily = await getDailyHistory(normalized);
  return Array.isArray(daily) && daily.length >= MIN_QUALIFIED_POINTS;
}
