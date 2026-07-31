import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Top Stocks With Buy Signals | MyStockHarbor",
  description: "Browse stocks currently showing multiple bullish technical conditions from the live MyStockHarbor picker feed.",
  alternates: {
    canonical: "https://www.mystockharbor.com/top-stocks-with-buy-signals",
  },
  openGraph: {
    title: "Top Stocks With Buy Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bullish technical conditions from the live MyStockHarbor picker feed.",
    url: "https://www.mystockharbor.com/top-stocks-with-buy-signals",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Top Stocks With Buy Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bullish technical conditions from the live MyStockHarbor picker feed.",
  },
};

// kind stays "buySignals" -- that branch of buildEntries keeps this page's own
// presentation (the "N of 9 bullish conditions met" note, the score pill driven
// by that count, and reason chips drawn from BUY_REASON_DEFS rather than all 25
// tracked conditions), which the generic "preset" path would flatten.
//
// presetFilters is what opts it into filtering in place: the page ships the full
// universe with `hasBuySignal` pre-ticked, so Select Screener can narrow it
// further (buy signals AND oversold) or widen it by unticking, without
// navigating away. See PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/top-stocks-with-buy-signals",
  eyebrow: "Buy signal stock screener",
  title: "Top Stocks With Buy Signals",
  description: "Browse stocks currently showing multiple bullish technical conditions from the live MyStockHarbor picker feed.",
  explainerTitle: "How to use buy signal stocks",
  explainerBody: "Buy signal pages are starting points, not automatic entries. Look for agreement between the mini chart, broader trend, moving averages, momentum and recent news before treating a signal as actionable.",
  emptyText: "No buy signal stocks are currently available from the live picker feed.",
  tone: "green",
  kind: "buySignals",
  presetFilters: ["hasBuySignal"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
