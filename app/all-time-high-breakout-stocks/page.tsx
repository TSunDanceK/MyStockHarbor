import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "All-Time High Breakout Stocks | MyStockHarbor",
  description: "Review stocks trading at or near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
  alternates: {
    canonical: "https://www.mystockharbor.com/all-time-high-breakout-stocks",
  },
  openGraph: {
    title: "All-Time High Breakout Stocks | MyStockHarbor",
    description: "Review stocks trading at or near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
    url: "https://www.mystockharbor.com/all-time-high-breakout-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "All-Time High Breakout Stocks | MyStockHarbor",
    description: "Review stocks trading at or near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
  },
};

// kind is "preset", not "section": ships the whole universe with `athBreakoutPick`
// pre-ticked so Select Screener filters in place. That flag is derived from this
// same section (see buildCategoryFlags), so the default set is identical to
// before; sectionIncludes is kept so the ATH reference-line chart deep link
// (athPrice / athDate), badge and ordering survive. See buildEntries in
// PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/all-time-high-breakout-stocks",
  eyebrow: "Breakout stock screener",
  title: "All-Time High Breakout Stocks",
  description: "Review stocks trading at or near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
  explainerTitle: "How to use all-time high breakouts",
  explainerBody: "Breakouts near all-time highs can show strong demand and leadership. The cleaner setups usually hold near the breakout zone rather than immediately failing back into the prior range.",
  emptyText: "No all-time high breakout stocks are currently available from the live picker feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["athBreakoutPick"],
  sectionIncludes: ["all-time high breakout"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
