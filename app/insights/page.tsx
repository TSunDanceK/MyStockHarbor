import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Stock Market Insights & Trade Ideas | MyStockHarbor",
  description:
    "Read daily stock market insights, chart-based trade ideas, and technical analysis updates from MyStockHarbor.",
  alternates: {
    canonical: "https://mystockharbor.com/insights",
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

  return (
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
        <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
          DAILY STOCK BLOG
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
                    fontWeight: 800,
                    color: "#93c5fd",
                  }}
                >
                  Read insight →
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
