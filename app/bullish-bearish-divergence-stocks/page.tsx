import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bullish & Bearish Divergence Stocks | MyStockHarbor",
  description: "Find stocks showing bullish or bearish RSI and MACD divergence signals from the live MyStockHarbor picker feed.",
  alternates: {
    canonical: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
  },
  openGraph: {
    title: "Bullish & Bearish Divergence Stocks | MyStockHarbor",
    description: "Find stocks showing bullish or bearish RSI and MACD divergence signals from the live MyStockHarbor picker feed.",
    url: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bullish & Bearish Divergence Stocks | MyStockHarbor",
    description: "Find stocks showing bullish or bearish RSI and MACD divergence signals from the live MyStockHarbor picker feed.",
  },
};

const config: PickerResultConfig = {
  href: "/bullish-bearish-divergence-stocks",
  eyebrow: "Divergence stock screener",
  title: "Bullish & Bearish Divergence Stocks",
  description: "Find stocks showing bullish or bearish RSI and MACD divergence signals from the live MyStockHarbor picker feed.",
  explainerTitle: "How to use divergence stocks",
  explainerBody: "Divergence can warn that momentum is changing before price confirms it. The best divergence setups usually align with a clear support or resistance area and a visible shift in price behaviour.",
  emptyText: "No divergence stocks are currently available from the live picker feed.",
  tone: "blue",
  kind: "section",
  sectionIncludes: ["divergence"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
