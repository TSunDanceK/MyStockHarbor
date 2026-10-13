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
  title: "Top Stocks With Sell Signals | MyStockHarbor",
  description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  alternates: {
    canonical: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
  },
  openGraph: {
    title: "Top Stocks With Sell Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
    url: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Top Stocks With Sell Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  },
};

// kind stays "sellSignals" -- that branch of buildEntries keeps this page's own
// presentation (the "N of 5 bearish conditions met" note, the score pill driven
// by that count, and reason chips drawn from SELL_REASON_DEFS rather than all 25
// tracked conditions), which the generic "preset" path would flatten.
//
// presetFilters is what opts it into filtering in place: the page ships the full
// universe with `hasSellSignal` pre-ticked, so Select Screener can narrow it
// further (sell signals AND overbought) or widen it by unticking, without
// navigating away. See PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/top-stocks-with-sell-signals",
  eyebrow: "Sell signal stock screener",
  title: "Top Stocks With Sell Signals",
  description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  explainerTitle: "How to use sell signal stocks",
  // The listing rule (#553 COWORK #186 ruling 3), stated where it is used.
  explainerBody: "A stock is listed when it meets two or more of the five bearish conditions, at least one of them overbought or a bearish divergence: trading below a moving average alone is not enough. Sell signals can flag pullback risk, weak trends or possible short-side pressure. They are best used with the chart, because oversold names can still bounce even while the broader structure is weak.",
  emptyText: "No sell signal stocks are currently available from the live picker feed.",
  tone: "red",
  kind: "sellSignals",
  presetFilters: ["hasSellSignal"],
  maxItems: 36,
  bodySections: [
    {
      heading: "What gets counted",
      paragraphs: [
        "Top Stocks With Sell Signals is the name of a rule count. It tracks five bearish technical conditions — overbought, below the 50-day simple moving average, below the 200-day simple moving average, a bearish RSI divergence and a bearish MACD divergence — and lists stocks meeting two or more. It is not advice, and appearing here is not a call on where the price goes next.",
        "One extra rule keeps the list focused on events rather than states. At least one of the conditions met must be overbought or a bearish divergence, so a stock that is merely sitting below both averages, two points on its own, does not qualify.",
        "Overbought has its own definition: RSI(14) at 70 or above, plus at least one other overbought check, and more overbought checks than oversold ones. A bearish divergence means price made a higher closing peak while momentum, measured by RSI or the MACD line, made a lower one.",
      ],
    },
    {
      heading: "Reading and questioning the list",
      paragraphs: [
        "Rows are sorted by count, highest first, then A–Z. An overbought reading above a rising 200-day average is a different picture from a bearish divergence below both averages, so looking at which conditions combine can be more useful than the number alone.",
        "The conditions come from end-of-day bars, with the newest being the previous session’s close, and the page rebuilds hourly. Overbought readings can persist through strong uptrends, divergences can fade without any decline, and the count cannot see earnings, news or valuation.",
      ],
    },
    {
      heading: "Why the count can change quickly",
      paragraphs: [
        "Because several conditions depend on a single close, a stock can enter or leave the list from one session to the next. An RSI that dips from 71 to 69, or a close that moves back above the 50-day average, may be enough to change the count. A short stay on the page is common and does not by itself mean much.",
      ],
    },
    {
      heading: "A sample row and a close cousin",
      paragraphs: [
        "Take a hypothetical stock with an RSI(14) of 74 that also meets one other overbought check, while showing more overbought than oversold checks. If its price has also made a higher closing peak while the MACD line made a lower one, it scores two: overbought plus a bearish MACD divergence. A stock with the same RSI but no second overbought check would not count as overbought, and with nothing else it would not appear.",
        "The Top Stocks With Buy Signals page is built the other way round. It counts mostly bullish conditions, scores zero for any stock not above its 200-day average, and needs at least three; this page needs only two and has no 200-day requirement. A stock can therefore appear here while still trading above its 200-day average, and both pages are best read as rule counts describing a chart, not as opposing verdicts.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/top-stocks-with-buy-signals", label: "Top Stocks With Buy Signals (rule count)" },
    { href: "/overbought-stocks-today", label: "Overbought stocks today" },
    { href: "/bearish-rsi-divergence-stocks", label: "Bearish RSI divergence stocks" },
    { href: "/bearish-macd-divergence-stocks", label: "Bearish MACD divergence stocks" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
