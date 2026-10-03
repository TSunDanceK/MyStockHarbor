// THE STOCK-PAGE COLD FILL: THE ONE TIINGO CALLER BESIDES THE JOBS
// (#553 COWORK #121/#122/#123; owner-approved change to COWORK #56 rule 1).
//
// scripts/check-tiingo-callers.mjs holds the graph: this module may import the
// adapter, and only two files may import this one -- the stock page's server
// action (app/stock/[symbol]/tiingoColdFillAction.ts) and the tiingo-cold-queue
// job route. No render reaches it: the page reads lib/server/tiingoColdState.ts.
//
// ── THE GATE, CHEAPEST FIRST, THE PAID CHECK LATE (coldFillGate) ──────────
//   1. page token and symbol shape                 CPU
//   2. not already stored                          (the page's own read)
//   3. on Tiingo's supported list, not "no data"   1 pipeline of 2
//   4. the visitor's 20 new tickers a day          coldVisitorCap.ts, 3
//   5. the site's BotID attempts today (3,000)     2
//   6. BotID deep analysis: any bot is refused     paid; /stock/* POST is deep
//   7. the site's fills this hour / day (500/3,000) 4
//   8. the per-symbol lock                         1
// Refusals at 4-7 QUEUE the symbol for tiingo-cold-queue (every 10 minutes,
// around the clock), so the page's "being prepared" words stay true. A crawler
// is refused at 6 and queued: it never spends the budget (#122).
//
// ── THE FILL ─────────────────────────────────────────────────────────────
// One reserved request through the shared limiter (the "cold-fill" path, the
// only one also allowed on Preview), one CSV of the stored window, a 3 s
// budget. Stored exactly as the nightly job stores it (msh:tiingo:eod:v2:<SYM>,
// same window, same TTL), then the symbol joins the requested set so the quote
// and EOD jobs keep it fresh. A short or empty answer is recorded as "no data"
// and not stored: the page then takes its non-Tiingo path.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "../redisCacheMode";
import { TiingoHttpError, TiingoRefused, fetchEodHistory, reserveTiingoRequests, type TiingoCallPath } from "./tiingo";
import {
  TIINGO_COLD_NODATA_KEY,
  TIINGO_COLD_QUEUE_KEY,
  TIINGO_EOD_TTL_SECONDS,
  TIINGO_REQUESTED_KEY,
  tiingoEodKey,
} from "./keys";
import { EOD_MIN_BARS, EOD_WINDOW_BARS, eodStartDate } from "./eodWindow";
import type { StoredEod } from "./types";
import {
  COLD_ATTEMPTS_PER_DAY,
  COLD_FETCH_TIMEOUT_MS,
  COLD_FILLS_PER_DAY,
  COLD_FILLS_PER_HOUR,
  REQUESTED_CAP,
  REQUESTED_IDLE_DAYS,
  coldSymbol,
  releaseColdLock,
  takeColdLock,
} from "../tiingoColdState";

// PAGE_READ_CACHE: the stock page reaches this module through its server action
// (TiingoColdFill.tsx -> tiingoColdFillAction.ts), so check-page-read-cache
// counts it as page-reachable, as with secColdFill.ts.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ ...PAGE_READ_CACHE, retry: { retries: 1, backoff: () => 50 } })
    : null;

// ── the gate (pure) ─────────────────────────────────────────────────────────

export type ColdRefusal =
  | "token" | "symbol" | "not-supported" | "no-list"
  | "visitor-cap" | "attempt-cap" | "bot" | "hour-cap" | "day-cap" | "in-flight";

/** Refusals that queue the symbol instead of ending: someone (a job) will still fill it. */
export const QUEUEING_REFUSALS: ReadonlySet<ColdRefusal> = new Set(["visitor-cap", "attempt-cap", "bot", "hour-cap", "day-cap"]);

export type ColdGateInput = {
  tokenOk: boolean;
  symbolOk: boolean;
  supported: "yes" | "no" | "no-list" | "no-data" | "error";
  /** admitColdVisitor's verdict; ok:false for any reason (cap or a Redis error) refuses. */
  visitorOk: boolean;
  /** The site's BotID attempts today INCLUDING this one; null = unreadable (refuses). */
  attempts: number | null;
  /** BotID's verdict; null = unanswerable (refuses). Undefined = not asked yet. */
  bot?: { isBot: boolean; isVerifiedBot: boolean } | null;
  /** Fills this hour / today INCLUDING this one; null = unreadable (refuses). Undefined = not counted yet. */
  fills?: { hour: number | null; day: number | null };
  /** The day cap in force (coldFillsPerDay(); the env override can force 0). */
  dayCap?: number;
};

/**
 * PURE: the first refusal, in gate order, for what is known so far. The action
 * calls it after each stage, so a later stage is never paid for once an earlier
 * one refuses. Every unreadable input refuses (fails closed).
 */
export function coldFillGate(i: ColdGateInput): ColdRefusal | null {
  if (!i.tokenOk) return "token";
  if (!i.symbolOk) return "symbol";
  if (i.supported === "no-list" || i.supported === "error") return "no-list";
  if (i.supported !== "yes") return "not-supported";
  if (!i.visitorOk) return "visitor-cap";
  if (i.attempts == null || i.attempts > COLD_ATTEMPTS_PER_DAY) return "attempt-cap";
  if (i.bot === undefined) return null;
  if (!i.bot || i.bot.isBot || i.bot.isVerifiedBot) return "bot";
  if (i.fills === undefined) return null;
  if (i.fills.hour == null || i.fills.hour > COLD_FILLS_PER_HOUR) return "hour-cap";
  if (i.fills.day == null || i.fills.day > (i.dayCap ?? COLD_FILLS_PER_DAY)) return "day-cap";
  return null;
}

// ── the fill ────────────────────────────────────────────────────────────────

export type ColdFillResult = "filled" | "no-data" | "timeout" | "refused" | "error";

/**
 * Add a filled symbol to the requested set, then evict the least recently
 * viewed past REQUESTED_CAP. 2 commands, +1 ZPOPMIN only when over the cap.
 * An evicted symbol's history lapses on its own 8-day TTL.
 */
async function addRequested(r: Redis, sym: string, nowMs: number): Promise<void> {
  const p = r.pipeline();
  p.zadd(TIINGO_REQUESTED_KEY, { score: nowMs, member: sym });
  p.zcard(TIINGO_REQUESTED_KEY);
  const [, card] = (await p.exec()) as [number, number];
  const over = Number(card) - REQUESTED_CAP;
  if (over > 0) await r.zpopmin(TIINGO_REQUESTED_KEY, over);
}

/**
 * Fetch and store one symbol's history: 1 Tiingo request (reserved on the
 * shared limiter, 4 commands), then SET + the requested set (3), or one SADD to
 * the no-data set. Never throws. `path` is "cold-fill" from the action only.
 */
export async function fillTiingoColdSymbol(
  symbol: string,
  opts: { path: TiingoCallPath; timeoutMs?: number; nowMs?: number }
): Promise<ColdFillResult> {
  if (!redis) return "error";
  const sym = coldSymbol(symbol);
  const nowMs = opts.nowMs ?? Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? COLD_FETCH_TIMEOUT_MS);
  try {
    await reserveTiingoRequests(1, nowMs, opts.path);
    const got = await fetchEodHistory(sym, eodStartDate(nowMs), { path: opts.path, signal: ac.signal });
    if (got.bars.length < EOD_MIN_BARS) {
      await redis.sadd(TIINGO_COLD_NODATA_KEY, sym);
      return "no-data";
    }
    const bars = got.bars.slice(-EOD_WINDOW_BARS);
    const value: StoredEod = { asOf: bars[bars.length - 1][0], fetchedAt: nowMs, basis: "split", bars };
    await redis.set(tiingoEodKey(sym), JSON.stringify(value), { ex: TIINGO_EOD_TTL_SECONDS });
    await addRequested(redis, sym, nowMs);
    return "filled";
  } catch (err) {
    if (err instanceof TiingoRefused) return "refused";
    if (err instanceof TiingoHttpError && err.status === 404) {
      try { await redis.sadd(TIINGO_COLD_NODATA_KEY, sym); } catch { /* the next attempt re-asks */ }
      return "no-data";
    }
    if (ac.signal.aborted) return "timeout";
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

// ── the queue (the tiingo-cold-queue job) ───────────────────────────────────

/** Queued symbols one run fills: 100 Tiingo requests at most, far inside the 300 s function. */
export const COLD_QUEUE_PER_RUN = 100;
const DRAIN_CONCURRENCY = 4;

/**
 * Every 10 minutes: drop requested symbols unviewed for REQUESTED_IDLE_DAYS,
 * then fill up to COLD_QUEUE_PER_RUN queued ones (oldest first) through the job
 * path (production only). Each is removed from the queue whatever its outcome
 * except "refused" (the limiter said no: it waits for the next run).
 *
 * Commands: 2 a run when the queue is empty (ZREMRANGEBYSCORE + ZRANGE);
 * per queued symbol ~9 (lock 2, limiter 4, SET, requested 2) + 1 ZREM a run.
 */
export async function drainColdQueue(
  nowMs = Date.now(),
  onFilled?: (symbol: string) => void
): Promise<{ ok: boolean; idleDropped: number; queued: number; filled: number; noData: number; failed: number; refused: number }> {
  const out = { ok: true, idleDropped: 0, queued: 0, filled: 0, noData: 0, failed: 0, refused: 0 };
  if (!redis) return { ...out, ok: false };
  out.idleDropped = Number(
    await redis.zremrangebyscore(TIINGO_REQUESTED_KEY, 0, nowMs - REQUESTED_IDLE_DAYS * 86_400_000)
  );
  const queued = (await redis.zrange<string[]>(TIINGO_COLD_QUEUE_KEY, 0, COLD_QUEUE_PER_RUN - 1)).map(String);
  out.queued = queued.length;
  if (!queued.length) return out;
  const done: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < queued.length) {
      const sym = queued[next++];
      // The visitor's own fill may be running: leave it to them.
      if (!(await takeColdLock(sym))) continue;
      try {
        const r = await fillTiingoColdSymbol(sym, { path: "job", timeoutMs: 15_000, nowMs });
        if (r === "refused") { out.refused++; continue; }
        done.push(sym);
        if (r === "filled") { out.filled++; onFilled?.(sym); }
        else if (r === "no-data") out.noData++;
        else out.failed++;
      } finally {
        await releaseColdLock(sym);
      }
    }
  };
  await Promise.all(Array.from({ length: DRAIN_CONCURRENCY }, worker));
  if (done.length) await redis.zrem(TIINGO_COLD_QUEUE_KEY, ...done);
  return out;
}
