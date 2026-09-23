// THE HUMAN-GATED COLD FILL (#535 COWORK #13).
//
// A stock page for a symbol with a CIK and no stored fact set renders at once,
// with a "reading" state in its figures section and `noindex`. After hydration
// the page asks for a fill through a SERVER ACTION (no public JSON route), and
// the action runs the gates below before fillColdSymbol may call SEC.
//
// ── WHAT A BOT CAN AND CANNOT DO ──────────────────────────────────────────
// The render makes no SEC call and queues nothing, so a crawler walking
// /stock/<ticker> costs SEC nothing and leaves no work behind. To reach SEC a
// request must carry a valid page token, come from an address under its hourly
// limit while the site is under its daily ceiling, and be classified HUMAN by
// BotID deep analysis. Verified good bots (Googlebot and the like) are refused
// too: they are served the scheduled jobs' data, never a live fetch.
//
// ── ORDER: CHEAPEST FIRST, THE PAID CHECK LAST ────────────────────────────
// BotID deep analysis is billed per call, so every free refusal runs before it:
// token (CPU), symbol and CIK (committed file), per-IP and daily counters (two
// INCRs). Only a request that clears all of those costs a deep analysis, and
// the day's FILL ceiling is counted only after BotID has said human.
//
// ── NOTHING MACHINE-READABLE LEAVES ───────────────────────────────────────
// The action returns an outcome word, never a figure. The client refreshes and
// the server re-renders from the stored set, so this path is not a data API.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { secCounterPrefix } from "./secWriteGate";

// PAGE_READ_CACHE because the pages import the action that imports this, and a
// bare client anywhere in a prerenderable page's graph opts the route out of
// static rendering (check-page-read-cache). The action is not a render, so the
// mode changes nothing about its own requests.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ ...PAGE_READ_CACHE, retry: { retries: 1, backoff: () => 50 } })
    : null;

/** The client address, as dailyPageLimit.getClientIp reads it (not imported: see above). */
export function clientIpFrom(h: Headers): string {
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || h.get("x-real-ip")?.trim() || "unknown";
}

/** Cold fills one address may trigger in an hour. */
export const COLD_FILL_PER_IP_PER_HOUR = 5;
/** Cold fills the whole site may trigger in a UTC day — counted AFTER BotID says human. */
export const COLD_FILL_PER_DAY = 300;
/**
 * Attempts the whole site may put to BotID deep analysis in a UTC day, counted
 * BEFORE it. Two ceilings, not one: counting fills before the human verdict
 * would let a botnet spend the day's fills and lock people out; counting only
 * after it would leave the paid check unbounded. ~$1/day at this cap.
 */
export const COLD_FILL_ATTEMPTS_PER_DAY = 1000;
/** How long one symbol's fill holds its lock: the 5 s fetch budget plus the write. */
export const COLD_FILL_LOCK_S = 20;

/** Tickers only: letters, digits, dot and dash, as the stock routes accept. */
export const COLD_FILL_SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;

export type ColdFillRefusal =
  | "token"
  | "symbol"
  | "not-eligible"
  | "ip-limit"
  | "day-limit"
  | "attempt-limit"
  | "bot"
  | "in-flight";

export type ColdFillGateInput = {
  tokenOk: boolean;
  symbolOk: boolean;
  hasCik: boolean;
  /** This address's attempts this hour, INCLUDING this one. */
  ipCount: number;
  /** The site's attempts put to BotID today, INCLUDING this one. */
  attemptCount: number;
  /** BotID's verdict. Null only when the gate refused before asking. */
  bot: { isBot: boolean; isVerifiedBot: boolean } | null;
};

/**
 * The cheap half of the gate: everything decided before BotID is asked.
 * PURE, so every refusal can be pinned by a check without a network.
 */
export function coldFillPreGate(i: Omit<ColdFillGateInput, "bot">): ColdFillRefusal | null {
  if (!i.tokenOk) return "token";
  if (!i.symbolOk) return "symbol";
  if (!i.hasCik) return "not-eligible";
  if (i.ipCount > COLD_FILL_PER_IP_PER_HOUR) return "ip-limit";
  if (i.attemptCount > COLD_FILL_ATTEMPTS_PER_DAY) return "attempt-limit";
  return null;
}

/** After a human verdict: the site's fills today, INCLUDING this one. */
export function coldFillDayGate(dayCount: number): ColdFillRefusal | null {
  return dayCount > COLD_FILL_PER_DAY ? "day-limit" : null;
}

/**
 * The BotID half. ANY bot is refused, a verified one included: the cold fill is
 * for people, and a verified crawler reads what the scheduled jobs stored.
 * An unanswerable verdict (null) is refused too — this gate fails CLOSED,
 * unlike the page gates, because the cost of a wrong "yes" here is an SEC
 * request a bot chose to make.
 */
export function coldFillBotGate(bot: ColdFillGateInput["bot"]): ColdFillRefusal | null {
  if (!bot) return "bot";
  if (bot.isBot || bot.isVerifiedBot) return "bot";
  return null;
}

const ipKey = (ip: string, d = new Date()) =>
  `${secCounterPrefix("msh:sec:cold-fill-ip:v1")}:${ip}:${d.toISOString().slice(0, 13)}`;
export const coldFillDayKey = (d = new Date()) =>
  `${secCounterPrefix("msh:sec:cold-fill-day:v1")}:${d.toISOString().slice(0, 10)}`;
export const coldFillAttemptKey = (d = new Date()) =>
  `${secCounterPrefix("msh:sec:cold-fill-attempt:v1")}:${d.toISOString().slice(0, 10)}`;
const lockKey = (symbol: string) => `${secCounterPrefix("msh:sec:cold-fill-lock:v1")}:${symbol.toUpperCase()}`;

async function bump(key: string, ttlS: number): Promise<number | null> {
  if (!redis) return null;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, ttlS);
    return n;
  } catch {
    return null;
  }
}

/**
 * Count this attempt against the address's hour and the site's daily attempts.
 *
 * FAILS CLOSED: with Redis unreachable the counts come back over the limits and
 * the gate refuses. The page then shows "not yet read" and the scheduled job
 * fills the symbol — a slower page, never an unbounded one.
 */
export async function countColdFillAttempt(ip: string): Promise<{ ipCount: number; attemptCount: number }> {
  const [ipCount, attemptCount] = await Promise.all([bump(ipKey(ip), 2 * 3600), bump(coldFillAttemptKey(), 2 * 86400)]);
  return {
    ipCount: ipCount ?? COLD_FILL_PER_IP_PER_HOUR + 1,
    attemptCount: attemptCount ?? COLD_FILL_ATTEMPTS_PER_DAY + 1,
  };
}

/** Count one human-verified fill against the site's day. Fails closed, as above. */
export async function countColdFillDay(): Promise<number> {
  return (await bump(coldFillDayKey(), 2 * 86400)) ?? COLD_FILL_PER_DAY + 1;
}

/** One fill per symbol at a time: ten visitors at once cause one SEC request. */
export async function takeColdFillLock(symbol: string): Promise<boolean> {
  if (!redis) return false;
  try {
    return (await redis.set(lockKey(symbol), 1, { nx: true, ex: COLD_FILL_LOCK_S })) === "OK";
  } catch {
    return false;
  }
}

export async function releaseColdFillLock(symbol: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(lockKey(symbol));
  } catch {
    // The lock expires on its own.
  }
}
