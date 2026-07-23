import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

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

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
