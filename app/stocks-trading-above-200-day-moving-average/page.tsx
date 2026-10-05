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
  title: "Stocks Above the 200-Day Moving Average | MyStockHarbor",
  description: "Stocks currently trading above their 200-day moving average — a widely watched gauge of a longer-term uptrend.",
  alternates: { canonical: "https://www.mystockharbor.com/stocks-trading-above-200-day-moving-average" },
  openGraph: {
    title: "Stocks Above the 200-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading above their 200-day moving average — a widely watched gauge of a longer-term uptrend.",
    url: "https://www.mystockharbor.com/stocks-trading-above-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Above the 200-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading above their 200-day moving average — a widely watched gauge of a longer-term uptrend.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-trading-above-200-day-moving-average",
  eyebrow: "ABOVE 200-DAY MA SCREENER",
  title: "Stocks Above the 200-Day Moving Average",
  description: "Stocks currently trading above their 200-day moving average — a widely watched gauge of a longer-term uptrend.",
  explainerTitle: "How to use the 200-day moving average",
  explainerBody: "The 200-day MA is the classic long-term trend line; trading above it is generally considered bullish. Use it to filter for names in longer-term uptrends, then confirm with the rest of the chart.",
  emptyText: "No stocks are currently trading above their 200-day moving average in the live feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["aboveMA200"],
  maxItems: 36,
  // WRITE-UP (#553 COWORK #152, batch 1 of the indexing test, 2026-10-05):
  // what the condition is and how this page computes it, from the builder's
  // own thresholds; distinct per page; descriptive only.
  bodySections: [
    {
      heading: "The 200-day average and how this page applies it",
      paragraphs: [
        "The 200-day moving average is the mean of a stock's last 200 daily closing prices, recalculated every session. Two hundred trading days is a little under ten calendar months, so the line moves slowly and smooths out almost all of the day-to-day noise. That slowness is the reason it is so widely watched: it is one of the simplest ways to describe the direction of a stock over most of a year.",
        "This page lists every stock in the analyzed universe whose latest daily close is above its own 200-day simple moving average. A stock needs at least 200 sessions of price history for the average to exist, so recent listings cannot appear until they have built that record. The 200 MA column on the General tab shows the level of the average, so the gap between it and the price can be read straight off the table.",
        "Because the test is simply above or below, the list is often long. In a broadly rising market a large share of stocks can sit above their 200-day line at the same time, and in a weak one the list can shrink sharply. The length of the list on a given day is a rough reading of market breadth in its own right.",
      ],
    },
    {
      heading: "Above the line can mean very different things",
      paragraphs: [
        "A stock 2% above its 200-day average and one 40% above it both qualify, yet they are in quite different positions. The first sits close to a level many market participants watch, and a modest fall would take it back below. The second has travelled a long way from its average, which describes a strong advance but also a price that has run well ahead of its own longer-term mean.",
        "The slope of the average matters as much as the price's position. A price above a rising 200-day line describes a stock whose long-run direction is up. A price that has just climbed above a falling line describes a possible change of direction that has not yet been confirmed by the average itself, since the line is still pointing down. The chart for each name shows which of the two applies.",
        "Recent arrivals are a group of their own. A stock that crossed above its average in the last few sessions has a very different history from one that has stayed above it for a year. Prices near the line also tend to cross back and forth, sometimes several times in a few weeks, which is why a single crossing on its own is generally treated as weak evidence.",
      ],
    },
    {
      heading: "Narrowing a long list",
      paragraphs: [
        "With so many names qualifying, the most useful step is often to add a second condition. Sorting by the 200 MA column next to price, or adding a filter from the Screeners panel, can separate the stocks hugging their average from those far above it. The Performance tab shows how the last week, month, six months and year compare, which helps distinguish a steady climb from a single sharp jump.",
        "Two related pages cover the cases this one leaves out. The near-200-day-average page lists stocks trading in a narrow band around the line, from 1% below it to 3% above, where a test of the level may be under way, and the below-200-day page lists the stocks on the other side of it. Reading the three together gives a fuller picture than any one of them alone.",
        "The 200-day average is a lagging measure by construction: it summarises the past ten months and says nothing about what comes next. Staying above it describes a trend that has held so far, and trends can end. The list is a way to organise stocks by long-term direction for further study, and it is not a recommendation about any security.",
      ],
    },
  ],
  relatedGuide: {
    href: "/learn/moving-averages",
    label: "our lesson on moving averages",
    blurb: "For why this level matters and how traders use it, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
