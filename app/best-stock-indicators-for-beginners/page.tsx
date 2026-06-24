import type { Metadata } from "next";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "Best Stock Indicators for Beginners";
const DESC = "Discover the best stock indicators for beginners, including RSI, MACD, moving averages, and volume, and learn how to use them to read charts more clearly.";
const PATH = "/best-stock-indicators-for-beginners";

export const metadata: Metadata = {
  title: `${TITLE} | MyStockHarbor`,
  description: DESC,
  alternates: { canonical: `https://www.mystockharbor.com${PATH}` },
  openGraph: {
    title: `${TITLE} | MyStockHarbor`,
    description: DESC,
    url: `https://www.mystockharbor.com${PATH}`,
    siteName: "MyStockHarbor",
    type: "article",
    locale: "en_GB",
    images: [{ url: "https://www.mystockharbor.com/og-image-v2.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | MyStockHarbor`,
    description: DESC,
    images: ["https://www.mystockharbor.com/og-image-v2.png"],
  },
};

export { default } from "./BestStockIndicatorsPage";
