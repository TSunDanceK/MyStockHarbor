import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic, matching every other picker page:
// `force-dynamic` ships Cache-Control: no-store, so every visit and every crawl
// pays a full serverless render. 300s matches the underlying pickers cache
// cycle. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Stocks With a Bullish Trend Flip | MyStockHarbor",
  description:
    "Stocks whose Trend Helper trend state has just confirmed a flip to bullish on the daily chart, ranked most recent first.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-bullish-trend-flip",
  },
  openGraph: {
    title: "Stocks With a Bullish Trend Flip | MyStockHarbor",
    description:
      "Stocks whose Trend Helper trend state has just confirmed a flip to bullish on the daily chart, ranked most recent first.",
    url: "https://www.mystockharbor.com/stocks-with-bullish-trend-flip",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With a Bullish Trend Flip | MyStockHarbor",
    description:
      "Stocks whose Trend Helper trend state has just confirmed a flip to bullish on the daily chart, ranked most recent first.",
  },
};

// kind is "preset": the page ships the whole analyzed universe with
// `trendFlipBullish` pre-ticked, so Select Screener can narrow or widen it in
// place instead of the visitor navigating away.
//
// `sectionIncludes` is what carries the ORDER. The builder's
// "Bullish Trend Flip Stocks (Daily)" section is ranked by bars since the flip,
// ascending, and buildEntries re-applies that section's rank on top of the
// universe -- so these rows are most-recent-flip first rather than in the
// tracked-conditions count order every unranked preset page falls back to.
// The section takes 40, comfortably more than the 36 rows shown here.
//
// The direction and the timeframe are both carried by the flag itself, so no
// filterTimeframe is needed: there is one section per page.
const config: PickerResultConfig = {
  href: "/stocks-with-bullish-trend-flip",
  eyebrow: "Bullish trend flip screener",
  title: "Stocks With a Bullish Trend Flip",
  description:
    "Stocks whose Trend Helper (Slow) trend state has confirmed a flip to bullish within the last four daily bars. The most recent flips are at the top.",
  explainerTitle: "How to use a bullish trend flip",
  explainerBody:
    "The Trend Helper confirms a direction only after two consecutive bars close on the correct side of a rising Hull moving average, so a flip here is a change that has already held for a bar rather than a single green candle. Each row leads with the session the flip actually confirmed on. That is never the current session - the screen only ever evaluates completed daily bars, and the newest one it has is the previous session's close for the whole trading day - so the age beside the date counts back in sessions, not calendar days. Treat the flip as the start of a case to check, not the case itself - look at where the flip happened relative to support, the 200-day moving average and volume before acting on it.",
  emptyText:
    "No stocks have confirmed a bullish trend flip in the last four trading days.",
  tone: "green",
  kind: "preset",
  presetFilters: ["trendFlipBullish"],
  sectionIncludes: ["bullish trend flip stocks (daily)"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
