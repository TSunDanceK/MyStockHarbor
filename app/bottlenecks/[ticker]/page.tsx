import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllBottleneckPosts, getBottleneckBySlug } from "@/lib/bottlenecks";
import BottleneckShockView from "@/app/components/BottleneckShockView";

type Props = {
  params: Promise<{ ticker: string }>;
};

export async function generateStaticParams() {
  const posts = getAllBottleneckPosts();
  return posts.map((post) => ({ ticker: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;

  try {
    const post = getBottleneckBySlug(ticker.toLowerCase());
    const title = `${post.companyName} (${post.symbol}) Bottlenecks: Supply Chain & Customer Concentration | MyStockHarbor`;
    const description = `See the companies ${post.companyName} (${post.symbol}) relies on most - up to 10 key suppliers and its largest customers - broken down into two pie charts, with editorial reliance estimates and links to each company's own stock analysis.`;
    const url = `https://www.mystockharbor.com/bottlenecks/${post.slug}`;
    const publishedTime = post.date
      ? new Date(post.date).toISOString()
      : new Date().toISOString();
    const ogImageUrl = "https://www.mystockharbor.com/og-image-v2.png";

    return {
      title,
      description,
      alternates: { canonical: url },
      robots: {
        index: true,
        follow: true,
      },
      openGraph: {
        title,
        description,
        url,
        siteName: "MyStockHarbor",
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: `${post.companyName} (${post.symbol}) bottlenecks`,
          },
        ],
        locale: "en_GB",
        type: "article",
        publishedTime,
        modifiedTime: publishedTime,
        authors: ["https://www.mystockharbor.com"],
        section: "Stock Bottlenecks",
        tags: [
          post.symbol,
          post.companyName,
          "supply chain risk",
          "customer concentration",
          "stock bottlenecks",
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [ogImageUrl],
      },
    };
  } catch {
    return {
      title: "Stock Bottlenecks | MyStockHarbor",
      description:
        "See which companies a stock relies on most - key suppliers and its largest customers.",
      robots: {
        index: true,
        follow: true,
      },
    };
  }
}

export default async function BottleneckPage({ params }: Props) {
  const { ticker } = await params;

  let post: ReturnType<typeof getBottleneckBySlug>;

  try {
    post = getBottleneckBySlug(ticker.toLowerCase());
  } catch {
    notFound();
  }

  const pageUrl = `https://www.mystockharbor.com/bottlenecks/${post.slug}`;
  const stockUrl = `https://www.mystockharbor.com/stock/${post.symbol}`;
  const publishedTime = post.date
    ? new Date(post.date).toISOString()
    : new Date().toISOString();

  const bottleneckJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${pageUrl}#article`,
        headline: post.title,
        description: post.summary,
        datePublished: publishedTime,
        dateModified: publishedTime,
        mainEntityOfPage: { "@type": "WebPage", "@id": `${pageUrl}#webpage` },
        url: pageUrl,
        author: {
          "@type": "Organization",
          "@id": "https://www.mystockharbor.com/#organization",
          name: "MyStockHarbor",
          url: "https://www.mystockharbor.com",
        },
        publisher: {
          "@type": "Organization",
          "@id": "https://www.mystockharbor.com/#organization",
          name: "MyStockHarbor",
          logo: {
            "@type": "ImageObject",
            url: "https://www.mystockharbor.com/logo.png",
          },
        },
        isPartOf: { "@id": "https://www.mystockharbor.com/#website" },
        articleSection: "Stock Bottlenecks",
        keywords: [
          post.symbol,
          post.companyName,
          "supply chain risk",
          "customer concentration",
          "stock bottlenecks",
        ],
        about: {
          "@type": "Corporation",
          name: post.companyName,
          tickerSymbol: post.symbol,
          url: stockUrl,
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
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
            name: "Bottlenecks",
            item: "https://www.mystockharbor.com/bottlenecks",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: `${post.companyName} (${post.symbol})`,
            item: pageUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(bottleneckJsonLd) }}
      />

      <main
        className="bottlenecksTickerMain"
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
          <div
            style={{
              marginBottom: 24,
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <Link
              href="/bottlenecks"
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              ← Back to Bottlenecks
            </Link>
            <Link
              href={`/stock/${encodeURIComponent(post.symbol)}`}
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {post.symbol} stock analysis →
            </Link>
          </div>

          <BottleneckShockView post={post} />

          <p
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              opacity: 0.6,
              marginTop: 24,
              fontStyle: "italic",
            }}
          >
            {post.disclaimer}
          </p>
        </div>

        <style>{`
          @media (max-width: 860px) {
            .bottleneckColumns {
              grid-template-columns: 1fr !important;
            }
            .bottleneckMobileToggle {
              display: inline-flex !important;
            }
            .bottleneckMobileHidden {
              display: none !important;
            }
          }

          @media (max-width: 640px) {
            .bottlenecksTickerMain {
              padding: 24px 14px !important;
            }
            .bottleneckIntroCard {
              padding: 18px !important;
            }
            .bottleneckTickerTitle {
              font-size: 24px !important;
            }
            .bottleneckChartBlock {
              padding: 16px !important;
            }
          }

          .bnActionBtn {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 5px 12px;
            border-radius: 999px;
            font-weight: 600;
            font-size: 12.5px;
            white-space: nowrap;
            text-decoration: none;
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.14);
            transition: transform 0.18s ease, box-shadow 0.18s ease,
              background-color 0.18s ease, border-color 0.18s ease;
          }
          .bnActionBtn--blue {
            color: #93c5fd;
          }
          .bnActionBtn--blue:hover,
          .bnActionBtn--blue:focus-visible {
            background: rgba(147, 197, 253, 0.12);
            border-color: rgba(147, 197, 253, 0.6);
            box-shadow: 0 0 12px rgba(147, 197, 253, 0.35);
            transform: scale(1.06);
          }
          .bnActionBtn--teal {
            color: #5fd4c7;
          }
          .bnActionBtn--teal:hover,
          .bnActionBtn--teal:focus-visible {
            background: rgba(95, 212, 199, 0.12);
            border-color: rgba(95, 212, 199, 0.6);
            box-shadow: 0 0 12px rgba(95, 212, 199, 0.35);
            transform: scale(1.06);
          }
        `}</style>
      </main>
    </>
  );
}
