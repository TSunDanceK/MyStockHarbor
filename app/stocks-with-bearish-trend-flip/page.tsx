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
  title: "Stocks With a Bearish Trend Flip | MyStockHarbor",
  description:
    "Stocks whose Trend Helper trend state has just confirmed a flip to bearish on the daily chart, ranked most recent first.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-bearish-trend-flip",
  },
  openGraph: {
    title: "Stocks With a Bearish Trend Flip | MyStockHarbor",
    description:
      "Stocks whose Trend Helper trend state has just confirmed a flip to bearish on the daily chart, ranked most recent first.",
    url: "https://www.mystockharbor.com/stocks-with-bearish-trend-flip",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With a Bearish Trend Flip | MyStockHarbor",
    description:
      "Stocks whose Trend Helper trend state has just confirmed a flip to bearish on the daily chart, ranked most recent first.",
  },
};

// kind is "preset": the page ships the whole analyzed universe with
// `trendFlipBearish` pre-ticked, so Select Screener can narrow or widen it in
// place instead of the visitor navigating away.
//
// `sectionIncludes` is what carries the ORDER. The builder's
// "Bearish Trend Flip Stocks (Daily)" section is ranked by bars since the flip,
// ascending, and buildEntries re-applies that section's rank on top of the
// universe -- so these rows are most-recent-flip first rather than in the
// tracked-conditions count order every unranked preset page falls back to.
// The section takes 40, comfortably more than the 36 rows shown here.
//
// The direction and the timeframe are both carried by the flag itself, so no
// filterTimeframe is needed: there is one section per page.
const config: PickerResultConfig = {
  href: "/stocks-with-bearish-trend-flip",
  eyebrow: "Bearish trend flip screener",
  title: "Stocks With a Bearish Trend Flip",
  description:
    "Stocks whose Trend Helper (Slow) trend state has confirmed a flip to bearish within the last four daily bars. The most recent flips are at the top.",
  explainerTitle: "How to use a bearish trend flip",
  explainerBody:
    "The Trend Helper confirms a direction only after two consecutive bars close on the correct side of a falling Hull moving average, so a flip here is a change that has already held for a bar rather than a single red candle. Each row leads with the session the flip actually confirmed on. That is never the current session - the screen only ever evaluates completed daily bars, and the newest one it has is the previous session's close for the whole trading day - so the age beside the date counts back in sessions, not calendar days. A bearish flip is a warning about trend condition, not a prediction - check whether the stock is losing a level that mattered, or simply pulling back inside a range.",
  emptyText:
    "No stocks have confirmed a bearish trend flip in the last four trading days.",
  tone: "red",
  kind: "preset",
  presetFilters: ["trendFlipBearish"],
  sectionIncludes: ["bearish trend flip stocks (daily)"],
  // Named on the page (#553 COWORK #161): the section sorts by bars since
  // the flip, newest first, ties A to Z (pickersBuilder).
  rankedBy: { label: "most recent Trend Helper flip, newest first", short: "newest flip" },
  maxItems: 36,
  bodySections: [
    {
      heading: "The rule behind a bearish flip",
      paragraphs: [
        "A bearish trend flip is recorded when the Trend Helper Slow line — a 55-period Hull moving average, which weights recent prices more heavily so it turns sooner than a simple average — has rolled over and price has settled beneath it. Specifically, the stock needs two closes in a row below the line while the line is sloping down. A flat line confirms nothing either way.",
        "The previous state must have been bullish, and the change must be recent: the confirmation has to land within the last three bars, so roughly the last four trading sessions. Stocks whose very first confirmed state in the data happens to be bearish are not counted, because nothing actually flipped. The bearish state then stays in place until two closes above a rising line confirm the opposite.",
      ],
    },
    {
      heading: "Making sense of the rows",
      paragraphs: [
        "The newest flips sit at the top, and stocks that flipped on the same session are listed alphabetically. Each row starts with the session the flip confirmed on; this is never the current day, because the screen works from end-of-day bars and the latest one is the previous close.",
        "A bearish flip describes a change in trend condition, not what happens next. One useful question is what kind of drop produced it. A stock slipping under the line after a long run higher may simply be pausing, while one losing the line close to its 200-day average, or near a support level visible on the chart, can tell a more serious story. Comparing the flip with the moving-average columns can help separate the two.",
      ],
    },
    {
      heading: "Blind spots",
      paragraphs: [
        "The rule sees only closing prices against one moving average. It does not know about earnings, guidance or sector news, and in a range-bound stock the line can whipsaw, confirming bearish one week and bullish the next. Each row works best as a prompt to look at the chart, and with hourly rebuilds from end-of-day data, the list can trail the market by a session.",
      ],
    },
    {
      heading: "A hypothetical flip, step by step",
      paragraphs: [
        "Suppose a stock has been in a bullish state for months and its Slow line begins to curl lower after a sharp pullback. On the first finish under the down-sloping line, nothing is recorded yet. The second consecutive finish beneath it confirms the bearish state, and that session becomes the date in the row. Had the line still been rising on those two days, the closes under it would not have counted, however large the drop.",
        "Compared with the weekly bearish trend flip page, this list turns over much faster: a daily flip stays for at most four sessions, while the weekly version is measured in closed weeks. A stock showing on both at once may reflect the shorter and longer trends lining up, though that remains a description of past closes rather than a forecast.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-with-bullish-trend-flip", label: "Daily bullish trend flips" },
    { href: "/stocks-with-weekly-bearish-trend-flip", label: "Weekly bearish trend flips" },
    { href: "/stocks-below-50-day-moving-average", label: "Stocks below the 50-day moving average" },
    { href: "/stocks-below-200-day-moving-average", label: "Stocks below the 200-day moving average" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
