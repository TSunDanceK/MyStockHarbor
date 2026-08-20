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
export const revalidate = 300;

// kind is "preset", not "section": ships the whole universe with
// `positiveLastEarnings` pre-ticked so Select Screener filters in place --
// which on an earnings page is the point, since combining it with a technical
// condition is the obvious next question. sectionIncludes is kept so the
// earnings section's badge and ordering are re-applied on top. See buildEntries
// in PickerResultPage.tsx.
const config: PickerResultConfig = {
  href: "/stocks-with-positive-last-earnings",
  eyebrow: "Earnings stock screener",
  title: "Stocks With Positive Last Earnings",
  description:
    "Find stocks ranked by their latest completed earnings report, using EPS surprise, revenue surprise, positive EPS and report freshness.",
  explainerTitle: "How this earnings picker ranks stocks",
  explainerBody:
    "This page focuses on the latest reported quarter. The strongest names tend to have positive EPS surprise, positive revenue surprise, profitable EPS and a recent report that supports the current earnings read.",
  emptyText:
    "No positive last-earnings results are available yet. Use the Fetch Earnings button on the main Pickers page or wait for the earnings cache to warm.",
  tone: "green",
  kind: "preset",
  presetFilters: ["positiveLastEarnings"],
  sectionIncludes: ["positive", "last", "earnings"],
  maxItems: 40,
};

export const metadata: Metadata = {
  title:
    "Stocks With Positive Last Earnings | EPS & Revenue Beat Screener | MyStockHarbor",
  description:
    "Browse stocks with positive latest earnings using EPS surprise, revenue surprise, positive EPS and earnings freshness from MyStockHarbor.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-positive-last-earnings",
  },
  openGraph: {
    title: "Stocks With Positive Last Earnings | MyStockHarbor",
    description:
      "Find stocks ranked by their latest completed earnings report, including EPS and revenue surprise.",
    url: "https://www.mystockharbor.com/stocks-with-positive-last-earnings",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With Positive Last Earnings | MyStockHarbor",
    description:
      "Browse stocks with positive latest earnings using EPS surprise, revenue surprise and earnings quality.",
  },
};

export default function StocksWithPositiveLastEarningsPage() {
  return <PickerResultPage config={config} />;
}
