import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Custom Stock Screener | MyStockHarbor",
  description: "Combine any of the site's screening conditions to search the full analyzed universe of stocks -- check one or more conditions to see which stocks currently match all of them.",
  alternates: {
    canonical: "https://www.mystockharbor.com/custom-screener",
  },
  openGraph: {
    title: "Custom Stock Screener | MyStockHarbor",
    description: "Combine any of the site's screening conditions to search the full analyzed universe of stocks -- check one or more conditions to see which stocks currently match all of them.",
    url: "https://www.mystockharbor.com/custom-screener",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Custom Stock Screener | MyStockHarbor",
    description: "Combine any of the site's screening conditions to search the full analyzed universe of stocks -- check one or more conditions to see which stocks currently match all of them.",
  },
};

const config: PickerResultConfig = {
  href: "/custom-screener",
  eyebrow: "CUSTOM STOCK SCREENER",
  title: "Custom Stock Screener",
  description: "Combine any of the site's screening conditions to search the full analyzed universe of stocks. Check one or more conditions on the left to see which stocks currently match all of them.",
  explainerTitle: "How to use the custom screener",
  explainerBody: "Check any combination of conditions in the left-hand nav -- oversold, breakouts, moving-average position, divergence, category picks like Buy Signals or Best Trend, and more. Results show every stock in the full analyzed universe that currently meets ALL of the conditions you've checked, not just one category's own narrow list. Results update instantly in your browser as you check or uncheck boxes, with no extra loading or page reloads. Uncheck a condition (or hit Clear) at any time to widen the results again.",
  emptyText: "No stocks currently match every condition you've selected. Try unchecking one.",
  tone: "blue",
  kind: "allSymbols",
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
