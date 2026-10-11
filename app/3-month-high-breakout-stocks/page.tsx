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
  title: "3-Month High Breakout Stocks | MyStockHarbor",
  description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  alternates: {
    canonical: "https://www.mystockharbor.com/3-month-high-breakout-stocks",
  },
  openGraph: {
    title: "3-Month High Breakout Stocks | MyStockHarbor",
    description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
    url: "https://www.mystockharbor.com/3-month-high-breakout-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "3-Month High Breakout Stocks | MyStockHarbor",
    description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  },
};

// kind is "preset", not "section": ships the whole universe with
// `threeMonthHighPick` pre-ticked so Select Screener filters in place. That flag
// is derived from this same section (see buildCategoryFlags), so the default set
// is identical to before; sectionIncludes is kept so the range-high reference
// line chart deep link (rangeHighPrice / rangeHighDate), badge and ordering
// survive. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/3-month-high-breakout-stocks",
  eyebrow: "Breakout stock screener",
  title: "3-Month High Breakout Stocks",
  description: "Find stocks breaking above their highest closing level from the last three months, ranked by breakout quality and freshness.",
  explainerTitle: "How to use 3-month high breakouts",
  explainerBody: "A 3-month high breakout can flag improving momentum before a stock reaches major all-time high territory. Watch for follow-through volume, controlled retests and a lack of immediate rejection.",
  emptyText: "No 3-month high breakout stocks are currently available from the live picker feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["threeMonthHighPick"],
  sectionIncludes: ["3-month high breakout"],
  maxItems: 36,
  bodySections: [
    {
      heading: "The rule behind a three-month high",
      paragraphs: [
        "This screen looks for stocks whose latest close has climbed back to the top of their recent range. It works on daily bars of end-of-day prices, so the newest bar is the previous session’s close, and a stock needs at least 90 daily bars of history before it can be considered at all.",
        "The reference level is the highest close across 63 bars, roughly three months of trading, that ends five bars ago. The latest five sessions are deliberately left out of that window, so a stock is measured against the high it had to get past rather than against a peak it set only days earlier. A stock qualifies when its last close is at least 99.5% of that reference high. In other words it may sit up to 0.5% below the level and still count, so not every name here has actually closed above it.",
        "Only the top 20 qualifiers are listed, ranked by a blended score: how recent the move is carries 45%, volume compared with its own 20-day average 25%, liquidity (how heavily the stock trades) 20%, and extension 10%.",
      ],
    },
    {
      heading: "Reading the ranked list and where it falls short",
      paragraphs: [
        "Because the order comes from that score, a name near the top tends to be a fresh move on stronger-than-usual volume in a liquid stock. A useful habit is to open the chart and see whether the old high was a single spike or a level price struggled with several times; a level tested repeatedly may carry more meaning than a lone peak.",
        "As an illustration, picture a stock whose highest close in that 63-bar window was $50.00. A last close of $49.80 works out to 99.6% of the reference, so it would be listed despite sitting 20 cents short. A close of $49.70, at 99.4%, would miss and stay off the page until price edges higher.",
        "The closest relative is the all-time-high breakout screen, which measures against up to about five years of closes with a looser 1% tolerance. A name can show up here while still far below its long-run peak, so this page may catch recoveries within a wider range.",
        "Volume is worth a second look on its own. A close near the high on thin trading can fade more easily than one where activity has picked up, and the score only weights volume rather than requiring it.",
        "The screen has clear limits. It reads closing prices only, so an intraday push through the level that reversed by the close will not appear. Pages rebuild hourly from data that is already a session old, so the picture may have moved. And a stock pressing a three-month high can just as easily stall there; the list shows where price is, not where it might go next.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/all-time-high-breakout-stocks", label: "All-time high breakout stocks" },
    { href: "/breakout-signal-stocks", label: "Breakout signal stocks" },
    { href: "/volume-spike-stocks", label: "Volume spike stocks" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
