import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getAllBottleneckPosts,
  getBottleneckBySlug,
  type BottleneckCompany,
} from "@/lib/bottlenecks";
import BottleneckPieChart, { NEON_PALETTE } from "@/app/components/BottleneckPieChart";

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

function CompanyRow({
  company,
  color,
}: {
  company: BottleneckCompany;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "14px 0",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9" }}>
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 999,
              background: color,
              marginRight: 8,
              boxShadow: `0 0 6px ${color}`,
            }}
          />
          {company.name}
          {company.ticker ? (
            <span style={{ color: "#5FD4C7" }}> ({company.ticker})</span>
          ) : null}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#8a97ad" }}>
          ~{company.pct}%
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, opacity: 0.88 }}>
        {company.blurb}
      </p>
      {company.ticker ? (
        <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <Link
            href={`/stock/${encodeURIComponent(company.ticker)}`}
            className="bnActionBtn bnActionBtn--blue"
          >
            Stock analysis →
          </Link>
          <Link
            href={`/stock/${encodeURIComponent(company.ticker)}/earnings`}
            className="bnActionBtn bnActionBtn--teal"
          >
            Earnings →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function ChartBlock({
  heading,
  description,
  companies,
}: {
  heading: string;
  description: string;
  companies: BottleneckCompany[];
}) {
  const segments = companies.map((company, index) => ({
    name: company.name,
    ticker: company.ticker,
    pct: company.pct,
    color: NEON_PALETTE[index % NEON_PALETTE.length],
  }));

  return (
    <section
      style={{
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 22,
        boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
        height: "100%",
      }}
    >
      <h2
        style={{ marginTop: 0, marginBottom: 8, fontSize: 21, fontWeight: 850 }}
      >
        {heading}
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.55, opacity: 0.85, marginBottom: 18 }}>
        {description}
      </p>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
        <BottleneckPieChart segments={segments} />
      </div>

      <div>
        {companies.map((company, index) => (
          <CompanyRow
            key={`${company.ticker ?? company.name}-${index}`}
            company={company}
            color={NEON_PALETTE[index % NEON_PALETTE.length]}
          />
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

  const supplyChainDescription =
    post.supplyChainNote ||
    `Companies ${post.symbol} relies on to design, manufacture, package, and assemble its hardware.`;

  const customersDescription =
    post.customersNote ||
    `Companies that make up an outsized share of ${post.symbol}'s revenue - who ${post.symbol} relies on to buy from it.`;

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
        style={{
          minHeight: "100vh",
          background: "#06080d",
          color: "#f1f5f9",
          fontFamily: "system-ui, Arial",
          padding: "40px 20px",
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
              {post.companyName} ({post.symbol}): Who It Depends On
            </h1>

            <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
              {post.summary}
            </p>
          </section>

          <div
            className="bottleneckColumns"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
              marginTop: 24,
              alignItems: "start",
            }}
          >
            <ChartBlock
              heading="Supply-chain dependency"
              description={supplyChainDescription}
              companies={post.supplyChain}
            />

            <ChartBlock
              heading="Customer concentration"
              description={customersDescription}
              companies={post.customers}
            />
          </div>

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
          }

          .bnActionBtn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 7px 14px;
            border-radius: 999px;
            font-weight: 700;
            font-size: 13px;
            text-decoration: none;
            transition: transform 0.18s ease, box-shadow 0.18s ease,
              background-color 0.18s ease, border-color 0.18s ease;
          }
          .bnActionBtn--blue {
            color: #93c5fd;
            background: rgba(147, 197, 253, 0.08);
            border: 1px solid rgba(147, 197, 253, 0.35);
          }
          .bnActionBtn--blue:hover,
          .bnActionBtn--blue:focus-visible {
            background: rgba(147, 197, 253, 0.18);
            border-color: rgba(147, 197, 253, 0.75);
            box-shadow: 0 0 16px rgba(147, 197, 253, 0.45);
            transform: scale(1.07);
          }
          .bnActionBtn--teal {
            color: #5fd4c7;
            background: rgba(95, 212, 199, 0.08);
            border: 1px solid rgba(95, 212, 199, 0.35);
          }
          .bnActionBtn--teal:hover,
          .bnActionBtn--teal:focus-visible {
            background: rgba(95, 212, 199, 0.18);
            border-color: rgba(95, 212, 199, 0.75);
            box-shadow: 0 0 16px rgba(95, 212, 199, 0.45);
            transform: scale(1.07);
          }
        `}</style>
      </main>
    </>
  );
}
