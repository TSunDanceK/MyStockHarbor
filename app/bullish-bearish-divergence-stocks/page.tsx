import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 300;

const pageTitle = "Bullish & Bearish Divergence Stocks | RSI & MACD Signals | MyStockHarbor";
const pageDescription =
  "Browse bullish and bearish divergence stocks using live MyStockHarbor picker data. Review RSI and MACD divergence signals, open each stock page, and jump straight to the chart for deeper analysis.";

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

// kind is "preset", not "section": ships the whole universe with `divergencePick`
// pre-ticked so Select Screener filters in place. That flag is derived from this
// same section (see buildCategoryFlags), so the default set is identical to
// before; sectionIncludes is kept so each card's badge and the section ordering
// are re-applied on top. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/bullish-bearish-divergence-stocks",
  eyebrow: "Divergence stock screener",
  title: "Bullish & Bearish Divergence Stocks",
  description:
    "Find stocks currently showing bullish or bearish RSI and MACD divergence, where momentum has started to disagree with price.",
  explainerTitle: "How to use RSI & MACD divergence",
  explainerBody:
    "Divergence appears when price and momentum stop moving in sync — in bullish divergence price keeps weakening while momentum improves, in bearish divergence price keeps pushing higher while momentum fades. Each card here shows whichever of RSI or MACD produced the strongest divergence signal for that stock. Divergence alone isn't a signal to act on — check structure, support and resistance, and follow-through before deciding.",
  emptyText: "No bullish or bearish divergence stocks are currently available from the live picker feed.",
  tone: "blue",
  kind: "preset",
  presetFilters: ["divergencePick"],
  sectionIncludes: ["divergence"],
  maxItems: 36,
  relatedGuide: {
    href: "/bullish-divergence-explained",
    label: "bullish divergence explained",
    blurb: "For how these patterns form and how to read them on a chart, start with",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
