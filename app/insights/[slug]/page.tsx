
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { remark } from "remark";
import html from "remark-html";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  const posts = getAllPosts();

  return posts.map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const post = getPostBySlug(slug);

    return {
      title: `${post.title} | MyStockHarbor`,
      description: post.excerpt,
      alternates: {
        canonical: `https://mystockharbor.com/insights/${slug}`,
      },
      openGraph: {
        title: `${post.title} | MyStockHarbor`,
        description: post.excerpt,
        url: `https://mystockharbor.com/insights/${slug}`,
        siteName: "MyStockHarbor",
        type: "article",
      },
      twitter: {
        card: "summary_large_image",
        title: `${post.title} | MyStockHarbor`,
        description: post.excerpt,
      },
    };
  } catch {
    return {
      title: "Insight | MyStockHarbor",
      description: "Stock market insight from MyStockHarbor.",
    };
  }
}

function articleShellStyle(): React.CSSProperties {
  return {
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 22,
    boxShadow: "0 16px 34px rgba(0,0,0,0.22)",
  };
}

export default async function InsightPostPage({ params }: Props) {
  const { slug } = await params;

  let post: ReturnType<typeof getPostBySlug>;

  try {
    post = getPostBySlug(slug);
  } catch {
    notFound();
  }

  const processedContent = await remark().use(html).process(post.content);
  const contentHtml = processedContent.toString();

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
          maxWidth: 900,
          margin: "0 auto",
          padding: "24px 20px 40px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <Link
            href="/insights"
            style={{
              color: "#93c5fd",
              textDecoration: "none",
              fontWeight: 800,
            }}
          >
            ← Back to Insights
          </Link>

          {post.symbol ? (
            <Link
              href={`/stock/${post.symbol}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(59,130,246,0.34)",
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))",
                color: "#eff6ff",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              View {post.symbol} Stock Page →
            </Link>
          ) : null}
        </div>

        <article style={articleShellStyle()}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
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

          <h1
            style={{
              margin: 0,
              fontSize: 36,
              lineHeight: 1.12,
              letterSpacing: "-0.5px",
            }}
          >
            {post.title}
          </h1>

          <p
            style={{
              margin: "12px 0 0",
              fontSize: 17,
              lineHeight: 1.65,
              opacity: 0.82,
            }}
          >
            {post.excerpt}
          </p>

          <div
            className="insightArticleBody"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
            style={{
              marginTop: 22,
              lineHeight: 1.8,
              fontSize: 16,
              color: "#e5e7eb",
            }}
          />
        </article>

        <div
          style={{
            marginTop: 18,
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            padding: 18,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>
            Continue exploring
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/pickers"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "11px 14px",
                borderRadius: 12,
                border: "1px solid rgba(34,197,94,0.32)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.10))",
                color: "#ecfdf5",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Scan Stock Pickers
            </Link>

            <Link
              href="/platforms"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "11px 14px",
                borderRadius: 12,
                border: "1px solid rgba(168,85,247,0.32)",
                background:
                  "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(59,130,246,0.10))",
                color: "#faf5ff",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Compare Platforms
            </Link>

            {post.symbol ? (
              <>
                <Link
                  href={`/stock/${post.symbol}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "11px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(250,204,21,0.32)",
                    background:
                      "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(245,158,11,0.10))",
                    color: "#fefce8",
                    textDecoration: "none",
                    fontWeight: 900,
                  }}
                >
                  Open {post.symbol} Analysis
                </Link>

                <Link
                  href={`/stock/${post.symbol}/news`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "11px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(59,130,246,0.32)",
                    background:
                      "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                    color: "#eff6ff",
                    textDecoration: "none",
                    fontWeight: 900,
                  }}
                >
                  Read {post.symbol} News
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <style>{`
        .insightArticleBody h2 {
          margin: 28px 0 10px;
          font-size: 26px;
          line-height: 1.2;
          letter-spacing: -0.3px;
          color: #f8fafc;
        }

        .insightArticleBody p {
          margin: 0 0 16px;
        }

        .insightArticleBody ul {
          margin: 0 0 18px;
          padding-left: 22px;
        }

        .insightArticleBody li {
          margin-bottom: 8px;
        }

        .insightArticleBody a {
          color: #93c5fd;
        }

        @media (max-width: 640px) {
          .insightArticleBody h2 {
            font-size: 22px;
          }
        }
      `}</style>
    </main>
  );
}
