import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

// ── ISR probe (2026-08-20) ──────────────────────────────────────────────────
//
// Was `export const dynamic = "force-dynamic"`, which ships Cache-Control:
// no-store and makes every visit and every crawl a full serverless render.
// Nothing on this page is per-request: the picker data is built by a daily
// warm cron into Redis and read back from there, exactly like /bottlenecks,
// which runs on `revalidate` and prerenders happily (○ 1h in the build
// output).
//
// 300s rather than an hour because the underlying pickers cache is itself
// refreshed on a 5-minute cycle -- matching what /pickers already uses, which
// the build output confirms as ○ 5m.
//
// THIS IS A PROBE, deliberately applied to ONE page so the build output gives
// a clean A/B against its ~23 identical siblings. The open question is not the
// directive but the `searchParams` prop below: awaiting searchParams in a
// server component opts a route out of static rendering on its own, so
// removing force-dynamic may change nothing. If this page comes back ƒ while
// carrying revalidate, that is the answer, and the fix is to stop threading
// searchParams through the server component and read `?symbol=` client-side
// via useSearchParams instead -- PickerFilterContext.tsx already does exactly
// that for the filter predicates.
export const revalidate = 300;

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

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
