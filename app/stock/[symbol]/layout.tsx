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
export const revalidate = 900;
