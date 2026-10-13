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
  title: "Breakout Signal Stocks | MyStockHarbor",
  description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  alternates: { canonical: "https://www.mystockharbor.com/breakout-signal-stocks" },
  openGraph: {
    title: "Breakout Signal Stocks | MyStockHarbor",
    description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
    url: "https://www.mystockharbor.com/breakout-signal-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Breakout Signal Stocks | MyStockHarbor",
    description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  },
};

const config: PickerResultConfig = {
  href: "/breakout-signal-stocks",
  eyebrow: "BREAKOUT SIGNAL SCREENER",
  title: "Breakout Signal Stocks",
  description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  explainerTitle: "How to use breakout signals",
  explainerBody: "Breakouts can mark the start of a new move or fail and reverse. Use this list to find names clearing resistance, then confirm the breakout holds with volume and follow-through before acting.",
  emptyText: "No stocks are currently flagged as breaking out in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["breakout"],
  maxItems: 36,
  bodySections: [
    {
      heading: "Two breakout rules, one combined list",
      paragraphs: [
        "This page is a union of two separate tests. A stock appears if it passes the full all-time-high breakout rule set or the full three-month-high breakout rule set. It is the complete membership of each test, not just the top 20 that the dedicated pages show, so this list is usually longer and less filtered.",
        "The all-time-high test asks whether the last close is within 1% of the highest close in the loaded history. That history runs up to about five years of daily closes, so the “all-time high” here is a long-window high rather than a true lifetime peak, and intraday highs are ignored. The three-month test compares the last close with the highest close over 63 bars ending five bars ago, and counts a stock within 0.5% of that level.",
        "Both tests run on daily bars of end-of-day prices, where the newest bar is the previous session’s close.",
      ],
    },
    {
      heading: "Making sense of the order",
      paragraphs: [
        "Rows are sorted by conditions met, meaning how many of the tracked screener conditions a stock satisfies at once, not by breakout strength. A name near the top may simply be ticking several other boxes too, such as sitting above its moving averages or showing a volume spike. Opening a row’s chart can help show which of those other conditions are doing the work.",
        "It can help to note which of the two rules a stock passed. A name pressing a multi-year high is in a different position from one reclaiming a three-month range, and the chart usually makes the difference obvious within a few seconds. Pressing ‘See more’ only expands the list; it doesn’t change who is on it.",
        "A hypothetical row shows how the union works. Suppose a stock closed at $98 against a five-year closing high of $100: that is 98% of the peak, just outside the 1% allowance, so the long-window rule passes it by. If its highest close over the 63 bars ending five sessions ago was $98.30, though, the same close is about 99.7% of that level and the three-month rule lets it in.",
        "The two dedicated breakout pages each rank their qualifiers by a score built from recency, volume and liquidity and keep only 20, whereas this page keeps every qualifier from both and lets the conditions-met count decide the order.",
      ],
    },
    {
      heading: "What a breakout flag cannot tell you",
      paragraphs: [
        "Both tests allow a close slightly below the reference high, so some names have not cleared their level yet. Closes only are used, which means a move that broke out intraday and reversed will not count, and one that is already fading may still be listed until the next rebuild. Pages refresh hourly from data a session old. Breakouts also tend to fail fairly often, and nothing in this rule checks whether the move will hold.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/3-month-high-breakout-stocks", label: "3-month high breakout stocks" },
    { href: "/all-time-high-breakout-stocks", label: "All-time high breakout stocks" },
    { href: "/volume-spike-stocks", label: "Volume spike stocks" },
  ],
  relatedGuide: {
    href: "/breakout-stocks",
    label: "our guide to breakout stocks",
    blurb: "For how breakouts form and which ones tend to fail, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
