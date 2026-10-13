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
  title: "Bullish MACD Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD line makes higher lows.",
  alternates: { canonical: "https://www.mystockharbor.com/bullish-macd-divergence-stocks" },
  openGraph: {
    title: "Bullish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD line makes higher lows.",
    url: "https://www.mystockharbor.com/bullish-macd-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bullish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD line makes higher lows.",
  },
};

const config: PickerResultConfig = {
  href: "/bullish-macd-divergence-stocks",
  eyebrow: "BULLISH MACD DIVERGENCE SCREENER",
  title: "Bullish MACD Divergence Stocks",
  description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD line makes higher lows.",
  explainerTitle: "How to use bullish MACD divergence",
  explainerBody: "A bullish MACD divergence can flag slowing downside momentum ahead of a turn. Use it to narrow charts to review, and confirm with support, trend and volume before acting.",
  emptyText: "No stocks are currently showing a bullish MACD divergence in the live feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["bullishMacdDivergence"],
  maxItems: 36,
  bodySections: [
    {
      heading: "When a decline starts losing steam",
      paragraphs: [
        "Picture a stock that closes at a fresh low, yet the momentum reading behind it holds up better than it did at the last low. That is a bullish MACD divergence, and it is what this page collects. It can indicate that downward pressure is easing, which some chart readers treat as a cue to look closer rather than as a turning point in itself.",
        "MACD here means the MACD line: a fast 12-period exponential average of closes minus a slower 26-period one. The histogram is not used for this test.",
      ],
    },
    {
      heading: "The detector’s settings, daily versus weekly",
      paragraphs: [
        "Both lows are pivots on closing prices, a pivot being a close that stands out against two bars on each side. The daily scan covers 45 bars and the weekly scan 30. Price must undercut the earlier low by at least 1.6% on daily data and 2.0% on weekly. Recency matters too: the newer low can be at most 16 daily bars or 10 weekly bars back.",
        "Meanwhile the MACD line has to rise between the two lows by a margin worth noticing, at least 0.5 times its standard deviation on daily bars and 0.35 times on weekly. A stock keeps just one divergence, the better-scoring candidate across the two timeframes, so it might be absent here because a bearish signal scored higher.",
        "The list is ordered by conditions met, meaning how many of the site’s tracked screener conditions each stock satisfies.",
      ],
    },
    {
      heading: "Questions worth asking of each row",
      paragraphs: [
        "Is price near a support level, or still sliding in a steep downtrend? Is the 200-day average far overhead? A divergence in a long decline can repeat several times before anything changes. Since the bars are end-of-day and the page refreshes hourly, the newest low may be only a session old.",
        "None of this is a forecast. Momentum can keep improving while price makes still lower closes, and the screen has no view of news, earnings or the wider market that may be driving the move.",
      ],
    },
    {
      heading: "One row, worked through",
      paragraphs: [
        "Imagine a stock whose daily close bottomed at 50, then twelve sessions later bottomed again at 48.5, a 3% undercut and comfortably past the 1.6% floor. If its MACD line sat at −1.8 at the first low and −1.1 at the second, it has risen while price fell, and provided that rise beats half the line’s standard deviation, the pair may qualify. The same shape with a second low only 1% beneath the first would not, however clear it looks on a chart.",
        "Timing is another miss. Once the newer low is more than 16 daily bars old, the pattern drops off even if nothing on the chart has changed. The bullish RSI divergence page looks for the same kind of falling-price, rising-momentum pair but measures momentum with RSI; because the gauges are built differently, the lists may overlap only partly.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/bearish-macd-divergence-stocks", label: "Bearish MACD divergence" },
    { href: "/bullish-rsi-divergence-stocks", label: "Bullish RSI divergence" },
    { href: "/oversold-stocks-today", label: "Oversold stocks today" },
    { href: "/macro-support-resistance-stocks", label: "Macro support and resistance" },
  ],
  relatedGuide: {
    href: "/bullish-divergence-explained",
    label: "bullish divergence explained",
    blurb: "For how the pattern forms and how to read it on a chart, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
