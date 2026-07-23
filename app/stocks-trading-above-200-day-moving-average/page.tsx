import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

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
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
