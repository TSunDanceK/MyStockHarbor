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
  title: "Overbought Stocks Today | MyStockHarbor",
  description: "Review overbought stocks ranked by extension, liquidity and pullback-risk profile.",
  alternates: {
    canonical: "https://www.mystockharbor.com/overbought-stocks-today",
  },
  openGraph: {
    title: "Overbought Stocks Today | MyStockHarbor",
    description: "Review overbought stocks ranked by extension, liquidity and pullback-risk profile.",
    url: "https://www.mystockharbor.com/overbought-stocks-today",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Overbought Stocks Today | MyStockHarbor",
    description: "Review overbought stocks ranked by extension, liquidity and pullback-risk profile.",
  },
};

// kind is "preset", not "section": ships the whole universe with `overbought`
// pre-ticked so Select Screener filters in place. sectionIncludes is kept so the
// section's per-item detail (dominant indicator for the chart deep link, badge,
// ordering) is re-applied on top. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/overbought-stocks-today",
  eyebrow: "Overbought stock screener",
  title: "Overbought Stocks Today",
  description: "Review overbought stocks ranked by extension, liquidity and pullback-risk profile.",
  explainerTitle: "How to use overbought stocks",
  explainerBody: "Overbought stocks can keep trending, so this page is not automatically bearish. Use it to find stretched names where chasing may carry more risk, especially if momentum starts to fade.",
  emptyText: "No overbought stocks are currently available from the live picker feed.",
  tone: "red",
  kind: "preset",
  presetFilters: ["overbought"],
  sectionIncludes: ["overbought"],
  maxItems: 36,
  // WRITE-UP (#553 COWORK #152, batch 1 of the indexing test, 2026-10-05):
  // what the condition is and how this page computes it, from the builder's
  // own thresholds; distinct per page; descriptive only.
  bodySections: [
    {
      heading: "How this page decides a stock is overbought",
      paragraphs: [
        "There is no single official definition of overbought, so this page uses a panel of six checks on each stock's daily closes and lists a stock when the evidence leans clearly one way. The checks are: RSI(14), calculated the standard Wilder way, at 70 or above; the close above the upper Bollinger band (20 sessions, 2 standard deviations); the close at least 5% above the 20-day exponential moving average; at least 5% above the 50-day moving average; at least 5% above the 200-day moving average; and a MACD(12,26,9) histogram worth at least 0.2% of the share price.",
        "A stock qualifies when at least two of those checks fire on the overbought side and they outnumber any that fire on the oversold side. It also needs at least 60 sessions of price history, so a recent listing with a short record cannot appear. In chart view, each card's note states how many of the six checks fired; in the list, the Signals column counts something broader, namely how many of the site's tracked screener conditions the stock meets at the moment, with their names on hover.",
        "The order of the list is a ranking, not a verdict. It weighs how far past their thresholds the readings sit, how liquid the stock is, how sharp the last one and five sessions have been, and how far the price has moved from its 20-day and 50-day averages. A thinly traded name is pushed down the list, because a stretched reading on light volume says less than the same reading on heavy volume.",
      ],
    },
    {
      heading: "Two quite different kinds of stretched stock",
      paragraphs: [
        "Some names arrive here after a sudden jump: a result, an announcement or a sector-wide move lifts the price several percent in a session or two, and the short-term checks (RSI, the upper band, the distance from the 20-day average) all trip at once. A reading like that describes a burst, and it can fade as quickly as it formed, or the price may simply move sideways while the averages catch up.",
        "Others arrive slowly. A stock in a long, steady advance can sit 5% or more above its 50-day and 200-day averages for months, with RSI hovering near 70 the whole time. Here the overbought label is describing the strength of an established trend rather than an exhausted one, and strong trends have historically been able to stay extended for longer than many observers expect.",
        "The chart is the quickest way to tell the two apart. A price that has lifted away from a flat 50-day average in the last few sessions points to a short, sharp move; a price riding a rising 50-day and 200-day average for months points to a longer climb. Neither picture is a signal on its own, and the same stock can move from one group to the other within a few weeks.",
      ],
    },
    {
      heading: "Reading the results without over-reading them",
      paragraphs: [
        "The Stretch (z20) column on the General tab gives a second view of the same question in a single number: how many standard deviations the last close sits above its own 20-day average. A stock flagged by several checks but with a modest stretch figure may be extended mainly against its longer averages; a large stretch figure suggests the move is unusual even by the stock's own recent standards.",
        "The Performance tab adds context the checks leave out. A name up sharply over one week but flat over six months is in a different position from one that has risen steadily all year, even if both carry the same number of fired checks today. Opening the chart for each name, rather than relying on the table, is usually the clearest way to see which situation applies.",
        "Overbought is a description of where the price sits relative to its recent history, not a forecast of where it goes next. Momentum readings can stay high through a strong rally, and a pause can come from the price drifting sideways rather than falling. The page is a starting point for closer review, and none of it amounts to a recommendation about any security.",
      ],
    },
  ],
  relatedGuide: {
    href: "/overbought-stocks",
    label: "our guide to overbought stocks",
    blurb: "For what an overbought reading does and doesn't tell you, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
