import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ISR rather than force-dynamic. `force-dynamic` shipped Cache-Control:
// no-store, so every visit and every crawl of this page paid a full
// serverless render -- 24h of runtime logs showed cache=MISS on every
// request, never a HIT or PRERENDER. 300s matches the underlying pickers
// cache cycle (and what /pickers already runs at), and the payload is
// cron-warmed into Redis on a shorter cycle than that, so nothing here goes
// stale. See claude/picker-pages-isr-2026-08-20.md.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Oversold Stocks Today | MyStockHarbor",
  description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  alternates: {
    canonical: "https://www.mystockharbor.com/oversold-stocks-today",
  },
  openGraph: {
    title: "Oversold Stocks Today | MyStockHarbor",
    description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
    url: "https://www.mystockharbor.com/oversold-stocks-today",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Oversold Stocks Today | MyStockHarbor",
    description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  },
};

// kind is "preset", not "section": the page ships the whole analyzed universe
// with `oversold` pre-ticked client-side, so "Select Screener" can narrow or
// widen the list in place instead of sending visitors off to /stock-screener.
// `sectionIncludes` is kept so the Oversold section's per-item detail (dominant
// indicator for the chart deep link, timeframe/indicator badge, its own
// ordering) is re-applied on top -- see buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/oversold-stocks-today",
  eyebrow: "Oversold stock screener",
  title: "Oversold Stocks Today",
  description: "Review oversold stocks ranked by stretch, exhaustion, liquidity and potential rebound quality.",
  explainerTitle: "How to use oversold stocks",
  explainerBody: "Oversold does not automatically mean bullish. The best setups usually show selling pressure slowing, a clean support area, or early evidence that buyers are stepping back in.",
  emptyText: "No oversold stocks are currently available from the live picker feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["oversold"],
  sectionIncludes: ["oversold"],
  maxItems: 36,
  relatedGuide: {
    href: "/oversold-stocks",
    label: "our guide to oversold stocks",
    blurb: "New to RSI and oversold conditions? Start with",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
