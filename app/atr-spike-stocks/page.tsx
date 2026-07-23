import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ATR Spike Stocks | MyStockHarbor",
  description: "Stocks currently showing an ATR spike — a jump in average true range signalling a sharp rise in volatility.",
  alternates: { canonical: "https://www.mystockharbor.com/atr-spike-stocks" },
  openGraph: {
    title: "ATR Spike Stocks | MyStockHarbor",
    description: "Stocks currently showing an ATR spike — a jump in average true range signalling a sharp rise in volatility.",
    url: "https://www.mystockharbor.com/atr-spike-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ATR Spike Stocks | MyStockHarbor",
    description: "Stocks currently showing an ATR spike — a jump in average true range signalling a sharp rise in volatility.",
  },
};

const config: PickerResultConfig = {
  href: "/atr-spike-stocks",
  eyebrow: "ATR SPIKE SCREENER",
  title: "ATR Spike Stocks",
  description: "Stocks currently showing an ATR spike — a jump in average true range signalling a sharp rise in volatility.",
  explainerTitle: "How to use ATR spikes",
  explainerBody: "A rising ATR means bigger daily ranges and more volatility — useful for spotting names on the move and for sizing positions and stops. Higher volatility cuts both ways, so manage risk accordingly.",
  emptyText: "No stocks are currently flagged with an ATR spike in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["atrSpike"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
