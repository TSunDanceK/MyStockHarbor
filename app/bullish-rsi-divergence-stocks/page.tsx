import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bullish RSI Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  alternates: { canonical: "https://www.mystockharbor.com/bullish-rsi-divergence-stocks" },
  openGraph: {
    title: "Bullish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
    url: "https://www.mystockharbor.com/bullish-rsi-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bullish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  },
};

const config: PickerResultConfig = {
  href: "/bullish-rsi-divergence-stocks",
  eyebrow: "BULLISH RSI DIVERGENCE SCREENER",
  title: "Bullish RSI Divergence Stocks",
  description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  explainerTitle: "How to use bullish RSI divergence",
  explainerBody: "A bullish RSI divergence — price falling while RSI turns up — can flag waning downside momentum and a possible reversal. Use it as a starting point for chart review, not an automatic buy; confirm with support and volume.",
  emptyText: "No stocks are currently showing a bullish RSI divergence in the live feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["bullishRsiDivergence"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
