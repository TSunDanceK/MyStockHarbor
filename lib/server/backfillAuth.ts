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
import { PAGE_READ_CACHE } from "./redisCacheMode";

// PAGE_READ_CACHE, and this one changed for a reason worth recording.
//
// redisCacheMode.ts used to name this module as deliberately exempt, "never on
// a static render path". That was true when it was written and is not any more:
// pickersBuilder.ts imports this module, PickerResultPage imports
// pickersBuilder, and #381 made all 36 picker pages prerendered. So a bare
// client now sits in the module graph of 36 SSG routes.
//
// Nothing is failing today, because the calls here (checkBackfillLockout,
// checkBackfillKey, clearBackfillFailures) are only reached from
// handlePickersRequest -- the API handler -- and never during a page render.
// Constructing the client is inert; only a call would throw. But "the call
// happens to be on the other branch" is precisely the reasoning #310 shipped
// on, and one call added to a render path would 500 all 36 routes.
//
// NO STALENESS RISK, which is the objection that kept it bare: PAGE_READ_CACHE
// is `{ cache: "default" }`, and it only drops the no-store HINT. Upstash's REST
// API is POST and Next's fetch cache only caches GET, so no auth or lockout read
// becomes cacheable. See the note in redisCacheMode.ts.
//
// Found by scripts/check-page-read-cache.mjs on its first run.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
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
/**
 * The one guard every debug route goes through. Returns a response to send, or
 * null to carry on.
 *
 * WHY THIS EXISTS RATHER THAN A FOURTEENTH COPY OF THE SAME FIFTEEN LINES. The
 * five debug routes that were already guarded had THREE different versions of
 * the block between them -- `{ error }` vs `{ ok: false, error }`, a
 * `retry-after` header on one and not the others, `submitted` vs an inline
 * lookup. Nothing had changed the rule; the copies had simply drifted the way
 * copies do. Nine more copies would have made it worse, and the assertion in
 * scripts/check-debug-routes-guarded.mjs would have had to match three shapes
 * to be true.
 *
 * The response carries BOTH shapes' fields, so nothing that reads either one
 * breaks: `ok: false` for the callers that check it, `error` for the ones that
 * print it, `retryAfterSeconds` in the body AND `retry-after` in the header,
 * which is the only variant that told a client when to come back.
 *
 * A ROUTE WITH NO Request OBJECT still has to be guarded -- pickers-size and
 * universe-size take no argument today -- so the caller adds one. That is a
 * two-character change against an unauthenticated 8 MB Redis read.
 */
export async function guardDebugRequest(request: Request): Promise<Response | null> {
  const ip = getClientIp(request);
  const lockout = await checkBackfillLockout(ip);
  if (lockout.locked) {
    return Response.json(
      {
        ok: false,
        error: "Too many attempts.",
        retryAfterSeconds: lockout.retryAfterSeconds,
      },
      { status: 429, headers: { "retry-after": String(lockout.retryAfterSeconds) } }
    );
  }

  const submitted = new URL(request.url).searchParams.get("key") ?? "";
  if (!checkBackfillKey(submitted)) {
    await recordBackfillFailure(ip);
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await clearBackfillFailures(ip);
  return null;
}

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
