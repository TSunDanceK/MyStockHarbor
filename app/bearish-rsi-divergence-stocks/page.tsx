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
  title: "Bearish RSI Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  alternates: { canonical: "https://www.mystockharbor.com/bearish-rsi-divergence-stocks" },
  openGraph: {
    title: "Bearish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
    url: "https://www.mystockharbor.com/bearish-rsi-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bearish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  },
};

const config: PickerResultConfig = {
  href: "/bearish-rsi-divergence-stocks",
  eyebrow: "BEARISH RSI DIVERGENCE SCREENER",
  title: "Bearish RSI Divergence Stocks",
  description: "Stocks currently showing a bearish RSI divergence — price making higher highs while RSI makes lower highs, a classic momentum-weakening signal.",
  explainerTitle: "How to use bearish RSI divergence",
  explainerBody: "A bearish RSI divergence — price rising while RSI turns down — can flag fading upside momentum and a possible pullback. Treat it as a caution flag for chart review, not an automatic sell.",
  emptyText: "No stocks are currently showing a bearish RSI divergence in the live feed.",
  tone: "red",
  kind: "preset",
  presetFilters: ["bearishRsiDivergence"],
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
