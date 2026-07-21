import { Redis } from "@upstash/redis";

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
// Fix: a short (20s) Redis cache keyed by symbol, same fail-open
// @upstash/redis pattern already used across the codebase (see
// lib/server/historyCache.ts, app/api/market/route.ts), plus a per-instance
// in-flight request map so a burst of near-simultaneous requests for the
// same symbol (e.g. many visitors loading the same ticker in the same
// second, all missing the Redis cache together) collapse into a single FMP
// call instead of one each. 20s keeps quote data effectively real-time to a
// user while cutting live upstream calls dramatically for popular symbols.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const QUOTE_CACHE_PREFIX = "msh:quote:v1";
const QUOTE_CACHE_TTL_SECONDS = 20;

function getQuoteCacheKey(symbol: string) {
  return `${QUOTE_CACHE_PREFIX}:${symbol}`;
}

async function readQuoteCache(symbol: string): Promise<Quote | null> {
  if (!redis) return null;

  try {
    const cached = await redis.get<Quote>(getQuoteCacheKey(symbol));
    if (!cached || typeof cached !== "object" || cached.symbol !== symbol) return null;
    return cached;
  } catch {
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

async function fetchQuoteFromFmp(symbol: string): Promise<Quote> {
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) return emptyQuote(symbol);

  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });

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
export async function fetchQuoteSnapshot(symbolInput: string): Promise<Quote> {
  const symbol = String(symbolInput ?? "").trim().toUpperCase();
  if (!symbol) return emptyQuote(String(symbolInput ?? ""));

  const cached = await readQuoteCache(symbol);
  if (cached) return cached;

  const existing = inFlight.get(symbol);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const quote = await fetchQuoteFromFmp(symbol);
      await writeQuoteCache(symbol, quote);
      return quote;
    } finally {
      inFlight.delete(symbol);
    }
  })();

  inFlight.set(symbol, promise);
  return promise;
}
