import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Best Trend Score Stocks | MyStockHarbor",
  description: "Find stocks with the strongest current trend structure based on moving averages, price behaviour and momentum context.",
  alternates: {
    canonical: "https://www.mystockharbor.com/best-trend-score-stocks",
  },
  openGraph: {
    title: "Best Trend Score Stocks | MyStockHarbor",
    description: "Find stocks with the strongest current trend structure based on moving averages, price behaviour and momentum context.",
    url: "https://www.mystockharbor.com/best-trend-score-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Trend Score Stocks | MyStockHarbor",
    description: "Find stocks with the strongest current trend structure based on moving averages, price behaviour and momentum context.",
  },
};

// kind is "preset", not "section": ships the whole universe with `bestTrendPick`
// pre-ticked so Select Screener filters in place. That flag is derived from this
// same section (see buildCategoryFlags), so the default set is identical to
// before; sectionIncludes is kept so the MA50/MA200 chart deep link, badge and
// ordering are re-applied on top. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/best-trend-score-stocks",
  eyebrow: "Trend score stock screener",
  title: "Best Trend Score Stocks",
  description: "Find stocks with the strongest current trend structure based on moving averages, price behaviour and momentum context.",
  explainerTitle: "How to use trend score stocks",
  explainerBody: "Trend score pages are useful for finding leadership. Strong trends can still be extended, so the cleaner ideas often combine trend strength with controlled pullbacks or constructive bases.",
  emptyText: "No best trend score stocks are currently available from the live picker feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["bestTrendPick"],
  // The Signals column on this page reports the four TREND checks, not the
  // composite's oversold/overbought ones. Without this the column was a dash on
  // every row: a trend leader is normally neither oversold nor overbought, so
  // the default rule had nothing to return, and the page's only statement about
  // which checks fired was the bare count in the note ("4/4 trend checks").
  signalsFrom: "trend",
  sectionIncludes: ["best trend score"],
  maxItems: 36,
  relatedGuide: {
    href: "/how-to-identify-stock-trends",
    label: "our guide to identifying stock trends",
    blurb: "For how to judge trend structure beyond a single score, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
