import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
  description:
    "Browse stocks screening near their weekly 200-day moving average, a slower higher-timeframe trend reference for bigger support and resistance zones.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-near-weekly-200-day-moving-average",
  },
  openGraph: {
    title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
    description:
      "Browse stocks screening near their weekly 200-day moving average using live MyStockHarbor picker data.",
    url: "https://www.mystockharbor.com/stocks-near-weekly-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Near Weekly 200-Day Moving Average | MyStockHarbor",
    description:
      "Browse stocks screening near their weekly 200-day moving average using live MyStockHarbor picker data.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-near-weekly-200-day-moving-average",
  eyebrow: "Weekly MA200 stock screener",
  title: "Stocks Near Weekly 200-Day Moving Average",
  description:
    "Review stocks screening near the weekly 200-day moving average. These are slower, higher-timeframe levels that can matter for larger trend tests.",
  explainerTitle: "How to use weekly MA200 setups",
  explainerBody:
    "The weekly 200-day moving average is a higher-timeframe reference point. These setups are usually slower than daily MA200 tests, so focus on whether the stock is building support, reclaiming the level, or rejecting from it.",
  emptyText:
    "No weekly MA200 proximity stocks are currently available from the live picker feed.",
  tone: "yellow",
  kind: "section",
  sectionIncludes: ["weekly ma200"],
  filterTimeframe: "W",
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
