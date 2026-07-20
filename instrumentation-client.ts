import { initBotId } from "botid/client/core";

/**
 * Vercel BotID client initialisation.
 *
 * `protect` lists the app-initiated routes we want BotID to classify. The
 * client attaches a signed header to fetches to these paths; the server then
 * validates it with checkBotId() (see lib/botid-guard.ts). A path listed here
 * does NOTHING until a matching server-side guard is added — so this file is
 * safe on its own and blocks nobody.
 *
 * IMPORTANT: never add server-to-server routes here. They have no browser
 * session and would fail classification:
 *   - /api/jobs/*   (Vercel cron jobs)
 *   - /api/indexnow (SEO ping)
 *
 * Also intentionally NOT protected (checked during the 2026-07-20 site-wide
 * expansion, see PR "Expand BotID Basic coverage site-wide"):
 *   - /api/market — has no direct browser caller; it's an internal
 *     aggregation endpoint self-fetched server-to-server by /api/plays,
 *     /api/bull-flags, /api/descending-triangles and pickersBuilder.ts to
 *     build their own payloads. Those self-fetches carry no browser BotID
 *     header, so guarding /api/market would risk breaking all of their
 *     universe-refresh pipelines, not just an SSR nicety.
 *   - /api/pickers — its GET handler (lib/server/pickersBuilder.ts) is
 *     re-exported verbatim by the /api/jobs/warm-picker-universe cron route,
 *     so a guard here would also block that scheduled warm-up. It's also
 *     still HTTP self-fetched with `cache: "no-store"` and no client
 *     fallback by app/bullish-divergence-stocks/page.tsx and
 *     app/bearish-divergence-stocks/page.tsx — the exact self-fetch-gets-
 *     blocked failure mode already documented in
 *     claude/pickers-firewall-selfblock-2026-07-17.md (a past production
 *     outage from a *different* blocking mechanism). Not safe to touch
 *     without first giving pickers the same in-process treatment
 *     PickerResultPage.tsx already got (getPickersData()).
 *
 * NOTE on SSR: BotID protects these API/data routes, NOT server-rendered page
 * HTML. Data embedded directly in page HTML stays readable (it must, for
 * Googlebot). Fully protecting that data is a separate architecture change
 * (thin SSR + client-fetched protected API).
 *
 * NOTE on self-fetches that ARE protected below (/api/plays, /api/bull-flags,
 * /api/descending-triangles, /api/benchmarks): each has a page.tsx that also
 * self-fetches it server-side for SSR prefetch. That self-fetch carries no
 * browser BotID header either, so it will now itself read as bot traffic and
 * get a 403 -- but each of those page.tsx fall back gracefully (Next Data
 * Cache revalidate window keeps serving the last good payload, and the
 * client component re-fetches with the browser's real header on mount), the
 * same accepted trade-off already shipped for /api/quote on the dashboard.
 * /api/pickers and /api/market do NOT have that safety net, which is why
 * they're excluded above.
 *
 * Wired server-side guards so far: /api/quote, /api/history,
 * /api/stock-earnings/*, /api/symbols, /api/plays, /api/bull-flags,
 * /api/descending-triangles, /api/benchmarks, /api/discovery-strip,
 * /api/news, /api/insights/search, /api/earnings-calendar/day,
 * /api/earnings-calendar/backfill-date, /api/stock-valuation/*,
 * /api/stock-analyst-rating/*, /api/stock-news/insight,
 * /api/stock-news/why-it-matters.
 */
initBotId({
  protect: [
    { path: "/api/quote", method: "GET" },
    { path: "/api/history", method: "GET" },
    { path: "/api/stock-earnings/*", method: "GET" },
    { path: "/api/symbols", method: "GET" },
    { path: "/api/plays", method: "GET" },
    { path: "/api/bull-flags", method: "GET" },
    { path: "/api/descending-triangles", method: "GET" },
    { path: "/api/benchmarks", method: "GET" },
    { path: "/api/discovery-strip", method: "GET" },
    { path: "/api/news", method: "GET" },
    { path: "/api/insights/search", method: "GET" },
    { path: "/api/earnings-calendar/day", method: "GET" },
    { path: "/api/earnings-calendar/backfill-date", method: "POST" },
    { path: "/api/stock-valuation/*", method: "GET" },
    { path: "/api/stock-analyst-rating/*", method: "GET" },
    { path: "/api/stock-news/insight", method: "POST" },
    { path: "/api/stock-news/why-it-matters", method: "POST" },
  ],
});
