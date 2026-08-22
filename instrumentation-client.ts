import { initBotId } from "botid/client/core";

/**
 * Vercel BotID client initialisation.
 *
 * `protect` lists the app-initiated routes we want BotID to classify. The
 * client attaches a signed header to fetches to these paths; the server then
 * validates it with checkBotId() (see lib/botid-guard.ts). A path listed here
 * does NOTHING until a matching server-side guard is added -- so this file is
 * safe on its own and blocks nobody.
 *
 * IMPORTANT: never add server-to-server routes here. They have no browser
 * session and would fail classification:
 *   - /api/jobs/*   (Vercel cron jobs)
 *   - /api/indexnow (SEO ping)
 *
 * Also intentionally NOT protected (checked during the 2026-07-20 site-wide
 * expansion, see PR "Expand BotID Basic coverage site-wide"):
 *   - /api/market -- has no direct browser caller; it's an internal
 *     aggregation endpoint self-fetched server-to-server by /api/plays,
 *     /api/bull-flags, /api/descending-triangles and pickersBuilder.ts to
 *     build their own payloads. Those self-fetches carry no browser BotID
 *     header, so guarding /api/market would risk breaking all of their
 *     universe-refresh pipelines, not just an SSR nicety.
 *   - /api/pickers -- its GET handler (lib/server/pickersBuilder.ts) is
 *     re-exported verbatim by the /api/jobs/warm-picker-universe cron route,
 *     so a guard here would also block that scheduled warm-up. It's also
 *     still HTTP self-fetched server-side by app/pickers/page.tsx
 *     (`fetch(`${base}/api/pickers`, { next: { revalidate: 300 } })`, line
 *     ~81) with no client fallback -- the exact self-fetch-gets-blocked
 *     failure mode already documented in
 *     claude/pickers-firewall-selfblock-2026-07-17.md (a past production
 *     outage from a *different* blocking mechanism). Not safe to touch
 *     without first giving that page the same in-process treatment
 *     PickerResultPage.tsx already got (getPickersData()).
 *
 *     Corrected 2026-08-22. This previously named
 *     app/bullish-divergence-stocks/page.tsx and its bearish twin as the
 *     self-fetchers. Both had already been converted to getPickersData() --
 *     they imported it and never called fetch at all -- and both have now
 *     been deleted outright (next.config.ts 301s the two routes, so neither
 *     had rendered since that redirect landed). The HAZARD IS STILL REAL; only
 *     the file that carries it was wrong. Anyone who checked the two named
 *     files, found no self-fetch, and concluded the constraint had lapsed
 *     would have guarded /api/pickers and broken /pickers.
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
 * NOTE on checkLevel: every route below runs Basic (free) unless it sets
 * advancedOptions.checkLevel explicitly. Deep Analysis (paid) is reserved for
 * routes where every hit is a real, billed upstream call with little or no
 * caching cushion: /api/quote (calls FMP live on every request, zero
 * caching), and /api/stock-news/insight + /api/stock-news/why-it-matters
 * (call OpenAI, cached by unstable_cache keyed on the full request payload --
 * varying attacker-controlled article text forces a fresh, billed OpenAI
 * call every time). checkLevel here MUST match the corresponding
 * checkBotId() call server-side (see lib/botid-guard.ts's
 * isUnwantedBot(checkLevel) and its call sites in app/api/quote/route.ts,
 * app/api/stock-news/insight/route.ts and
 * app/api/stock-news/why-it-matters/route.ts) or verification fails
 * outright. See claude/firewall-bot-protection-audit-2026-07-19.md for the
 * full reasoning and why other routes (already well-cached) weren't picked.
 *
 * /api/ticker-lookup (added alongside the single-category picker pages'
 * "search a ticker across our pickers" box, see
 * app/components/ScreenerNav.tsx's TickerSearch): only ever reads existing
 * memo/Redis caches in-process (getPickersData/getPlaysData/
 * getBullFlagsData/getDescendingTrianglesData, no forceRefresh path exists
 * on this route at all), so it's cheap by construction -- protected mainly
 * for consistency with the other browser-facing data routes below, not
 * because it has an expensive bypass to gate.
 *
 * /api/internal/verify-human (added 2026-07-21, see
 * claude/stock-daily-rate-limit-2026-07-21.md): NOT a data route. It's the
 * BotID Deep Analysis gate for the /stock/* daily real-view limit --
 * middleware.ts redirects an IP here (via app/verify) only after it's
 * already racked up 40+ real page views on /stock/* today and hasn't been
 * checked yet today. The server side (app/api/internal/verify-human/route.ts)
 * short-circuits on an already-known result for that IP+day, so this is at
 * most one Deep Analysis call per IP per day, not one per request.
 *
 * Wired server-side guards so far: /api/quote, /api/history,
 * /api/stock-earnings/*, /api/symbols, /api/plays, /api/bull-flags,
 * /api/descending-triangles, /api/benchmarks, /api/discovery-strip,
 * /api/news, /api/insights/search, /api/earnings-calendar/day,
 * /api/earnings-calendar/backfill-date, /api/stock-valuation/*,
 * /api/stock-analyst-rating/*, /api/stock-news/insight,
 * /api/stock-news/why-it-matters, /api/ticker-lookup,
 * /api/internal/verify-human.
 */
initBotId({
  protect: [
    {
      path: "/api/quote",
      method: "GET",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
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
    {
      path: "/api/stock-news/insight",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      path: "/api/stock-news/why-it-matters",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    { path: "/api/ticker-lookup", method: "GET" },
    {
      path: "/api/internal/verify-human",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
  ],
}
);
