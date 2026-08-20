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
