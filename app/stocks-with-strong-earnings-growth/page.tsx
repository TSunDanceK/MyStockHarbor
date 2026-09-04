import type { Metadata } from "next";
import PickerResultPage, {
  type PickerResultConfig,
} from "@/app/components/PickerResultPage";

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

// kind is "preset", not "section": ships the whole universe with
// `strongEarningsGrowth` pre-ticked so Select Screener filters in place --
// which on an earnings page is the point, since combining it with a technical
// condition is the obvious next question. sectionIncludes is kept so the
// earnings section's badge and ordering are re-applied on top. See buildEntries
// in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/stocks-with-strong-earnings-growth",
  eyebrow: "Earnings growth screener",
  title: "Stocks With Strong Earnings Growth",
  description:
    "Find stocks ranked by year-over-year EPS growth, revenue growth, recent positive earnings consistency and beat history.",
  explainerTitle: "How this earnings growth picker ranks stocks",
  explainerBody:
    "This page is designed to highlight companies with improving earnings patterns. It gives more weight to year-over-year EPS growth, revenue growth, recent positive EPS consistency and a history of beating expectations.",
  emptyText:
    "No strong earnings-growth results are available yet. Use the Fetch Earnings button on the main Pickers page or wait for the earnings cache to warm.",
  tone: "green",
  kind: "preset",
  presetFilters: ["strongEarningsGrowth"],
  sectionIncludes: ["strong", "earnings", "growth"],
  maxItems: 40,
};

export const metadata: Metadata = {
  title:
    "Stocks With Strong Earnings Growth | YoY EPS & Revenue Growth Screener | MyStockHarbor",
  description:
    "Browse stocks with strong earnings growth, ranked by year-over-year EPS growth, revenue growth, positive earnings consistency and beat history.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-strong-earnings-growth",
  },
  openGraph: {
    title: "Stocks With Strong Earnings Growth | MyStockHarbor",
    description:
      "Find stocks ranked by year-over-year EPS growth, revenue growth and recent earnings consistency.",
    url: "https://www.mystockharbor.com/stocks-with-strong-earnings-growth",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With Strong Earnings Growth | MyStockHarbor",
    description:
      "Browse stocks with strong earnings growth using YoY EPS and revenue improvement.",
  },
};

export default function StocksWithStrongEarningsGrowthPage() {
  return <PickerResultPage config={config} />;
}
