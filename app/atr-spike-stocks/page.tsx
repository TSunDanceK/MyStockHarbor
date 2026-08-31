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
  title: "ATR Spike Stocks | MyStockHarbor",
  description: "Stocks currently showing an ATR spike — a jump in average true range signalling a sharp rise in volatility.",
  alternates: { canonical: "https://www.mystockharbor.com/atr-spike-stocks" },
  openGraph: {
    title: "ATR Spike Stocks | MyStockHarbor",
    description: "Stocks currently showing an ATR spike — a jump in average true range signalling a sharp rise in volatility.",
    url: "https://www.mystockharbor.com/atr-spike-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ATR Spike Stocks | MyStockHarbor",
    description: "Stocks currently showing an ATR spike — a jump in average true range signalling a sharp rise in volatility.",
  },
};

const config: PickerResultConfig = {
  href: "/atr-spike-stocks",
  eyebrow: "ATR SPIKE SCREENER",
  title: "ATR Spike Stocks",
  description: "Stocks currently showing an ATR spike — a jump in average true range signalling a sharp rise in volatility.",
  explainerTitle: "How to use ATR spikes",
  explainerBody: "A rising ATR means bigger daily ranges and more volatility — useful for spotting names on the move and for sizing positions and stops. Higher volatility cuts both ways, so manage risk accordingly.",
  emptyText: "No stocks are currently flagged with an ATR spike in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["atrSpike"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
