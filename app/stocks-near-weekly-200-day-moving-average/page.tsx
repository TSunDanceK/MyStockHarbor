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
  title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
  description:
    "Browse stocks screening near their weekly 200-day moving average, a slower higher-timeframe trend reference for bigger support and resistance zones.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-near-weekly-200-day-moving-average",
  },
  openGraph: {
    title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
    description:
      "Browse stocks screening near their weekly 200-day moving average using live MyStockHarbor picker data.",
    url: "https://www.mystockharbor.com/stocks-near-weekly-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
    description:
      "Browse stocks screening near their weekly 200-day moving average using live MyStockHarbor picker data.",
  },
};

// kind is "preset", not "section": ships the whole universe with
// `weeklyMa200Proximity` pre-ticked so Select Screener filters in place.
// sectionIncludes + filterTimeframe are kept so the weekly section's badge and
// ordering are re-applied on top (filterTimeframe now only scopes which section
// items enrich, since the W/D split is already carried by the flag itself).
// See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/stocks-near-weekly-200-day-moving-average",
  eyebrow: "Weekly MA200 stock screener",
  title: "Stocks Near Weekly 200-Day Moving Average",
  description:
    "Review stocks screening near the weekly 200-day moving average. These are slower, higher-timeframe levels that can matter for larger trend tests.",
  explainerTitle: "How to use weekly MA200 setups",
  explainerBody:
    "The weekly 200-day moving average is a higher-timeframe reference point. These setups are usually slower than daily MA200 tests, so focus on whether the stock is building support, reclaiming the level, or rejecting from it.",
  emptyText:
    "No weekly MA200 proximity stocks are currently available from the live picker feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["weeklyMa200Proximity"],
  sectionIncludes: ["weekly ma200"],
  filterTimeframe: "W",
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
