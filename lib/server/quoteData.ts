import { Redis } from "@upstash/redis";
import { unstable_cache } from "next/cache";
import { fmpFetch } from "./fmpUsage";
import { timingCache, beginTiming } from "./timing";
import { PAGE_READ_CACHE } from "./redisCacheMode";

export type Quote = {
  symbol: string;
  price: number | null;
  marketCap: number | null;
  name: string | null;
  pe: number | null;
  priceAvg50: number | null;
  priceAvg200: number | null;
  exchange: string | null;
  date: string | null;
  time: string | null;
  source: string;
  // Added for the trader quote-snapshot header: day range, volume vs average,
  // previous close and change. All come from the same stable/quote call
  // already being made — no extra API cost.
  open: number | null;
  previousClose: number | null;
  change: number | null;
  changePercentage: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  volume: number | null;
  avgVolume: number | null;
};

export function emptyQuote(symbol: string): Quote {
  return {
    symbol,
    price: null,
    marketCap: null,
    name: null,
    pe: null,
    priceAvg50: null,
    priceAvg200: null,
    exchange: null,
    date: null,
    time: null,
    source: "financialmodelingprep.com",
    open: null,
    previousClose: null,
    change: null,
    changePercentage: null,
    dayLow: null,
    dayHigh: null,
    yearLow: null,
    yearHigh: null,
    volume: null,
    avgVolume: null,
  };
}

// Fixed 2026-07-21: fetchQuoteSnapshot() used to hit FMP live on every
// single call with zero caching -- app/api/quote/route.ts's own comment
// called this out as "the highest-value target on the site" for exactly
// that reason. Since the BotID self-fetch fixes (see
// claude/pickers-firewall-selfblock-2026-07-17.md through
// claude/video-page-quote-selfblock-fix-2026-07-21.md) moved every
// server-rendered caller -- this route, the dashboard, video pages, and
// insight-snapshot generation -- onto this same function called in-process,
// that gap got worse, not better: four call sites now share one uncached
// upstream hit instead of one self-fetch that at least had Next's Data
// Cache in front of it sometimes.
//
// Fix: a short Redis cache keyed by symbol, same fail-open @upstash/redis
// pattern already used across the codebase (see lib/server/historyCache.ts,
// app/api/market/route.ts), plus a per-instance in-flight request map so a
// burst of near-simultaneous requests for the same symbol (e.g. many
// visitors loading the same ticker in the same second, all missing the
// Redis cache together) collapse into a single FMP call instead of one
// each. Started at 20s, raised to 60s on 2026-07-21 (owner didn't need
// updates faster than once a minute) -- cache only ever gets populated for
// symbols someone actually requests (a page view, a search, a background
// snapshot build), never a blanket prefetch of the whole ticker universe.
// PAGE_READ_CACHE: this client is on the render path of BOTH /insights/[slug]
// (via getOrCreateInsightSnapshot) and /insights/videos/[videoId] (via
// getVideoStockData), so a bare client's no-store hint would reach the renderer
// directly.
//
// This note used to end "does NOT by itself make either route safe to
// prerender", because the FMP fetch below still issued a literal no-store call
// on a cache miss and no Redis client option can fix that. That is now handled:
// both of those call sites go through fetchQuoteSnapshotForRender, whose FMP
// fetch is wrapped in unstable_cache. The bare no-store call remains, reached
// only from /api/quote, which is force-dynamic.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const QUOTE_CACHE_PREFIX = "msh:quote:v1";
const QUOTE_CACHE_TTL_SECONDS = 60;

function getQuoteCacheKey(symbol: string) {
  return `${QUOTE_CACHE_PREFIX}:${symbol}`;
}

async function readQuoteCache(symbol: string): Promise<Quote | null> {
  if (!redis) {
    timingCache("quote", "redis", "skip", "no-credentials");
    return null;
  }

  try {
    const cached = await redis.get<Quote>(getQuoteCacheKey(symbol));
    if (!cached || typeof cached !== "object" || cached.symbol !== symbol) {
      // A miss here means the next step is a live FMP call. That is the
      // distinction the whole measurement exists for -- QUOTE_CACHE_TTL_SECONDS
      // is 60, so at the dashboard's render rate this may miss most of the time.
      timingCache("quote", "redis", "miss", symbol);
      return null;
    }
    timingCache("quote", "redis", "hit", symbol);
    return cached;
  } catch {
    timingCache("quote", "redis", "miss", `${symbol} threw`);
    return null;
  }
}

async function writeQuoteCache(symbol: string, quote: Quote) {
  if (!redis) return;

  try {
    await redis.set(getQuoteCacheKey(symbol), quote, { ex: QUOTE_CACHE_TTL_SECONDS });
  } catch {
    // fail open -- a cache write failure shouldn't affect the response
  }
}

// Per-instance map of in-flight fetches, keyed by normalized symbol.
const inFlight = new Map<string, Promise<Quote>>();

async function fetchQuoteFromFmpUncached(symbol: string): Promise<Quote> {
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) return emptyQuote(symbol);

  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

    // NO LONGER THE BLOCKER FOR RENDER PATHS, but still a literal no-store call,
    // so read fetchQuoteFromFmpCached below before adding a caller. This
    // function is now reached directly only from /api/quote, which is
    // force-dynamic and answers Cache-Control: no-store -- the live path, and
    // supposed to be. Every render path goes through the cached wrapper, so the
    // DYNAMIC_SERVER_USAGE this comment used to warn about can no longer be
    // reached from a prerendered route.
    const res = await fmpFetch(url, { cache: "no-store", headers: { accept: "application/json" } });

    if (!res.ok) throw new Error(`FMP quote failed: ${res.status}`);

    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    const now = new Date();

    const payload: Quote = {
      symbol: str(row?.symbol) ?? symbol,
      price: num(row?.price),
      marketCap: num(row?.marketCap),
      name: str(row?.name),
      pe: num(row?.pe),
      priceAvg50: num(row?.priceAvg50),
      priceAvg200: num(row?.priceAvg200),
      exchange: str(row?.exchange),
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 19),
      source: "financialmodelingprep.com",
      open: num(row?.open),
      previousClose: num(row?.previousClose),
      change: num(row?.change),
      changePercentage: num(row?.changePercentage),
      dayLow: num(row?.dayLow),
      dayHigh: num(row?.dayHigh),
      yearLow: num(row?.yearLow),
      yearHigh: num(row?.yearHigh),
      volume: num(row?.volume),
      avgVolume: num(row?.avgVolume),
    };

    return payload;
  } catch {
    return emptyQuote(symbol);
  }
}

// Core FMP quote fetch + parse, extracted out of app/api/quote/route.ts so it
// can be called in-process (no HTTP self-fetch) by server-rendered callers
// that have no browser session -- e.g. lib/insightSnapshots.ts building a new
// Insight post's SEO snapshot. A server-to-server fetch to the public
// /api/quote route carries no browser BotID header and gets misclassified as
// bot traffic once that route is BotID-guarded (see
// claude/pickers-firewall-selfblock-2026-07-17.md for the same failure mode
// hitting /api/pickers, /api/plays, /api/bull-flags, /api/descending-triangles
// and /api/benchmarks previously -- this is that exact pattern applied here).
// app/api/quote/route.ts's GET handler calls this function too, so the public
// endpoint and any in-process caller always return identically-shaped data,
// and now share the same Redis cache + in-flight dedupe above.
/**
 * The LIVE path, unchanged: a Redis miss issues a real no-store fetch.
 *
 * /api/quote is force-dynamic and answers `Cache-Control: no-store`, so its
 * whole contract is freshness, and it is never prerendered -- the no-store call
 * cannot throw there.
 */
export async function fetchQuoteSnapshot(symbolInput: string): Promise<Quote> {
  const endTiming = beginTiming("quote", "fetchQuoteSnapshot");
  try {
    return await fetchQuoteSnapshotInner(symbolInput, fetchQuoteFromFmpUncached);
  } finally {
    endTiming();
  }
}

/**
 * The RENDER path. Same data, but the FMP call goes through unstable_cache, so
 * a page render can never reach a literal no-store fetch.
 *
 * WHY A SEPARATE ENTRY POINT rather than wrapping the fetch for everyone, which
 * is what lib/youtube.ts does for its own no-store calls. Those functions have
 * only page renders as consumers, so wrapping in place costs nothing. This
 * module has a third consumer youtube does not: /api/quote, the live endpoint.
 * unstable_cache sits IN FRONT of the 60s Redis TTL rather than replacing it, so
 * a value served from it can be written back to Redis with a fresh TTL --
 * widening the worst case from ~60s to ~120s. That is immaterial to the two
 * consumers below, whose pages are cached for 30 minutes and 24 hours, and a
 * visible regression on an endpoint that exists to be live.
 *
 * The revalidate matches QUOTE_CACHE_TTL_SECONDS deliberately: this module
 * already declares 60s as its freshness budget, so the second layer reuses that
 * number rather than inventing one.
 */
export async function fetchQuoteSnapshotForRender(symbolInput: string): Promise<Quote> {
  const endTiming = beginTiming("quote", "fetchQuoteSnapshotForRender");
  try {
    return await fetchQuoteSnapshotInner(symbolInput, fetchQuoteFromFmpCached);
  } finally {
    endTiming();
  }
}

// Same shape as getLatestYouTubeVideos / getYouTubeVideoById in lib/youtube.ts:
// an *Uncached function doing the work, and a thin unstable_cache wrapper over
// it keyed by its argument. Caching failures as well as successes is the point
// there and here -- it is what stops an FMP outage being retried on every
// render of every page.
const fetchQuoteFromFmpCached = (symbol: string): Promise<Quote> =>
  unstable_cache(
    (s: string) => fetchQuoteFromFmpUncached(s),
    ["quote-from-fmp"],
    { revalidate: QUOTE_CACHE_TTL_SECONDS, tags: ["quotes"] }
  )(symbol);

async function fetchQuoteSnapshotInner(
  symbolInput: string,
  fetchFromFmp: (symbol: string) => Promise<Quote>
): Promise<Quote> {
  const symbol = String(symbolInput ?? "").trim().toUpperCase();
  if (!symbol) return emptyQuote(String(symbolInput ?? ""));

  const cached = await readQuoteCache(symbol);
  if (cached) return cached;

  const existing = inFlight.get(symbol);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const quote = await fetchFromFmp(symbol);
      await writeQuoteCache(symbol, quote);
      return quote;
    } finally {
      inFlight.delete(symbol);
    }
  })();

  inFlight.set(symbol, promise);
  return promise;
}
