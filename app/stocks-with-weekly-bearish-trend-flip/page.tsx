import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic, matching every other picker page:
// `force-dynamic` ships Cache-Control: no-store, so every visit and every crawl
// pays a full serverless render. 300s matches the underlying pickers cache
// cycle. See claude/picker-pages-isr-2026-08-20.md.
// 3600, PAIRED WITH THE HOURLY PRICE TIER.
//
// These two changes only make sense together. A page rebuilt hourly cannot
// DISPLAY anything fresher than an hour, so refreshing the tail of the price
// pool every 30 minutes was buying freshness this surface throws away -- which
// is the argument that moved TIER2_TTL_MS to 60 (lib/server/priceTiers.ts).
// Stretching the window without that would have been a freshness cut with no
// coherent story; making both is a deliberate position: screening and longer
// horizons here, live ticks on TradingView.
//
// ScanFooter prints the OBSERVED age range of the prices on the page rather
// than the policy, so this needs no change there and the spread stays stated
// rather than hidden.
//
// The ISR saving is real but second-order: 36 routes at 48 regenerations a day
// halve to 24, which is ~1,700 fewer a day against a bill dominated by
// /stock/[symbol]. See claude/isr-cadence-2026-09-04.md for the split.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Stocks With a Weekly Bearish Trend Flip | MyStockHarbor",
  description:
    "Stocks whose Trend Helper trend state has confirmed a flip to bearish on the weekly chart within the last four closed weeks.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-weekly-bearish-trend-flip",
  },
  openGraph: {
    title: "Stocks With a Weekly Bearish Trend Flip | MyStockHarbor",
    description:
      "Stocks whose Trend Helper trend state has confirmed a flip to bearish on the weekly chart within the last four closed weeks.",
    url: "https://www.mystockharbor.com/stocks-with-weekly-bearish-trend-flip",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With a Weekly Bearish Trend Flip | MyStockHarbor",
    description:
      "Stocks whose Trend Helper trend state has confirmed a flip to bearish on the weekly chart within the last four closed weeks.",
  },
};

// kind is "preset": the page ships the whole analyzed universe with
// `trendFlipBearishWeekly` pre-ticked, so Select Screener can narrow or widen it in
// place instead of the visitor navigating away.
//
// `sectionIncludes` is what carries the ORDER. The builder's
// "Bearish Trend Flip Stocks (Weekly)" section is ranked by bars since the flip,
// ascending, and buildEntries re-applies that section's rank on top of the
// universe -- so these rows are most-recent-flip first rather than in the
// tracked-conditions count order every unranked preset page falls back to.
// The section takes 40, comfortably more than the 36 rows shown here.
//
// The direction and the timeframe are both carried by the flag itself, so no
// filterTimeframe is needed: there is one section per page.
const config: PickerResultConfig = {
  href: "/stocks-with-weekly-bearish-trend-flip",
  eyebrow: "Weekly bearish trend flip screener",
  title: "Stocks With a Weekly Bearish Trend Flip",
  description:
    "Stocks whose Trend Helper (Slow) trend state has confirmed a flip to bearish within the last four closed weeks. The most recent flips are at the top, and each row names the week the flip confirmed in.",
  explainerTitle: "How to use a weekly trend flip",
  explainerBody:
    "This screen is measured on CLOSED weekly bars only - the week in progress is never evaluated, so nothing here can appear on Tuesday and vanish by Friday. Each row leads with the week the flip actually confirmed in, which for most rows is NOT the most recent week - the age beside it says how far back that was. A weekly bearish flip is a slow signal about trend condition: it says the higher-timeframe state has turned, not that the next week is down.",
  emptyText:
    "No stocks have confirmed a bearish weekly trend flip in the last four closed weeks.",
  tone: "red",
  kind: "preset",
  presetFilters: ["trendFlipBearishWeekly"],
  sectionIncludes: ["bearish trend flip stocks (weekly)"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
