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
  // Named on the page (#553 COWORK #161): the section sorts by bars since
  // the flip, newest first, ties A to Z (pickersBuilder).
  rankedBy: { label: "most recent weekly Trend Helper flip, newest first", short: "newest flip" },
  maxItems: 36,
  bodySections: [
    {
      heading: "How the weekly bearish rule works",
      paragraphs: [
        "Here the Trend Helper Slow line, a 55-period Hull moving average, is calculated on weekly closes. A bearish state confirms once two weekly closes in a row finish below the line while it is sloping down. Until that happens, a stock that was in a bullish weekly state stays bullish, even through a sharp weekly drop.",
        "The screen lists stocks where that confirmation happened within the last three closed weeks. The unfinished current week is left out of the calculation entirely, and a stock’s first confirmation in the loaded history is ignored, because a first reading is not a flip from anything.",
      ],
    },
    {
      heading: "Why a weekly turn reads differently",
      paragraphs: [
        "On weekly bars, two confirming closes take at least two weeks to form, so a flip here describes a change in the larger trend rather than a short pullback. It may matter more to someone thinking in months than in days. It can also arrive late: a stock may already be well off its highs by the time the weekly state catches up.",
        "Rows run from the most recent flip down, with same-week flips sorted A–Z, and each names the week of confirmation. New weeks usually appear about a day after they close, once the following session’s data lands. Checking whether the stock is still above or below its 200-day average, and whether the daily trend has already turned back up, can add context.",
      ],
    },
    {
      heading: "Limits worth keeping in mind",
      paragraphs: [
        "The rule cannot tell a lasting downtrend from a long sideways range, and in a range it can flip back and forth over a few months. It does not look at earnings or news. It also drops stocks once the flip is more than three weeks old, so an established weekly downtrend may not be listed at all. A weekly bearish flip is a description of past closes, not a forecast of the weeks ahead.",
      ],
    },
    {
      heading: "Following one weekly row",
      paragraphs: [
        "Consider a stock in a long weekly uptrend that has a rough quarter. Its weekly Slow line flattens, then starts to point lower; one week ends beneath it, and a second week does the same. That second week is the confirmation, and the row names it. If the decline had happened while the line was still pointing up, the stock could have fallen a long way with no flip recorded, one reason this screen can trail the price.",
        "It differs from the daily bearish trend flip page mainly in what it filters out. A two-day slide under the daily line can register there and reverse within a fortnight, whereas here a stock needs two full weeks of closes on the wrong side. Seeing a stock on the daily bearish list but not here may simply mean the larger weekly trend has not changed, at least so far.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-with-bearish-trend-flip", label: "Daily bearish trend flips" },
    { href: "/stocks-with-weekly-bullish-trend-flip", label: "Weekly bullish trend flips" },
    { href: "/stocks-below-200-day-moving-average", label: "Stocks below the 200-day moving average" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
