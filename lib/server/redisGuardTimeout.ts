/**
 * Time-bounded wrapper for the Redis reads that sit in the MIDDLEWARE hot
 * path (lib/server/trapBlock.ts, lib/server/dailyPageLimit.ts).
 *
 * ── The bug this exists to fix ──────────────────────────────────────────
 * Every Redis guard in this codebase documents itself as "fail open": if
 * Redis is unreachable, nothing is blocked. That was implemented as a bare
 * try/catch, which catches ERRORS but not SLOWNESS. A reachable-but-slow
 * Upstash produces no error at all -- the `await` simply sits there. Worse,
 * @upstash/redis retries with backoff by default, so one slow call becomes
 * several.
 *
 * middleware.ts runs on every non-static request and does at least one
 * Redis round-trip (the trap-block check) before any routing decision, and
 * up to three on /stock/*. So an unbounded await there is a single point of
 * failure for the ENTIRE site: on 2026-08-10 between 13:19 and 13:21 UTC,
 * 12 distinct clients got
 *   "Your function was stopped as it did not return an initial response
 *    within 25s"
 * on route=/middleware. Nothing rendered at all. It cleared on its own and
 * has not recurred.
 *
 * ── What actually triggered it is still unknown ─────────────────────────
 * Two candidate causes, and the runtime logs for that window have since
 * aged out, so neither could be confirmed after the fact:
 *
 *   (a) an Upstash latency spike, or
 *   (b) a bot flood -- every request middleware sees makes a Redis call, so
 *       enough concurrent traffic saturates Upstash and produces the exact
 *       same hang.
 *
 * They need different follow-up work: (a) is fully cured by this file,
 * while (b) additionally wants a Vercel Firewall rate limit. That is why
 * the timeout path logs rather than failing silently -- see below.
 *
 * ── The diagnostic, which is half the point ─────────────────────────────
 * On timeout we return the fallback immediately BUT keep a handler attached
 * to the abandoned promise, so when Redis eventually answers we log how
 * long it really took. A `late-response` line at ~600ms reads very
 * differently from one at ~8000ms, and the accompanying ip/ja4 context says
 * whether the slow requests share a client fingerprint (bots) or are spread
 * across unrelated visitors (Upstash). Next occurrence is evidence instead
 * of guesswork.
 *
 * Grep for `[redis-guard]` in Vercel runtime logs.
 *
 * ── Safety ──────────────────────────────────────────────────────────────
 * This can only ever make the guards MORE permissive, never less: every
 * caller passes the same fallback its catch block already returned (false /
 * 0 = "not blocked", "not flagged"). A timeout therefore lets the request
 * through, exactly as a Redis outage already did.
 */

/** Deliberately well under Vercel's 25s middleware ceiling and under any
 *  latency a healthy Upstash round-trip shows (single-digit to low tens of
 *  ms from iad1). Tunable without a code change via REDIS_GUARD_TIMEOUT_MS
 *  in case the floor turns out to be tighter than expected. */
const DEFAULT_TIMEOUT_MS = 400;

const TIMED_OUT = Symbol("redis-guard-timed-out");

function timeoutMs(): number {
  const raw = Number(process.env.REDIS_GUARD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Strip CR/LF/tab and truncate anything client-controlled before it reaches
 * a log line. `context` carries IPs, JA4 digests and similar header-derived
 * values; without this a caller could smuggle a newline and forge a second,
 * fake "[redis-guard]" line -- poisoning the very data this wrapper exists
 * to collect. Mirrors logSafe() in app/api/quote/route.ts.
 */
function logSafe(value: string | null | undefined, max = 120): string {
  if (!value) return "";
  const cleaned = value.replace(/[\r\n\t]+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return logSafe(message, 160) || "unknown";
}

/**
 * Run a Redis read with a hard time budget.
 *
 * @param operation Thunk performing the read. Taken as a function rather
 *                  than a promise so nothing is started if a caller ever
 *                  short-circuits before this point.
 * @param fallback  Value returned on timeout OR error. MUST be the
 *                  permissive answer -- see the safety note above.
 * @param label     Short identifier for the log line, e.g. "trap-block".
 * @param context   Optional caller detail (ip=... ja4=...), sanitised here.
 */
export async function withRedisTimeout<T>(
  operation: () => Promise<T>,
  fallback: T,
  label: string,
  context = ""
): Promise<T> {
  const budget = timeoutMs();
  const startedAt = Date.now();
  const detail = logSafe(context);
  const suffix = detail ? ` ${detail}` : "";

  const work = operation();

  // Two jobs: (1) keep the abandoned promise from ever surfacing as an
  // unhandled rejection once we've raced past it, and (2) record the TRUE
  // latency when it finally settles. Only logs in the abandoned case --
  // a call that beat the budget is the normal path and must stay silent.
  let abandoned = false;
  void work.then(
    () => {
      if (abandoned) {
        console.warn(
          `[redis-guard] late-response label=${label}` +
            ` elapsedMs=${Date.now() - startedAt} budgetMs=${budget}${suffix}`
        );
      }
    },
    (error: unknown) => {
      if (abandoned) {
        console.warn(
          `[redis-guard] late-error label=${label}` +
            ` elapsedMs=${Date.now() - startedAt} budgetMs=${budget}` +
            ` error=${errorText(error)}${suffix}`
        );
      }
    }
  );

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const raced = await Promise.race<T | typeof TIMED_OUT>([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), budget);
      }),
    ]);

    if (raced === TIMED_OUT) {
      abandoned = true;
      console.warn(
        `[redis-guard] timeout label=${label} budgetMs=${budget}` +
          ` (failing open; watch for a matching late-response line)${suffix}`
      );
      return fallback;
    }

    return raced;
  } catch (error) {
    // Preserves the previous behaviour of each guard's own catch block,
    // except that it is now visible in the logs rather than swallowed.
    console.warn(
      `[redis-guard] error label=${label}` +
        ` elapsedMs=${Date.now() - startedAt} error=${errorText(error)}${suffix}`
    );
    return fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
