// A STALE SET REFRESHES ITSELF WHEN SOMEONE LOOKS AT IT — after the response,
// never during it.
//
// ── THE GAP THIS CLOSES ───────────────────────────────────────────────────
// secColdFetch already re-fetches a stored set on a chain-hash mismatch, but
// ONLY when that set came back EMPTY. A POPULATED stale set has no path back to
// the current chains except the cron's rewindow queue, and that queue is sized
// for a migration with no deadline. Measured after `oneConceptPerFiler` landed:
// 431 SYMBOLS eligible, and even with the slack borrowing merged in #468 that
// is three days during which a page someone is actually reading serves figures
// resolved under a rule production no longer runs.
//
// The cron is the FLOOR — it reaches every symbol eventually, whether or not
// anyone visits. This is the fast path for the ones being read, and it does not
// replace the queue: a symbol refreshed here still has its manifest entry
// updated, so the cron simply finds it current when its turn comes.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
// IT NEVER BLOCKS A RENDER. The stale set is returned to the page first and the
// refresh runs in `after()`. A reader waiting 3MB for a figure that is complete
// but not current is a worse page than one that renders immediately, and the
// difference is invisible to them either way — the corrected values land on the
// next view.
//
// IT NEVER DECIDES WHAT STALE MEANS. `needsReread` is imported from
// secStaleness, the same function the cron's queue selects on. A second
// predicate that agreed today is how the read path and the write path drift
// apart, and the whole reason that function was moved out of the route.
import { after } from "next/server";
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { needsReread, staleReasons } from "./secStaleness";
import type { StoredFactSet } from "./secFactCodec";

// Redis.fromEnv WITH PAGE_READ_CACHE, the same construction as secColdFetch and
// secFactStore. @upstash/redis sends `cache: "no-store"` by default and ONE such
// hint opts the whole route out of static rendering — which on a render path is
// the difference between paying the fetch per revalidation window and paying it
// per visitor. check-page-read-cache asserts it.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ ...PAGE_READ_CACHE, retry: { retries: 1, backoff: () => 200 } })
    : null;

const LOCK_PREFIX = "msh:sec:refresh-lock:v1";
const COOLDOWN_PREFIX = "msh:sec:refresh-cooldown:v1";
const RATE_PREFIX = "msh:sec:refresh-rate:v1";

/**
 * How long one symbol's refresh holds the lock.
 *
 * LONGER THAN THE FETCH, SHORTER THAN THE COOLDOWN. It exists to stop two
 * concurrent renders of the same page both fetching 3MB, so it only has to
 * outlive a single attempt — SEC_COLD_TIMEOUT_MS is 5s and the measured p90 is
 * 327ms. Sixty seconds is generous against both and still self-heals quickly if
 * a lambda dies holding it.
 */
export const REFRESH_LOCK_TTL_S = 60;

/**
 * How long before the same symbol may be refreshed again.
 *
 * THIS IS THE GUARD AGAINST A FAILING SYMBOL, not against a popular one — the
 * lock handles concurrency. A symbol whose fetch throws every time would
 * otherwise re-attempt on every single view: the cooldown is set BEFORE the
 * attempt and is not cleared on failure, so one bad symbol costs one fetch an
 * hour rather than one per reader.
 *
 * An hour is also comfortably shorter than the cron's daily cadence, so a
 * symbol being read stays ahead of the queue rather than racing it.
 */
export const REFRESH_COOLDOWN_S = 3600;

/**
 * Refreshes site-wide per minute, across ALL symbols.
 *
 * ── ITS OWN BUCKET, NOT THE COLD PATH'S ───────────────────────────────────
 * Sharing `msh:sec:cold-rate` would let refreshes spend the budget that exists
 * so a reader of a NEVER-POPULATED symbol gets a page at all. Those two are not
 * interchangeable: a cold fetch is the difference between a page and a "not
 * loaded yet" card, and a refresh is the difference between current figures and
 * complete-but-older ones. The first outranks the second, and one bucket cannot
 * express that.
 *
 * TEN, half the cold path's twenty. Together they are 30/min against SEC's
 * published 10 requests/SECOND, so the pair is still two orders of magnitude
 * inside fair access — and the cooldown means the steady state is far below
 * this, because each symbol can only contribute once an hour.
 */
export const REFRESH_FETCHES_PER_MINUTE = 10;

/**
 * Take the per-symbol lock. False means someone else is already on it.
 *
 * SET NX EX, one command, so the check and the take cannot separate. A
 * read-then-write would let two renders both read "unlocked" and both fetch,
 * which is precisely the case the lock exists for.
 *
 * FAILS CLOSED, unlike claimColdFetch's rate bucket. A Redis error here means
 * "I do not know whether anyone else holds this", and the safe answer for an
 * optional background refresh is to skip — nothing is lost but a cycle, and the
 * cron still covers the symbol. The cold path fails OPEN because refusing there
 * costs a reader their page.
 */
async function takeLock(symbol: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const res = await redis.set(`${LOCK_PREFIX}:${symbol}`, "1", {
      nx: true,
      ex: REFRESH_LOCK_TTL_S,
    });
    return res === "OK";
  } catch {
    return false;
  }
}

/**
 * True when this symbol has not been refreshed recently.
 *
 * SET BEFORE THE ATTEMPT, NOT AFTER IT, and never cleared on failure. See
 * REFRESH_COOLDOWN_S: a symbol that throws on every fetch is exactly the one
 * that must not be retried per view, and a cooldown written only on success
 * would give it unlimited attempts.
 */
async function claimCooldown(symbol: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const res = await redis.set(`${COOLDOWN_PREFIX}:${symbol}`, "1", {
      nx: true,
      ex: REFRESH_COOLDOWN_S,
    });
    return res === "OK";
  } catch {
    return false;
  }
}

/**
 * The site-wide per-minute budget for refreshes.
 *
 * Same minute-resolution bucket as the cold path, and the same 120s expiry for
 * the same reason: a bucket created at :59 would otherwise expire a second
 * later and hand the next second a fresh allowance.
 */
async function claimRate(): Promise<boolean> {
  if (!redis) return false;
  try {
    const key = `${RATE_PREFIX}:${new Date().toISOString().slice(0, 16)}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 120);
    if (n > REFRESH_FETCHES_PER_MINUTE) {
      // Not a warning. Spending the minute's refresh budget is the system
      // working: every symbol turned away here is still current enough to
      // render and is still in the cron's queue.
      console.info(
        `[sec-refresh] budget spent: ${n} refreshes this minute (cap ${REFRESH_FETCHES_PER_MINUTE})`
      );
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * ── THE ORDER OF THE GUARDS IS THE DESIGN ─────────────────────────────────
 *
 * Cheapest and most selective first, so the common case — a current set, which
 * is every set once the migration drains — costs ZERO Redis commands:
 *
 *   1. needsReread   in-process, no I/O. Most views stop here.
 *   2. cooldown      one command. Rejects a symbol already done this hour,
 *                    including one that failed, before any budget is touched.
 *   3. rate          one command. Site-wide, so it must come after the
 *                    per-symbol rejections or a single hot symbol's repeated
 *                    views would spend the budget for everyone else.
 *   4. lock          one command. Last, because it is the only one that must be
 *                    RELEASED, and taking it before a guard that might refuse
 *                    would leave it held for nothing.
 *
 * GETTING THIS ORDER WRONG IS NOT A PERFORMANCE DETAIL. Rate before cooldown
 * lets one symbol under cooldown consume the site's whole minute; lock before
 * rate strands the lock for its full TTL on every budget refusal, which blocks
 * the symbol for a minute for no work done.
 */
export async function maybeRefreshOnView(
  set: StoredFactSet,
  refetch: (symbol: string) => Promise<unknown>
): Promise<void> {
  if (!needsReread(set)) return;
  const symbol = set.symbol;

  // after() ONLY EXISTS INSIDE A REQUEST OR RENDER SCOPE and throws outside
  // one. Same guard as fmpUsage's scheduleFlush: this is an optimisation over
  // the cron, not the mechanism, so a throw here must not reach the render.
  try {
    after(async () => {
      try {
        if (!(await claimCooldown(symbol))) return;
        if (!(await claimRate())) return;
        if (!(await takeLock(symbol))) return;
        try {
          // THE SAME WRITE PATH THE COLD FETCH USES. Passed in rather than
          // imported, so this module holds no second copy of "how a set is
          // fetched, extracted, encoded and stored" — and so a change to that
          // path cannot leave a stale duplicate here.
          await refetch(symbol);
          console.info(
            `[sec-refresh] ${symbol} refreshed on view (was stale: ${staleReasons(set).join(",")})`
          );
        } finally {
          // RELEASED ON FAILURE TOO. The cooldown is what stops a failing
          // symbol retrying; holding the lock as well would add nothing and
          // would block the cron's own refresh of the same symbol.
          try {
            await redis?.del(`${LOCK_PREFIX}:${symbol}`);
          } catch {
            // The TTL releases it. Nothing to do and nothing to report.
          }
        }
      } catch (err) {
        // A BACKGROUND REFRESH NEVER FAILS A PAGE. The response is already
        // sent; the worst outcome is that the set stays stale until the cron
        // reaches it, which is the behaviour without this file at all.
        console.warn(`[sec-refresh] ${symbol}: ${String((err as Error)?.message ?? err)}`);
      }
    });
  } catch {
    // Not in a request scope. The cron is the floor and still covers it.
  }
}
