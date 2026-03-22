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
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Trading Risk Tools & Calculators",
            url: "https://mystockharbor.com/utilities",
            description:
              "Use trading calculators to estimate position size, stop loss risk, liquidation price, and risk-reward before entering a trade.",
            mainEntity: {
              "@type": "ItemList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  item: {
                    "@type": "SoftwareApplication",
                    name: "Position Size Calculator",
                    applicationCategory: "FinanceApplication",
                  },
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  item: {
                    "@type": "SoftwareApplication",
                    name: "Risk Reward Calculator",
                    applicationCategory: "FinanceApplication",
                  },
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  item: {
                    "@type": "SoftwareApplication",
                    name: "Stop Loss Calculator",
                    applicationCategory: "FinanceApplication",
                  },
                },
                {
                  "@type": "ListItem",
                  position: 4,
                  item: {
                    "@type": "SoftwareApplication",
                    name: "Liquidation Calculator",
                    applicationCategory: "FinanceApplication",
                  },
                },
              ],
            },
            breadcrumb: {
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "Home",
                  item: "https://mystockharbor.com/",
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Utilities",
                  item: "https://mystockharbor.com/utilities",
                },
              ],
            },
          }),
        }}
      />

      <UtilitiesClient />
    </>
  );
}
