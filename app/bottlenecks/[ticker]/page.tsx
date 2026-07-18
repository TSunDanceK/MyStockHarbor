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

// Bottom-of-page internal-linking block, same on every bottleneck page.
// These four destinations (Headlines, Upcoming IPOs, Earnings Calendar,
// Pickers) only otherwise appear inside SiteHeader's client-rendered
// dropdown menus, which don't mount their links into the DOM until a user
// opens them - so this is the first static, always-crawlable path to those
// pages from the Bottlenecks section.
const CONTINUE_EXPLORING_LINKS = [
  { href: "/headlines", label: "Market Headlines →", tone: "blue" },
  { href: "/upcoming-ipos", label: "Upcoming IPOs →", tone: "green" },
  { href: "/earnings-calendar", label: "Earnings Calendar →", tone: "gold" },
  { href: "/pickers", label: "Stock Pickers →", tone: "purple" },
] as const;

function ContinueExploring() {
  return (
    <section
      style={{
        marginTop: 32,
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 24,
        boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
      }}
    >
      <h2
        style={{
          marginTop: 0,
          marginBottom: 6,
          fontSize: 20,
          fontWeight: 850,
        }}
      >
        Continue Exploring
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.75, marginBottom: 16 }}>
        More ways to dig into the market on MyStockHarbor.
      </p>
      <div className="bnExploreGrid">
        {CONTINUE_EXPLORING_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`bnExploreBtn bnExploreBtn--${link.tone}`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
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

          <ContinueExploring />
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

          /* "Continue Exploring" buttons — same treatment as the insights
             "Continue with current context" strip: full-width, centered,
             colour-tinted. One row on desktop (auto-fit), stacked full-width
             on mobile. */
          .bnExploreGrid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 12px;
          }
          .bnExploreBtn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 46px;
            padding: 12px 16px;
            border-radius: 14px;
            font-weight: 900;
            font-size: 13.5px;
            letter-spacing: 0.02em;
            text-align: center;
            text-decoration: none;
            border: 1px solid transparent;
            transition: transform 0.16s ease, filter 0.16s ease,
              border-color 0.16s ease;
          }
          .bnExploreBtn:hover,
          .bnExploreBtn:focus-visible {
            transform: translateY(-1px);
            filter: brightness(1.08);
          }
          .bnExploreBtn--blue {
            border-color: rgba(59, 130, 246, 0.34);
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(37, 99, 235, 0.10));
            color: #dbeafe;
          }
          .bnExploreBtn--green {
            border-color: rgba(34, 197, 94, 0.30);
            background: linear-gradient(135deg, rgba(34, 197, 94, 0.16), rgba(21, 128, 61, 0.08));
            color: #dcfce7;
          }
          .bnExploreBtn--gold {
            border-color: rgba(250, 204, 21, 0.30);
            background: linear-gradient(135deg, rgba(250, 204, 21, 0.16), rgba(202, 138, 4, 0.08));
            color: #fef3c7;
          }
          .bnExploreBtn--purple {
            border-color: rgba(168, 85, 247, 0.30);
            background: linear-gradient(135deg, rgba(168, 85, 247, 0.16), rgba(126, 34, 206, 0.08));
            color: #f3e8ff;
          }
          @media (max-width: 640px) {
            .bnExploreGrid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </main>
    </>
  );
}
