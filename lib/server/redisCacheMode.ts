// Why the screener pages pass a cache mode to Redis.fromEnv().
//
// @upstash/redis issues every REST call with `cache: "no-store"` by default
// (nodejs.mjs: `cache: configOrRequester.cache ?? "no-store"`). Under the App
// Router that one hint is enough to opt a route out of static rendering:
//
//   Dynamic server usage: Route /x couldn't be rendered statically because it
//   used no-store fetch <upstash>/pipeline
//
// and the route falls back to `ƒ`, server-rendered on every visit and every
// crawl.
//
// This is what kept all 32 screener pages dynamic even after `force-dynamic`,
// `headers()` and `searchParams` were removed. It is invisible on those pages:
// getPickerData() wraps its reads in try/catch, so the DynamicServerError is
// swallowed, the build stays green, and the route silently stays dynamic with
// no log line to explain it. It only shows up as `ƒ` in the build's route
// table -- and only when Redis credentials are actually present, since without
// them the client never issues the call at all. See
// claude/picker-pages-isr-2026-08-20.md.
//
// "default" drops the hint; it does not introduce staleness. Upstash's REST
// API is called over POST and Next's fetch cache only caches GET, so none of
// these reads become cacheable. Freshness stays governed by the page's own
// `revalidate`, which is the intent.
//
// Applied to every client a prerendered page can reach through its module graph.
//
// The rate-limit clients trapBlock and dailyPageLimit keep the no-store default:
// no page reaches them at all, so they gain nothing from this.
//
// backfillAuth USED TO BE ON THAT LIST and no longer is, which is the useful
// part of this note. The stated reason was "never on a static render path" --
// true when written, and falsified since without anyone noticing: pickersBuilder
// imports it, PickerResultPage imports pickersBuilder, and #381 made all 36
// picker pages prerendered. An exemption whose justification is a fact about the
// import graph stops being valid when the graph changes, and nothing was
// watching. scripts/check-page-read-cache.mjs now derives that reachability
// instead of trusting a list, and it is what found this.
//
// Worth being precise about the other half of the old reason, because it reads
// as a safety argument and is not one: "a cached auth read would be a
// correctness bug" does not apply. As the paragraph above says, `cache:
// "default"` only drops the no-store hint -- Upstash calls are POST and Next's
// fetch cache only caches GET, so nothing here becomes cacheable either way.
// ── A DEADLINE ON EVERY UPSTASH REQUEST (#553 CODE-B #144, COWORK #155) ──────
// @upstash/redis sets no request timeout, so a connection that never answers
// held a render until Vercel killed the function at 300 s (the /dashboard
// timeouts, CODE-B #137). Every client now carries a per-request deadline.
//
// THE FUNCTION FORM, ALWAYS: `signal: () => AbortSignal.timeout(ms)` builds a
// fresh signal per request, and on abort the client THROWS without retrying,
// so the caller's own catch path (absent, lock-error, missed symbol) runs. The
// plain form `signal: AbortSignal.timeout(ms)` must never be used: the client
// turns an abort on a non-function signal into a fake HTTP 200 whose result is
// the string "Aborted", so a read would return junk instead of failing.
// scripts/check-redis-timeouts.mjs holds every client to one of the options
// below and runs both forms against a server that never answers.
//
// The values: a single REST command answers in tens of milliseconds and the
// whole /dashboard (five sources) took 4.3 s off Vercel, so 6 s for anything a
// visitor's request waits on; 20 s for jobs and for the multi-MB bulk reads,
// matching jobBudget's FETCH_TIMEOUT_MS. Each timeout is logged once per key
// prefix by lib/server/redisTimeoutLog.ts (installed in instrumentation.ts).
export const REDIS_PAGE_TIMEOUT_MS = 6_000;
export const REDIS_JOB_TIMEOUT_MS = 20_000;

/** Page reads: the prerender-safe cache mode plus the 6 s deadline. */
export const PAGE_READ_CACHE = { cache: "default", signal: () => AbortSignal.timeout(REDIS_PAGE_TIMEOUT_MS) } as const;
/** Bulk reads on a page or build path (multi-MB MGETs): the cache mode plus 20 s. */
export const BULK_READ_CACHE = { cache: "default", signal: () => AbortSignal.timeout(REDIS_JOB_TIMEOUT_MS) } as const;
/** A request-path client that keeps the no-store default (rate limits, API routes): 6 s. */
export const PAGE_TIMEOUT_OPTS = { signal: () => AbortSignal.timeout(REDIS_PAGE_TIMEOUT_MS) } as const;
/** Jobs and job-only stores: 20 s. */
export const JOB_REDIS_OPTS = { signal: () => AbortSignal.timeout(REDIS_JOB_TIMEOUT_MS) } as const;
