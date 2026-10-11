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
  bodySections: [
    {
      heading: "How weekly zones are found",
      paragraphs: [
        "This screen zooms out to weekly bars, using up to the last 260 weeks (about five years) and requiring at least 90 weeks of history. It marks pivots, the turning points in weekly highs and lows, and then looks for places where price has turned repeatedly at a similar level.",
        "A level only counts when at least three pivots of the same kind cluster within 4.5% of each other, the resulting zone is no wider than 4.5%, and those touches span at least 18 weeks. That last condition keeps out clusters formed during a single short episode. Price must currently sit between 3% below and 12% above the level for a stock to be listed.",
        "Whether a zone is labeled support or resistance depends on where price is now relative to it, not on how the pivots were originally formed. A former ceiling that price has climbed above may therefore appear as support.",
      ],
    },
    {
      heading: "Using the ranking",
      paragraphs: [
        "Only the top 20 candidates are shown, scored on number of touches (27%), proximity of price to the zone (24%), how tight the zone is (18%), volume traded around it (16%), how many weeks it spans (9%) and liquidity (6%). A higher rank tends to mean a well-tested, narrow zone that price is close to right now.",
        "Take an imagined stock with three weekly lows near $40, $41 and $41.50, spread over about eight months. Those pivots sit within 4.5% of each other and span well over 18 weeks, so they may form a zone around $41. With price now at $44, about 7% above, the stock is in range and the zone reads as support; at $47, roughly 15% above, it would drop out.",
        "Opening the weekly chart is the natural next step. It may show whether price is approaching the zone from above or below, and whether previous visits produced sharp turns or brief pauses. Comparing the stated level with the current price shows how much room there is before it is tested.",
      ],
    },
    {
      heading: "Limits of a zone-based screen",
      paragraphs: [
        "Zones are areas, not exact prices, and a level that held several times can still give way. Weekly bars move slowly, so a fresh break may take time to register. The underlying prices are end-of-day data rebuilt hourly. Past turning points show where price turned before; they cannot show whether it will turn there again.",
        "Edge cases fall away quietly: two strong touches are not enough, nor are three bunched within a few months, and a stock that slips just over 3% below a level is dropped. The weekly 200 moving average screen also uses weekly bars, but it tracks one average that shifts every week, while these levels stay fixed where price actually turned.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/stocks-near-weekly-200-day-moving-average", label: "Stocks near the weekly 200 moving average" },
    { href: "/stocks-near-200-day-moving-average", label: "Stocks near the 200-day moving average" },
    { href: "/3-month-high-breakout-stocks", label: "3-month high breakout stocks" },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
