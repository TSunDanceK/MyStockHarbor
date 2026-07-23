import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Volume Spike Stocks | MyStockHarbor",
  description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  alternates: { canonical: "https://www.mystockharbor.com/volume-spike-stocks" },
  openGraph: {
    title: "Volume Spike Stocks | MyStockHarbor",
    description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
    url: "https://www.mystockharbor.com/volume-spike-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Volume Spike Stocks | MyStockHarbor",
    description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  },
};

const config: PickerResultConfig = {
  href: "/volume-spike-stocks",
  eyebrow: "VOLUME SPIKE SCREENER",
  title: "Volume Spike Stocks",
  description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  explainerTitle: "How to use volume spikes",
  explainerBody: "A volume spike shows unusual interest and can precede or confirm a big move in either direction. Pair it with the price action and news to judge whether it is accumulation, distribution or a one-off.",
  emptyText: "No stocks are currently flagged with a volume spike in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["volumeSpike"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
