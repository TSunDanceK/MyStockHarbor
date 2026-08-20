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

const pageTitle = "Macro Support and Resistance Stocks | MyStockHarbor";
const pageDescription =
  "Find stocks approaching wider support or resistance zones using weekly chart structure, repeated touch areas, distance from current price, and volume at the level.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: "https://www.mystockharbor.com/macro-support-resistance-stocks",
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/macro-support-resistance-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
  },
};

// kind is "preset", not "section": ships the whole universe with `macroSrPick`
// pre-ticked so Select Screener filters in place. That flag is derived from this
// same section (see buildCategoryFlags), so the default set is identical to
// before; sectionIncludes is kept so the S/R zone chart deep link (srLower /
// srUpper / srKind) and the zone overlay on each card survive -- those come off
// the section item, not the signal record. See buildEntries in
// PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/macro-support-resistance-stocks",
  eyebrow: "Support and resistance screener",
  title: "Macro Support and Resistance Stocks",
  description:
    "Find stocks approaching wider support or resistance zones using weekly chart structure, repeated touch areas, distance from current price, and volume at the level.",
  explainerTitle: "How to use macro support and resistance",
  explainerBody:
    "Macro support and resistance areas are wider chart zones, not exact prices. This page highlights stocks near repeated weekly support or resistance areas, then adds context from distance to the zone and trading volume around that level. Open the chart to check whether price is reacting, rejecting, breaking out, or breaking down.",
  emptyText:
    "No strong macro support or resistance candidates are currently available from the live picker feed.",
  tone: "blue",
  kind: "preset",
  presetFilters: ["macroSrPick"],
  sectionIncludes: ["macro", "support", "resistance"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
