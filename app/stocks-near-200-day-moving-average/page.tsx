import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
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
  title: "Stocks Near 200-Day Moving Average | MyStockHarbor",
  description: "Browse stocks screening near their daily or weekly 200-day moving average, a major long-term trend reference.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-near-200-day-moving-average",
  },
  openGraph: {
    title: "Stocks Near 200-Day Moving Average | MyStockHarbor",
    description: "Browse stocks screening near their daily or weekly 200-day moving average, a major long-term trend reference.",
    url: "https://www.mystockharbor.com/stocks-near-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Near 200-Day Moving Average | MyStockHarbor",
    description: "Browse stocks screening near their daily or weekly 200-day moving average, a major long-term trend reference.",
  },
};

// kind is "preset", not "section": ships the whole universe with
// `dailyMa200Proximity` pre-ticked so Select Screener filters in place.
// sectionIncludes is kept so the section's badge and ordering are re-applied on
// top. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/stocks-near-200-day-moving-average",
  eyebrow: "MA200 stock screener",
  title: "Stocks Near 200-Day Moving Average",
  description: "Browse stocks screening near their daily or weekly 200-day moving average, a major long-term trend reference.",
  explainerTitle: "How to use stocks near the 200-day",
  explainerBody: "The 200-day moving average can act as support, resistance or a trend filter. Focus on whether price is reclaiming the level, defending it, or rejecting from it.",
  emptyText: "No MA200 proximity stocks are currently available from the live picker feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["dailyMa200Proximity"],
  sectionIncludes: ["daily ma200"],
  // THE ORDER IN WORDS (#553 COWORK #184 item 4): the list was in this score's
  // order while the sort control read "Market Cap (high to low)". A composite,
  // named as one: the score's parts are computeMa200Candidate's, plus
  // pickersBuilder's dynamicBoost (today's movers and most-searched names).
  rankedBy: { label: "200-day setup score (closeness to the line, time spent above it, its slope and liquidity, with a lift for today's most active and most searched names), best first", short: "setup score" },
  maxItems: 36,
  bodySections: [
    {
      heading: "Sitting close to the long-term average",
      paragraphs: [
        "The 200-day simple moving average, the mean of the last 200 daily closes, is one of the most widely watched long-term trend references. This screen finds stocks trading close to it, a zone where traders often watch to see whether the average acts as support or gives way.",
        "A stock needs at least 220 daily bars to be tested, and its latest close must sit between 1% below and 3% above its 200-day average. The window leans upward on purpose, so it mainly captures stocks resting on or just above the line, plus those that have slipped only slightly under it.",
        "This rule uses the daily average only. A separate page applies a similar test to the 200-week average on weekly bars, which tracks a much longer stretch of history and tends to change far more slowly than the daily line.",
      ],
    },
    {
      heading: "How every candidate is ranked",
      paragraphs: [
        "All qualifying stocks are ranked by a setup score with five parts. Distance makes up 28%, with the best marks going to closes between 0.25% below and 1.5% above the average. Another 32% rewards stocks that spent little of their last 500 bars more than 7% below the average, which tends to favor names with a history of holding above it.",
        "Time spent above the average adds 18%, the 30-bar slope of the average adds 14%, and liquidity, meaning how heavily the stock trades, adds 8%. A rising slope generally suggests the long-term trend is still pointing up, while a flat or falling one may make the average less reliable as a reference.",
        "When reading the list, it can help to compare how far each stock sits from the line rather than treating every row alike. Opening the chart may show whether earlier tests of the average held and which way the average itself is tilting.",
      ],
    },
    {
      heading: "What closeness does not guarantee",
      paragraphs: [
        "Being near the 200-day says nothing on its own about which way price goes next. Averages do break, and a stock sitting 1% above the line one day may be well below it a week later. The score leans on past behavior, and the past may not repeat.",
        "The screen uses daily bars of end-of-day prices, so the newest bar is the previous session’s close, and the page rebuilds hourly. It compares a single close with the average, without waiting for a second day of confirmation.",
        "It also cannot see earnings dates, news or valuation, any of which might move a stock through the average regardless of its history. And because the analysis universe covers about 700 US-listed stocks, plenty of names testing their own 200-day line will never show up on this page.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-near-weekly-200-day-moving-average", label: "Stocks near the weekly 200 average" },
    { href: "/stocks-trading-above-200-day-moving-average", label: "Stocks above the 200-day average" },
    { href: "/stocks-below-200-day-moving-average", label: "Stocks below the 200-day average" },
    { href: "/best-trend-score-stocks", label: "Best trend score stocks" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
