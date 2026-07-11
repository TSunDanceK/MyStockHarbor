import type { Metadata } from "next";
import PickerResultPage, {
  type PickerResultConfig,
} from "@/app/components/PickerResultPage";

const config: PickerResultConfig = {
  href: "/stocks-with-positive-last-earnings",
  eyebrow: "Earnings stock screener",
  title: "Stocks With Positive Last Earnings",
  description:
    "Find stocks ranked by their latest completed earnings report, using EPS surprise, revenue surprise, positive EPS and report freshness.",
  explainerTitle: "How this earnings picker ranks stocks",
  explainerBody:
    "This page focuses on the latest reported quarter. The strongest names tend to have positive EPS surprise, positive revenue surprise, profitable EPS and a recent report that supports the current earnings read.",
  emptyText:
    "No positive last-earnings results are available yet. Use the Fetch Earnings button on the main Pickers page or wait for the earnings cache to warm.",
  tone: "green",
  kind: "section",
  sectionIncludes: ["positive", "last", "earnings"],
  maxItems: 40,
};

export const metadata: Metadata = {
  title:
    "Stocks With Positive Last Earnings | EPS & Revenue Beat Screener | MyStockHarbor",
  description:
    "Browse stocks with positive latest earnings using EPS surprise, revenue surprise, positive EPS and earnings freshness from MyStockHarbor.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-positive-last-earnings",
  },
  openGraph: {
    title: "Stocks With Positive Last Earnings | MyStockHarbor",
    description:
      "Find stocks ranked by their latest completed earnings report, including EPS and revenue surprise.",
    url: "https://www.mystockharbor.com/stocks-with-positive-last-earnings",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With Positive Last Earnings | MyStockHarbor",
    description:
      "Browse stocks with positive latest earnings using EPS surprise, revenue surprise and earnings quality.",
  },
};

export default async function StocksWithPositiveLastEarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
