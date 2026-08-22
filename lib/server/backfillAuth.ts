// Shared owner-only backfill auth: key check + IP-based lockout, used by
// app/api/earnings-calendar/backfill-date/route.ts (the in-page "Backfill"
// button on app/earnings-calendar/page.tsx). Fails open if Redis isn't
// configured or errors, matching this codebase's usual posture -- worst
// case is no brute-force slowdown, not a broken route.
//
// v2 counter prefix (distinct from the old, now-removed URL-based backfill
// route's v1 prefix) so this doesn't inherit any stale attempt counts, and
// so the two lockout policies (this one: 3 attempts / 10 min, matching the
// site owner's explicit request) never collide.

import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const FAIL_PREFIX = "msh:earnings-backfill-fail:v2";
const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 10 * 60;

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export async function checkBackfillLockout(
  ip: string
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  if (!redis) return { locked: false, retryAfterSeconds: 0 };

  try {
    const key = `${FAIL_PREFIX}:${ip}`;
    const [count, ttl] = await Promise.all([redis.get<number>(key), redis.ttl(key)]);
    const attempts = typeof count === "number" ? count : 0;

    if (attempts >= MAX_ATTEMPTS) {
      return { locked: true, retryAfterSeconds: ttl > 0 ? ttl : LOCKOUT_SECONDS };
    }
    return { locked: false, retryAfterSeconds: 0 };
  } catch {
    return { locked: false, retryAfterSeconds: 0 };
  }
}

export async function recordBackfillFailure(ip: string) {
  if (!redis) return;

  try {
    const key = `${FAIL_PREFIX}:${ip}`;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, LOCKOUT_SECONDS);
    }
  } catch {
    // fail open -- worst case a determined attacker isn't slowed down
  }
}

export async function clearBackfillFailures(ip: string) {
  if (!redis) return;

  try {
    await redis.del(`${FAIL_PREFIX}:${ip}`);
  } catch {
    // best-effort
  }
}

// Validates the submitted key against EARNINGS_BACKFILL_KEY. Returns false
// (never authorized) if the env var isn't set at all.
export function checkBackfillKey(submitted: string): boolean {
  const expected = process.env.EARNINGS_BACKFILL_KEY;
  return Boolean(expected) && submitted === expected;
}

// Validates against CACHE_HEALTH_KEY -- the read-only cache health page's OWN
// key, deliberately not one of the two that already exist.
//
// WHY A THIRD KEY RATHER THAN REUSING ONE. EARNINGS_BACKFILL_KEY authorises
// work: the backfill button spends FMP calls. CRON_SECRET authorises the warm
// jobs, and its isAuthorized() fails OPEN when unset (see
// app/api/debug/fmp-endpoints/route.ts:56 for why those two are already kept
// apart). The health page is READ-ONLY and is meant to be opened casually from
// a phone, which is exactly the usage that leaks a key into history, a
// screenshot or a Referer header. Sharing a key would make one leak of a stats
// page into unbounded FMP spend against a cap already at 73.6%.
//
// Fails CLOSED: an unset env var authorises nobody.
//
// Constant-time compare. The `===` above is the existing house pattern and is
// fine in practice, but this key is new, so there is no compatibility reason
// not to do it properly.
export function checkCacheHealthKey(submitted: string): boolean {
  const expected = process.env.CACHE_HEALTH_KEY;
  if (!expected || !submitted) return false;
  if (submitted.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ submitted.charCodeAt(i);
  }
  return diff === 0;
}

// Separate lockout namespace from the backfill one, so a wrong health-page key
// cannot lock the owner out of the backfill button and vice versa. Same policy
// (3 attempts / 10 min) and the same fail-open posture.
const HEALTH_FAIL_PREFIX = "msh:cache-health-fail:v1";

export async function checkCacheHealthLockout(
  ip: string
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  if (!redis) return { locked: false, retryAfterSeconds: 0 };
  try {
    const key = `${HEALTH_FAIL_PREFIX}:${ip}`;
    const [count, ttl] = await Promise.all([redis.get<number>(key), redis.ttl(key)]);
    const attempts = typeof count === "number" ? count : 0;
    if (attempts >= MAX_ATTEMPTS) {
      return { locked: true, retryAfterSeconds: ttl > 0 ? ttl : LOCKOUT_SECONDS };
    }
    return { locked: false, retryAfterSeconds: 0 };
  } catch {
    return { locked: false, retryAfterSeconds: 0 };
  }
}

export async function recordCacheHealthFailure(ip: string) {
  if (!redis) return;
  try {
    const key = `${HEALTH_FAIL_PREFIX}:${ip}`;
    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, LOCKOUT_SECONDS);
  } catch {
    // fail open
  }
}

export async function clearCacheHealthFailures(ip: string) {
  if (!redis) return;
  try {
    await redis.del(`${HEALTH_FAIL_PREFIX}:${ip}`);
  } catch {
    // best-effort
  }
}
