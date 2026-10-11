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
  title: "Stocks Above the 50-Day Moving Average | MyStockHarbor",
  description: "Stocks currently trading above their 50-day moving average — a simple gauge of shorter-term uptrend.",
  alternates: { canonical: "https://www.mystockharbor.com/stocks-above-50-day-moving-average" },
  openGraph: {
    title: "Stocks Above the 50-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading above their 50-day moving average — a simple gauge of shorter-term uptrend.",
    url: "https://www.mystockharbor.com/stocks-above-50-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Above the 50-Day Moving Average | MyStockHarbor",
    description: "Stocks currently trading above their 50-day moving average — a simple gauge of shorter-term uptrend.",
  },
};

const config: PickerResultConfig = {
  href: "/stocks-above-50-day-moving-average",
  eyebrow: "ABOVE 50-DAY MA SCREENER",
  title: "Stocks Above the 50-Day Moving Average",
  description: "Stocks currently trading above their 50-day moving average — a simple gauge of shorter-term uptrend.",
  explainerTitle: "How to use the 50-day moving average",
  explainerBody: "Trading above the 50-day MA is a basic sign of a healthy shorter-term trend. Use it to filter for names in gear, then review the chart and longer-term trend before acting.",
  emptyText: "No stocks are currently trading above their 50-day moving average in the live feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["aboveMA50"],
  maxItems: 36,
  bodySections: [
    {
      heading: "A wide net for shorter-term strength",
      paragraphs: [
        "The 50-day moving average is the plain mean of the last 50 daily closes, a simple moving average or SMA. A stock is listed here when its most recent close sits strictly above that line. In a firm market this can include a large share of the roughly 700 US-listed stocks the site analyzes, so the page works best as a first filter rather than a shortlist.",
        "The test is one close against one number. There is no requirement for a fresh cross, no minimum distance above the line, and no need for the close to hold for several days. A stock that rose through its 50-day average yesterday and one that has stayed above it for months look identical to the rule.",
      ],
    },
    {
      heading: "Narrowing it down",
      paragraphs: [
        "Rows sort by conditions met, the number of tracked screener conditions a stock satisfies, which tends to push names with several technical flags toward the top. Useful next questions include how far price is above the average, since a close well above it may be stretched, and whether the 200-day average agrees. A stock above its 50-day but below its 200-day can be bouncing inside a longer slide.",
        "The sidebar filters can add a second condition, such as above the 200-day, without leaving the page.",
      ],
    },
    {
      heading: "What one close cannot show",
      paragraphs: [
        "A 50-day average lags price by design, and stocks trading sideways near it can flip in and out of this list from one session to the next. Bars are end-of-day, the newest being the previous close, and the page rebuilds hourly, so it will not reflect intraday moves.",
        "The screen also cannot see why a stock is above its average. A rally driven by one earnings report, a broad market lift, or a slow steady climb all pass the same test, and the chart is usually the quickest way to tell them apart.",
      ],
    },
    {
      heading: "Two rows that look alike",
      paragraphs: [
        "Picture a stock that closed at 52.40 with its 50-day average at 50.00, about 4.8% above the line. It qualifies. If the session before closed at 49.80, it was absent a day earlier, yet nothing in the row flags it as new. A second stock closing 25% above its average carries the same standing, even though it could fall several percent and stay listed, while the first might drop off after one soft session.",
        "The page for stocks above the 200-day average asks the same kind of question over roughly ten months instead of about ten weeks. Because the 50-day line tracks price more closely, this list tends to turn over faster and may pick up a change in direction sooner, at the cost of more short-lived entries. A name that shows up here but not on the 200-day list is still trading under its longer average.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-trading-above-200-day-moving-average", label: "Above the 200-day average" },
    { href: "/best-trend-score-stocks", label: "Best trend score" },
    { href: "/stocks-with-bullish-trend-flip", label: "Bullish trend flips" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
