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
  // Named on the page (#553 COWORK #161): the section sorts by bars since
  // the flip, newest first, ties A to Z (pickersBuilder).
  rankedBy: { label: "most recent Trend Helper flip, newest first", short: "newest flip" },
  maxItems: 36,
  bodySections: [
    {
      heading: "What counts as a daily bullish flip",
      paragraphs: [
        "This screen lists stocks whose Trend Helper Slow line has just turned from a bearish state to a bullish one on daily bars. The Slow line is a 55-period Hull moving average, a type of average designed to react faster than a simple average while still smoothing out day-to-day noise.",
        "A bullish state confirms only after two consecutive daily closes above the line while the line itself is sloping upward. If the line is flat, neither direction confirms. Once bullish, the state holds until a bearish confirmation replaces it, so a single dip below the line does not undo it.",
        "To appear here, that flip must have confirmed no more than three bars ago, which means within the last four sessions. A stock’s first-ever confirmation in the loaded history is left out, since there is no earlier state for it to have flipped from.",
      ],
    },
    {
      heading: "Reading the list from the top down",
      paragraphs: [
        "Rows are ordered by how recent the flip is, newest first, with ties sorted A–Z. The date at the start of each row is the session the flip confirmed on, and because the data is end-of-day, the newest possible bar is the previous session’s close, not today’s trading.",
        "A fresh flip on its own says only that short-to-medium momentum has turned. It may help to check where the stock sits relative to its 200-day moving average, and whether volume picked up around the flip, since a turn inside a long decline can read differently from one inside an existing uptrend.",
      ],
    },
    {
      heading: "Where daily flips fall short",
      paragraphs: [
        "Daily flips can happen often in choppy, sideways markets, where price may cross the line, confirm and reverse within a couple of weeks. The two-close rule cuts some of that noise but cannot remove it. The screen also cannot see news, earnings dates or intraday moves, and the page rebuilds hourly from end-of-day bars, so it always lags the live market slightly.",
      ],
    },
    {
      heading: "One row, worked through",
      paragraphs: [
        "Picture a stock that spent several weeks closing below a falling Slow line. The line then levels off and starts to tilt upward, and on a Monday the stock closes above it. On Tuesday it closes above the rising line again, so Tuesday becomes the confirmation bar and the row is dated to that session. If Wednesday slips back under the line, the bullish state still stands, because only two closes below a falling line could reverse it.",
        "That stock stays listed through the next three sessions after Tuesday and then drops off, even if the new trend carries on. A stock that closed above the line twice while the line was still flat or tilting down would not qualify at all, an edge case that may leave out some early turns. The weekly bullish flip page applies the same logic to closed weeks, so a daily flip may show up there later.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-with-weekly-bullish-trend-flip", label: "Weekly bullish trend flips" },
    { href: "/stocks-with-bearish-trend-flip", label: "Daily bearish trend flips" },
    { href: "/best-trend-score-stocks", label: "Best trend score stocks" },
    { href: "/stocks-above-50-day-moving-average", label: "Stocks above the 50-day moving average" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
