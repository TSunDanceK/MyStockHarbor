import type { Metadata } from "next";
import GuideJsonLd from "@/app/components/GuideJsonLd";

const TITLE = "Position Sizing Guide for Stock Traders";
const DESC = "Learn how position sizing works, why it matters for managing risk, and how to calculate the right position size for each trade based on your account and stop loss.";
const PATH = "/position-sizing-guide";

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

export { default } from "./PositionSizingPage";
