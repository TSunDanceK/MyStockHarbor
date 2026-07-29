import { Redis } from "@upstash/redis";

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

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
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

  try {
    const results = await redis.mget<(number | null)[]>(...keys);
    return results.some((value) => value != null);
  } catch {
    // Fail open -- never treat a Redis hiccup as "this requester is
    // blocked".
    return false;
  }
}
