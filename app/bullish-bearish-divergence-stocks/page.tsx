import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

const pageTitle =
  "Bullish & Bearish Divergence Stocks | RSI & MACD Signals | MyStockHarbor";
const pageDescription =
  "Browse bullish and bearish divergence stocks using live MyStockHarbor picker data. Review RSI and MACD divergence signals, ranked by timeframe, duration, structure quality and location, then open the chart for deeper analysis.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
  },
};

const config: PickerResultConfig = {
  href: "/bullish-bearish-divergence-stocks",
  eyebrow: "Divergence stock screener",
  title: "Bullish & Bearish Divergence Stocks",
  description:
    "Stocks currently showing bullish or bearish divergence between price and momentum, ranked by timeframe, duration, structure quality, magnitude and location context.",
  explainerTitle: "How to use divergence signals",
  explainerBody:
    "Divergence appears when price and momentum stop moving in sync. In bullish divergence, price keeps making lower lows while momentum starts to improve. In bearish divergence, price keeps pushing to new highs while momentum begins to fade. That makes it a useful early warning, not a signal to trade on its own — check price structure, support and resistance, and whether price is actually confirming the setup before acting. Each card's chart shows whichever indicator, RSI or MACD, produced the stronger divergence signal for that stock.",
  emptyText:
    "No divergence results are currently available from the live picker feed.",
  tone: "blue",
  kind: "section",
  sectionIncludes: ["divergence"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
