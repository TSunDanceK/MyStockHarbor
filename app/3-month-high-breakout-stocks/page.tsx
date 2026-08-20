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
  title: "3-Month High Breakout Stocks | MyStockHarbor",
  description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  alternates: {
    canonical: "https://www.mystockharbor.com/3-month-high-breakout-stocks",
  },
  openGraph: {
    title: "3-Month High Breakout Stocks | MyStockHarbor",
    description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
    url: "https://www.mystockharbor.com/3-month-high-breakout-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "3-Month High Breakout Stocks | MyStockHarbor",
    description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  },
};

// kind is "preset", not "section": ships the whole universe with
// `threeMonthHighPick` pre-ticked so Select Screener filters in place. That flag
// is derived from this same section (see buildCategoryFlags), so the default set
// is identical to before; sectionIncludes is kept so the range-high reference
// line chart deep link (rangeHighPrice / rangeHighDate), badge and ordering
// survive. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/3-month-high-breakout-stocks",
  eyebrow: "Breakout stock screener",
  title: "3-Month High Breakout Stocks",
  description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  explainerTitle: "How to use 3-month high breakouts",
  explainerBody: "A 3-month high breakout can flag improving momentum before a stock reaches major all-time high territory. Watch for follow-through volume, controlled retests and a lack of immediate rejection.",
  emptyText: "No 3-month high breakout stocks are currently available from the live picker feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["threeMonthHighPick"],
  sectionIncludes: ["3-month high breakout"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
