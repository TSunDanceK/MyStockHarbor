import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
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

// UA-sniffed best guess at mobile vs desktop, used only to seed
// HomePageRouter's initial render on the server so root "/" (and every
// "/?symbol=X" variant) ships real, crawlable HTML instead of nothing.
//
// Before this, HomePageRouter (a client component) started with
// `isMobile = null` and returned `null` until a mount-time
// window.innerWidth check ran -- meaning the server-rendered HTML for the
// root URL, and every "?symbol=" variant of it, contained NEITHER
// DashboardClient's nor MobileHomePage's content (no <h1>, no hero, nothing)
// until client JS executed. Bing's Site Scan flagged this as "H1 tag
// missing" across dozens of "/?symbol=..." URLs (2026-08-07) -- the H1 was
// never the real problem, the whole page body was invisible pre-hydration.
// A crawler that snapshots the initial response (or doesn't wait for a
// resize-triggered effect) sees a blank page.
//
// This is a best-effort guess, not a replacement for the client-side check:
// HomePageRouter still runs its window.innerWidth listener after mount and
// will correct itself (e.g. if a desktop UA string is spoofed, or a tablet
// falls on the other side of the 768px breakpoint than its UA suggests).
const MOBILE_UA_PATTERN =
  /Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini|Mobile Safari|Windows Phone/i;

async function getInitialIsMobile(): Promise<boolean> {
  const headerStore = await headers();
  const ua = headerStore.get("user-agent") || "";
  // iPad UAs (both classic "iPad" and modern desktop-class "Macintosh" +
  // touch) render the desktop dashboard by default -- iPads are wide enough
  // to comfortably fit it, matching the existing 768px breakpoint's intent.
  if (/iPad/i.test(ua)) return false;
  return MOBILE_UA_PATTERN.test(ua);
}

export default async function Page() {
  const [pageToken, initialIsMobile] = await Promise.all([
    Promise.resolve(mintQuoteToken()),
    getInitialIsMobile(),
  ]);

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

          initialIsMobile (added 2026-08-07): UA-sniffed guess passed so
          HomePageRouter renders real content on the server instead of null
          -- see getInitialIsMobile() above for the full story.
        */}
        <HomePageRouter pageToken={pageToken} initialIsMobile={initialIsMobile} />
      </Suspense>
    </>
  );
}
