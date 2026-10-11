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
  title: "Oversold Stocks Today | MyStockHarbor",
  description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  alternates: {
    canonical: "https://www.mystockharbor.com/oversold-stocks-today",
  },
  openGraph: {
    title: "Oversold Stocks Today | MyStockHarbor",
    description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
    url: "https://www.mystockharbor.com/oversold-stocks-today",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Oversold Stocks Today | MyStockHarbor",
    description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  },
};

// kind is "preset", not "section": the page ships the whole analyzed universe
// with `oversold` pre-ticked client-side, so "Select Screener" can narrow or
// widen the list in place instead of sending visitors off to /stock-screener.
// `sectionIncludes` is kept so the Oversold section's per-item detail (dominant
// indicator for the chart deep link, timeframe/indicator badge, its own
// ordering) is re-applied on top -- see buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/oversold-stocks-today",
  eyebrow: "Oversold stock screener",
  title: "Oversold Stocks Today",
  description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  explainerTitle: "How to use oversold stocks",
  explainerBody: "Oversold does not automatically mean bullish. The best setups usually show selling pressure slowing, a clean support area, or early evidence that buyers are stepping back in.",
  emptyText: "No oversold stocks are currently available from the live picker feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["oversold"],
  sectionIncludes: ["oversold"],
  maxItems: 36,
  bodySections: [
    {
      heading: "What counts as oversold on this page",
      paragraphs: [
        "This screen looks for stocks whose recent selling has stretched them unusually far from their normal trading range. “Oversold” here describes how far and how fast a price has fallen, judged by a handful of indicators. It does not say the decline is over, and it is not a recommendation.",
        "Each stock is tested against six checks: RSI(14), a 0–100 momentum gauge, at or below 30; a close under the lower Bollinger Band, which sits two standard deviations below the 20-day average; a close at least 5% below the 20-day EMA, a moving average that weights recent days more heavily; a close at least 5% below the 50-day simple moving average; a close at least 5% below the 200-day; and a MACD histogram at or below −0.2% of the price.",
        "To qualify, a stock needs at least two of those checks, more oversold checks than overbought ones, and RSI at or below 30 must be one of them. Stocks with fewer than 60 daily closes are skipped, since several of the indicators need that much history to settle.",
      ],
    },
    {
      heading: "How the list is ordered and what to compare",
      paragraphs: [
        "The first 20 rows are ranked by an oversold score, so the most stretched names in the screen’s judgment tend to sit at the top. Anything beyond those 20 is ordered by conditions met, a count of how many tracked screener conditions a stock currently meets. ‘See more’ only lengthens the list; it does not change which stocks belong to it.",
        "A useful habit is to compare where the stretch comes from. A stock far below its 200-day average may be in a long downtrend, while one that is only under its 20-day EMA and lower band may have had a sharp but short drop. The Performance tab can help separate a single bad week from months of weakness, and the chart link can show whether a nearby support area exists.",
        "You can also tick extra conditions in “Select Screener” to narrow the list in place, for example to see which oversold names are also showing a bullish divergence.",
      ],
    },
    {
      heading: "What the screen cannot tell you",
      paragraphs: [
        "Everything here runs on daily bars of end-of-day prices, so the newest bar is the previous session’s close, and the page rebuilds hourly. A stock that bounced or fell further during today’s session will not reflect that until the next daily bar arrives.",
        "Oversold readings can also persist. In a strong decline, RSI may stay under 30 for days or weeks, and a stock can keep appearing here while it keeps falling. The screen cannot see news, earnings or the reason for the selling, and those may matter more than any indicator.",
        "The universe is limited to about 700 US-listed stocks, so a name outside it will never appear, however stretched it might be. Treat the list as a set of charts that may be worth a closer look, not as a signal on its own.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/overbought-stocks-today", label: "Overbought stocks today" },
    { href: "/bullish-rsi-divergence-stocks", label: "Bullish RSI divergence stocks" },
    { href: "/stocks-down-20-from-all-time-highs", label: "Stocks down 20% from their highs" },
    { href: "/stocks-below-200-day-moving-average", label: "Stocks below the 200-day average" },
  ],
  relatedGuide: {
    href: "/oversold-stocks",
    label: "our guide to oversold stocks",
    blurb: "New to RSI and oversold conditions? Start with",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
