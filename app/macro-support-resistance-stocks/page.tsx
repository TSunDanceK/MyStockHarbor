import type { Metadata } from "next";
import PickerResultPage, { type PickerResultConfig } from "@/app/components/PickerResultPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Macro Support and Resistance Stocks | MyStockHarbor",
  description:
    "Find stocks approaching major support or resistance zones using wider weekly chart structure, repeated touch areas, and distance from current price.",
  alternates: {
    canonical: "https://www.mystockharbor.com/macro-support-resistance-stocks",
  },
  openGraph: {
    title: "Macro Support and Resistance Stocks | MyStockHarbor",
    description:
      "Find stocks approaching major support or resistance zones using wider weekly chart structure, repeated touch areas, and distance from current price.",
    url: "https://www.mystockharbor.com/macro-support-resistance-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Macro Support and Resistance Stocks | MyStockHarbor",
    description:
      "Find stocks approaching major support or resistance zones using wider weekly chart structure, repeated touch areas, and distance from current price.",
  },
};

const config: PickerResultConfig = {
  href: "/macro-support-resistance-stocks",
  eyebrow: "Support and resistance screener",
  title: "Macro Support and Resistance Stocks",
  description:
    "Find stocks approaching major support or resistance zones using wider weekly chart structure, repeated touch areas, and distance from current price.",
  explainerTitle: "How to use macro support and resistance",
  explainerBody:
    "Macro support and resistance areas are wider chart zones, not exact prices. Use this page to find stocks near repeated weekly support or resistance areas, then open the chart to check whether price is reacting, rejecting, breaking out, or breaking down.",
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
