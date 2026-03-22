import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Stock Market Insights & Trade Ideas | MyStockHarbor",
  description:
    "Read daily stock market insights, chart-based trade ideas, and technical analysis updates from MyStockHarbor.",
  alternates: {
    canonical: "https://www.mystockharbor.com/insights",
  },
  openGraph: {
    title: "Stock Market Insights & Trade Ideas | MyStockHarbor",
    description:
      "Read daily stock market insights, chart-based trade ideas, and technical analysis updates from MyStockHarbor.",
    url: "https://www.mystockharbor.com/insights",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Market Insights & Trade Ideas | MyStockHarbor",
    description:
      "Read daily stock market insights, chart-based trade ideas, and technical analysis updates from MyStockHarbor.",
  },
};

function postCardStyle(): React.CSSProperties {
  return {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 18,
    textDecoration: "none",
    color: "#f1f5f9",
    display: "block",
    boxShadow: "0 12px 28px rgba(0,0,0,0.16)",
  };
}

export default function InsightsPage() {
  const posts = getAllPosts();

  const insightsJsonLd = {
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
        "@id": "https://www.mystockharbor.com/insights#webpage",
        url: "https://www.mystockharbor.com/insights",
        name: "Stock Market Insights & Trade Ideas",
        description:
          "Read daily stock market insights, chart-based trade ideas, and technical analysis updates from MyStockHarbor.",
        isPartOf: {
          "@type": "WebSite",
          "@id": "https://www.mystockharbor.com/#website",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        about: {
          "@type": "Thing",
          name: "Stock market insights and technical analysis",
        },
        publisher: {
          "@id": "https://www.mystockharbor.com/#organization",
        },
        mainEntity: {
          "@id": "https://www.mystockharbor.com/insights#itemlist",
        },
      },
      {
        "@type": "ItemList",
        "@id": "https://www.mystockharbor.com/insights#itemlist",
        itemListElement: posts.slice(0, 12).map((post, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `https://www.mystockharbor.com/insights/${post.slug}`,
          name: post.title,
          item: {
            "@type": "BlogPosting",
            headline: post.title,
            url: `https://www.mystockharbor.com/insights/${post.slug}`,
            datePublished: post.date,
            dateModified: post.date,
            description: post.excerpt,
            author: {
              "@type": "Organization",
              name: "MyStockHarbor",
            },
            publisher: {
              "@id": "https://www.mystockharbor.com/#organization",
            },
            about: post.symbol
              ? {
                  "@type": "Thing",
                  name: post.symbol,
                }
              : {
                  "@type": "Thing",
                  name: "Stock market analysis",
                },
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": "https://www.mystockharbor.com/insights#breadcrumb",
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
            name: "Insights",
            item: "https://www.mystockharbor.com/insights",
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(insightsJsonLd) }}
      />

      <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          padding: "24px 20px 40px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
            DAILY STOCK BLOG
          </div>

          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "9px 14px",
              borderRadius: 12,
              border: "1px solid rgba(239,68,68,0.45)",
              background:
                "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))",
              color: "#fee2e2",
              textDecoration: "none",
              fontWeight: 900,
              fontSize: 13,
              boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
              transition: "all 140ms ease",
              whiteSpace: "nowrap",
            }}
          >
            ← Back
          </Link>
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 34,
            letterSpacing: "-0.4px",
          }}
        >
          Stock Market Insights & Trade Ideas
        </h1>

        <p
          style={{
            marginTop: 10,
            maxWidth: 760,
            opacity: 0.8,
            lineHeight: 1.6,
          }}
        >
          Daily stock market observations, chart-based trade ideas, and simple
          technical analysis write-ups focused on price structure, trend, support,
          resistance, and setups worth watching.
        </p>

        {posts.length === 0 ? (
          <div
            style={{
              marginTop: 24,
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              padding: 18,
              opacity: 0.8,
            }}
          >
            No insight posts yet.
          </div>
        ) : (
          <div
            style={{
              marginTop: 24,
              display: "grid",
              gap: 16,
            }}
          >
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/insights/${post.slug}`}
                style={postCardStyle()}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  {post.symbol ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "rgba(59,130,246,0.16)",
                        border: "1px solid rgba(59,130,246,0.28)",
                        fontSize: 12,
                        fontWeight: 900,
                        color: "#dbeafe",
                      }}
                    >
                      {post.symbol}
                    </div>
                  ) : null}

                  <div
                    style={{
                      fontSize: 13,
                      opacity: 0.68,
                      fontWeight: 700,
                    }}
                  >
                    {post.date}
                  </div>
                </div>

                <h2
                  style={{
                    margin: "12px 0 0",
                    fontSize: 24,
                    letterSpacing: "-0.3px",
                  }}
                >
                  {post.title}
                </h2>

                <p
                  style={{
                    margin: "10px 0 0",
                    opacity: 0.82,
                    lineHeight: 1.6,
                  }}
                >
                  {post.excerpt}
                </p>

                <div
                  style={{
                    marginTop: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(59,130,246,0.45)",
                    background:
                      "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.12))",
                    color: "#eff6ff",
                    textDecoration: "none",
                    fontWeight: 900,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
                    transition: "all 140ms ease",
                  }}
                >
                  Read Insight →
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
    </>
  );
}
