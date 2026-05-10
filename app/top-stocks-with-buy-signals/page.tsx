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
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
