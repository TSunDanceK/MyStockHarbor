import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic, matching every other picker page:
// `force-dynamic` ships Cache-Control: no-store, so every visit and every crawl
// pays a full serverless render. 300s matches the underlying pickers cache
// cycle. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Stocks With a Weekly Bullish Trend Flip | MyStockHarbor",
  description:
    "Stocks whose Trend Helper trend state has confirmed a flip to bullish on the weekly chart within the last four closed weeks.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-weekly-bullish-trend-flip",
  },
  openGraph: {
    title: "Stocks With a Weekly Bullish Trend Flip | MyStockHarbor",
    description:
      "Stocks whose Trend Helper trend state has confirmed a flip to bullish on the weekly chart within the last four closed weeks.",
    url: "https://www.mystockharbor.com/stocks-with-weekly-bullish-trend-flip",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With a Weekly Bullish Trend Flip | MyStockHarbor",
    description:
      "Stocks whose Trend Helper trend state has confirmed a flip to bullish on the weekly chart within the last four closed weeks.",
  },
};

// kind is "preset": the page ships the whole analyzed universe with
// `trendFlipBullishWeekly` pre-ticked, so Select Screener can narrow or widen it in
// place instead of the visitor navigating away.
//
// `sectionIncludes` is what carries the ORDER. The builder's
// "Bullish Trend Flip Stocks (Weekly)" section is ranked by bars since the flip,
// ascending, and buildEntries re-applies that section's rank on top of the
// universe -- so these rows are most-recent-flip first rather than in the
// tracked-conditions count order every unranked preset page falls back to.
// The section takes 40, comfortably more than the 36 rows shown here.
//
// The direction and the timeframe are both carried by the flag itself, so no
// filterTimeframe is needed: there is one section per page.
const config: PickerResultConfig = {
  href: "/stocks-with-weekly-bullish-trend-flip",
  eyebrow: "Weekly bullish trend flip screener",
  title: "Stocks With a Weekly Bullish Trend Flip",
  description:
    "Stocks whose Trend Helper (Slow) trend state has confirmed a flip to bullish within the last four closed weeks. The most recent flips are at the top, and each row names the week the flip confirmed in.",
  explainerTitle: "How to use a weekly trend flip",
  explainerBody:
    "This screen is measured on CLOSED weekly bars only - the week in progress is never evaluated, so nothing here can appear on Tuesday and vanish by Friday. Each row leads with the week the flip actually confirmed in, which for most rows is NOT the most recent week - the age beside it says how far back that was. Weekly flips are much rarer and much slower than daily ones: a stock is usually one to four weeks into the new state by the time it lands here, so this is a screen for trend condition rather than for entries.",
  emptyText:
    "No stocks have confirmed a bullish weekly trend flip in the last four closed weeks.",
  tone: "green",
  kind: "preset",
  presetFilters: ["trendFlipBullishWeekly"],
  sectionIncludes: ["bullish trend flip stocks (weekly)"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
