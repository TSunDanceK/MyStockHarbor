import type { Metadata } from "next";
import { Suspense } from "react";
import HomePageRouter from "./components/HomePageRouter";
import { mintQuoteToken } from "@/lib/server/quoteToken";

export const metadata: Metadata = {
  title: "Stock Analysis Tools, Stock Pickers & Market Insights | MyStockHarbor",
  description:
    "Use MyStockHarbor to explore stock analysis tools, stock pickers, market insights, technical chart views and educational investing resources.",
  alternates: {
    canonical: "https://www.mystockharbor.com/",
  },
  openGraph: {
    title: "Stock Analysis Tools, Stock Pickers & Market Insights | MyStockHarbor",
    description:
      "Explore stock analysis tools, technical chart views, stock pickers and market insights on MyStockHarbor.",
    url: "https://www.mystockharbor.com/",
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
                url: "https://www.mystockharbor.com/",
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
                url: "https://www.mystockharbor.com/",
                logo: {
                  "@type": "ImageObject",
                  url: "https://www.mystockharbor.com/logo.png",
                },
              },
              {
                "@type": "WebPage",
                "@id": "https://www.mystockharbor.com/#webpage",
                url: "https://www.mystockharbor.com/",
                name: "Stock Analysis Tools, Stock Pickers & Market Insights | MyStockHarbor",
                description:
                  "Use MyStockHarbor to explore stock analysis tools, stock pickers, market insights, technical chart views and educational investing resources.",
                inLanguage: "en",
                isPartOf: {
                  "@id": "https://www.mystockharbor.com/#website",
                },
                about: {
                  "@id": "https://www.mystockharbor.com/#organization",
                },
                breadcrumb: {
                  "@id": "https://www.mystockharbor.com/#breadcrumb",
                },
              },
              {
                "@type": "BreadcrumbList",
                "@id": "https://www.mystockharbor.com/#breadcrumb",
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: "Home",
                    item: "https://www.mystockharbor.com/",
                  },
                ],
              },
              {
                "@type": "WebApplication",
                "@id": "https://www.mystockharbor.com/#webapp",
                name: "MyStockHarbor Dashboard",
                url: "https://www.mystockharbor.com/",
                applicationCategory: "FinanceApplication",
                operatingSystem: "Web",
                browserRequirements: "Requires a modern web browser",
                description:
                  "A stock analysis web application providing chart tools, stock pickers, market benchmarks, news briefings, and educational resources to help users study market behaviour and price action.",
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
                featureList: [
                  "Stock chart analysis",
                  "Technical indicators",
                  "Stock pickers",
                  "Market benchmarks",
                  "Stock news briefings",
                  "Trading calculators",
                  "Trading education",
                ],
              },
            ],
          }),
        }}
      />

      <Suspense
        fallback={
          <div style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
            Loading…
          </div>
        }
      >
        {/*
          Root "/" is the desktop dashboard experience (HomePageRouter picks
          DashboardClient vs MobileHomePage at mount). Unlike /dashboard/
          page.tsx, this page previously rendered HomePageRouter with no
          props at all, so DashboardClient's pageToken defaulted to "" for
          every desktop visitor landing here -- which is most of the site's
          real dashboard traffic, since "/" *is* the dashboard, not a
          separate rarely-used route. That meant every /api/quote call these
          visitors triggered logged reason=missing, indistinguishable in the
          logs from an actual scraper hitting the API directly. Minting here
          and passing it through closes that gap. See
          lib/server/quoteToken.ts and claude/quote-page-token-rollout-2026-
          07-29.md for the full token design; HomePageRouter forwards this
          only to the desktop (DashboardClient) branch -- MobileHomePage
          never calls /api/quote.
        */}
        <HomePageRouter pageToken={mintQuoteToken()} />
      </Suspense>
    </>
  );
}
