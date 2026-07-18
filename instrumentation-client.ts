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
 * NOTE on SSR: BotID protects these API/data routes, NOT server-rendered page
 * HTML. Data embedded directly in page HTML stays readable (it must, for
 * Googlebot). Fully protecting that data is a separate architecture change
 * (thin SSR + client-fetched protected API).
 *
 * FOLLOW-UP: confirm each route's HTTP method + dynamic shape, expand this
 * list, and add the matching isUnwantedBot() guard to each handler. Candidate
 * data routes:
 *   /api/quote, /api/history, /api/market, /api/symbols, /api/plays,
 *   /api/pickers, /api/discovery-strip, /api/benchmarks, /api/bull-flags,
 *   /api/descending-triangles, /api/stock-earnings/*, /api/stock-valuation/*,
 *   /api/stock-analyst-rating/*, /api/stock-news/*, /api/news, /api/insights,
 *   /api/earnings-calendar
 */
initBotId({
  protect: [
    // Representative starters — expand these alongside the server guards.
    { path: "/api/quote", method: "GET" },
    { path: "/api/history", method: "GET" },
    { path: "/api/stock-earnings/*", method: "GET" },
  ],
});
