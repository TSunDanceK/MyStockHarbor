import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Breakout Signal Stocks | MyStockHarbor",
  description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  alternates: { canonical: "https://www.mystockharbor.com/breakout-signal-stocks" },
  openGraph: {
    title: "Breakout Signal Stocks | MyStockHarbor",
    description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
    url: "https://www.mystockharbor.com/breakout-signal-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Breakout Signal Stocks | MyStockHarbor",
    description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  },
};

const config: PickerResultConfig = {
  href: "/breakout-signal-stocks",
  eyebrow: "BREAKOUT SIGNAL SCREENER",
  title: "Breakout Signal Stocks",
  description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  explainerTitle: "How to use breakout signals",
  explainerBody: "Breakouts can mark the start of a new move or fail and reverse. Use this list to find names clearing resistance, then confirm the breakout holds with volume and follow-through before acting.",
  emptyText: "No stocks are currently flagged as breaking out in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["breakout"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
