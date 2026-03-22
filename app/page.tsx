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
            "@type": "WebSite",
            name: "MyStockHarbor",
            url: "https://www.mystockharbor.com",
            description:
              "Stock analysis tools, stock pickers, market insights and chart-based research from MyStockHarbor.",
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
