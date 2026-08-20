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
// Deliberately applied ONLY to clients that a prerendered page reads through.
// The rate-limit and auth clients (trapBlock, backfillAuth, dailyPageLimit)
// keep the no-store default: they are never on a static render path, so they
// gain nothing from this, and a cached auth or rate-limit read would be a
// correctness bug rather than a performance win.
export const PAGE_READ_CACHE = { cache: "default" } as const;
