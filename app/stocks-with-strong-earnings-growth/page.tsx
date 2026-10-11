import type { Metadata } from "next";
import PickerResultPage, {
  type PickerResultConfig,
} from "@/app/components/PickerResultPage";
import { pickersFundamentalsSource } from "@/lib/server/pickersSecFundamentals";
import { SEC_GROWTH_COPY } from "@/lib/server/pickersSecEarningsGrowth";

// THE WORDS FOLLOW THE RULE (#553 CODE-B #94 B5, 2026-10-03). Under the SEC
// default the list is built from filed figures (lib/server/
// pickersSecEarningsGrowth.ts): YoY diluted EPS and revenue on the latest filed
// period. The old copy promised "beat history" and "positive earnings
// consistency", which came from FMP estimates no filing carries, so the SEC
// copy says what the screen now measures. PICKERS_FUNDAMENTALS=fmp (the
// rollback) restores the old rule and, with it, the old words below.
const SEC = pickersFundamentalsSource() === "sec";

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
  description: SEC
    ? SEC_GROWTH_COPY.description
    : "Find stocks ranked by year-over-year EPS growth, revenue growth, recent positive earnings consistency and beat history.",
  explainerTitle: SEC ? SEC_GROWTH_COPY.explainerTitle : "How this earnings growth picker ranks stocks",
  explainerBody: SEC
    ? SEC_GROWTH_COPY.explainerBody
    : "This page is designed to highlight companies with improving earnings patterns. It gives more weight to year-over-year EPS growth, revenue growth, recent positive EPS consistency and a history of beating expectations.",
  emptyText: SEC
    ? SEC_GROWTH_COPY.emptyText
    : "No strong earnings-growth results are available right now. The list is built from reported earnings data and may stay empty until newer results have been processed.",
  tone: "green",
  kind: "preset",
  presetFilters: ["strongEarningsGrowth"],
  sectionIncludes: ["strong", "earnings", "growth"],
  // Named on the page (#553 COWORK #161): the SEC section is ordered by filed
  // EPS growth alone (pickersBuilder). The FMP rollback ranks by a composite.
  rankedBy: SEC ? { label: "EPS growth, highest first, then small bases by the $ change", short: "growth" } : undefined,
  maxItems: 40,
  bodySections: [
    {
      heading: "What this screen measures",
      paragraphs: [
        "This page compares a company’s newest filed quarter, or fiscal year, with the same period one year earlier, using figures taken from SEC filings. Diluted earnings per share — profit divided by a share count that includes options and convertible securities — must be up at least 15%, and revenue must be higher too, so earnings growth on shrinking sales is left out.",
        "Several guards keep the comparison fair. Both periods need EPS of at least $0.05, figures must be in US dollars, and the newest period can be no more than 15 months old. A company is refused when its filings can’t be compared cleanly, for example after a change in share basis, with an incomplete revenue line, or when a large non-operating item such as a one-off gain distorts the result.",
      ],
    },
    {
      heading: "How the list is ordered",
      paragraphs: [
        "Companies are ranked by EPS growth percentage, highest first. There is one exception: where year-ago EPS was below $0.50, a percentage can look huge off a tiny starting point, so those companies are placed after the rest and sorted by the dollar change in EPS instead. A move from $0.06 to $0.30 is a 400% rise but a modest change in absolute terms.",
        "The figures behind each row come from the filings themselves rather than from analyst estimates. It can help to note whether the growth is for a quarter or a full year, and to compare it with how the share price has moved, since strong reported growth is sometimes already reflected in the price.",
      ],
    },
    {
      heading: "What filings can’t show",
      paragraphs: [
        "Reported results look backward; they say nothing about guidance or the next quarter. A single strong quarter may reflect seasonal timing or an easy comparison against a weak year-ago period. SEC data refreshes daily, but a company only updates here once it files, so the newest period can be several months old.",
      ],
    },
    {
      heading: "A worked example and the near misses",
      paragraphs: [
        "Imagine a company whose newest quarter shows diluted EPS of $1.38 against $1.15 a year earlier, with revenue up from $2.0 billion to $2.2 billion. EPS rose 20%, clearing the 15% bar, and sales grew, so it qualifies and sits among the rows ranked by percentage. Had year-ago EPS been $0.40 rising to $0.48, the same 20% gain would still qualify, but the company would land in the lower group, ordered by its $0.08 dollar change.",
        "Near misses are easy to overlook. A company with EPS up 14.5% does not appear, and neither does one with EPS up 40% on flat or falling revenue. One that moved from a small loss to a profit fails the $0.05 floor for the year-ago period. Unlike the low P/E screen, which weighs earnings against the share price, this page ignores price entirely and looks only at the change in reported results.",
      ],
    },
  ],
  relatedScreens: [
    { href: "/dividend-growth-stocks", label: "Dividend growth stocks" },
    { href: "/low-pe-stocks", label: "Low P/E stocks" },
    { href: "/cash-rich-value-stocks", label: "Cash-rich value stocks" },
  ],
};

export const metadata: Metadata = {
  title:
    "Stocks With Strong Earnings Growth | YoY EPS & Revenue Growth Screener | MyStockHarbor",
  description: SEC
    ? SEC_GROWTH_COPY.metaDescription
    : "Browse stocks with strong earnings growth, ranked by year-over-year EPS growth, revenue growth, positive earnings consistency and beat history.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-with-strong-earnings-growth",
  },
  openGraph: {
    title: "Stocks With Strong Earnings Growth | MyStockHarbor",
    description: SEC
      ? SEC_GROWTH_COPY.metaDescription
      : "Find stocks ranked by year-over-year EPS growth, revenue growth and recent earnings consistency.",
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
