import type { Metadata } from "next";
import PickerResultPage, {
  type PickerResultConfig,
} from "@/app/components/PickerResultPage";

// kind is "preset", not "section": ships the whole universe with
// `strongEarningsGrowth` pre-ticked so Select Screener filters in place --
// which on an earnings page is the point, since combining it with a technical
// condition is the obvious next question. sectionIncludes is kept so the
// earnings section's badge and ordering are re-applied on top. See buildEntries
// in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/stocks-with-strong-earnings-growth",
  eyebrow: "Earnings growth screener",
  title: "Stocks With Strong Earnings Growth",
  description:
    "Find stocks ranked by year-over-year EPS growth, revenue growth, recent positive earnings consistency and beat history.",
  explainerTitle: "How this earnings growth picker ranks stocks",
  explainerBody:
    "This page is designed to highlight companies with improving earnings patterns. It gives more weight to year-over-year EPS growth, revenue growth, recent positive EPS consistency and a history of beating expectations.",
  emptyText:
    "No strong earnings-growth results are available yet. Use the Fetch Earnings button on the main Pickers page or wait for the earnings cache to warm.",
  tone: "green",
  kind: "preset",
  presetFilters: ["strongEarningsGrowth"],
  sectionIncludes: ["strong", "earnings", "growth"],
  maxItems: 40,
};

export const metadata: Metadata = {
  title:
    "Stocks With Strong Earnings Growth | YoY EPS & Revenue Growth Screener | MyStockHarbor",
  description:
    "Browse stocks with strong earnings growth, ranked by year-over-year EPS growth, revenue growth, positive earnings consistency and beat history.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-strong-earnings-growth",
  },
  openGraph: {
    title: "Stocks With Strong Earnings Growth | MyStockHarbor",
    description:
      "Find stocks ranked by year-over-year EPS growth, revenue growth and recent earnings consistency.",
    url: "https://www.mystockharbor.com/stocks-with-strong-earnings-growth",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With Strong Earnings Growth | MyStockHarbor",
    description:
      "Browse stocks with strong earnings growth using YoY EPS and revenue improvement.",
  },
};

export default async function StocksWithStrongEarningsGrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
