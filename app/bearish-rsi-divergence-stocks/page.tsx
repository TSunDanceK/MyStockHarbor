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
