import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Stocks Above the 50-Day Moving Average | MyStockHarbor",
  description: "Stocks currently trading above their 50-day moving average — a simple gauge of shorter-term uptrend.",
  alternates: { canonical: "https://www.mystockharbor.com/stocks-above-50-day-moving-average" },
  openGraph: {
    title: "Stocks Above the 50-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading above their 50-day moving average — a simple gauge of shorter-term uptrend.",
    url: "https://www.mystockharbor.com/stocks-above-50-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Above the 50-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading above their 50-day moving average — a simple gauge of shorter-term uptrend.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-above-50-day-moving-average",
  eyebrow: "ABOVE 50-DAY MA SCREENER",
  title: "Stocks Above the 50-Day Moving Average",
  description: "Stocks currently trading above their 50-day moving average — a simple gauge of shorter-term uptrend.",
  explainerTitle: "How to use the 50-day moving average",
  explainerBody: "Trading above the 50-day MA is a basic sign of a healthy shorter-term trend. Use it to filter for names in gear, then review the chart and longer-term trend before acting.",
  emptyText: "No stocks are currently trading above their 50-day moving average in the live feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["aboveMA50"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
