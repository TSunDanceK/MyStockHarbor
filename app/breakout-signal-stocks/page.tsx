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
  title: "Breakout Signal Stocks | MyStockHarbor",
  description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  alternates: { canonical: "https://www.mystockharbor.com/breakout-signal-stocks" },
  openGraph: {
    title: "Breakout Signal Stocks | MyStockHarbor",
    description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
    url: "https://www.mystockharbor.com/breakout-signal-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Breakout Signal Stocks | MyStockHarbor",
    description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  },
};

const config: PickerResultConfig = {
  href: "/breakout-signal-stocks",
  eyebrow: "BREAKOUT SIGNAL SCREENER",
  title: "Breakout Signal Stocks",
  description: "Stocks currently flagged as breaking out — pushing through a recent range or resistance level in the live technical scan.",
  explainerTitle: "How to use breakout signals",
  explainerBody: "Breakouts can mark the start of a new move or fail and reverse. Use this list to find names clearing resistance, then confirm the breakout holds with volume and follow-through before acting.",
  emptyText: "No stocks are currently flagged as breaking out in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["breakout"],
  maxItems: 36,
  relatedGuide: {
    href: "/breakout-stocks",
    label: "our guide to breakout stocks",
    blurb: "For how breakouts form and which ones tend to fail, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
