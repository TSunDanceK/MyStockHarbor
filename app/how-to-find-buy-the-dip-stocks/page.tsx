import type { Metadata } from "next";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "How to Find Buy the Dip Stocks";
const DESC = "Learn how to find buy the dip stocks using technical analysis, including moving averages, RSI, support levels, and trend structure to spot potential rebound setups.";
const PATH = "/how-to-find-buy-the-dip-stocks";

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

export { default } from "./HowToFindBuyTheDipPage";
