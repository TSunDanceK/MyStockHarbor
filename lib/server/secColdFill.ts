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
// request must carry a valid page token while the site is under its daily
// ceilings, be classified HUMAN by BotID deep analysis, and come from a visitor
// under its daily count of new tickers. Verified good bots (Googlebot and the
// like) never fetch live: they only QUEUE the symbol for the scheduled job,
// behind every person's entry. Unverified bots queue nothing.
//
// ── ONE VISITOR, 20 NEW TICKERS A DAY, SHARED WITH B (#552 COWORK #132) ────
// The per-address limit is B's coldVisitorCap (SADD + SCARD on a per-day set,
// fails closed): a ticker counts once per visitor per UTC day, whether it needs
// a Tiingo fill, an SEC fill or both. It replaced A's own 5-an-hour counter.
// Over the cap, a person's symbol is QUEUED, never fetched.
//
// ── ORDER: CHEAPEST FIRST, THE PAID CHECK LAST ────────────────────────────
// BotID deep analysis is billed per call, so every free refusal runs before it:
// token (CPU), symbol and CIK (committed file), then this ADDRESS's attempts
// this hour (one INCR, #552 COWORK #147), then the site's daily attempt
// counter (one INCR). The address ceiling comes FIRST so one noisy client
// cannot spend the site's day of attempts for everyone: a request refused
// there never touches the site counter. Only a request that clears all of
// those costs a deep analysis. The visitor's count runs AFTER the verdict, because an over-cap
// PERSON is queued and an over-cap bot is not, so the verdict has to be known;
// one address's attempts stay bounded by the site's 1,000 a day and by the
// edge firewall's 25 /stock requests per 10 minutes (secColdFetch.ts). The
// day's FILL ceiling is counted last, only for a person under the cap.
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

/**
 * BotID ATTEMPTS one address may make in an hour (#552 COWORK #147). Counts
 * attempts, not tickers: B's 20-new-tickers-a-day cap (coldVisitorCap) stays
 * the only visitor FILL cap. This only stops one address spending the site's
 * 1,000 daily attempts — paid deep analyses — on everyone else's behalf.
 */
export const COLD_FILL_ATTEMPTS_PER_IP_PER_HOUR = 30;
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
  | "day-limit"
  | "attempt-limit"
  /** One address over its hourly BotID attempts: refused, nothing queued. */
  | "attempt-ip"
  | "bot"
  /** A verified crawler: QUEUED for the scheduled job, behind people. */
  | "crawler"
  /** A person over the shared 20-new-tickers-a-day cap: QUEUED. */
  | "visitor-cap"
  /** The visitor could not be counted (no address, Redis down): fails closed, nothing queued. */
  | "visitor-unknown"
  | "in-flight";

export type ColdFillGateInput = {
  tokenOk: boolean;
  symbolOk: boolean;
  hasCik: boolean;
  /** This address's attempts this hour, INCLUDING this one. Absent before it is counted. */
  ipAttemptCount?: number;
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
  if ((i.ipAttemptCount ?? 0) > COLD_FILL_ATTEMPTS_PER_IP_PER_HOUR) return "attempt-ip";
  if (i.attemptCount > COLD_FILL_ATTEMPTS_PER_DAY) return "attempt-limit";
  return null;
}

/** After a human verdict: the site's fills today, INCLUDING this one. */
export function coldFillDayGate(dayCount: number): ColdFillRefusal | null {
  return dayCount > COLD_FILL_PER_DAY ? "day-limit" : null;
}

/**
 * The BotID half. NO bot fetches live, a verified one included: the cold fill
 * is for people. A VERIFIED crawler may only queue the symbol for the scheduled
 * job ("crawler", behind people); any other bot, and an unanswerable verdict
 * (null), is refused outright and queues nothing — this gate fails CLOSED,
 * unlike the page gates, because the cost of a wrong "yes" here is an SEC
 * request (or queue entry) a bot chose to make.
 */
export function coldFillBotGate(bot: ColdFillGateInput["bot"]): ColdFillRefusal | null {
  if (!bot) return "bot";
  if (bot.isVerifiedBot) return "crawler";
  if (bot.isBot) return "bot";
  return null;
}

/**
 * A person's verdict from the shared visitor cap (coldVisitorCap.ts): through,
 * over the cap (queue it), or not countable (fail closed, queue nothing).
 */
export function coldFillVisitorGate(v: { ok: true } | { ok: false; reason: string }): ColdFillRefusal | null {
  if (v.ok) return null;
  return v.reason === "cap" ? "visitor-cap" : "visitor-unknown";
}

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

const ipAttemptKey = (ip: string, d = new Date()) =>
  `${secCounterPrefix("msh:sec:cold-fill-attempt-ip:v1")}:${ip}:${d.toISOString().slice(0, 13)}`;

/**
 * Count this attempt against the ADDRESS's hour, before anything else is
 * counted. FAILS CLOSED: with Redis unreachable it reads over the ceiling.
 */
export async function countColdFillIpAttempt(ip: string): Promise<number> {
  return (await bump(ipAttemptKey(ip), 2 * 3600)) ?? COLD_FILL_ATTEMPTS_PER_IP_PER_HOUR + 1;
}

/**
 * Count this attempt against the site's daily attempts.
 *
 * FAILS CLOSED: with Redis unreachable the count comes back over the limit and
 * the gate refuses. The page then shows "not yet read" and the scheduled job
 * fills the symbol — a slower page, never an unbounded one.
 */
export async function countColdFillAttempt(): Promise<{ attemptCount: number }> {
  const attemptCount = await bump(coldFillAttemptKey(), 2 * 86400);
  return { attemptCount: attemptCount ?? COLD_FILL_ATTEMPTS_PER_DAY + 1 };
}

/** Count one human-verified fill against the site's day. Fails closed, as above. */
export async function countColdFillDay(): Promise<number> {
  return (await bump(coldFillDayKey(), 2 * 86400)) ?? COLD_FILL_PER_DAY + 1;
}

export const coldFillOutcomeKey = (d = new Date()) =>
  `${secCounterPrefix("msh:sec:cold-fill-outcome:v1")}:${d.toISOString().slice(0, 10)}`;

/**
 * WHAT EACH COUNTED ATTEMPT ENDED AS, by word (#535 COWORK #19 §1c): a refusal
 * reason (attempt-ip, attempt-limit, bot, crawler, visitor-cap, visitor-unknown,
 * day-limit, in-flight) or a fill
 * outcome (filled, no-data, queued, busy, …). One HINCRBY on a day hash.
 *
 * ONLY AFTER countColdFillAttempt: the free refusals (token, symbol,
 * not-eligible) are never counted, so this is bounded by the same daily
 * attempt cap and a flood of junk requests costs it nothing. Best-effort:
 * a failure here never changes the reply.
 */
export async function countColdFillOutcome(word: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.hincrby(coldFillOutcomeKey(), word, 1);
  } catch {
    // Reporting only.
  }
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
