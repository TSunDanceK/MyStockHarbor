import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bullish MACD Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD histogram makes higher lows.",
  alternates: { canonical: "https://www.mystockharbor.com/bullish-macd-divergence-stocks" },
  openGraph: {
    title: "Bullish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD histogram makes higher lows.",
    url: "https://www.mystockharbor.com/bullish-macd-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bullish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD histogram makes higher lows.",
  },
};

const config: PickerResultConfig = {
  href: "/bullish-macd-divergence-stocks",
  eyebrow: "BULLISH MACD DIVERGENCE SCREENER",
  title: "Bullish MACD Divergence Stocks",
  description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD histogram makes higher lows.",
  explainerTitle: "How to use bullish MACD divergence",
  explainerBody: "A bullish MACD divergence can flag slowing downside momentum ahead of a turn. Use it to narrow charts to review, and confirm with support, trend and volume before acting.",
  emptyText: "No stocks are currently showing a bullish MACD divergence in the live feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["bullishMacdDivergence"],
  maxItems: 36,
  relatedGuide: {
    href: "/bullish-divergence-explained",
    label: "bullish divergence explained",
    blurb: "For how the pattern forms and how to read it on a chart, see",
  },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
