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
  title: "Top Stocks With Buy Signals | MyStockHarbor",
  description: "Browse stocks currently showing multiple bullish technical conditions from the live MyStockHarbor picker feed.",
  alternates: {
    canonical: "https://www.mystockharbor.com/top-stocks-with-buy-signals",
  },
  openGraph: {
    title: "Top Stocks With Buy Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bullish technical conditions from the live MyStockHarbor picker feed.",
    url: "https://www.mystockharbor.com/top-stocks-with-buy-signals",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Top Stocks With Buy Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bullish technical conditions from the live MyStockHarbor picker feed.",
  },
};

// kind stays "buySignals" -- that branch of buildEntries keeps this page's own
// presentation (the "N of 9 bullish conditions met" note, the score pill driven
// by that count, and reason chips drawn from BUY_REASON_DEFS rather than all 25
// tracked conditions), which the generic "preset" path would flatten.
//
// presetFilters is what opts it into filtering in place: the page ships the full
// universe with `hasBuySignal` pre-ticked, so Select Screener can narrow it
// further (buy signals AND oversold) or widen it by unticking, without
// navigating away. See PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/top-stocks-with-buy-signals",
  eyebrow: "Buy signal stock screener",
  title: "Top Stocks With Buy Signals",
  description: "Browse stocks currently showing multiple bullish technical conditions from the live MyStockHarbor picker feed.",
  explainerTitle: "How to use buy signal stocks",
  // The listing rule (#553 COWORK #186 ruling 2), stated where it is used.
  explainerBody: "A stock is listed when it trades above its 200-day moving average and meets at least two more of the bullish conditions. Buy signal pages are starting points, not automatic entries. Look for agreement between the mini chart, broader trend, moving averages, momentum and recent news before treating a signal as actionable.",
  emptyText: "No buy signal stocks are currently available from the live picker feed.",
  tone: "green",
  kind: "buySignals",
  presetFilters: ["hasBuySignal"],
  maxItems: 36,
  bodySections: [
    {
      heading: "A count of rule conditions, not a recommendation",
      paragraphs: [
        "Despite the name, Top Stocks With Buy Signals is a tally. Each stock is checked against a fixed set of technical conditions, and the page lists those that meet enough of them. Nothing here is advice, and a high count is not a judgment on the stock’s merits.",
        "The count starts with one gate: if the latest daily close is not above the 200-day simple moving average, the score is zero and the stock is not listed. Above that line, the tracked conditions are: above the 200-day average, oversold, down 20% from its high, a breakout, a volume spike of at least 1.8 times the 20-day average, an ATR spike (an unusually wide daily range measured against ATR(14)), above the 50-day average, a bullish RSI divergence and a bullish MACD divergence. A stock needs at least three, which means the 200-day condition plus at least two others.",
      ],
    },
    {
      heading: "Reading the counts",
      paragraphs: [
        "Rows are ordered by the number of conditions met, then A–Z. It may help to look at which conditions make up a count, not just its size, because they can point in different directions: being oversold and breaking out describe very different charts, yet each adds one to the total.",
        "Some conditions also overlap. A stock above its 50-day and 200-day averages scores two points from what is largely one uptrend, so a count of four is not necessarily four independent pieces of evidence.",
      ],
    },
    {
      heading: "What the tally leaves out",
      paragraphs: [
        "Every condition is built from end-of-day prices, and the newest bar is the previous session’s close. The tally knows nothing about valuation, earnings or news, and the page rebuilds hourly, so it can trail fast-moving stocks. Counts can rise and fall from one session to the next as individual conditions switch on and off.",
      ],
    },
    {
      heading: "One row, counted out",
      paragraphs: [
        "Take a hypothetical stock closing 3% above its 200-day average and 2% above its 50-day average, with the day’s volume at 2.1 times its 20-day average. That makes three conditions: above the 200-day, above the 50-day, and a volume spike. It is listed with a count of three. Had volume been 1.7 times the average, the count would fall to two and the stock would drop off, which shows how one threshold can decide membership.",
        "The 200-day gate also hides some combinations entirely. A stock 1% under its 200-day line with an oversold reading, a bullish RSI divergence and a volume spike scores zero here, however many other conditions it meets. Top Stocks With Sell Signals is a separate tally built from different conditions rather than a mirror image, so a stock can appear on both pages or on neither, and the two are not meant to be read as opposites.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/top-stocks-with-sell-signals", label: "Top Stocks With Sell Signals (rule count)" },
    { href: "/breakout-signal-stocks", label: "Breakout signal stocks" },
    { href: "/bullish-rsi-divergence-stocks", label: "Bullish RSI divergence stocks" },
    { href: "/stocks-trading-above-200-day-moving-average", label: "Stocks above the 200-day moving average" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
