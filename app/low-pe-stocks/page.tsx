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

const pageTitle = "Low P/E Stocks | Shares Trading Under 15x Earnings | MyStockHarbor";
const pageDescription =
  "Stocks in the analyzed universe trading below 15 times earnings, opening on the valuation view so a low multiple can be checked against forward P/E, price-to-sales and price-to-book rather than judged on its own.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "https://www.mystockharbor.com/low-pe-stocks" },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/low-pe-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: pageTitle, description: pageDescription },
};

const config: PickerResultConfig = {
  href: "/low-pe-stocks",
  eyebrow: "LOW P/E SCREENER",
  title: "Low P/E Stocks",
  description:
    "Stocks trading below 15 times trailing earnings. Sort by any column, or add a second condition to narrow the list without leaving the page.",
  explainerTitle: "How to use this screen",
  explainerBody:
    "A P/E under 15 is a starting point, not a conclusion. Check why the multiple is low before treating it as cheap — falling earnings shrink the denominator and can make an expensive stock look inexpensive.",
  emptyText: "No stocks in the analyzed universe are currently trading below 15 times earnings.",
  tone: "blue",
  kind: "preset",
  presetPredicates: [{ kind: "number", field: "peRatio", max: 15 }],
  // The predicate that defines the set is also the order. Before this the page
  // shipped in `reasons.length` order -- how many of 25 technical conditions a
  // stock happens to meet -- which on a page called Lowest P/E is not an
  // imprecise ranking, it is a ranking of something else. Same accessor as the
  // predicate above, so membership and order can never disagree.
  orderBy: { field: "peRatio", dir: "asc", label: "P/E Ratio" },
  maxItems: 36,
  // P/E is the screen, and the Valuation tab is the only place it sits next to
  // forward P/E, P/S, P/B and P/FCF -- the cross-checks that tell a cheap stock
  // from a broken one. General shows P/E alone, without that context.
  defaultTab: "valuation",
  bodySections: [
    {
      heading: "What a low P/E actually tells you",
      paragraphs: [
        "The price-to-earnings ratio divides a company's share price by its earnings per share, so it answers a narrow question: how many years of current profit are you paying for? A stock at 12 times earnings costs twelve years of today's profit. A stock at 40 costs forty. That is the whole of what the number says, and most of the mistakes people make with it come from asking it to say more.",
        "Fifteen is a useful line to draw because it sits near the long-run average for large-cap equities, so a stock below it is priced more cautiously than the market has historically priced the average business. It is not a magic threshold, and nothing happens at 14.9 that does not happen at 15.1. Treat it as a way of shortening a long list, not as a verdict on any single name.",
        "The ratio is also blind to debt. Two companies can earn identical profits and trade at identical multiples while one carries no borrowings and the other is heavily leveraged. The second is a materially different proposition, and the P/E will not tell you so.",
      ],
    },
    {
      heading: "Why cheap stocks are often cheap for a reason",
      paragraphs: [
        "The most common trap here is the value trap: a company whose earnings are falling faster than its share price. Because the multiple is calculated on trailing profit, a business heading into a downturn shows a shrinking denominator and a flattering ratio right up until the earnings actually arrive. The screen cannot see that coming, and neither can any screen built on historic figures.",
        "Cyclical businesses invert the rule entirely. Miners, homebuilders, semiconductor equipment makers and car manufacturers tend to trade at their lowest multiples at the peak of their cycle, when profits are at a high that is about to reverse, and at their highest multiples at the trough when profits are depressed. For those industries a low P/E is closer to a warning than an invitation.",
        "The useful discipline is to ask what the market has noticed that you have not. Sometimes the answer is nothing much and the price is simply out of favour. Often it is a lawsuit, a patent expiry, a structural decline in demand, or a balance sheet that cannot support the dividend. The screen finds the candidates; the reading is still yours to do.",
      ],
    },
    {
      heading: "Reading this list sensibly",
      paragraphs: [
        "Sort by market cap first. A low multiple on a very large, widely covered company usually means the market has priced in a known problem, because hundreds of analysts have already looked. The same multiple on a smaller name may simply mean nobody is looking, which is a different and sometimes more interesting situation.",
        "Then check the P/E against the sector rather than against the whole list. Banks, insurers and energy producers habitually trade in single digits and always have; software and medical devices rarely do. A bank at 11 times earnings is unremarkable. A software company at 11 is unusual enough to be worth understanding. Comparing across sectors on this one number produces a list of banks and little else.",
        "Free cash flow is the most useful cross-check of all, and it is one tab across on Financials. Profit is an accounting figure and can be shaped by non-cash charges; cash is harder to argue with. A company with a low multiple and strong cash generation is a genuinely different case from one with a low multiple and cash that never seems to appear. Add a free cash flow floor from the sidebar to screen on both at once.",
      ],
    },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
