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

const pageTitle = "Cash-Rich Value Stocks | Big Free Cash Flow, Low P/E | MyStockHarbor";
const pageDescription =
  "Companies generating over $10bn in free cash flow while trading below 20 times earnings — the combination that separates a genuinely cheap business from an accounting bargain.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "https://www.mystockharbor.com/cash-rich-value-stocks" },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/cash-rich-value-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: pageTitle, description: pageDescription },
};

const config: PickerResultConfig = {
  href: "/cash-rich-value-stocks",
  eyebrow: "CASH-RICH VALUE SCREENER",
  title: "Cash-Rich Value Stocks",
  description:
    "Companies producing more than $10bn of free cash flow a year while trading under 20 times earnings. Both conditions apply together — loosen either one from the sidebar.",
  explainerTitle: "How to use this screen",
  explainerBody:
    "Profit is an opinion; cash is a fact. Requiring both a low multiple and heavy cash generation filters out most of the companies that look cheap only because their earnings are about to fall.",
  emptyText: "No stocks in the analyzed universe currently meet both the free cash flow and valuation conditions.",
  tone: "blue",
  kind: "preset",
  presetPredicates: [
    { kind: "number", field: "freeCashFlow", min: 10_000_000_000 },
    { kind: "number", field: "peRatio", max: 20 },
  ],
  maxItems: 36,
  // Free cash flow appears only on the Financials tab, and it is the leading
  // half of this screen. P/E is the qualifier and stays one click away on
  // Valuation (it is also on General).
  defaultTab: "financials",
  bodySections: [
    {
      heading: "Why free cash flow is the harder test",
      paragraphs: [
        "Free cash flow is what remains after a company has paid its operating costs and funded the capital spending needed to keep the business running. It is the money genuinely available to pay dividends, buy back shares, repay debt or make acquisitions — and unlike reported profit, it is difficult to manufacture.",
        "Earnings sit at the end of a long chain of judgements: how quickly to depreciate an asset, when to recognise revenue, what to treat as a one-off charge. Every one of those is a legitimate accounting choice, and collectively they give management real latitude over the number that reaches the bottom line. Cash arriving in the bank account is subject to none of that.",
        "This is why the two conditions on this page work better together than either does alone. A low multiple on its own finds cheap-looking companies, some of which are cheap for excellent reasons. Adding a heavy cash generation requirement removes most of the ones whose profits exist mainly on paper.",
      ],
    },
    {
      heading: "What the $10bn floor is doing",
      paragraphs: [
        "The threshold is deliberately high, and it is doing something specific: it restricts the list to businesses of genuine scale. A company throwing off ten billion dollars a year in surplus cash is, almost by definition, dominant in its market, and dominance is what allows it to keep doing so. Scale of this kind is also its own form of durability, because it takes an unusual amount of disruption to unseat a business generating that much.",
        "The trade-off is that the screen will never surface a small or mid-cap opportunity. This is a large-cap page by construction, and that is the intended behaviour rather than a limitation to work around. If you want the same logic applied further down the market, lower the free cash flow floor in the sidebar and accept that you are trading certainty for breadth.",
        "It is also worth knowing what the combination excludes. A fast-growing company reinvesting everything it earns will fail the cash flow test even when the underlying business is excellent, because heavy capital spending is subtracted before free cash flow is calculated. Absence from this list is not evidence against a company.",
      ],
    },
    {
      heading: "Reading the results",
      paragraphs: [
        "Compare free cash flow against market capitalisation rather than looking at it in isolation. Ten billion dollars is transformative for a company valued at eighty billion and unremarkable for one valued at two trillion. The ratio between the two — free cash flow yield — is the more meaningful figure, and both columns are on the table so you can form it at a glance.",
        "Check what the cash is being used for. A business generating large surpluses and returning them through dividends and buybacks is treating shareholders as owners. One generating the same surplus and spending it on serial acquisitions has a different track record to examine, and the results of that strategy vary enormously.",
        "Finally, apply the same scepticism this site applies to any low multiple. A company can generate strong cash today from a product or franchise in structural decline, and the cash flow statement is a record of what has already happened. It confirms the business has been strong. It does not promise that it will stay so.",
      ],
    },
  ],
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
