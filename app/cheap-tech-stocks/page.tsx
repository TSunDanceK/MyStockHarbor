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

const pageTitle = "Cheap Tech Stocks | Technology Shares Under 25x Earnings | MyStockHarbor";
const pageDescription =
  "Technology companies trading below 25 times earnings — a demanding filter in a sector that usually commands a premium, and a short list because of it.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "https://www.mystockharbor.com/cheap-tech-stocks" },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/cheap-tech-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: pageTitle, description: pageDescription },
};

const config: PickerResultConfig = {
  href: "/cheap-tech-stocks",
  eyebrow: "CHEAP TECH SCREENER",
  title: "Cheap Tech Stocks",
  description:
    "Technology sector stocks trading under 25 times earnings. A deliberately loose ceiling by market standards and a strict one for this sector — both conditions can be adjusted from the sidebar.",
  explainerTitle: "How to use this screen",
  explainerBody:
    "Twenty-five times earnings is not cheap in absolute terms. It is cheap relative to a sector that routinely trades at twice that, which is the only sense in which the word is useful here.",
  emptyText: "No technology stocks in the analyzed universe are currently trading below 25 times earnings.",
  tone: "blue",
  kind: "preset",
  presetPredicates: [
    { kind: "category", field: "sector", values: ["Technology"] },
    { kind: "number", field: "peRatio", max: 25 },
  ],
  // Same reasoning as /low-pe-stocks, and the same accessor as the predicate
  // above so membership and order cannot disagree. This page shipped in
  // `reasons.length` order -- how many of 25 unrelated technical conditions a
  // stock happens to meet -- which on a page whose entire claim is a valuation
  // ceiling is not an imprecise ranking, it is a ranking of a different subject.
  //
  // It was left out of #336 only because it is in NOINDEX_PICKER_PAGES. That
  // governs whether search engines see the page, not whether a visitor reading
  // it is shown the cheapest names first.
  orderBy: { field: "peRatio", dir: "asc", label: "P/E Ratio" },
  maxItems: 36,
  // Same reasoning as /low-pe-stocks: the claim is about valuation, so open on
  // the tab that lets it be checked against more than one multiple.
  defaultTab: "valuation",
  bodySections: [
    {
      heading: "What counts as cheap in technology",
      paragraphs: [
        "The 25x ceiling on this page would be a generous definition of value almost anywhere else on the market. In technology it is restrictive, and that difference is the entire point. Sector context is what makes a valuation number meaningful — a multiple that reads as expensive against utilities can read as a discount against software.",
        "Technology carries a persistent premium for reasons that are mostly rational. Software has minimal marginal cost, so incremental revenue converts to profit at rates a manufacturer cannot approach. Network effects and switching costs make established positions unusually defensible. Growth rates are higher and last longer. Investors pay more for those characteristics because, on average, they have been worth more.",
        "The consequence is that applying a conventional value threshold to this sector returns almost nothing. Screening technology at 15 times earnings does not find you bargains; it finds you an empty list, or a handful of companies whose multiples are low because something is genuinely wrong.",
      ],
    },
    {
      heading: "Why a tech stock ends up on this list",
      paragraphs: [
        "There are broadly three routes onto this page, and they call for very different responses. The first is maturity: an established technology business growing at single digits, well run and highly profitable, that the market has simply stopped classifying as a growth story. These are often the most interesting names here, because the multiple reflects a change in narrative rather than a change in quality.",
        "The second is a hardware or components business that the sector label flatters. Technology as a sector classification includes companies whose economics look much more like manufacturing — thin margins, heavy capital requirements, real cyclicality. Those businesses have always traded closer to industrial multiples, and their presence here is normal rather than notable.",
        "The third is genuine trouble: a company facing platform obsolescence, a lost contract, margin compression from a better-funded competitor, or a product cycle that has turned. Technology punishes this harder than most sectors, because disruption tends to be permanent rather than cyclical. A retailer can recover a bad year; a company whose core product has been superseded frequently cannot.",
      ],
    },
    {
      heading: "How to work through the results",
      paragraphs: [
        "Look at revenue growth first, before anything else. It is the fastest way to separate the three cases above. A company at 20 times earnings still growing revenue steadily is in a different position from one at the same multiple whose revenue is shrinking, even though the valuation column reads identically.",
        "Then check free cash flow on the Financials tab, which is particularly informative in this sector. Technology accounting involves large non-cash charges — share-based compensation especially — that can make reported earnings a poor guide to the cash a business actually produces. The gap between the two is often wide here, and it usually favours looking at cash.",
        "Bear in mind that this list is short and will stay short. Only a small fraction of the technology names in the analyzed universe clear a 25x ceiling at any given time, and that scarcity is informative in itself: it tells you the sector is priced for continued growth. If the list ever lengthens materially, that is worth noticing, because it means the market has changed its mind about technology as a whole rather than about any one company on it.",
      ],
    },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
