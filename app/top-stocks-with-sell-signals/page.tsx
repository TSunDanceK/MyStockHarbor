import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Top Stocks With Sell Signals | MyStockHarbor",
  description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  alternates: {
    canonical: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
  },
  openGraph: {
    title: "Top Stocks With Sell Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
    url: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Top Stocks With Sell Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  },
};

const config: PickerResultConfig = {
  href: "/top-stocks-with-sell-signals",
  eyebrow: "Sell signal stock screener",
  title: "Top Stocks With Sell Signals",
  description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  explainerTitle: "How to use sell signal stocks",
  explainerBody: "Sell signals can flag pullback risk, weak trends or possible short-side pressure. They are best used with the chart, because oversold names can still bounce even while the broader structure is weak.",
  emptyText: "No sell signal stocks are currently available from the live picker feed.",
  tone: "red",
  kind: "sellSignals",
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
