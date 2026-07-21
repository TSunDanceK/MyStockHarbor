import { Redis } from "@upstash/redis";

// Cumulative per-IP, per-category, 24h rate limit -- distinct from, and on
// top of, the existing Vercel Firewall rate-limit rules. Firewall's own
// rate-limit rules cap out at a 600s (10min) fixed window on the Pro plan
// -- there's no dashboard option for a 24h window -- so this closes that
// specific gap in application code instead. It's meant to catch a slow,
// steady drip of requests spread across a day that never bursts hard
// enough inside any 10-minute window to trip the Firewall rule, not to
// replace that rule.
//
// Same fail-open @upstash/redis pattern as every other Redis guard in this
// codebase (historyCache.ts's reserveFmpCallSlot, youtube.ts's call
// budget, quoteData.ts's cache): if Redis is unreachable or
// UPSTASH_REDIS_REST_URL/TOKEN aren't set, requests are allowed through
// rather than the site going down for real visitors over a missing cache
// layer.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const DAILY_LIMIT_PREFIX = "msh:daily-limit:v1";

// 25h, not 24h: gives a 1h buffer past the UTC day boundary so a bucket
// created right at 23:59:59 UTC doesn't expire mid-count if a later
// increment in the same UTC day lands a little late.
const BUCKET_TTL_SECONDS = 25 * 60 * 60;

function getUtcDayBucket(now: Date) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getDailyLimitKey(category: string, ip: string, now: Date) {
  return `${DAILY_LIMIT_PREFIX}:${category}:${getUtcDayBucket(now)}:${ip}`;
}

export type DailyLimitResult = {
  allowed: boolean;
  count: number;
};

// Bucketed by UTC calendar day rather than a true rolling 24h window --
// same simplification the existing FMP-call-rate guard in historyCache.ts
// makes for its per-minute buckets. The trade-off: someone active in the
// hour either side of UTC midnight gets a bit more effective daily budget
// than someone active mid-day. Acceptable for a coarse abuse backstop;
// not trying to be exact.
export async function checkDailyPageLimit(
  category: string,
  ip: string,
  limit: number
): Promise<DailyLimitResult> {
  if (!redis || !ip || ip === "unknown") {
    return { allowed: true, count: 0 };
  }

  const key = getDailyLimitKey(category, ip, new Date());

  try {
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, BUCKET_TTL_SECONDS);
    }

    return { allowed: count <= limit, count };
  } catch {
    // Fail open -- a Redis hiccup should never block a real visitor.
    return { allowed: true, count: 0 };
  }
}
