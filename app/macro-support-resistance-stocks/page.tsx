import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

const pageTitle = "Macro Support and Resistance Stocks | MyStockHarbor";
const pageDescription =
  "Find stocks approaching wider support or resistance zones using weekly chart structure, repeated touch areas, distance from current price, and volume at the level.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: "https://www.mystockharbor.com/macro-support-resistance-stocks",
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://www.mystockharbor.com/macro-support-resistance-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
  },
};

const config: PickerResultConfig = {
  href: "/macro-support-resistance-stocks",
  eyebrow: "Support and resistance screener",
  title: "Macro Support and Resistance Stocks",
  description:
    "Find stocks approaching wider support or resistance zones using weekly chart structure, repeated touch areas, distance from current price, and volume at the level.",
  explainerTitle: "How to use macro support and resistance",
  explainerBody:
    "Macro support and resistance areas are wider chart zones, not exact prices. This page highlights stocks near repeated weekly support or resistance areas, then adds context from distance to the zone and trading volume around that level. Open the chart to check whether price is reacting, rejecting, breaking out, or breaking down.",
  emptyText:
    "No strong macro support or resistance candidates are currently available from the live picker feed.",
  tone: "blue",
  kind: "section",
  sectionIncludes: ["macro", "support", "resistance"],
  maxItems: 36,
};

export default function Page() {
  return <PickerResultPage config={config} />;
}
