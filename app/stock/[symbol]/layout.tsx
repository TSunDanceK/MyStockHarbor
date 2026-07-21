import type { ReactNode } from "react";
import PageViewTracker from "@/app/components/PageViewTracker";

// Wraps every /stock/[symbol]/* route (overview, /news, /earnings) so the
// real-page-view beacon fires exactly once per real navigation into any of
// them -- matching the scope of both the existing Vercel Firewall "Rate
// limit /stock category (10min)" rule and the daily cap in middleware.ts.
// See lib/server/dailyPageLimit.ts for why this counts real views instead
// of raw requests.
export default function StockSymbolLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageViewTracker category="stock" />
      {children}
    </>
  );
}
