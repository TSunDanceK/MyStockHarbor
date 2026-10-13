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
  title: "All-Time High Breakout Stocks | MyStockHarbor",
  description: "Review stocks trading at or near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
  alternates: {
    canonical: "https://www.mystockharbor.com/all-time-high-breakout-stocks",
  },
  openGraph: {
    title: "All-Time High Breakout Stocks | MyStockHarbor",
    description: "Review stocks trading at or near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
    url: "https://www.mystockharbor.com/all-time-high-breakout-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "All-Time High Breakout Stocks | MyStockHarbor",
    description: "Review stocks trading at or near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
  },
};

// kind is "preset", not "section": ships the whole universe with `athBreakoutPick`
// pre-ticked so Select Screener filters in place. That flag is derived from this
// same section (see buildCategoryFlags), so the default set is identical to
// before; sectionIncludes is kept so the ATH reference-line chart deep link
// (athPrice / athDate), badge and ordering survive. See buildEntries in
// PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/all-time-high-breakout-stocks",
  eyebrow: "Breakout stock screener",
  title: "All-Time High Breakout Stocks",
  description: "Review stocks trading at or near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
  explainerTitle: "How to use all-time high breakouts",
  explainerBody: "Breakouts near all-time highs can show strong demand and leadership. The cleaner setups usually hold near the breakout zone rather than immediately failing back into the prior range.",
  emptyText: "No all-time high breakout stocks are currently available from the live picker feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["athBreakoutPick"],
  sectionIncludes: ["all-time high breakout"],
  maxItems: 36,
  bodySections: [
    {
      heading: "How this breakout screen defines a high",
      paragraphs: [
        "This page lists stocks closing at or very near the top of their price history. A stock that keeps reaching fresh highs is often described as showing relative strength, meaning it has held up better than much of the market, and this screen is a quick way to see which names are in that position right now.",
        "The rule is short. A stock needs at least 120 daily bars, and its latest close must be at least 99% of the highest close in its loaded history. In other words, a stock within 1% of its peak qualifies even if it has not quite matched it.",
        "The “all-time high” used here is the highest closing price in up to about five years of loaded daily data. Intraday highs are ignored, and a stock that peaked more than five years ago may be measured against a nearer, lower high instead, so the reference is not a true all-time high in every case.",
      ],
    },
    {
      heading: "Why only twenty names, and in what order",
      paragraphs: [
        "Only the top 20 qualifying stocks are shown, ranked by a score that blends four ingredients: how recent the breakout is, the latest volume compared with its 20-day average, liquidity (how heavily the stock trades), and extension, or how far price has run beyond the prior high.",
        "Recency is measured in days since a close at least 0.1% above the prior high. That figure feeds the score but does not decide membership, so a stock can sit just under its peak for a while and still appear, only lower down the list.",
        "When reading the results, the chart link marks the reference high, which can help show whether price is holding near that line or drifting back beneath it. Comparing volume across rows may also hint at which moves had broad participation behind them, while a large extension can mean price has already moved a long way from the level.",
      ],
    },
    {
      heading: "Where breakout lists can mislead",
      paragraphs: [
        "Breakouts fail often. A stock may close near its high one day and slip back into its old range the next, and this screen has no way to tell a lasting move from a brief one. It works from daily bars of end-of-day prices, so the newest data point is the previous session’s close, and the page rebuilds hourly.",
        "The five-year window can also flatter a stock that is merely recovering toward an older peak set outside that window. A longer chart might reveal overhead resistance the screen cannot see. News, earnings and valuation sit outside the rule entirely.",
        "Because the list stops at 20, a qualifying stock with a weak score may be left off entirely. For a broader view, the breakout signals page combines this full rule set with the three-month high rule, without the top-20 cut.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/3-month-high-breakout-stocks", label: "3-month high breakout stocks" },
    { href: "/breakout-signal-stocks", label: "Breakout signal stocks" },
    { href: "/best-trend-score-stocks", label: "Best trend score stocks" },
    { href: "/volume-spike-stocks", label: "Volume spike stocks" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
