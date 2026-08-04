import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

const pageTitle = "High Dividend Yield Stocks | Shares Yielding Over 4% | MyStockHarbor";
const pageDescription =
  "Stocks in the analyzed universe yielding more than 4%, opening on the dividend view so payout ratio, dividend growth and payment frequency sit beside the yield — the four numbers that separate a sustainable income stream from one about to be cut.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "https://www.mystockharbor.com/high-dividend-yield-stocks" },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/high-dividend-yield-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: pageTitle, description: pageDescription },
};

const config: PickerResultConfig = {
  href: "/high-dividend-yield-stocks",
  eyebrow: "HIGH DIVIDEND YIELD SCREENER",
  title: "High Dividend Yield Stocks",
  description:
    "Stocks currently yielding over 4%, shown with payout ratio, dividend growth and payment frequency so the yield can be judged rather than just read.",
  explainerTitle: "How to use this screen",
  explainerBody:
    "Yield rises when the price falls, so the highest yields on any list often belong to the stocks the market trusts least. Check the payout ratio before treating a large number as good news.",
  emptyText: "No stocks in the analyzed universe are currently yielding above 4%.",
  tone: "green",
  kind: "preset",
  presetPredicates: [{ kind: "number", field: "divYield", min: 4 }],
  maxItems: 36,
  // Yield alone is close to meaningless (see the body copy). The Dividends tab
  // is where payout ratio, dividend growth and frequency sit beside it, which is
  // the combination the page actually asks the reader to judge.
  defaultTab: "dividends",
  bodySections: [
    {
      heading: "Why the highest yield is rarely the best one",
      paragraphs: [
        "Dividend yield is the annual dividend divided by the share price. That makes it a fraction with two moving parts, and the one that usually moves is the denominator. A stock yielding 9% has almost never got there by raising its dividend; it has got there because the price fell and the dividend has not been cut yet. The yield is high because the market doubts it will last.",
        "This is why sorting any dividend screen from highest to lowest tends to surface exactly the wrong names first. The order is a reasonable proxy for market scepticism. The most durable income on a list like this usually sits in the middle of the range, not at the top.",
        "A cut is not just a loss of income, either. It is generally accompanied by a further fall in the share price, because the investors holding the stock for its dividend sell once the reason for holding it disappears. The two losses arrive together, which is what makes an unsustainable yield worse than no yield at all.",
      ],
    },
    {
      heading: "The payout ratio is the number that matters",
      paragraphs: [
        "The payout ratio is the share of earnings paid out as dividends, and it is the most direct read on whether the current payment can continue. Below about 60% leaves the company room to keep paying through a weaker year without touching the balance sheet. Above 80% means most of the profit is already committed and there is little margin for a disappointment. Above 100% means the dividend is not being funded by earnings at all.",
        "There are legitimate exceptions. Real estate investment trusts are required to distribute the bulk of their income and will show high payout ratios as a matter of structure rather than stress, and their figures should be read against funds from operations rather than net profit. Utilities also run higher than the market because their revenues are regulated and unusually predictable. Outside those cases, a high ratio is what it looks like.",
        "Free cash flow is the harder-nosed version of the same test. Dividends are paid in cash, and a company can report perfectly good accounting profit while generating none. If cash generation comfortably exceeds the dividend, the payment is well covered whatever the earnings-based ratio says.",
      ],
    },
    {
      heading: "Using this list",
      paragraphs: [
        "This page opens on the Dividends view for a reason: payout ratio, dividend growth and payment frequency sit beside the yield there, and reading those four together tells you considerably more than the yield alone. A moderate yield that has grown steadily on a modest payout ratio is a stronger position than a large yield that has been flat for years on a stretched one.",
        "Expect this list to concentrate in a few sectors. Utilities, energy, consumer staples and parts of financial services are where mature cash-generative businesses tend to sit, and they are where large sustainable dividends are usually found. A high yield appearing in a fast-growing sector is unusual and worth a second look, because growth companies normally reinvest rather than distribute.",
        "If you want the stricter version of this screen, add a payout ratio ceiling from the sidebar. Combining a yield above 4% with a payout ratio below 60% produces a materially shorter and more defensible list, and you can do it in place without navigating away.",
      ],
    },
  ],
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
