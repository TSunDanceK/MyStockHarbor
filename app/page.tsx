import type { Metadata } from "next";
import DashboardPage from "./dashboard/page";

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

// ONE PAGE ON EVERY DEVICE (#563 COWORK #149 §1, 7 Oct 2026). "/" used to
// sniff the user agent and hand phones the mobile-only tile landing
// (MobileHomePage, via HomePageRouter) and desktops the old dashboard without
// its landing. It now renders /dashboard's own page, the new landing and the
// analyser, so phones and desktops get the same thing. This route keeps its
// own title, description, canonical and structured data (above and below);
// /dashboard canonicalises to "/" so the two are not duplicates.
// HomePageRouter and MobileHomePage are kept, unused, with a dated note.
type Props = { searchParams: Promise<{ symbol?: string | string[] }> };

/** As /dashboard: the rendered symbol is per visitor (its cookie), so every render is fresh. */
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: Props) {
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

      <DashboardPage searchParams={searchParams} />
    </>
  );
}
