import type { Metadata } from "next";
import { Suspense } from "react";
import DashboardClient from "./components/DashboardClient";

export const metadata: Metadata = {
  title: "Stock Analysis Tools, Stock Pickers & Market Insights | MyStockHarbor",
  description:
    "Use MyStockHarbor to explore stock analysis tools, stock pickers, market insights, technical chart views and educational investing resources.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Stock Analysis Tools, Stock Pickers & Market Insights | MyStockHarbor",
    description:
      "Explore stock analysis tools, technical chart views, stock pickers and market insights on MyStockHarbor.",
    url: "/",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Analysis Tools, Stock Pickers & Market Insights | MyStockHarbor",
    description:
      "Explore stock analysis tools, technical chart views, stock pickers and market insights on MyStockHarbor.",
  },
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebSite",
                "@id": "https://www.mystockharbor.com/#website",
                name: "MyStockHarbor",
                url: "https://www.mystockharbor.com",
                description:
                  "Stock analysis tools, stock pickers, market insights and chart-based research from MyStockHarbor.",
                inLanguage: "en",
                publisher: {
                  "@id": "https://www.mystockharbor.com/#organization",
                },
              },
              {
                "@type": "Organization",
                "@id": "https://www.mystockharbor.com/#organization",
                name: "MyStockHarbor",
                url: "https://www.mystockharbor.com",
                logo: {
                  "@type": "ImageObject",
                  url: "https://www.mystockharbor.com/logo.png",
                },
              },
              {
                "@type": "WebApplication",
                "@id": "https://www.mystockharbor.com/#webapp",
                name: "MyStockHarbor",
                url: "https://www.mystockharbor.com",
                applicationCategory: "FinanceApplication",
                operatingSystem: "Web",
                browserRequirements: "Requires a modern web browser",
description:
  "A stock analysis web application providing chart tools, stock pickers, and educational resources to help users study market behaviour and price action.",
                inLanguage: "en",
                isPartOf: {
                  "@id": "https://www.mystockharbor.com/#website",
                },
                publisher: {
                  "@id": "https://www.mystockharbor.com/#organization",
                },
                offers: {
                  "@type": "Offer",
                  price: "0",
                  priceCurrency: "USD",
                },
              },
            ],
          }),
        }}
      />

      <Suspense
        fallback={
          <div style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
            Loading dashboard…
          </div>
        }
      >
        <DashboardClient />
      </Suspense>
    </>
  );
}
