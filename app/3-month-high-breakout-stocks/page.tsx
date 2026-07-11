import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "3-Month High Breakout Stocks | MyStockHarbor",
  description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  alternates: {
    canonical: "https://www.mystockharbor.com/3-month-high-breakout-stocks",
  },
  openGraph: {
    title: "3-Month High Breakout Stocks | MyStockHarbor",
    description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
    url: "https://www.mystockharbor.com/3-month-high-breakout-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "3-Month High Breakout Stocks | MyStockHarbor",
    description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  },
};

const config: PickerResultConfig = {
  href: "/3-month-high-breakout-stocks",
  eyebrow: "Breakout stock screener",
  title: "3-Month High Breakout Stocks",
  description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  explainerTitle: "How to use 3-month high breakouts",
  explainerBody: "A 3-month high breakout can flag improving momentum before a stock reaches major all-time high territory. Watch for follow-through volume, controlled retests and a lack of immediate rejection.",
  emptyText: "No 3-month high breakout stocks are currently available from the live picker feed.",
  tone: "orange",
  kind: "section",
  sectionIncludes: ["3-month high breakout"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
