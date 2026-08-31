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
  title: "Stocks Below the 200-Day Moving Average | MyStockHarbor",
  description: "Stocks currently trading below their 200-day moving average — a widely watched gauge of a longer-term downtrend or deep pullback.",
  alternates: { canonical: "https://www.mystockharbor.com/stocks-below-200-day-moving-average" },
  openGraph: {
    title: "Stocks Below the 200-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading below their 200-day moving average — a widely watched gauge of a longer-term downtrend or deep pullback.",
    url: "https://www.mystockharbor.com/stocks-below-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Below the 200-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading below their 200-day moving average — a widely watched gauge of a longer-term downtrend or deep pullback.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-below-200-day-moving-average",
  eyebrow: "BELOW 200-DAY MA SCREENER",
  title: "Stocks Below the 200-Day Moving Average",
  description: "Stocks currently trading below their 200-day moving average — a widely watched gauge of a longer-term downtrend or deep pullback.",
  explainerTitle: "How to use the 200-day moving average",
  explainerBody: "Trading below the 200-day MA is generally considered a longer-term caution flag — though deeply oversold names below it can also mark value or reversal setups. Use it as a starting point, not a verdict.",
  emptyText: "No stocks are currently trading below their 200-day moving average in the live feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["belowMA200"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
