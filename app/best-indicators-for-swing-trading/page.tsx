import type { Metadata } from "next";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "Best Indicators for Swing Trading";
const DESC = "Learn the best indicators for swing trading, including RSI, MACD, moving averages, and volume, and how to combine them to find higher-probability trade setups.";
const PATH = "/best-indicators-for-swing-trading";

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

export { default } from "./BestIndicatorsSwingTradingPage";
