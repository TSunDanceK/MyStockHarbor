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
  title: "Bullish MACD Divergence Stocks | MyStockHarbor",
  description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD histogram makes higher lows.",
  alternates: { canonical: "https://www.mystockharbor.com/bullish-macd-divergence-stocks" },
  openGraph: {
    title: "Bullish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD histogram makes higher lows.",
    url: "https://www.mystockharbor.com/bullish-macd-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bullish MACD Divergence Stocks | MyStockHarbor",
    description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD histogram makes higher lows.",
  },
};

const config: PickerResultConfig = {
  href: "/bullish-macd-divergence-stocks",
  eyebrow: "BULLISH MACD DIVERGENCE SCREENER",
  title: "Bullish MACD Divergence Stocks",
  description: "Stocks currently showing a bullish MACD divergence — price making lower lows while the MACD histogram makes higher lows.",
  explainerTitle: "How to use bullish MACD divergence",
  explainerBody: "A bullish MACD divergence can flag slowing downside momentum ahead of a turn. Use it to narrow charts to review, and confirm with support, trend and volume before acting.",
  emptyText: "No stocks are currently showing a bullish MACD divergence in the live feed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["bullishMacdDivergence"],
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
