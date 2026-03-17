import type { Metadata } from "next";
import StockSymbolPageClient from "./StockSymbolPageClient";

type Props = {
  params: Promise<{ symbol: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  return {
    title: `${upper} Stock Analysis, Trend, Moving Averages & Technical Summary | MyStockHarbor`,
    description: `View ${upper} stock analysis with trend structure, moving averages, technical summary and a direct link into the MyStockHarbor chart dashboard.`,
    alternates: {
      canonical: `/stock/${upper}`,
    },
    openGraph: {
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description: `Trend, market structure and technical analysis for ${upper}.`,
      url: `/stock/${upper}`,
      siteName: "MyStockHarbor",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description: `Trend, moving averages and technical summary for ${upper}.`,
    },
  };
}

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  return <StockSymbolPageClient symbol={symbol.toUpperCase()} />;
}
