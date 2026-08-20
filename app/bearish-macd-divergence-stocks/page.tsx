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
  title: "Bearish MACD Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD histogram makes lower highs.",
  alternates: { canonical: "https://www.mystockharbor.com/bearish-macd-divergence-stocks" },
  openGraph: {
    title: "Bearish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD histogram makes lower highs.",
    url: "https://www.mystockharbor.com/bearish-macd-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bearish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD histogram makes lower highs.",
  },
};

const config: PickerResultConfig = {
  href: "/bearish-macd-divergence-stocks",
  eyebrow: "BEARISH MACD DIVERGENCE SCREENER",
  title: "Bearish MACD Divergence Stocks",
  description: "Stocks currently showing a bearish MACD divergence — price making higher highs while the MACD histogram makes lower highs.",
  explainerTitle: "How to use bearish MACD divergence",
  explainerBody: "A bearish MACD divergence can flag fading upside momentum. Use it as a caution flag for chart review, confirming with trend and volume, not as an automatic sell.",
  emptyText: "No stocks are currently showing a bearish MACD divergence in the live feed.",
  tone: "red",
  kind: "preset",
  presetFilters: ["bearishMacdDivergence"],
  maxItems: 36,
  relatedGuide: {
    href: "/bearish-divergence-explained",
    label: "bearish divergence explained",
    blurb: "For how the pattern forms and how to read it on a chart, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
