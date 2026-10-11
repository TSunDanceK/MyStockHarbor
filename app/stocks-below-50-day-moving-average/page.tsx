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
  title: "Stocks Below the 50-Day Moving Average | MyStockHarbor",
  description: "Stocks currently trading below their 50-day moving average — a simple gauge of shorter-term weakness or pullback.",
  alternates: { canonical: "https://www.mystockharbor.com/stocks-below-50-day-moving-average" },
  openGraph: {
    title: "Stocks Below the 50-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading below their 50-day moving average — a simple gauge of shorter-term weakness or pullback.",
    url: "https://www.mystockharbor.com/stocks-below-50-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Below the 50-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading below their 50-day moving average — a simple gauge of shorter-term weakness or pullback.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-below-50-day-moving-average",
  eyebrow: "BELOW 50-DAY MA SCREENER",
  title: "Stocks Below the 50-Day Moving Average",
  description: "Stocks currently trading below their 50-day moving average — a simple gauge of shorter-term weakness or pullback.",
  explainerTitle: "How to use the 50-day moving average",
  explainerBody: "Trading below the 50-day MA flags shorter-term weakness or a pullback — sometimes a warning, sometimes a dip in a larger uptrend. Check the bigger picture before drawing conclusions.",
  emptyText: "No stocks are currently trading below their 50-day moving average in the live feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["belowMA50"],
  maxItems: 36,
  bodySections: [
    {
      heading: "Two very different stories under one line",
      paragraphs: [
        "Every stock here closed its latest session strictly below its 50-day simple moving average, the average of its last 50 daily closes. That sounds like a single condition, but it covers at least two quite different situations. One is a short dip in a stock that remains in a longer advance. The other is a stock that has been drifting lower for months and simply stays under the line.",
        "The screen does not separate them. It checks one close against one average, with no cross, no confirmation period, and no depth threshold, so a stock half a percent below qualifies exactly as one twenty percent below does.",
      ],
    },
    {
      heading: "Telling the cases apart",
      paragraphs: [
        "The 200-day average is the quickest clue. A stock below its 50-day yet still above its 200-day may be pulling back within an uptrend, while one under both is more often in a broader decline. The screener’s columns and the related pages for the 200-day can help sort that out.",
        "The list follows conditions met, a count of tracked screener conditions per stock, so oversold or divergence flags may lift a stock higher in the order. Looking at RSI alongside can show whether a drop has been sharp or gradual.",
      ],
    },
    {
      heading: "Limits worth keeping in mind",
      paragraphs: [
        "Being below a moving average describes where price has been; it may or may not persist. Because the 50-day line reacts fairly quickly, names hovering near it can enter and leave the list from one session to the next, and a single weak close is enough to add a stock that recovers the following day.",
        "The screen has no view of the cause. A company-specific setback, a sector-wide slump and a market-wide pullback all look the same here. Prices come from end-of-day bars, the newest being the previous session’s close, and the page is rebuilt hourly, so intraday moves only show up after the next daily bar lands.",
      ],
    },
    {
      heading: "An example row and a near miss",
      paragraphs: [
        "Consider a stock with a 50-day average of 80.00 that closed at 78.40, 2% under the line. It is listed. Had it closed at exactly 80.00 it would not be, because the rule wants a close strictly below; a close equal to the average lands on neither this page nor its above-the-line counterpart. If the following session ends at 81.00, the stock leaves without any notice, so a name seen here yesterday can simply be missing today.",
        "This page differs from the oversold screen in an important way. Oversold requires RSI(14), a 14-day momentum gauge, at or under 30 plus another stretched reading, so it tends to catch sharp, fast drops. Sitting under the 50-day needs no momentum reading at all, which means slow, quiet declines are included here even when they never register as oversold.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-above-50-day-moving-average", label: "Above the 50-day average" },
    { href: "/stocks-below-200-day-moving-average", label: "Below the 200-day average" },
    { href: "/oversold-stocks-today", label: "Oversold stocks today" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
