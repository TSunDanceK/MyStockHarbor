// WHAT THE STOCK PAGE MAY ASK ABOUT A COLD SYMBOL, WITHOUT REACHING TIINGO
// (#553 COWORK #121/#122/#123).
//
// A "cold" symbol is a real ticker (on Tiingo's supported list) that we hold no
// Tiingo data for. The page renders "Price data for X is being prepared" for
// it, and the cold-fill server action fills it after hydration. This module is
// the part the RENDER may import: Redis reads and the requested/queue writes,
// no adapter import (scripts/check-tiingo-callers.mjs). The one Tiingo call
// lives in lib/server/marketData/coldFill.ts, behind the action's gates.
//
// FAILS CLOSED FOR SPENDING, OPEN FOR THE PAGE. An unreadable supported list
// means "not a cold candidate": the page keeps its existing path (the FMP leg
// while there is one, else the honest "no data" page) and nothing is fetched.
import { cache } from "react";
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import {
  TIINGO_COLD_COUNTER_PREFIX,
  TIINGO_COLD_NODATA_KEY,
  TIINGO_COLD_QUEUE_KEY,
  TIINGO_REQUESTED_KEY,
  TIINGO_SUPPORTED_KEY,
  TIINGO_SUPPORTED_MARKER,
} from "./marketData/keys";
import { readTiingoHistory } from "./marketData/read";
import { priceProviderFor } from "./marketData/provider";
import { toDashed } from "../symbolSpellings.mjs";
import companyNameSnapshot from "@/data/company-names.json";
import { priorityStocks, uniqueEtfs } from "../curatedSymbols";

// PAGE_READ_CACHE: the stock page imports this, and a bare client in a
// prerenderable page's graph opts it out of static rendering
// (check-page-read-cache), as in secColdFill.ts.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ ...PAGE_READ_CACHE, retry: { retries: 1, backoff: () => 50 } })
    : null;

// ── the owner's figures (#553 COWORK #121 §3/§4, #123) ──────────────────────
/** Cold fills the whole site may make in an hour / a UTC day (1 Tiingo request each). */
export const COLD_FILLS_PER_HOUR = 500;
export const COLD_FILLS_PER_DAY = 3_000;
/**
 * The day cap in force: COLD_FILLS_PER_DAY, or TIINGO_COLD_FILL_DAY_CAP when
 * set to a whole number (0 included). For the preview acceptance ("with the cap
 * forced to 0 the page says being prepared", COWORK #121) and as an owner-side
 * brake; it can only be set by an env change and a redeploy.
 */
export function coldFillsPerDay(env: Record<string, string | undefined> = process.env): number {
  const v = env.TIINGO_COLD_FILL_DAY_CAP;
  if (v == null || v.trim() === "") return COLD_FILLS_PER_DAY;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : COLD_FILLS_PER_DAY;
}
/**
 * Requests the whole site may put to BotID deep analysis in a UTC day, counted
 * BEFORE it (billed per call, ~$1 per 1,000). Matches the fills cap.
 */
export const COLD_ATTEMPTS_PER_DAY = 3_000;
/** Symbols the queue may take in a UTC day (crawlers, capped visitors, timeouts). */
export const COLD_QUEUE_ADDS_PER_DAY = 500;
/** The requested set: at most this many symbols, least recently viewed evicted first. */
export const REQUESTED_CAP = 1_000;
/** ...and a symbol unviewed this long drops out (the jobs stop refreshing it). */
export const REQUESTED_IDLE_DAYS = 30;
/** One symbol's fill holds its lock this long: the 3 s fetch plus the write, with room. */
export const COLD_LOCK_SECONDS = 20;
/** The fetch's own budget (#121 §1). */
export const COLD_FETCH_TIMEOUT_MS = 3_000;

/** Tickers only, as the stock routes accept. */
export const COLD_SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;

/** The words the page shows while a cold symbol is filled or queued (#121 §3, owner-kept in #123). */
export function preparingWords(symbol: string): string {
  return `Price data for ${symbol} is being prepared; it may take a few minutes.`;
}

export const coldCounterKey = (name: string, period: string) => `${TIINGO_COLD_COUNTER_PREFIX}${name}:${period}`;
export const coldLockKey = (symbol: string) => `${TIINGO_COLD_COUNTER_PREFIX}lock:${symbol}`;
const dayOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);
const hourOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 13);
export { dayOf as coldDay, hourOf as coldHour };

/** Our dashed, upper-case spelling: the jobs' and the stored keys' form. */
export const coldSymbol = (s: string) => toDashed(String(s ?? "").trim().toUpperCase());

/**
 * THE COMMITTED UNIVERSE: every symbol with a stock page by the site's own
 * lists (company-names.json + curatedSymbols), the same two lists as
 * tiingoUniverse.ts's STOCK_PAGE_SYMBOLS. Read here from the files rather than
 * imported, because that module holds a bare Redis client (see above). The
 * jobs refresh these anyway, so a view of one needs no "requested" touch.
 */
const UNIVERSE = new Set(
  [
    ...Object.keys((companyNameSnapshot as { rows?: Record<string, string> }).rows ?? {}),
    ...priorityStocks,
    ...uniqueEtfs,
  ].map(coldSymbol)
);
export function inCommittedUniverse(symbol: string): boolean {
  return UNIVERSE.has(coldSymbol(symbol));
}

export type SupportedState = "yes" | "no" | "no-list" | "no-data" | "error";

/**
 * Is this a real ticker we may cold-fill? One pipeline of 2: SMISMEMBER on the
 * supported list (the symbol and the list's marker, so a missing list reads
 * "no-list", not "no") and SISMEMBER on the no-data set.
 */
export async function supportedState(symbol: string): Promise<SupportedState> {
  if (!redis) return "error";
  const sym = coldSymbol(symbol);
  try {
    const p = redis.pipeline();
    p.smismember(TIINGO_SUPPORTED_KEY, [TIINGO_SUPPORTED_MARKER, sym]);
    p.sismember(TIINGO_COLD_NODATA_KEY, sym);
    const [both, nodata] = (await p.exec()) as [number[], number];
    if (!Array.isArray(both) || Number(both[0]) !== 1) return "no-list";
    if (Number(both[1]) !== 1) return "no";
    return Number(nodata) === 1 ? "no-data" : "yes";
  } catch {
    return "error";
  }
}

/**
 * THE RENDER'S QUESTION, once per request (React cache): should this page show
 * "being prepared" and mount the cold fill, rather than take the FMP leg or the
 * "no data" page? Only on the Tiingo stock-page path, only with no stored
 * history, and only for a supported ticker Tiingo has not answered empty for.
 * Costs nothing extra for a symbol we hold (the history read is the page's own,
 * Data-Cached); a cold one adds the 2-command pipeline above.
 */
export const isColdTiingoCandidate = cache(async (symbol: string): Promise<boolean> => {
  if (priceProviderFor("STOCK_PAGE") !== "tiingo") return false;
  const sym = coldSymbol(symbol);
  if (!COLD_SYMBOL.test(sym)) return false;
  const stored = await readTiingoHistory(sym).catch(() => null);
  if (stored?.bars?.length) return false;
  return (await supportedState(sym)) === "yes";
});

async function bump(key: string, ttlSeconds: number): Promise<number | null> {
  if (!redis) return null;
  try {
    const p = redis.pipeline();
    p.incr(key);
    p.expire(key, ttlSeconds, "NX");
    const [n] = (await p.exec()) as [number, number];
    return Number.isFinite(Number(n)) ? Number(n) : null;
  } catch {
    return null;
  }
}

/** This UTC day's BotID attempts, INCLUDING this one; null (fail closed) on any error. 2 commands. */
export const countColdAttempt = (nowMs = Date.now()) => bump(coldCounterKey("attempts", dayOf(nowMs)), 25 * 3600);

/** This hour's and day's fills, INCLUDING this one; null (fail closed) on any error. 4 commands. */
export async function countColdFill(nowMs = Date.now()): Promise<{ hour: number | null; day: number | null }> {
  const [hour, day] = await Promise.all([
    bump(coldCounterKey("fills-h", hourOf(nowMs)), 2 * 3600),
    bump(coldCounterKey("fills-d", dayOf(nowMs)), 25 * 3600),
  ]);
  return { hour, day };
}

/**
 * Queue a symbol for tiingo-cold-queue. Capped at COLD_QUEUE_ADDS_PER_DAY new
 * entries a day (a repeat costs no slot: ZADD NX answers 0 and is not counted
 * against the cap). 3 commands; never throws. Returns whether it is queued.
 */
export async function queueColdSymbol(symbol: string, nowMs = Date.now()): Promise<boolean> {
  if (!redis) return false;
  const sym = coldSymbol(symbol);
  try {
    const already = await redis.zscore(TIINGO_COLD_QUEUE_KEY, sym);
    if (already != null) return true;
    const n = await bump(coldCounterKey("queued", dayOf(nowMs)), 25 * 3600);
    if (n == null || n > COLD_QUEUE_ADDS_PER_DAY) return false;
    await redis.zadd(TIINGO_COLD_QUEUE_KEY, { nx: true }, { score: nowMs, member: sym });
    return true;
  } catch {
    return false;
  }
}

/**
 * A view of a requested symbol keeps it in the set (#121 §4: it drops out after
 * REQUESTED_IDLE_DAYS without one). ZADD XX GT: a no-op for anything not in the
 * set, never moves a score back. 1 command; never throws.
 */
export async function touchRequested(symbol: string, nowMs = Date.now()): Promise<void> {
  if (!redis) return;
  try {
    await redis.zadd(TIINGO_REQUESTED_KEY, { xx: true, gt: true }, { score: nowMs, member: coldSymbol(symbol) });
  } catch {
    // A missed touch only brings the 30-day expiry a view earlier.
  }
}

/** Has the symbol been stored, or answered empty, since? The client's poll. 1 pipeline of 2. */
export async function coldSettled(symbol: string, eodKey: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const p = redis.pipeline();
    p.exists(eodKey);
    p.sismember(TIINGO_COLD_NODATA_KEY, coldSymbol(symbol));
    const [e, n] = (await p.exec()) as [number, number];
    return Number(e) === 1 || Number(n) === 1;
  } catch {
    return false;
  }
}

/** The per-symbol lock (SET NX EX). False on contention or any error. */
export async function takeColdLock(symbol: string): Promise<boolean> {
  if (!redis) return false;
  try {
    return (await redis.set(coldLockKey(coldSymbol(symbol)), "1", { nx: true, ex: COLD_LOCK_SECONDS })) === "OK";
  } catch {
    return false;
  }
}

export async function releaseColdLock(symbol: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(coldLockKey(coldSymbol(symbol)));
  } catch {
    // It lapses on its own in COLD_LOCK_SECONDS.
  }
}
