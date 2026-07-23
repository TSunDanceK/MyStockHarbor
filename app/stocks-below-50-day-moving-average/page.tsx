import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stocks Below the 50-Day Moving Average | MyStockHarbor",
  description: "Stocks currently trading below their 50-day moving average — a simple gauge of shorter-term weakness or pullback.",
  alternates: { canonical: "https://www.mystockharbor.com/stocks-below-50-day-moving-average" },
  openGraph: {
    title: "Stocks Below the 50-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading below their 50-day moving average — a simple gauge of shorter-term weakness or pullback.",
    url: "https://www.mystockharbor.com/stocks-below-50-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Below the 50-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading below their 50-day moving average — a simple gauge of shorter-term weakness or pullback.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-below-50-day-moving-average",
  eyebrow: "BELOW 50-DAY MA SCREENER",
  title: "Stocks Below the 50-Day Moving Average",
  description: "Stocks currently trading below their 50-day moving average — a simple gauge of shorter-term weakness or pullback.",
  explainerTitle: "How to use the 50-day moving average",
  explainerBody: "Trading below the 50-day MA flags shorter-term weakness or a pullback — sometimes a warning, sometimes a dip in a larger uptrend. Check the bigger picture before drawing conclusions.",
  emptyText: "No stocks are currently trading below their 50-day moving average in the live feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["belowMA50"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
