import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

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

const config: PickerResultConfig = {
  href: "/stocks-down-20-from-all-time-highs",
  eyebrow: "Pullback stock screener",
  title: "Stocks Down 20% From All-Time Highs",
  description: "Find stocks trading at least 20% below their all-time highs, ranked to favour tradable pullbacks over broken charts.",
  explainerTitle: "How to use stocks down from highs",
  explainerBody: "A large drawdown can create opportunity, but it can also signal real weakness. Use this page to find names worth reviewing, then check whether price is stabilising or still making lower lows.",
  emptyText: "No stocks down 20% from all-time highs are currently available from the live picker feed.",
  tone: "yellow",
  kind: "section",
  sectionIncludes: ["stocks down 20"],
  maxItems: 36,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  return <PickerResultPage config={config} searchParams={searchParams} />;
}
