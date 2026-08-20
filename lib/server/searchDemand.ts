// lib/server/searchDemand.ts
//
// "Popular Searches" demand signal. Counts how often real users deliberately
// SELECT a ticker from a search result (fired client-side via a sendBeacon --
// see app/lib/trackTickerInterest.ts + app/api/track/ticker-interest/route.ts),
// so server-side crawlers that never run JS never contribute. This module is the
// trustworthy core: normalisation, per-caller dedup + rate-limit, and the daily
// demand ZSETs that a rolling 14-day window is summed from.
//
// Fail-open throughout (like the rest of lib/server): if Redis is missing or a
// call throws, we simply don't count -- never break a page or the beacon.
//
// Nothing here promotes symbols into the analyzed universe or renders a page;
// those read readSearchDemand() and live elsewhere. See
// claude/popular-searches-universe-spec-2026-07-23.md.

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const DAILY_PREFIX = "msh:search-demand:daily:v1:"; // + YYYYMMDD -> ZSET symbol->count
const DEDUP_PREFIX = "msh:search-demand:dedup:v1:"; // + <ipHash>:<symbol>
const RL_PREFIX = "msh:search-demand:rl:v1:"; // + <ipHash>

// One count per (caller, symbol) per this window -- stops one person refreshing
// AAPL 50 times inflating demand.
const DEDUP_TTL_SECONDS = 30 * 60;
// Rolling per-caller cap so a single IP can't flood the signal.
const RL_WINDOW_SECONDS = 60 * 60;
const RL_MAX_PER_WINDOW = 60;
// Daily ZSETs self-expire just past the 14-day read window so old days prune
// themselves without a sweep job.
const DAILY_TTL_SECONDS = 16 * 24 * 60 * 60;

export const SEARCH_DEMAND_WINDOW_DAYS = 14;

// Cheap non-crypto hash so we key on a short digest instead of storing raw IPs.
function ipHash(ip: string): string {
  let h = 5381;
  for (let i = 0; i < ip.length; i++) {
    h = ((h << 5) + h + ip.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// UTC day bucket key, `offsetDays` back from today. (Runs in the Vercel runtime,
// where Date is available -- unlike the workflow sandbox.)
function dayKey(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${DAILY_PREFIX}${y}${m}${day}`;
}

// Format-only, equity-only normalisation. The symbol arrives from a user picking
// a real FMP search result, so it's already a valid ticker; this just cleans it
// and rejects tampering / crypto / derivatives. Returns null if unusable.
export function normaliseTicker(raw: unknown): string | null {
  const symbol = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");

  if (!symbol) return null;
  if (symbol.length > 10) return null;
  // Crypto pairs (BTCUSD/ETHUSD etc.) are excluded -- equities only.
  if (/USD$/.test(symbol) && symbol.length >= 6) return null;
  // Derivative-ish symbols (warrants/units/rights) -- mirrors symbolSearch.ts's
  // isDerivativeSymbol: contains "-" or a 5-char ticker ending W/U/R.
  if (symbol.includes("-")) return null;
  if (symbol.length === 5 && /[WUR]$/.test(symbol)) return null;

  return symbol;
}

// Records one deliberate ticker selection from `ip`. Applies dedup + rate-limit
// and, if the increment survives both, bumps today's demand ZSET. Returns
// whether it actually counted (callers can ignore it -- the beacon does).
export async function recordTickerInterest(
  rawSymbol: unknown,
  ip: string
): Promise<{ counted: boolean }> {
  if (!redis) return { counted: false };

  const symbol = normaliseTicker(rawSymbol);
  if (!symbol) return { counted: false };

  const ih = ipHash(ip || "unknown");

  try {
    // Per-(caller,symbol) dedup: SET NX -- if the key already exists this
    // caller counted this symbol recently, so skip.
    const firstThisWindow = await redis.set(`${DEDUP_PREFIX}${ih}:${symbol}`, 1, {
      nx: true,
      ex: DEDUP_TTL_SECONDS,
    });
    if (firstThisWindow !== "OK") return { counted: false };

    // Per-caller rolling rate-limit.
    const rlKey = `${RL_PREFIX}${ih}`;
    const used = await redis.incr(rlKey);
    if (used === 1) await redis.expire(rlKey, RL_WINDOW_SECONDS);
    if (used > RL_MAX_PER_WINDOW) return { counted: false };

    // Count it against today's bucket.
    const key = dayKey(0);
    await redis.zincrby(key, 1, symbol);
    await redis.expire(key, DAILY_TTL_SECONDS);

    return { counted: true };
  } catch {
    // fail open -- a dropped count is never worth surfacing an error.
    return { counted: false };
  }
}

// Sums the last SEARCH_DEMAND_WINDOW_DAYS daily ZSETs into a single ranked list.
// One pipelined round-trip reads every day's ZSET; merged + sorted in-process.
// Members are bounded by distinct searched tickers, so this stays small; the
// page/universe callers cache their reads on top of this.
export async function readSearchDemand(
  limit = 50
): Promise<Array<{ symbol: string; score: number }>> {
  if (!redis) return [];

  try {
    const keys: string[] = [];
    for (let i = 0; i < SEARCH_DEMAND_WINDOW_DAYS; i++) keys.push(dayKey(i));

    const pipe = redis.pipeline();
    for (const key of keys) pipe.zrange(key, 0, -1, { withScores: true });
    const results = (await pipe.exec()) as Array<Array<string | number> | null>;

    const totals = new Map<string, number>();
    for (const flat of results) {
      if (!Array.isArray(flat)) continue;
      // withScores returns a flat [member, score, member, score, ...] array.
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const member = String(flat[i]);
        const score = Number(flat[i + 1]);
        if (!member || !Number.isFinite(score)) continue;
        totals.set(member, (totals.get(member) ?? 0) + score);
      }
    }

    return Array.from(totals.entries())
      .map(([symbol, score]) => ({ symbol, score }))
      .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
      .slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}
