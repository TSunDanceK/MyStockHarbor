import { Redis } from "@upstash/redis";
import { withRedisTimeout } from "./redisGuardTimeout";

/**
 * Redis-backed temporary block list for the honeypot trap
 * (app/api/internal/feed-index/route.ts).
 *
 * Same fail-open @upstash/redis pattern as every other Redis guard in this
 * codebase (dailyPageLimit.ts, quoteData.ts's cache, historyCache.ts's
 * reserveFmpCallSlot): if Redis is unreachable or
 * UPSTASH_REDIS_REST_URL/TOKEN aren't set, nothing is ever blocked.
 *
 * Blocks BOTH the requester's IP and its JA4 TLS fingerprint, not just the
 * IP. An IP-only block is weak on its own -- a lot of scraping traffic
 * rotates through proxy pools or cloud IP ranges, so the exact address that
 * tripped the trap may never be seen again, while a real visitor could
 * later inherit that same address on a shared/dynamic range. JA4 survives
 * simple IP rotation (same TLS client, different address) and is already
 * proven useful on this site -- see
 * claude/firewall-ja4-repeat-offenders-selfblock-2026-07-21.md.
 */

// retries: 1 because isTrapBlocked() below runs in middleware, on every
// request, under a 400ms budget (redisGuardTimeout.ts). The SDK default of
// 5 attempts with exponential backoff cannot finish inside that budget, so
// the extra attempts only ever burn Upstash quota on a request whose answer
// has already been abandoned. One quick retry still absorbs a single
// dropped packet, which is the only retry that can help here.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ retry: { retries: 1, backoff: () => 50 } })
    : null;

const IP_PREFIX = "msh:trap-block:ip:v1";
const JA4_PREFIX = "msh:trap-block:ja4:v1";

const DEFAULT_BLOCK_DAYS = 2;

function blockDays(): number {
  const raw = Number(process.env.TRAP_BLOCK_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BLOCK_DAYS;
}

/** Current configured block duration, in days. Read once per module load --
 *  matches every other duration constant in this codebase; a change needs a
 *  redeploy to take effect regardless of when it's read. */
export const TRAP_BLOCK_DAYS = blockDays();

function ipKey(ip: string): string {
  return `${IP_PREFIX}:${ip}`;
}

function ja4Key(ja4: string): string {
  return `${JA4_PREFIX}:${ja4}`;
}

/**
 * Block an offender's IP and (if present) JA4 fingerprint for
 * TRAP_BLOCK_DAYS. Both writes go through a single pipeline round-trip.
 * Best-effort: a Redis hiccup here means this one offender doesn't get
 * blocked, never that anything breaks for anyone else.
 *
 * Deliberately NOT time-bounded like the read below: this runs in an API
 * route, not middleware, and a write that is abandoned halfway leaves the
 * offender unblocked -- worth waiting the extra moment for.
 */
export async function blockOffender(
  ip: string,
  ja4: string | null | undefined
): Promise<void> {
  if (!redis) return;

  const ttlSeconds = Math.round(TRAP_BLOCK_DAYS * 24 * 60 * 60);
  const hasIp = Boolean(ip) && ip !== "unknown";
  const hasJa4 = Boolean(ja4);

  if (!hasIp && !hasJa4) return;

  try {
    const pipeline = redis.pipeline();
    if (hasIp) pipeline.set(ipKey(ip), 1, { ex: ttlSeconds });
    if (hasJa4) pipeline.set(ja4Key(ja4 as string), 1, { ex: ttlSeconds });
    await pipeline.exec();
  } catch {
    // Fail open -- see module comment.
  }
}

/**
 * Read-only: is this IP or JA4 currently blocked? Checked in middleware.ts
 * on every request (before any other routing decision) so a blocked
 * offender is denied everywhere on the site, not just the path that
 * originally caught them. Uses a single mget round-trip when both an IP and
 * a JA4 are available, rather than two separate calls.
 *
 * Time-bounded via withRedisTimeout: this is the FIRST Redis call every
 * request on the site makes, so an unbounded await here hangs middleware
 * and takes the whole site down (2026-08-10 13:19-13:21 UTC, 12 clients,
 * 25s middleware timeouts). The old bare try/catch could not catch that,
 * because a slow-but-reachable Redis raises no error. See
 * redisGuardTimeout.ts for the full write-up.
 */
export async function isTrapBlocked(
  ip: string,
  ja4: string | null | undefined
): Promise<boolean> {
  if (!redis) return false;

  const keys: string[] = [];
  if (ip && ip !== "unknown") keys.push(ipKey(ip));
  if (ja4) keys.push(ja4Key(ja4));
  if (keys.length === 0) return false;

  // Bind to a const AFTER the null guard: strict-mode narrowing is not
  // guaranteed to survive into the closure below, and this is the pattern
  // used elsewhere in the codebase for exactly that reason.
  const client = redis;

  return withRedisTimeout(
    async () => {
      const results = await client.mget<(number | null)[]>(...keys);
      return results.some((value) => value != null);
    },
    // Fail open -- never treat a Redis hiccup, or a slow one, as "this
    // requester is blocked".
    false,
    "trap-block",
    `ip=${ip} ja4=${ja4 ?? "none"}`
  );
}
