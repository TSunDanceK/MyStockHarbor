import type { Metadata } from "next";
import UtilitiesClient from "./UtilitiesClient";

export const metadata: Metadata = {
  title: "Trading Risk Tools & Calculators | MyStockHarbor",
  description:
    "Use MyStockHarbor trading calculators to estimate liquidation price, position size, stop loss risk, and risk-reward before entering a trade.",
  alternates: {
    canonical: "/utilities",
  },
  openGraph: {
    title: "Trading Risk Tools & Calculators | MyStockHarbor",
    description:
      "Estimate liquidation price, position size, stop loss risk, and risk-reward with MyStockHarbor trading tools.",
    url: "https://mystockharbor.com/utilities",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trading Risk Tools & Calculators | MyStockHarbor",
    description:
      "Estimate liquidation price, position size, stop loss risk, and risk-reward with MyStockHarbor trading tools.",
  },
};

export default function UtilitiesPage() {
  return <UtilitiesClient />;
}
