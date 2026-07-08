import Link from "next/link";
import type { Metadata } from "next";
import { getAllBottleneckPosts } from "@/lib/bottlenecks";
import CompanyLogo from "@/app/components/CompanyLogo";

export const metadata: Metadata = {
  title: "Stock Bottlenecks | Supply Chain & Customer Dependency | MyStockHarbor",
  description:
    "See which companies a stock relies on most - key suppliers and customer concentration - broken down into simple pie charts, one stock built per day.",
  alternates: {
    canonical: "https://www.mystockharbor.com/bottlenecks",
  },
};

export const dynamic = "force-dynamic";

function formatUpdatedDate(value: string) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function BottlenecksIndexPage() {
  const posts = [...getAllBottleneckPosts()].sort((a, b) =>
    a.companyName.localeCompare(b.companyName)
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
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
          style={{
            background: "#0b1220",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
          }}
        >
          <h1
            style={{
              marginTop: 0,
              marginBottom: 16,
              fontSize: 34,
              lineHeight: 1.1,
              fontWeight: 900,
            }}
          >
            Stock Bottlenecks
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            Every public company depends on other companies to function -
            suppliers it can&apos;t easily replace, and customers that make up
            an outsized share of its revenue. This section breaks that down
            for one stock at a time, with two pie charts per stock:{" "}
            <strong>supply-chain dependency</strong> and{" "}
            <strong>customer concentration</strong>.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            New stock pages are added roughly one per day.
          </p>
        </section>

        <section style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 11,
              opacity: 0.55,
              fontWeight: 800,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Built so far
          </div>

          {posts.length === 0 ? (
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.03)",
                padding: 16,
                opacity: 0.7,
              }}
            >
              No bottleneck pages yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {posts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/bottlenecks/${post.slug}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "15px 18px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    textDecoration: "none",
                    color: "#f1f5f9",
                  }}
                >
                  <CompanyLogo domain={post.domain} name={post.companyName} />

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        lineHeight: 1.35,
                        display: "-webkit-box",
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {post.companyName}{" "}
                      <span style={{ color: "#93c5fd" }}>({post.symbol})</span>
                    </div>
                    {post.category && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 14,
                          opacity: 0.6,
                          lineHeight: 1.4,
                        }}
                      >
                        {post.category}
                      </div>
                    )}
                    {post.date && (
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.45 }}>
                        Updated {formatUpdatedDate(post.date)}
                      </div>
                    )}
                  </div>

                  <div style={{ flexShrink: 0, fontSize: 20, opacity: 0.3 }}>
                    ›
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
