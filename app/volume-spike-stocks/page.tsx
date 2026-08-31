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
  title: "Volume Spike Stocks | MyStockHarbor",
  description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  alternates: { canonical: "https://www.mystockharbor.com/volume-spike-stocks" },
  openGraph: {
    title: "Volume Spike Stocks | MyStockHarbor",
    description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
    url: "https://www.mystockharbor.com/volume-spike-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Volume Spike Stocks | MyStockHarbor",
    description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  },
};

const config: PickerResultConfig = {
  href: "/volume-spike-stocks",
  eyebrow: "VOLUME SPIKE SCREENER",
  title: "Volume Spike Stocks",
  description: "Stocks currently trading on a volume spike — unusually high volume versus their recent average in the live scan.",
  explainerTitle: "How to use volume spikes",
  explainerBody: "A volume spike shows unusual interest and can precede or confirm a big move in either direction. Pair it with the price action and news to judge whether it is accumulation, distribution or a one-off.",
  emptyText: "No stocks are currently flagged with a volume spike in the live feed.",
  tone: "orange",
  kind: "preset",
  presetFilters: ["volumeSpike"],
  maxItems: 36,
  relatedGuide: {
    href: "/learn/volume",
    label: "our lesson on volume",
    blurb: "For what a volume spike signals and what it doesn't, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
