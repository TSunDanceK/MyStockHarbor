import Link from "next/link";
import type { Metadata } from "next";
import {
  getUpcomingConfirmedIpos,
  getRecentIpos,
} from "@/lib/server/ipoCalendar";
import IpoList from "./IpoList";

const PAGE_TITLE = "Upcoming IPOs This Month | Confirmed IPO Calendar | MyStockHarbor";
const PAGE_DESCRIPTION =
  "Confirmed, priced IPOs expected in the next 30 days - ticker, exchange, price range, shares offered, deal size and market cap for each listing.";
const PAGE_URL = "https://www.mystockharbor.com/upcoming-ipos";
const OG_IMAGE_URL = "https://www.mystockharbor.com/og-image-v2.png";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: {
    canonical: PAGE_URL,
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    siteName: "MyStockHarbor",
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "MyStockHarbor upcoming IPO calendar",
      },
    ],
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
};

export const dynamic = "force-dynamic";

export default async function UpcomingIposPage() {
  const [upcomingFeed, recentFeed] = await Promise.all([
    getUpcomingConfirmedIpos(),
    getRecentIpos(),
  ]);

  const ipos = upcomingFeed.items;
  const recentIpos = recentFeed.items;

  // Only claim an ItemList when the read actually succeeded. On a failed read
  // `ipos` is [] and means nothing, and emitting an ItemList with zero items
  // asserts to Google that this page's entire subject does not exist -- a
  // stronger negative signal than the visible copy, on a page whose ranking
  // case IS the list. Asserting nothing is the correct degradation.
  const hasItemList = upcomingFeed.ok;

  const ipoJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
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
        "@type": "CollectionPage",
        "@id": `${PAGE_URL}#webpage`,
        url: PAGE_URL,
        name: "Upcoming IPOs",
        description: PAGE_DESCRIPTION,
        isPartOf: {
          "@type": "WebSite",
          "@id": "https://www.mystockharbor.com/#website",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        publisher: { "@id": "https://www.mystockharbor.com/#organization" },
        // Omitted alongside the ItemList itself, so this never dangles.
        ...(hasItemList ? { mainEntity: { "@id": `${PAGE_URL}#itemlist` } } : {}),
      },
      ...(hasItemList
        ? [
            {
              "@type": "ItemList",
              "@id": `${PAGE_URL}#itemlist`,
              itemListElement: ipos.map((ipo, index) => ({
                "@type": "ListItem",
                position: index + 1,
                name: `${ipo.company} (${ipo.symbol})`,
              })),
            },
          ]
        : []),
      {
        "@type": "BreadcrumbList",
        "@id": `${PAGE_URL}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://www.mystockharbor.com/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Upcoming IPOs",
            item: PAGE_URL,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ipoJsonLd) }}
      />

      <main
        className="ipoCalendarMain"
        style={{
          minHeight: "100vh",
          background: "#06080d",
          color: "#f1f5f9",
          fontFamily: "system-ui, Arial",
          padding: "40px 20px",
          overflowX: "hidden",
        }}
      >
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <div style={{ marginBottom: 24 }}>
            <Link
              href="/"
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              ← Back to Dashboard
            </Link>
          </div>

          <section
            className="ipoCalendarIntroCard"
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 24,
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              marginBottom: 24,
            }}
          >
            <h1
              className="ipoCalendarTitle"
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: 34,
                lineHeight: 1.1,
                fontWeight: 900,
              }}
            >
              Upcoming IPOs
            </h1>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 0 }}>
              Confirmed, priced IPOs expected over the next 30 days. Listings
              are shown once underwriters have finalized the price range and
              share count — not every rumored or filed IPO, only the ones
              that are actually locked in.
            </p>
          </section>

          <section
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              marginBottom: 32,
            }}
          >
            <IpoList
              ipos={ipos}
              dateColumnLabel="IPO Date"
              emptyMessage={
                upcomingFeed.ok
                  ? "No confirmed IPOs are currently scheduled in the next 30 days. Check back soon — this list updates as new deals are priced."
                  : "We couldn't load the IPO calendar just now. This is a temporary problem on our side, not an empty calendar — please refresh in a moment."
              }
            />
          </section>

          <section
            className="ipoCalendarIntroCard"
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 24,
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              marginBottom: 24,
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: 26,
                lineHeight: 1.1,
                fontWeight: 900,
              }}
            >
              Recent IPOs
            </h2>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 0 }}>
              Confirmed IPOs that listed within the last 30 days, most recent
              first.
            </p>
          </section>

          <section
            style={{
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
            }}
          >
            <IpoList
              ipos={recentIpos}
              dateColumnLabel="Listing Date"
              emptyMessage={
                recentFeed.ok
                  ? "No confirmed IPOs listed in the last 30 days."
                  : "We couldn't load recent IPO listings just now. This is a temporary problem on our side — please refresh in a moment."
              }
            />
          </section>

          <p style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16 }}>
            Data source: financialmodelingprep.com. IPO terms can change
            before listing day — treat this as a starting point for further
            research, not investment advice.
          </p>

          <p style={{ fontSize: 14, marginTop: 24 }}>
            Continue exploring:{" "}
            <Link
              href="/earnings-calendar"
              style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 700 }}
            >
              Earnings Calendar →
            </Link>
          </p>
        </div>

        <style>{`
          @media (max-width: 640px) {
            .ipoCalendarMain {
              padding: 24px 14px !important;
            }
            .ipoCalendarIntroCard {
              padding: 18px !important;
            }
            .ipoCalendarTitle {
              font-size: 26px !important;
            }
          }
        `}</style>
      </main>
    </>
  );
}
