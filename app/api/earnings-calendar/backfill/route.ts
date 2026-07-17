import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { populateNextMissingDate } from "@/lib/server/earningsCalendar";

export const runtime = "nodejs";

// Manually-triggered catch-up pass: populates the next few incomplete
// earnings-calendar dates (starting today, walking forward), bypassing this
// feature's own 50/hour quote cap for this call (the site-wide FMP account
// budget, ~300 calls/minute, is still always enforced -- see
// reserveFmpCallSlot in lib/server/earningsCalendar.ts). Gated behind a
// secret key so only the site owner can trigger it -- set
// EARNINGS_BACKFILL_KEY in Vercel's project env vars, then hit e.g.:
//
//   /api/earnings-calendar/backfill?key=<the-secret>&maxDates=8
//
// Repeat (or raise maxDates, capped at 10 per call to keep the function's
// execution time bounded) to walk further into the future. Once the
// upcoming months are seeded, this route doesn't need to be used again --
// normal traffic keeps dates topped up automatically from there (see the
// `after()` background call in app/earnings-calendar/page.tsx). Loading
// /earnings-calendar itself with ?backfillKey=<the-secret> does the same
// bypass for manual clicking, if that's preferred over calling this route
// directly -- that path never returns a distinguishable success/failure
// signal for a wrong key (a bad key there just behaves like no key at all),
// so it isn't a brute-force oracle and doesn't need the lockout below.
//
// This route DOES return a distinguishable 403 for a wrong key, which makes
// it guessable by repeated automated requests -- especially with a short
// key. IP-based lockout: after MAX_ATTEMPTS wrong keys from the same IP,
// further attempts (right or wrong) are rejected with 429 until the lockout
// window expires, regardless of whether Redis is configured (fails open to
// "not locked out" if Redis is unavailable, matching this codebase's usual
// fail-open posture -- worse case is no brute-force slowdown, not a broken
// route).
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const FAIL_PREFIX = "msh:earnings-backfill-fail:v1";
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 5 * 60;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

async function checkLockout(ip: string): Promise<{ locked: boolean; retryAfterSeconds: number }> {
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

async function recordFailure(ip: string) {
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

async function clearFailures(ip: string) {
  if (!redis) return;

  try {
    await redis.del(`${FAIL_PREFIX}:${ip}`);
  } catch {
    // best-effort
  }
}

export async function GET(request: Request) {
  const ip = getClientIp(request);

  const lockout = await checkLockout(ip);
  if (lockout.locked) {
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${lockout.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const key = (searchParams.get("key") || "").trim();
  const expected = process.env.EARNINGS_BACKFILL_KEY;

  if (!expected || key !== expected) {
    await recordFailure(ip);
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  await clearFailures(ip);

  const maxParam = Number(searchParams.get("maxDates") || "5");
  const maxDates = Number.isFinite(maxParam) && maxParam > 0 ? Math.min(Math.floor(maxParam), 10) : 5;

  const result = await populateNextMissingDate({ bypassCap: true, maxDates });
  return NextResponse.json(result);
}
