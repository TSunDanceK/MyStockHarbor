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
  title: "Bearish MACD Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD line makes lower highs.",
  alternates: { canonical: "https://www.mystockharbor.com/bearish-macd-divergence-stocks" },
  openGraph: {
    title: "Bearish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD line makes lower highs.",
    url: "https://www.mystockharbor.com/bearish-macd-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bearish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD line makes lower highs.",
  },
};

const config: PickerResultConfig = {
  href: "/bearish-macd-divergence-stocks",
  eyebrow: "BEARISH MACD DIVERGENCE SCREENER",
  title: "Bearish MACD Divergence Stocks",
  description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD line makes lower highs.",
  explainerTitle: "How to use bearish MACD divergence",
  explainerBody: "A bearish MACD divergence can flag fading upside momentum. Use it as a caution flag for chart review, confirming with trend and volume, not as an automatic sell.",
  emptyText: "No stocks are currently showing a bearish MACD divergence in the live feed.",
  tone: "red",
  kind: "preset",
  presetFilters: ["bearishMacdDivergence"],
  maxItems: 36,
  bodySections: [
    {
      heading: "Higher price, weaker momentum",
      paragraphs: [
        "This screen lists stocks where the closing price has set a higher swing high while MACD, a momentum gauge built from two exponential averages, has set a lower one. That mismatch may suggest a rise is carrying less force than the previous leg did, though it says nothing about when, or whether, the trend turns.",
        "The gauge used is the MACD line itself, the 12-period exponential average minus the 26-period one, rather than the histogram some charting packages show beneath it. Signal settings are the standard 12/26/9.",
      ],
    },
    {
      heading: "How a pattern makes the list",
      paragraphs: [
        "Swing points, called pivots, are found on closing prices, each one judged against the two bars either side of it. On daily bars the detector searches the last 45 bars, needs at least a 1.6% price difference between the two highs, and wants the second high no more than 16 bars old. On weekly bars it searches 30 bars, needs a 2.0% difference, and allows the second high to be up to 10 bars old.",
        "The fall in the MACD line between those highs must also be meaningful rather than noise: at least half its usual variation, measured as a standard deviation, on daily data, or 0.35 times that on weekly data. Only one divergence is kept per stock, whichever daily or weekly reading scores better, so a stock carrying a bullish divergence too may surface on just one of the two MACD pages.",
      ],
    },
    {
      heading: "Reading it, and where it falls short",
      paragraphs: [
        "Rows sort by conditions met, a count of how many tracked screener conditions each stock currently meets, not by how strong the divergence is. Opening the chart to see which timeframe triggered, how far apart the two highs sit, and whether price is still near the second one tends to say more than the row position.",
        "Momentum can fade for weeks while price keeps grinding higher, so many flags may never lead anywhere. The data is end-of-day, with the newest bar being the previous session’s close, and the page rebuilds hourly, so a pattern can appear or disappear between visits.",
      ],
    },
    {
      heading: "A worked example, and near misses",
      paragraphs: [
        "Suppose a stock’s daily close peaks at 100, then eleven sessions later at 103, a 3% gap clearing the 1.6% minimum. If the MACD line read 2.4 at the first high and 1.7 at the second, and that fall exceeds half the line’s usual variation, the pair can register. Had the newer high been 18 bars old, it would fall outside the 16-bar window.",
        "A 1.5% rise between highs, or a MACD fall small relative to that stock’s usual swings, will be passed over. The bearish RSI divergence page runs the same pivot search but judges momentum by RSI points instead, so a stock can show on one of these pages and not the other; appearing on both means two measures agree, not that the pattern is more reliable.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/bullish-macd-divergence-stocks", label: "Bullish MACD divergence" },
    { href: "/bearish-rsi-divergence-stocks", label: "Bearish RSI divergence" },
    { href: "/overbought-stocks-today", label: "Overbought stocks today" },
    { href: "/top-stocks-with-sell-signals", label: "Sell Signals rule count" },
  ],
  relatedGuide: {
    href: "/bearish-divergence-explained",
    label: "bearish divergence explained",
    blurb: "For how the pattern forms and how to read it on a chart, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
