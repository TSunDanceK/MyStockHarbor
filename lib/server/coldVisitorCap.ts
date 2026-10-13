// ONE VISITOR, AT MOST 20 NEW TICKERS A DAY, ACROSS EVERY COLD FILL
// (#553 COWORK #122/#123; Relay A's SEC cold fill joins it in #552 COWORK #132).
//
// The owner's rule: limit what costs us, not page views. A cold fill (B's
// Tiingo history, A's SEC fact set) is the costly thing, so each visitor may
// start fills for at most COLD_VISITOR_NEW_TICKERS_PER_DAY distinct symbols in
// a UTC day. Pages for symbols we already hold are never counted.
//
// A SET, NOT A COUNTER: a page that needs both a Tiingo and an SEC fill counts
// ONCE, whichever path asks first, and a retry of the same ticker is free.
//
// VISITOR DATA, NOT TIINGO OR SEC DATA, hence the neutral key and module. B
// owns it; A imports it. Neither copies it.
//
// FAILS CLOSED. No address, no Redis, or any Redis error refuses: the caller
// must not fetch (it queues instead, or shows its waiting state).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { toDashed } from "../symbolSpellings.mjs";

// PAGE_READ_CACHE because the stock page imports the actions that import this,
// and a bare client in a prerenderable page's graph opts the route out of
// static rendering (check-page-read-cache), as in secColdFill.ts. One retry:
// a cold fill that cannot count does not fetch, so there is nothing to save by
// waiting longer.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ ...PAGE_READ_CACHE, retry: { retries: 1, backoff: () => 50 } })
    : null;

/** New tickers one visitor may cold-fill per UTC day, Tiingo and SEC together. */
export const COLD_VISITOR_NEW_TICKERS_PER_DAY = 20;

/** 25 h: the same buffer past the UTC day as dailyPageLimit's buckets. */
export const COLD_VISITOR_TTL_SECONDS = 25 * 60 * 60;

export const COLD_VISITOR_PREFIX = "msh:cold:visitor:v1";

export type ColdVisitorVerdict =
  | { ok: true; count: number; repeat: boolean }
  | { ok: false; reason: "cap" | "no-ip" | "no-redis" | "redis-error"; count: number | null };

/** msh:cold:visitor:v1:<YYYYMMDD UTC>:<ip> */
export function coldVisitorKey(ip: string, nowMs: number = Date.now()): string {
  const day = new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "");
  return `${COLD_VISITOR_PREFIX}:${day}:${ip}`;
}

/** Pure: the verdict for one SADD/SCARD answer. Exported for the checks. */
export function coldVisitorVerdict(added: number, count: number): ColdVisitorVerdict {
  if (!Number.isFinite(added) || !Number.isFinite(count)) return { ok: false, reason: "redis-error", count: null };
  if (added === 0) return { ok: true, count, repeat: true };
  if (count > COLD_VISITOR_NEW_TICKERS_PER_DAY) return { ok: false, reason: "cap", count };
  return { ok: true, count, repeat: false };
}

/**
 * Count `symbol` against this visitor's day. FAILS CLOSED: no IP ("unknown" or
 * empty), no Redis, or any Redis error -> ok:false, and the caller must not fetch.
 *
 * 3 commands (one pipeline: SADD, SCARD, EXPIRE NX); a refusal adds 1 SREM so
 * the refused ticker is not left in the set to pass later as a repeat.
 */
export async function admitColdVisitor(ip: string, symbol: string, nowMs: number = Date.now()): Promise<ColdVisitorVerdict> {
  const addr = String(ip ?? "").trim();
  if (!addr || addr === "unknown") return { ok: false, reason: "no-ip", count: null };
  if (!redis) return { ok: false, reason: "no-redis", count: null };
  const sym = toDashed(String(symbol ?? "").trim().toUpperCase());
  const key = coldVisitorKey(addr, nowMs);
  try {
    const p = redis.pipeline();
    p.sadd(key, sym);
    p.scard(key);
    p.expire(key, COLD_VISITOR_TTL_SECONDS, "NX");
    const [added, count] = (await p.exec()) as [number, number, number];
    const verdict = coldVisitorVerdict(Number(added), Number(count));
    if (!verdict.ok && verdict.reason === "cap") {
      try {
        await redis.srem(key, sym);
      } catch {
        // The refusal stands either way; a left-over member only makes a later
        // retry of this one ticker read as a repeat on an already-full day.
      }
    }
    return verdict;
  } catch {
    return { ok: false, reason: "redis-error", count: null };
  }
}
