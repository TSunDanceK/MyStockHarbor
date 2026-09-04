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
  title: "Stocks Down 20% From All-Time Highs | MyStockHarbor",
  description: "Find stocks trading at least 20% below their all-time highs, ranked to favour tradable pullbacks over broken charts.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-down-20-from-all-time-highs",
  },
  openGraph: {
    title: "Stocks Down 20% From All-Time Highs | MyStockHarbor",
    description: "Find stocks trading at least 20% below their all-time highs, ranked to favour tradable pullbacks over broken charts.",
    url: "https://www.mystockharbor.com/stocks-down-20-from-all-time-highs",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Down 20% From All-Time Highs | MyStockHarbor",
    description: "Find stocks trading at least 20% below their all-time highs, ranked to favour tradable pullbacks over broken charts.",
  },
};

// kind is "preset", not "section": ships the whole universe with `buyTheDip`
// pre-ticked so Select Screener filters in place. sectionIncludes is kept so the
// section's badge and ordering are re-applied on top. See buildEntries in
// PickerResultPage.tsx.
//
// `buyTheDip` is this page's condition -- the drawdown-from-all-time-high check
// is the same test, just named for what it's used for rather than how it's
// measured. Note the Select Screener checkbox therefore reads "Buy The Dip"
// while the page heading reads "Stocks Down 20% From All-Time Highs"; the URL
// and metadata are deliberately left alone, since renaming a ranking page means
// redirects and starting its search history over.
const config: PickerResultConfig = {
  href: "/stocks-down-20-from-all-time-highs",
  eyebrow: "Pullback stock screener",
  title: "Stocks Down 20% From All-Time Highs",
  description: "Find stocks trading at least 20% below their all-time highs, ranked to favour tradable pullbacks over broken charts.",
  explainerTitle: "How to use stocks down from highs",
  explainerBody: "A large drawdown can create opportunity, but it can also signal real weakness. Use this page to find names worth reviewing, then check whether price is stabilising or still making lower lows.",
  emptyText: "No stocks down 20% from all-time highs are currently available from the live picker feed.",
  tone: "yellow",
  kind: "preset",
  presetFilters: ["buyTheDip"],
  sectionIncludes: ["stocks down 20"],
  maxItems: 36,
  relatedGuide: {
    href: "/how-to-find-buy-the-dip-stocks",
    label: "our guide to finding buy-the-dip stocks",
    blurb: "For how to tell a pullback worth reviewing from a broken chart, see",
  },
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
