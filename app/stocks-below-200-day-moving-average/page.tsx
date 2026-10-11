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
  title: "Stocks Below the 200-Day Moving Average | MyStockHarbor",
  description: "Stocks currently trading below their 200-day moving average — a widely watched gauge of a longer-term downtrend or deep pullback.",
  alternates: { canonical: "https://www.mystockharbor.com/stocks-below-200-day-moving-average" },
  openGraph: {
    title: "Stocks Below the 200-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading below their 200-day moving average — a widely watched gauge of a longer-term downtrend or deep pullback.",
    url: "https://www.mystockharbor.com/stocks-below-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Below the 200-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading below their 200-day moving average — a widely watched gauge of a longer-term downtrend or deep pullback.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-below-200-day-moving-average",
  eyebrow: "BELOW 200-DAY MA SCREENER",
  title: "Stocks Below the 200-Day Moving Average",
  description: "Stocks currently trading below their 200-day moving average — a widely watched gauge of a longer-term downtrend or deep pullback.",
  explainerTitle: "How to use the 200-day moving average",
  explainerBody: "Trading below the 200-day MA is generally considered a longer-term caution flag — though deeply oversold names below it can also mark value or reversal setups. Use it as a starting point, not a verdict.",
  emptyText: "No stocks are currently trading below their 200-day moving average in the live feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["belowMA200"],
  maxItems: 36,
  bodySections: [
    {
      heading: "Why the 200-day line gets so much attention",
      paragraphs: [
        "The 200-day simple moving average averages roughly ten months of daily closes, which makes it slow to move and widely used as a dividing line between longer-term uptrends and downtrends. This screen lists stocks whose latest daily close is below that average.",
        "The rule is a single comparison: one close, one average. A stock does not need to have just crossed under, stayed under for a set number of days, or fallen by any minimum amount. A name a fraction of a percent below and one far beneath it both qualify.",
      ],
    },
    {
      heading: "Getting more from the list",
      paragraphs: [
        "By default rows are ordered by conditions met, how many tracked screener conditions each stock meets. Distance from the average is often the most telling extra detail. A stock just under the line may be testing it from below, while one far under it has usually been weak for some time, and the two can behave differently.",
        "The slope of the 200-day may matter as well. An average still rising while price dips beneath it reads differently from one that has been falling for months. Comparing with the 50-day average and RSI can show whether recent action is stabilizing or still sliding.",
      ],
    },
    {
      heading: "What the screen leaves out",
      paragraphs: [
        "A long average reacts slowly, so a stock can recover well off its low and still sit below the 200-day for weeks. The screen also cannot see the reason for the weakness, whether earnings, sector rotation or broader market falls. Prices are end-of-day, the latest bar being the previous session’s close, and the page rebuilds hourly.",
        "In a broad market decline this list can grow to cover a large share of the roughly 700 analyzed stocks, which by itself may say more about the market than about any single company.",
      ],
    },
    {
      heading: "One row, worked through",
      paragraphs: [
        "Suppose a stock closed at 95.00 while its 200-day average stood at 100.00, putting it 5% below. It is listed. If its 50-day average sits at 92.00 and price is above that shorter line, recent trading may be firming even though the slower measure has not caught up; if price is under both, the weakness is more broad-based. Neither reading says what comes next, but together they frame the row better than the listing alone.",
        "The page for stocks near the 200-day average overlaps only partly. It accepts a band from 1% below to 3% above the line and favors stocks that have spent little time far beneath it, so it leans toward names holding the average. This page has no band: a stock 1.5% under the line appears here but falls outside the near-200 range, and one 40% under it appears here as well.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-near-200-day-moving-average", label: "Near the 200-day average" },
    { href: "/stocks-trading-above-200-day-moving-average", label: "Above the 200-day average" },
    { href: "/stocks-down-20-from-all-time-highs", label: "Down 20% from highs" },
    { href: "/stocks-below-50-day-moving-average", label: "Below the 50-day average" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
