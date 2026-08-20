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
  title: "Stocks Near 200-Day Moving Average | MyStockHarbor",
  description: "Browse stocks screening near their daily or weekly 200-day moving average, a major long-term trend reference.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-near-200-day-moving-average",
  },
  openGraph: {
    title: "Stocks Near 200-Day Moving Average | MyStockHarbor",
    description: "Browse stocks screening near their daily or weekly 200-day moving average, a major long-term trend reference.",
    url: "https://www.mystockharbor.com/stocks-near-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Near 200-Day Moving Average | MyStockHarbor",
    description: "Browse stocks screening near their daily or weekly 200-day moving average, a major long-term trend reference.",
  },
};

// kind is "preset", not "section": ships the whole universe with
// `dailyMa200Proximity` pre-ticked so Select Screener filters in place.
// sectionIncludes is kept so the section's badge and ordering are re-applied on
// top. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/stocks-near-200-day-moving-average",
  eyebrow: "MA200 stock screener",
  title: "Stocks Near 200-Day Moving Average",
  description: "Browse stocks screening near their daily or weekly 200-day moving average, a major long-term trend reference.",
  explainerTitle: "How to use stocks near the 200-day",
  explainerBody: "The 200-day moving average can act as support, resistance or a trend filter. Focus on whether price is reclaiming the level, defending it, or rejecting from it.",
  emptyText: "No MA200 proximity stocks are currently available from the live picker feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["dailyMa200Proximity"],
  sectionIncludes: ["daily ma200"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
