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
  title: "Bullish RSI Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  alternates: { canonical: "https://www.mystockharbor.com/bullish-rsi-divergence-stocks" },
  openGraph: {
    title: "Bullish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
    url: "https://www.mystockharbor.com/bullish-rsi-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bullish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  },
};

const config: PickerResultConfig = {
  href: "/bullish-rsi-divergence-stocks",
  eyebrow: "BULLISH RSI DIVERGENCE SCREENER",
  title: "Bullish RSI Divergence Stocks",
  description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  explainerTitle: "How to use bullish RSI divergence",
  explainerBody: "A bullish RSI divergence — price falling while RSI turns up — can flag waning downside momentum and a possible reversal. Use it as a starting point for chart review, not an automatic buy; confirm with support and volume.",
  emptyText: "No stocks are currently showing a bullish RSI divergence in the live feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["bullishRsiDivergence"],
  maxItems: 36,
  // WRITE-UP (#553 COWORK #152, batch 1 of the indexing test, 2026-10-05):
  // what the condition is and how this page computes it, from the builder's
  // own thresholds; distinct per page; descriptive only.
  bodySections: [
    {
      heading: "What a bullish RSI divergence is",
      paragraphs: [
        "The Relative Strength Index, or RSI, measures the balance of recent up-closes against down-closes on a scale of 0 to 100. This page uses the standard 14-period version with Wilder's smoothing. A bullish divergence appears when the price and the RSI disagree: the price sets a lower low, but the RSI at that second low is higher than it was at the first. The price is still falling, while the momentum behind the fall reads weaker than it did last time.",
        "That disagreement is why the pattern attracts attention. A downtrend in which each new low comes with less downside momentum is sometimes described as losing force. It is a description of how the decline has been unfolding, not proof that it has finished, and plenty of divergences resolve with the price continuing lower.",
      ],
    },
    {
      heading: "The exact rules behind this list",
      paragraphs: [
        "Lows are found from daily closing prices. A session counts as a low when its close is below the closes of the two sessions on either side of it, which also means the most recent low on any chart here is at least two sessions old. On the daily chart the page looks back 45 sessions and compares pairs of these lows: the later low must close at least 1.6% below the earlier one, the RSI at the later low must be at least 6 points higher, and the later low must fall within the last 16 sessions so the pattern is still recent.",
        "The same test runs on the weekly chart, with settings scaled to the slower timeframe: a 30-week lookback, a later low at least 2% below the earlier one, an RSI at least 5 points higher, and the later low within the last 10 weeks. Each test also needs a long enough price history before it can run at all, so newly listed stocks rarely qualify.",
        "When both timeframes produce a divergence, the stronger of the two is kept, with weekly patterns given more weight, and the stock is listed here when that chosen pattern includes the RSI condition. Some patterns also show a matching divergence in MACD; those stocks can appear on the MACD divergence page as well, and a pattern confirmed by both indicators is generally treated as the firmer reading.",
      ],
    },
    {
      heading: "Working through a divergence on the chart",
      paragraphs: [
        "Opening the chart with RSI(14) underneath is the clearest way to check each name, because the two lows the rule compared can be read off directly. A divergence where the second low sits only just under the first, and the RSI gap is close to the minimum, is a weaker example than one with a wide gap in both. The depth of the decline also matters: a pattern after a long, steep fall describes a different situation from one inside a shallow pullback.",
        "Context from the rest of the table helps. A stock with a divergence that is also trading near a long-term moving average or a prior support area presents a different picture from one in open space with nothing nearby. The Performance tab shows how far the price has fallen over one, six and twelve months, which places the divergence within the larger move.",
        "Divergences can fail, and they can stay in place for a long time before anything changes. A new lower low with weaker momentum can simply be followed by another one, and the pattern then redraws further down. The list is a set of charts worth a closer look, described by a fixed rule, and nothing on it is a forecast or a recommendation about any security.",
      ],
    },
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
