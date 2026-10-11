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
  title: "Bearish RSI Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  alternates: { canonical: "https://www.mystockharbor.com/bearish-rsi-divergence-stocks" },
  openGraph: {
    title: "Bearish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
    url: "https://www.mystockharbor.com/bearish-rsi-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bearish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  },
};

const config: PickerResultConfig = {
  href: "/bearish-rsi-divergence-stocks",
  eyebrow: "BEARISH RSI DIVERGENCE SCREENER",
  title: "Bearish RSI Divergence Stocks",
  description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  explainerTitle: "How to use bearish RSI divergence",
  explainerBody: "A bearish RSI divergence — price rising while RSI turns down — can flag fading upside momentum and a possible pullback. Treat it as a caution flag for chart review, not an automatic sell.",
  emptyText: "No stocks are currently showing a bearish RSI divergence in the live feed.",
  tone: "red",
  kind: "preset",
  presetFilters: ["bearishRsiDivergence"],
  maxItems: 36,
  bodySections: [
    {
      heading: "Price up, RSI down",
      paragraphs: [
        "RSI, the Relative Strength Index, scores recent gains against recent losses on a 0 to 100 scale, using a 14-bar window here. This page shows stocks whose closing price has set a higher swing high while RSI printed a lower reading at that second high than at the first. Analysts tend to read that as momentum thinning out beneath a rising price.",
        "Treat the list as a set of charts to inspect. A divergence describes the past few weeks of trading; it does not predict a decline. Some readers pair it with a trend check, such as whether price still holds above its 50-day average.",
      ],
    },
    {
      heading: "What counts as a real drop",
      paragraphs: [
        "The swing highs are pivots on closes, each compared with the two bars on either side, found by the same detector the MACD divergence pages use. Daily scans look back 45 bars, require at least a 1.6% gap between the two highs, and need the second within 16 bars of today. Weekly scans look back 30 bars, require 2.0%, and allow 10 bars.",
        "The RSI condition is a fixed points threshold rather than a relative one. On daily bars RSI must be at least 6 points lower at the second high than at the first; on weekly bars, at least 5 points. A one- or two-point dip, which can happen almost randomly, will not qualify.",
      ],
    },
    {
      heading: "Making sense of the results",
      paragraphs: [
        "The default order is conditions met, a tally of how many tracked screener conditions a stock matches, so the top row is not necessarily the clearest divergence. Checking whether the first high was itself overbought, above 70, and whether volume shrank into the second high may add context.",
        "Strong trends can produce repeated bearish divergences while price keeps climbing. The data comes from end-of-day bars, the latest being the previous session’s close, rebuilt hourly, so intraday moves are not reflected until the next update.",
      ],
    },
    {
      heading: "An illustrative row, and close calls",
      paragraphs: [
        "Consider a stock with a weekly close high of 80 followed, seven weeks later, by a higher one at 82, a 2.5% rise that clears the 2.0% weekly bar. If RSI stood at 71 on the first high and 64 on the second, the 7-point drop exceeds the 5 points weekly data requires, so the pair can count. With RSI at 67 on the second high, a 4-point drop, it would not, though the chart would look nearly identical.",
        "The same pair seen on daily bars would need a 6-point drop and a 1.6% price gap, with the second high inside 16 bars. A pattern can also age out, vanishing once the newer high leaves the window. The bearish MACD divergence page uses the same pivots but a different momentum test, scaled to each stock’s own MACD variation, so a stock with a modest, steady momentum fade might register there and not here, or the reverse.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/bullish-rsi-divergence-stocks", label: "Bullish RSI divergence" },
    { href: "/bearish-macd-divergence-stocks", label: "Bearish MACD divergence" },
    { href: "/bullish-bearish-divergence-stocks", label: "Best divergences ranked" },
    { href: "/overbought-stocks-today", label: "Overbought stocks today" },
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
