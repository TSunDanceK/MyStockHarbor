import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Best Trend Score Stocks | MyStockHarbor",
  description: "Find stocks with the strongest current trend structure based on moving averages, price behaviour and momentum context.",
  alternates: {
    canonical: "https://www.mystockharbor.com/best-trend-score-stocks",
  },
  openGraph: {
    title: "Best Trend Score Stocks | MyStockHarbor",
    description: "Find stocks with the strongest current trend structure based on moving averages, price behaviour and momentum context.",
    url: "https://www.mystockharbor.com/best-trend-score-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Trend Score Stocks | MyStockHarbor",
    description: "Find stocks with the strongest current trend structure based on moving averages, price behaviour and momentum context.",
  },
};

const config: PickerResultConfig = {
  href: "/best-trend-score-stocks",
  eyebrow: "Trend score stock screener",
  title: "Best Trend Score Stocks",
  description: "Find stocks with the strongest current trend structure based on moving averages, price behaviour and momentum context.",
  explainerTitle: "How to use trend score stocks",
  explainerBody: "Trend score pages are useful for finding leadership. Strong trends can still be extended, so the cleaner ideas often combine trend strength with controlled pullbacks or constructive bases.",
  emptyText: "No best trend score stocks are currently available from the live picker feed.",
  tone: "green",
  kind: "section",
  sectionIncludes: ["best trend score"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
