import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bearish MACD Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD histogram makes lower highs.",
  alternates: { canonical: "https://www.mystockharbor.com/bearish-macd-divergence-stocks" },
  openGraph: {
    title: "Bearish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD histogram makes lower highs.",
    url: "https://www.mystockharbor.com/bearish-macd-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bearish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD histogram makes lower highs.",
  },
};

const config: PickerResultConfig = {
  href: "/bearish-macd-divergence-stocks",
  eyebrow: "BEARISH MACD DIVERGENCE SCREENER",
  title: "Bearish MACD Divergence Stocks",
  description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD histogram makes lower highs.",
  explainerTitle: "How to use bearish MACD divergence",
  explainerBody: "A bearish MACD divergence can flag fading upside momentum. Use it as a caution flag for chart review, confirming with trend and volume, not as an automatic sell.",
  emptyText: "No stocks are currently showing a bearish MACD divergence in the live feed.",
  tone: "red",
  kind: "preset",
  presetFilters: ["bearishMacdDivergence"],
  maxItems: 36,
  relatedGuide: {
    href: "/bearish-divergence-explained",
    label: "bearish divergence explained",
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
