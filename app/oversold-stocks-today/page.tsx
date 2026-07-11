import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Oversold Stocks Today | MyStockHarbor",
  description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  alternates: {
    canonical: "https://www.mystockharbor.com/oversold-stocks-today",
  },
  openGraph: {
    title: "Oversold Stocks Today | MyStockHarbor",
    description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
    url: "https://www.mystockharbor.com/oversold-stocks-today",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Oversold Stocks Today | MyStockHarbor",
    description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  },
};

const config: PickerResultConfig = {
  href: "/oversold-stocks-today",
  eyebrow: "Oversold stock screener",
  title: "Oversold Stocks Today",
  description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  explainerTitle: "How to use oversold stocks",
  explainerBody: "Oversold does not automatically mean bullish. The best setups usually show selling pressure slowing, a clean support area, or early evidence that buyers are stepping back in.",
  emptyText: "No oversold stocks are currently available from the live picker feed.",
  tone: "green",
  kind: "section",
  sectionIncludes: ["oversold"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
