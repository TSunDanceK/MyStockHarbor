import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stock Screener — All Stocks | MyStockHarbor",
  description: "Browse the full analyzed universe of stocks with no filter applied. Sort any column, switch data tabs (Performance, Valuation, Dividends, Financials, Analysts), or check conditions on the left to narrow the list.",
  alternates: { canonical: "https://www.mystockharbor.com/stock-screener" },
  openGraph: {
    title: "Stock Screener — All Stocks | MyStockHarbor",
    description: "The full analyzed universe of stocks with no filter applied — sort, switch data tabs, or add conditions to screen.",
    url: "https://www.mystockharbor.com/stock-screener",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Screener — All Stocks | MyStockHarbor",
    description: "The full analyzed universe of stocks with no filter applied.",
  },
};

const config: PickerResultConfig = {
  href: "/stock-screener",
  eyebrow: "STOCK SCREENER",
  title: "Stock Screener — All Stocks",
  description: "Browse the full analyzed universe of stocks with no filter applied. Sort any column, switch between the data tabs, or tick conditions on the left to screen the list down.",
  explainerTitle: "How to use the stock screener",
  explainerBody: "This is the whole analyzed universe with nothing pre-filtered — a plain starting point that does not already apply a condition the way the Overbought or Oversold pages do. Sort by any column header, switch between the General, Performance, Valuation, Dividends, Financials and Analysts tabs, or tick any conditions in the left-hand nav to narrow the list. Everything updates instantly in your browser.",
  emptyText: "No stocks are currently available from the live universe.",
  tone: "blue",
  kind: "allSymbols",
  showAllImmediately: true,
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
