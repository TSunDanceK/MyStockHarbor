import type { ReactNode } from "react";
import PageViewTracker from "@/app/components/PageViewTracker";
import StockPagesBottomNav from "@/app/components/StockPagesBottomNav";

// Wraps every /stock/[symbol]/* route (overview, /news, /earnings) so the
// real-page-view beacon fires exactly once per real navigation into any of
// them -- matching the scope of both the existing Vercel Firewall "Rate
// limit /stock category (10min)" rule and the daily cap in middleware.ts.
// See lib/server/dailyPageLimit.ts for why this counts real views instead
// of raw requests.
//
// The bottom nav mounts here for the same reason: its scope is exactly these
// three routes plus /dashboard, and this layout already owns three of the
// four. It reads the ticker out of the pathname, so nothing needs passing
// down from the pages. Rendered after {children} so the reading and tab
// order end with the page's own content rather than with site chrome -- it
// is position: fixed, so where it sits in the flow makes no visual
// difference, only that ordering does.
export default function StockSymbolLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageViewTracker category="stock" />
      {children}
      <StockPagesBottomNav />
    </>
  );
}

// ── ISR (2026-08-20) ────────────────────────────────────────────────────────
//
// None of the three routes under this layout has ever carried a `dynamic` or
// `revalidate` export, yet every production request logs `cache=MISS`: each
// one renders from scratch for every visitor and every crawl. Over 24h that
// is ~650 renders on the overview, ~615 on /news and ~575 on /earnings, all
// serving substantially the same HTML.
//
// Declared here rather than in each page because segment config cascades to
// nested routes, so one line covers all three and they cannot drift apart.
//
// WHY 900 AND NOT 3600 (the value /bottlenecks uses) -- this is a safety
// constraint, not a freshness one. app/stock/[symbol]/page.tsx calls
// mintQuoteToken() during render and embeds the result in the HTML, and that
// token has an 1800s TTL (lib/server/quoteToken.ts). Cache the page longer
// than the TTL and most visitors are handed an already-expired token.
// Harmless today -- QUOTE_TOKEN_ENFORCE defaults off, so failures are logged
// and never blocked -- but it would fill the pilot's logs with false expiries,
// which is the entire signal that pilot exists to collect, and it would break
// live quotes for real visitors the day enforcement is turned on. At 900
// against 1800, every token served still has at least 15 minutes of life.
//
// Freshness is unchanged: fetchQuote() in page.tsx already caches the FMP
// quote for 3600s, so the price in this HTML is ALREADY up to an hour old,
// and StockSymbolPageClient refetches a live quote on mount regardless.
//
// Crawl protection is unchanged: the daily /stock/* cap and the Vercel
// Firewall rules both run in middleware at the edge, which a cached response
// still passes through, and the view counting is a client beacon to
// /api/internal/track-view rather than anything to do with rendering.
//
// That upstream cause was real, and is now fixed rather than predicted. The
// @upstash/redis client issues its REST calls with `cache: "no-store"`, which
// opts an entire route out of static rendering; getDailyHistory() reads Redis
// on every render of all three routes. The fix was NOT unstable_cache (the
// guess recorded in the earlier version of this comment) but an explicit cache
// mode on the clients a prerendered page reads through --
// lib/server/redisCacheMode.ts, landed with the screener ISR work. historyCache
// is already on that list; its direct FMP fetch carried its own `no-store` and
// has been given a short Next revalidate for the same reason.
//
// Verifying this: a build WITHOUT UPSTASH_REDIS_REST_* credentials proves
// nothing here -- the client short-circuits, never issues the call that does the
// bailing, and the route table reports static whether or not it is. And a route
// showing as cached does not mean the HTML has DATA in it. Both rules were
// learned the hard way; see claude/picker-pages-isr-2026-08-20.md.
// ─────────────────────────────────────────────────────────────────────────────
// 3600, NOT 900, AND THE REASON IS THAT THIS ROUTE IS THE BILL.
//
// ISR Writes are 7.7M and $30.80 of a $67.48 Vercel bill -- 46%, the largest
// single line by a wide margin -- and this is the only ISR surface with a path
// space bigger than a few dozen. The bound is exact on the other side: every
// other revalidating page in app/ sits at 1800s or slower over ~84 paths, which
// is a hard ceiling of ~4,000 regenerations a day however much traffic arrives.
// /stock/[symbol] at 900s is 96 a day PER PATH, across three tabs per symbol.
// Nothing else can be the line.
//
// WHAT A REGENERATION HERE ACTUALLY REBUILDS, which is why stretching it is
// cheap: the server render holds the SHELL -- company name, sector, profile,
// income statement -- and every one of those is on a 24-hour FMP cache. Nothing
// in it changes between 15 minutes and an hour.
//
// WHAT IS NOT ON THIS CLOCK, and this is the part that makes 3600 safe rather
// than a freshness cut. The three things a reader would notice are fetched
// CLIENT-SIDE with their own caches, on every load, regardless of this value:
//
//   price          /api/quote           60s Redis cache, tryReserveFmpCallSlot
//   valuation      /api/stock-valuation its own cache
//   analyst rating /api/stock-analyst-rating  its own cache
//
// The chart is server-seeded (initialHistory) and the client fetch is skipped
// when it is, so the CHART is on this clock -- daily candles, where an hour is
// immaterial and the last bar is a running close either way. That is the one
// real change and it is the one this route can afford.
//
// AND THE SEED IS WHY THIS ALSO CUTS REDIS. Each regeneration calls
// getDailyHistory(), a ~110 KB read (lib/server/redisBandwidth.ts). Stretching
// 900 -> 3600 cuts those fourfold. The size of that saving is NOT asserted here:
// #419's caller-tagged meter is what will measure it, and the honest sequence is
// to let it, rather than to claim a number the way the first version of this
// change did.
export const revalidate = 3600;

// Returns no params ON PURPOSE. Without a generateStaticParams export at all,
// a dynamic segment cannot be ISR at all -- measured, not assumed: with the
// force-dynamic exports and the historyCache no-store already gone, all three
// routes still built as `f` (server-rendered on demand) until this existed.
// With it they build as `●` at 15m, and `dynamicParams` (true by default) means
// every symbol still resolves.
//
// Returning an EMPTY list rather than a symbol list is the whole point, for two
// reasons:
//
// 1. Prerendering a list would be a build-time FMP storm. Each path calls
//    getDailyHistory(), which on a Redis miss hits FMP, against a 300/min
//    ceiling with a documented history of stage starvation. This is exactly why
//    app/insights/[slug]/page.tsx deliberately REMOVED its generateStaticParams
//    -- read the comment there before adding a list here. Three routes per
//    symbol multiplies it by three.
//
// 2. A build-time render is the one render that happens with no live request
//    behind it, and it is what bakes a bad artefact. Verified: a two-symbol
//    probe against a cold cache emitted /stock/AAPL.html carrying
//    `initialQuote: {price: null}`, no company name and an "Unavailable" state
//    -- a green build producing a data-less page, the same failure the screener
//    pages shipped (claude/picker-pages-isr-2026-08-20.md). With no params, the
//    HTML that gets cached is produced by a real request at runtime, when Redis
//    is warm and FMP is reachable, and the guard in page.tsx refuses to cache it
//    if it is not.
//
// Net effect for a crawler is identical -- first request generates, everyone
// after that gets cached HTML for 15 minutes -- with no build cost and no
// empty artefact.
export function generateStaticParams() {
  return [];
}
