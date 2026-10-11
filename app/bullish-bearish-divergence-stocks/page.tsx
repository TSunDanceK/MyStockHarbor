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

const pageTitle = "Bullish & Bearish Divergence Stocks | RSI & MACD Signals | MyStockHarbor";
const pageDescription =
  "Browse bullish and bearish divergence stocks using live MyStockHarbor picker data. Review RSI and MACD divergence signals, open each stock page, and jump straight to the chart for deeper analysis.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
  },
};

// kind is "preset", not "section": ships the whole universe with `divergencePick`
// pre-ticked so Select Screener filters in place. That flag is derived from this
// same section (see buildCategoryFlags), so the default set is identical to
// before; sectionIncludes is kept so each card's badge and the section ordering
// are re-applied on top. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/bullish-bearish-divergence-stocks",
  eyebrow: "Divergence stock screener",
  title: "Bullish & Bearish Divergence Stocks",
  description:
    "Find stocks currently showing bullish or bearish RSI and MACD divergence, where momentum has started to disagree with price.",
  explainerTitle: "How to use RSI & MACD divergence",
  explainerBody:
    "Divergence appears when price and momentum stop moving in sync — in bullish divergence price keeps weakening while momentum improves, in bearish divergence price keeps pushing higher while momentum fades. Each card here shows whichever of RSI or MACD produced the strongest divergence signal for that stock. Divergence alone isn't a signal to act on — check structure, support and resistance, and follow-through before deciding.",
  emptyText: "No bullish or bearish divergence stocks are currently available from the live picker feed.",
  tone: "blue",
  kind: "preset",
  presetFilters: ["divergencePick"],
  sectionIncludes: ["divergence"],
  maxItems: 36,
  bodySections: [
    {
      heading: "Divergence, in plain terms",
      paragraphs: [
        "A divergence is a disagreement between price and a momentum indicator. When price sets a lower low but momentum sets a higher one, it is called bullish divergence, because selling may be losing force. When price sets a higher high while momentum weakens, it is bearish divergence. This page gathers both kinds from two indicators, RSI(14) and the MACD line.",
        "Swing points are found on closing prices, using pivots with two bars on either side. On daily charts the detector looks back 45 bars, needs a price swing of at least 1.6%, and the second pivot must be no more than 16 bars old. On weekly charts it looks back 30 bars, needs a 2.0% swing, and the second pivot must be within 10 bars.",
        "The MACD version uses the line itself (the 12-period EMA minus the 26-period EMA), not the histogram, and its swing must be meaningful: at least 0.5 times its standard deviation on daily, 0.35 on weekly. For bearish RSI divergence, RSI must fall at least 6 points between the pivots on daily, or 5 on weekly.",
      ],
    },
    {
      heading: "How the twenty are chosen",
      paragraphs: [
        "Only the 20 strongest divergences across the universe appear, one per stock. Each is scored on six parts: timeframe 30%, with weekly signals weighted above daily; duration 20%; structure 20%; magnitude 15%; distance to the 200-day average 10%; and reaction 5%.",
        "Penalties apply for thin liquidity, for price swings under 2.5%, and for pivots spanning fewer than 4 bars, which tends to push small or crowded patterns down the list.",
        "Each card notes which indicator produced the signal and which way it leans. Weekly patterns cover far more history than daily ones, so the two may deserve different weight. The chart link can help check by eye whether the two pivots look meaningful and where price sits relative to its 200-day average.",
      ],
    },
    {
      heading: "Limits worth keeping in mind",
      paragraphs: [
        "Divergence describes momentum, not direction. Price can keep falling through a bullish divergence, or keep rising through a bearish one, sometimes forming several divergences in a row before anything changes. The pattern tends to be more informative alongside support, resistance and the broader trend than on its own.",
        "A pivot only confirms once two later bars exist, so every signal is at least a couple of bars old when it appears. The data is daily bars of end-of-day prices, with the newest bar being the previous session’s close, and the page rebuilds hourly.",
        "Because only one divergence is kept per stock and only 20 are listed, a stock can carry another signal that does not show here. The dedicated RSI and MACD divergence pages keep their own lists and might show it.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/bullish-rsi-divergence-stocks", label: "Bullish RSI divergence stocks" },
    { href: "/bearish-rsi-divergence-stocks", label: "Bearish RSI divergence stocks" },
    { href: "/bullish-macd-divergence-stocks", label: "Bullish MACD divergence stocks" },
    { href: "/bearish-macd-divergence-stocks", label: "Bearish MACD divergence stocks" },
  ],
  relatedGuide: {
    href: "/bullish-divergence-explained",
    label: "bullish divergence explained",
    blurb: "For how these patterns form and how to read them on a chart, start with",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
