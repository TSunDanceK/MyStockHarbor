import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import { getLatestYouTubeVideos } from "@/lib/youtube";

export const metadata: Metadata = {
  title: "Stock Market Insights, Trade Ideas & Market Analysis | MyStockHarbor",
  description:
    "Read daily stock market insights, chart-based trade ideas, technical analysis updates, and broader market analysis from MyStockHarbor.",
  alternates: {
    canonical: "https://www.mystockharbor.com/insights",
  },
  openGraph: {
    title: "Stock Market Insights, Trade Ideas & Market Analysis | MyStockHarbor",
    description:
      "Read daily stock market insights, chart-based trade ideas, technical analysis updates, and broader market analysis from MyStockHarbor.",
    url: "https://www.mystockharbor.com/insights",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Market Insights, Trade Ideas & Market Analysis | MyStockHarbor",
    description:
      "Read daily stock market insights, chart-based trade ideas, technical analysis updates, and broader market analysis from MyStockHarbor.",
  },
};

const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@MyStockHarbor";

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

function panelCardStyle(): React.CSSProperties {
  return {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 18,
    boxShadow: "0 12px 28px rgba(0,0,0,0.16)",
  };
}

function formatVideoDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function InsightsPage() {
  const posts = getAllPosts();
  const videos = await getLatestYouTubeVideos(7);

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
            author: { "@type": "Organization", name: "MyStockHarbor" },
            publisher: { "@id": "https://www.mystockharbor.com/#organization" },
            about: post.symbol
              ? { "@type": "Thing", name: post.symbol }
              : { "@type": "Thing", name: "Stock market analysis" },
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": "https://www.mystockharbor.com/insights#breadcrumb",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" },
          { "@type": "ListItem", position: 2, name: "Insights", item: "https://www.mystockharbor.com/insights" },
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

      <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 20px 40px" }}>

          <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>DAILY STOCK BLOG</div>

          <h1 style={{ margin: "8px 0 0", fontSize: 34, letterSpacing: "-0.4px" }}>
            Stock Market Insights & Trade Ideas
          </h1>

          <p style={{ marginTop: 10, maxWidth: 760, opacity: 0.8, lineHeight: 1.6 }}>
            Daily stock market observations, chart-based trade ideas, and simple technical analysis
            write-ups focused on price structure, trend, support, resistance, and setups worth watching.
          </p>

          {/* Market hub banner */}
          <section style={{
            marginTop: 18, borderRadius: 18,
            border: "1px solid rgba(59,130,246,0.22)",
            background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(34,197,94,0.06))",
            padding: 18,
          }}>
            <div style={{ fontSize: 12, opacity: 0.78, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Market hub
            </div>
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900, lineHeight: 1.2, letterSpacing: "-0.03em" }}>
              Looking for the bigger market picture?
            </div>
            <p style={{ margin: "10px 0 0", maxWidth: 820, lineHeight: 1.7, opacity: 0.84, fontSize: 15 }}>
              Read the S&amp;P 500 market page for a simple breakdown of SPX trend, key levels, RSI,
              MACD, and how to analyse market pullbacks without panicking.
            </p>
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/markets/spx" style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "10px 14px", borderRadius: 12,
                border: "1px solid rgba(59,130,246,0.45)",
                background: "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.12))",
                color: "#eff6ff", textDecoration: "none", fontWeight: 900, fontSize: 13,
                whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
              }}>
                Read S&amp;P 500 Analysis →
              </Link>
              <Link href="/pickers" style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "10px 14px", borderRadius: 12,
                border: "1px solid rgba(34,197,94,0.45)",
                background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.12))",
                color: "#ecfdf5", textDecoration: "none", fontWeight: 900, fontSize: 13,
                whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
              }}>
                Explore Live Stock Setups →
              </Link>
            </div>
          </section>

          {/* Main two-column split */}
          <section
            className="insightsSplit"
            style={{
              marginTop: 24,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.7fr) minmax(300px, 0.95fr)",
              gap: 22,
              alignItems: "start",
            }}
          >
            {/* LEFT — insight posts */}
            <div className="insightsPostsColumn">
              {posts.length === 0 ? (
                <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", padding: 18, opacity: 0.8 }}>
                  No insight posts yet.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 16 }}>
                  {posts.map((post) => (
                    <Link key={post.slug} href={`/insights/${post.slug}`} style={postCardStyle()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        {post.symbol ? (
                          <div style={{
                            display: "inline-flex", alignItems: "center",
                            padding: "6px 10px", borderRadius: 999,
                            background: "rgba(59,130,246,0.16)",
                            border: "1px solid rgba(59,130,246,0.28)",
                            fontSize: 12, fontWeight: 900, color: "#dbeafe",
                          }}>
                            {post.symbol}
                          </div>
                        ) : null}
                        <div style={{ fontSize: 13, opacity: 0.68, fontWeight: 700 }}>{post.date}</div>
                      </div>
                      <h2 style={{ margin: "12px 0 0", fontSize: 24, letterSpacing: "-0.3px" }}>{post.title}</h2>
                      <p style={{ margin: "10px 0 0", opacity: 0.82, lineHeight: 1.6 }}>{post.excerpt}</p>
                      <div style={{
                        marginTop: 14, display: "inline-flex", alignItems: "center", justifyContent: "center",
                        padding: "10px 14px", borderRadius: 12,
                        border: "1px solid rgba(59,130,246,0.45)",
                        background: "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.12))",
                        color: "#eff6ff", textDecoration: "none", fontWeight: 900, fontSize: 13,
                        whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
                      }}>
                        Read Insight →
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT — YouTube videos, all uniform cards */}
            <aside className="insightsYouTubeColumn" style={{ position: "sticky", top: 24, display: "grid", gap: 16 }}>
              <section style={panelCardStyle()}>
                <div style={{ fontSize: 12, opacity: 0.78, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", color: "#fecaca" }}>
                  Watch on YouTube
                </div>
                <h2 style={{ margin: "10px 0 0", fontSize: 24, fontWeight: 900, lineHeight: 1.15, letterSpacing: "-0.03em" }}>
                  Latest videos from MyStockHarbor
                </h2>
                <p style={{ margin: "10px 0 0", opacity: 0.82, lineHeight: 1.7, fontSize: 15 }}>
                  Watch the latest market narratives, stock stories, and bigger-picture analysis on YouTube.
                </p>

                {videos.length === 0 ? (
                  <div style={{ marginTop: 14, borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", padding: 16, opacity: 0.78, lineHeight: 1.7 }}>
                    Latest videos could not be loaded right now.
                  </div>
                ) : (
                  <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                    {videos.map((video) => (
                      <Link
                        key={video.id}
                        href={`/insights/videos/${video.id}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "116px minmax(0, 1fr)",
                          gap: 12,
                          textDecoration: "none",
                          color: "#f1f5f9",
                          borderRadius: 14,
                          border: "1px solid rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.03)",
                          padding: 10,
                        }}
                      >
                        <div style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", background: "#0b1220" }}>
                          {video.thumbnailUrl ? (
                            <img
                              src={video.thumbnailUrl}
                              alt={video.title}
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                          ) : null}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.45 }}>{video.title}</div>
                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.66, fontWeight: 700 }}>
                            {formatVideoDate(video.publishedAt)}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                <a
                  href={YOUTUBE_CHANNEL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    marginTop: 16, display: "inline-flex", alignItems: "center", justifyContent: "center",
                    padding: "11px 14px", borderRadius: 12,
                    border: "1px solid rgba(239,68,68,0.40)",
                    background: "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))",
                    color: "#fee2e2", textDecoration: "none", fontWeight: 900, fontSize: 13,
                    whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
                  }}
                >
                  Visit YouTube Channel ↗
                </a>
              </section>
            </aside>
          </section>
        </div>

        <style>{`
          @media (max-width: 980px) {
            .insightsSplit { grid-template-columns: 1fr !important; }
            .insightsYouTubeColumn { order: -1; position: static !important; }
            .insightsPostsColumn { order: 1; }
          }
        `}</style>
      </main>
    </>
  );
}
