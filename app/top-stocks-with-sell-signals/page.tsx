import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Top Stocks With Sell Signals | MyStockHarbor",
  description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  alternates: {
    canonical: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
  },
  openGraph: {
    title: "Top Stocks With Sell Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
    url: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Top Stocks With Sell Signals | MyStockHarbor",
    description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  },
};

// kind stays "sellSignals" -- that branch of buildEntries keeps this page's own
// presentation (the "N of 5 bearish conditions met" note, the score pill driven
// by that count, and reason chips drawn from SELL_REASON_DEFS rather than all 25
// tracked conditions), which the generic "preset" path would flatten.
//
// presetFilters is what opts it into filtering in place: the page ships the full
// universe with `hasSellSignal` pre-ticked, so Select Screener can narrow it
// further (sell signals AND overbought) or widen it by unticking, without
// navigating away. See PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/top-stocks-with-sell-signals",
  eyebrow: "Sell signal stock screener",
  title: "Top Stocks With Sell Signals",
  description: "Browse stocks currently showing multiple bearish technical conditions from the live MyStockHarbor picker feed.",
  explainerTitle: "How to use sell signal stocks",
  explainerBody: "Sell signals can flag pullback risk, weak trends or possible short-side pressure. They are best used with the chart, because oversold names can still bounce even while the broader structure is weak.",
  emptyText: "No sell signal stocks are currently available from the live picker feed.",
  tone: "red",
  kind: "sellSignals",
  presetFilters: ["hasSellSignal"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
