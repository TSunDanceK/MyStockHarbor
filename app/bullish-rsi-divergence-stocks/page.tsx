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
  title: "Bullish RSI Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  alternates: { canonical: "https://www.mystockharbor.com/bullish-rsi-divergence-stocks" },
  openGraph: {
    title: "Bullish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
    url: "https://www.mystockharbor.com/bullish-rsi-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bullish RSI Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  },
};

const config: PickerResultConfig = {
  href: "/bullish-rsi-divergence-stocks",
  eyebrow: "BULLISH RSI DIVERGENCE SCREENER",
  title: "Bullish RSI Divergence Stocks",
  description: "Stocks currently showing a bullish RSI divergence — price making lower lows while RSI makes higher lows, a classic momentum-reversal signal.",
  explainerTitle: "How to use bullish RSI divergence",
  explainerBody: "A bullish RSI divergence — price falling while RSI turns up — can flag waning downside momentum and a possible reversal. Use it as a starting point for chart review, not an automatic buy; confirm with support and volume.",
  emptyText: "No stocks are currently showing a bullish RSI divergence in the live feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["bullishRsiDivergence"],
  maxItems: 36,
  relatedGuide: {
    href: "/bullish-divergence-explained",
    label: "bullish divergence explained",
    blurb: "For how the pattern forms and how to read it on a chart, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
