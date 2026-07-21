import { Redis } from "@upstash/redis";

// Cumulative per-IP, per-category, 24h *real page view* counter, plus a
// same-day BotID verification gate layered on top of it.
//
// This intentionally does NOT count raw HTTP requests. An earlier version
// of this file incremented on every request middleware saw matching a path
// prefix, which turned out to badly over-count real visitors: Next.js Link
// prefetching (background RSC fetches for links that scroll into view or
// get hovered, never resulting in an actual visit) was firing 4-7x more
// matching requests per real visitor than actual page views, on pages like
// /earnings-calendar and /pickers in particular. An attempt to fix that by
// adding `prefetch={false}` across the site's per-item links was tried and
// rolled back (2026-07-21) after it measurably slowed page rendering and
// raised server-side CPU concerns -- not worth the risk for what is, at the
// end of the day, a request-counting problem.
//
// Instead: only a real, client-rendered navigation increments this counter,
// via `recordDailyPageView` being called from the /api/internal/track-view
// beacon endpoint, which is hit by a client component that mounts (once per
// real pathname change) inside the actual rendered page. A background
// Link prefetch only fetches an RSC payload into the router cache -- it
// never mounts anything client-side -- so it can never reach that beacon,
// no matter how many prefetch requests it generates.
//
// On top of the counter: once an IP crosses the daily limit, middleware
// sends it through an invisible BotID Deep Analysis check (app/verify) once
// per day instead of hard-blocking outright. `isVerifiedHumanToday` and
// `isBotFlaggedToday` (read-only, used by middleware) plus
// `markVerifiedHumanToday`/`markBotFlaggedToday` (write-only, used only by
// /api/internal/verify-human) record that result for the rest of the UTC
// day, so the same IP is never re-checked (and never re-billed for Deep
// Analysis) twice in one day.
//
// Same fail-open @upstash/redis pattern as every other Redis guard in this
// codebase (historyCache.ts's reserveFmpCallSlot, youtube.ts's call budget,
// quoteData.ts's cache): if Redis is unreachable or
// UPSTASH_REDIS_REST_URL/TOKEN aren't set, nothing is ever blocked.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const VIEWS_PREFIX = "msh:daily-views:v2";
const VERIFIED_PREFIX = "msh:botid-verified:v1";
const BOT_FLAG_PREFIX = "msh:botid-blocked:v1";

// 25h, not 24h: gives a 1h buffer past the UTC day boundary so a bucket
// created right at 23:59:59 UTC doesn't expire mid-count if a later
// increment/check in the same UTC day lands a little late. (Minor known
// edge case: something set at 23:00 UTC technically outlives the view
// counter's own day bucket by up to an hour -- not worth the extra
// complexity of computing exact seconds-to-midnight for a same-day gate.)
const BUCKET_TTL_SECONDS = 25 * 60 * 60;

function getUtcDayBucket(now: Date) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getKey(prefix: string, category: string, ip: string, now: Date) {
  return `${prefix}:${category}:${getUtcDayBucket(now)}:${ip}`;
}

// Same IP already whitelisted in the Vercel Firewall's "Bypass rate limit
// for my IP" rule (owner's home connection, confirmed 2026-07-21). Add more
// -- e.g. a work or mobile IP -- via the RATE_LIMIT_BYPASS_IPS env var
// (comma-separated) in Vercel project settings; needs a redeploy to take
// effect.
const DEFAULT_BYPASS_IPS = ["80.192.159.167"];

const BYPASS_IPS = new Set([
  ...DEFAULT_BYPASS_IPS,
  ...(process.env.RATE_LIMIT_BYPASS_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean),
]);

export function isBypassedIp(ip: string): boolean {
  return BYPASS_IPS.has(ip);
}

// Vercel forwards the connecting client IP as the first entry in
// x-forwarded-for. Falls back to x-real-ip, then "unknown" (treated as
// never-limited by every read/write function below, matching every other
// fail-open guard in this codebase).
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() ?? "unknown";
}

// ── Daily real-page-view counter ────────────────────────────────────────

// Read-only: how many real page views has this IP racked up today for this
// category so far? Used by middleware to decide whether to send a request
// through the verify gate -- it never increments, so checking the count
// doesn't itself count as a view.
export async function getDailyPageViewCount(
  category: string,
  ip: string
): Promise<number> {
  if (!redis || !ip || ip === "unknown") return 0;

  try {
    const key = getKey(VIEWS_PREFIX, category, ip, new Date());
    const count = await redis.get<number>(key);
    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}

// Increments the counter for a real page view. Called only from the
// /api/internal/track-view beacon endpoint, which only ever receives a
// request when a real client-rendered page actually mounted.
export async function recordDailyPageView(
  category: string,
  ip: string
): Promise<void> {
  if (!redis || !ip || ip === "unknown") return;

  try {
    const key = getKey(VIEWS_PREFIX, category, ip, new Date());
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, BUCKET_TTL_SECONDS);
    }
  } catch {
    // Fail open -- if Redis is down, we just undercount; never throw.
  }
}

// ── Same-day BotID verification result ───────────────────────────

export async function isVerifiedHumanToday(
  category: string,
  ip: string
): Promise<boolean> {
  if (!redis || !ip || ip === "unknown") return false;
  try {
    const key = getKey(VERIFIED_PREFIX, category, ip, new Date());
    return (await redis.get(key)) != null;
  } catch {
    // Fail open: if we can't tell, don't force a redundant verify loop --
    // middleware will just send them through /verify again, which itself
    // fails open on a Redis/BotID hiccup.
    return false;
  }
}

export async function markVerifiedHumanToday(
  category: string,
  ip: string
): Promise<void> {
  if (!redis || !ip || ip === "unknown") return;
  try {
    const key = getKey(VERIFIED_PREFIX, category, ip, new Date());
    await redis.set(key, 1, { ex: BUCKET_TTL_SECONDS });
  } catch {
    // Best effort -- worst case this IP gets re-checked once more today.
  }
}

export async function isBotFlaggedToday(
  category: string,
  ip: string
): Promise<boolean> {
  if (!redis || !ip || ip === "unknown") return false;
  try {
    const key = getKey(BOT_FLAG_PREFIX, category, ip, new Date());
    return (await redis.get(key)) != null;
  } catch {
    // Fail open -- never treat a Redis hiccup as "this IP is a bot".
    return false;
  }
}

export async function markBotFlaggedToday(
  category: string,
  ip: string
): Promise<void> {
  if (!redis || !ip || ip === "unknown") return;
  try {
    const key = getKey(BOT_FLAG_PREFIX, category, ip, new Date());
    await redis.set(key, 1, { ex: BUCKET_TTL_SECONDS });
  } catch {
    // Best effort -- worst case this IP gets re-checked (and re-billed)
    // once more today instead of being remembered as blocked.
  }
}
