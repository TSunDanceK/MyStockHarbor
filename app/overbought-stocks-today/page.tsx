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
  title: "Overbought Stocks Today | MyStockHarbor",
  description: "Review overbought stocks ranked by extension, liquidity and pullback-risk profile.",
  alternates: {
    canonical: "https://www.mystockharbor.com/overbought-stocks-today",
  },
  openGraph: {
    title: "Overbought Stocks Today | MyStockHarbor",
    description: "Review overbought stocks ranked by extension, liquidity and pullback-risk profile.",
    url: "https://www.mystockharbor.com/overbought-stocks-today",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Overbought Stocks Today | MyStockHarbor",
    description: "Review overbought stocks ranked by extension, liquidity and pullback-risk profile.",
  },
};

// kind is "preset", not "section": ships the whole universe with `overbought`
// pre-ticked so Select Screener filters in place. sectionIncludes is kept so the
// section's per-item detail (dominant indicator for the chart deep link, badge,
// ordering) is re-applied on top. See buildEntries in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/overbought-stocks-today",
  eyebrow: "Overbought stock screener",
  title: "Overbought Stocks Today",
  description: "Review overbought stocks ranked by extension, liquidity and pullback-risk profile.",
  explainerTitle: "How to use overbought stocks",
  explainerBody: "Overbought stocks can keep trending, so this page is not automatically bearish. Use it to find stretched names where chasing may carry more risk, especially if momentum starts to fade.",
  emptyText: "No overbought stocks are currently available from the live picker feed.",
  tone: "red",
  kind: "preset",
  presetFilters: ["overbought"],
  sectionIncludes: ["overbought"],
  maxItems: 36,
  relatedGuide: {
    href: "/overbought-stocks",
    label: "our guide to overbought stocks",
    blurb: "For what an overbought reading does and doesn't tell you, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
