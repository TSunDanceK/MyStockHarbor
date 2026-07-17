import Link from "next/link";
import type { Metadata } from "next";
import type React from "react";
import {
  getUpcomingConfirmedIpos,
  getRecentIpos,
  type ConfirmedIpo,
} from "@/lib/server/ipoCalendar";

const PAGE_TITLE = "Upcoming IPOs This Month | Confirmed IPO Calendar | MyStockHarbor";
const PAGE_DESCRIPTION =
  "Confirmed, priced IPOs expected in the next 30 days - ticker, exchange, price range, shares offered, deal size, market cap and revenue for each listing.";
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

function formatDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPriceRange(low: number | null, high: number | null) {
  if (low === null && high === null) return "-";
  if (low !== null && high !== null && low !== high) {
    return `$${low.toFixed(2)} - $${high.toFixed(2)}`;
  }
  const single = low ?? high;
  return single !== null ? `$${single.toFixed(2)}` : "-";
}

function formatShares(shares: number | null) {
  if (shares === null) return "-";
  return shares.toLocaleString("en-US");
}

function formatCompact(value: number | null) {
  if (value === null) return "-";

  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString("en-US");
}

function IpoTable({
  ipos,
  emptyMessage,
  dateColumnLabel,
}: {
  ipos: ConfirmedIpo[];
  emptyMessage: string;
  dateColumnLabel: string;
}) {
  if (ipos.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", opacity: 0.75, fontSize: 15 }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        className="ipoCalendarTable"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          minWidth: 880,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
            <th style={thStyle}>{dateColumnLabel}</th>
            <th style={thStyle}>Symbol</th>
            <th style={thStyle}>Company Name</th>
            <th style={thStyle}>Exchange</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Price Range</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Shares Offered</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Deal Size</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Market Cap</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Revenue</th>
          </tr>
        </thead>
        <tbody>
          {ipos.map((ipo: ConfirmedIpo) => (
            <tr
              key={`${ipo.symbol}-${ipo.date}`}
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <td style={tdStyle}>{formatDate(ipo.date)}</td>
              <td style={{ ...tdStyle, fontWeight: 700 }}>{ipo.symbol}</td>
              <td style={tdStyle}>{ipo.company}</td>
              <td style={tdStyle}>{ipo.exchange ?? "-"}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {formatPriceRange(ipo.priceRangeLow, ipo.priceRangeHigh)}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {formatShares(ipo.sharesOffered)}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(ipo.dealSize)}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(ipo.marketCap)}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{formatCompact(ipo.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function UpcomingIposPage() {
  const [ipos, recentIpos] = await Promise.all([
    getUpcomingConfirmedIpos(),
    getRecentIpos(),
  ]);

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
        mainEntity: { "@id": `${PAGE_URL}#itemlist` },
      },
      {
        "@type": "ItemList",
        "@id": `${PAGE_URL}#itemlist`,
        itemListElement: ipos.map((ipo, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: `${ipo.company} (${ipo.symbol})`,
        })),
      },
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
            <IpoTable
              ipos={ipos}
              dateColumnLabel="IPO Date"
              emptyMessage="No confirmed IPOs are currently scheduled in the next 30 days. Check back soon — this list updates as new deals are priced."
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
            <IpoTable
              ipos={recentIpos}
              dateColumnLabel="Listing Date"
              emptyMessage="No confirmed IPOs listed in the last 30 days."
            />
          </section>

          <p style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16 }}>
            Data source: financialmodelingprep.com. IPO terms can change
            before listing day — treat this as a starting point for further
            research, not investment advice.
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

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#8a97ad",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  whiteSpace: "nowrap",
};
