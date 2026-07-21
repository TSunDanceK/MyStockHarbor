import Link from "next/link";
import type { Metadata } from "next";
import type React from "react";
import { getRecentIndexAdditions, type IndexAddition } from "@/lib/server/indexChanges";

const PAGE_TITLE = "Recently Added to Index | S&P 500, Nasdaq 100 & Dow Jones | MyStockHarbor";
const PAGE_DESCRIPTION =
  "Stocks added to the S&P 500, Nasdaq 100, or Dow Jones in the last 30 days - which index, reason for the change, current price, and market cap.";
const PAGE_URL = "https://www.mystockharbor.com/recently-added-to-index";
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
        alt: "MyStockHarbor recently added to index",
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

function formatPrice(value: number | null) {
  return value !== null ? `$${value.toFixed(2)}` : "-";
}

function formatCompact(value: number | null) {
  if (value === null) return "-";

  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString("en-US");
}

const indexBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  background: "rgba(147,197,253,0.12)",
  color: "#93c5fd",
  border: "1px solid rgba(147,197,253,0.28)",
  whiteSpace: "nowrap",
};

export default async function RecentlyAddedToIndexPage() {
  const additions = await getRecentIndexAdditions();

  const jsonLd = {
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
        name: "Recently Added to Index",
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
        itemListElement: additions.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: `${item.company} (${item.symbol})`,
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
            name: "Recently Added to Index",
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main
        className="indexAddMain"
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
            className="indexAddIntroCard"
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
              className="indexAddTitle"
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: 34,
                lineHeight: 1.1,
                fontWeight: 900,
              }}
            >
              Recently Added to Index
            </h1>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92, marginBottom: 0 }}>
              Stocks added to the S&amp;P 500, Nasdaq 100, or Dow Jones within
              the last 30 days, most recent first, along with the stated
              reason for the change and current price / market cap.
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
            {additions.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", opacity: 0.75, fontSize: 15 }}>
                No index additions in the last 30 days. Check back soon —
                this list updates as S&amp;P Dow Jones Indices and Nasdaq
                announce reconstitution changes.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  className="indexAddTable"
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 14,
                    minWidth: 880,
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                      <th style={thStyle}>Date Added</th>
                      <th style={thStyle}>Symbol</th>
                      <th style={thStyle}>Company Name</th>
                      <th style={thStyle}>Index</th>
                      <th style={thStyle}>Reason</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Price</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Market Cap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {additions.map((item: IndexAddition) => (
                      <tr
                        key={`${item.symbol}-${item.indexName}-${item.dateAdded}`}
                        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <td style={tdStyle}>{formatDate(item.dateAdded)}</td>
                        <td style={tdStyle}>
                          <Link
                            href={`/stock/${encodeURIComponent(item.symbol)}`}
                            style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 700 }}
                          >
                            {item.symbol}
                          </Link>
                        </td>
                        <td style={tdStyle}>{item.company}</td>
                        <td style={tdStyle}>
                          <span style={indexBadgeStyle}>{item.indexName}</span>
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: "normal", opacity: 0.85 }}>
                          {item.reason ?? "-"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {formatPrice(item.price)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {formatCompact(item.marketCap)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16 }}>
            Data source: financialmodelingprep.com. Index composition changes
            are announced by the index provider and can be revised before
            the effective date — treat this as a starting point for further
            research, not investment advice.
          </p>
        </div>

        <style>{`
          @media (max-width: 640px) {
            .indexAddMain {
              padding: 24px 14px !important;
            }
            .indexAddIntroCard {
              padding: 18px !important;
            }
            .indexAddTitle {
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
