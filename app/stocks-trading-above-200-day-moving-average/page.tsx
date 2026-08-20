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
  title: "Stocks Above the 200-Day Moving Average | MyStockHarbor",
  description: "Stocks currently trading above their 200-day moving average — a widely watched gauge of a longer-term uptrend.",
  alternates: { canonical: "https://www.mystockharbor.com/stocks-trading-above-200-day-moving-average" },
  openGraph: {
    title: "Stocks Above the 200-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading above their 200-day moving average — a widely watched gauge of a longer-term uptrend.",
    url: "https://www.mystockharbor.com/stocks-trading-above-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Above the 200-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading above their 200-day moving average — a widely watched gauge of a longer-term uptrend.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-trading-above-200-day-moving-average",
  eyebrow: "ABOVE 200-DAY MA SCREENER",
  title: "Stocks Above the 200-Day Moving Average",
  description: "Stocks currently trading above their 200-day moving average — a widely watched gauge of a longer-term uptrend.",
  explainerTitle: "How to use the 200-day moving average",
  explainerBody: "The 200-day MA is the classic long-term trend line; trading above it is generally considered bullish. Use it to filter for names in longer-term uptrends, then confirm with the rest of the chart.",
  emptyText: "No stocks are currently trading above their 200-day moving average in the live feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["aboveMA200"],
  maxItems: 36,
  relatedGuide: {
    href: "/learn/moving-averages",
    label: "our lesson on moving averages",
    blurb: "For why this level matters and how traders use it, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
