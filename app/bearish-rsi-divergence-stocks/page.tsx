import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bearish RSI Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  alternates: { canonical: "https://www.mystockharbor.com/bearish-rsi-divergence-stocks" },
  openGraph: {
    title: "Bearish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
    url: "https://www.mystockharbor.com/bearish-rsi-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bearish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  },
};

const config: PickerResultConfig = {
  href: "/bearish-rsi-divergence-stocks",
  eyebrow: "BEARISH RSI DIVERGENCE SCREENER",
  title: "Bearish RSI Divergence Stocks",
  description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  explainerTitle: "How to use bearish RSI divergence",
  explainerBody: "A bearish RSI divergence — price rising while RSI turns down — can flag fading upside momentum and a possible pullback. Treat it as a caution flag for chart review, not an automatic sell.",
  emptyText: "No stocks are currently showing a bearish RSI divergence in the live feed.",
  tone: "red",
  kind: "preset",
  presetFilters: ["bearishRsiDivergence"],
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
