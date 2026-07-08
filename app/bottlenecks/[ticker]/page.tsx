import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getAllBottleneckPosts,
  getBottleneckBySlug,
  type BottleneckCompany,
} from "@/lib/bottlenecks";
import BottleneckPieChart from "@/app/components/BottleneckPieChart";

const PALETTE = [
  "#5FD4C7",
  "#8FE3D8",
  "#93C5FD",
  "#F2C879",
  "#FF9E8A",
  "#C4B5FD",
  "#6EE7B7",
  "#FDA4AF",
  "#67E8F9",
  "#D4D4D8",
];

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
    const title = `${post.companyName} (${post.symbol}) Bottlenecks - Who It Depends On | MyStockHarbor`;
    const description = `See the companies ${post.companyName} (${post.symbol}) relies on most - key suppliers and its largest customers - broken down into two pie charts.`;
    const url = `https://www.mystockharbor.com/bottlenecks/${post.slug}`;

    return {
      title,
      description,
      alternates: { canonical: url },
      openGraph: {
        title,
        description,
        url,
        siteName: "MyStockHarbor",
        type: "article",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
      },
    };
  } catch {
    return {
      title: "Stock Bottlenecks | MyStockHarbor",
      description: "See which companies a stock relies on most.",
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
        padding: "16px 0",
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
        <span style={{ fontSize: 17, fontWeight: 800, color: "#f1f5f9" }}>
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 999,
              background: color,
              marginRight: 8,
            }}
          />
          {company.name} <span style={{ color: "#5FD4C7" }}>({company.ticker})</span>
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#8a97ad" }}>
          ~{company.pct}%
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, opacity: 0.88 }}>
        {company.blurb}
      </p>
      <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
        <Link
          href={`/stock/${encodeURIComponent(company.ticker)}`}
          style={{
            color: "#93c5fd",
            textDecoration: "none",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          Stock analysis →
        </Link>
        <Link
          href={`/stock/${encodeURIComponent(company.ticker)}/earnings`}
          style={{
            color: "#93c5fd",
            textDecoration: "none",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          Earnings →
        </Link>
      </div>
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
    color: PALETTE[index % PALETTE.length],
  }));

  return (
    <section
      style={{
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 24,
        boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
        marginTop: 24,
      }}
    >
      <h2
        style={{ marginTop: 0, marginBottom: 8, fontSize: 24, fontWeight: 850 }}
      >
        {heading}
      </h2>
      <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.85, marginBottom: 20 }}>
        {description}
      </p>

      <div
        style={{
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          alignItems: "flex-start",
          marginBottom: 8,
        }}
      >
        <div style={{ flex: "0 0 auto" }}>
          <BottleneckPieChart segments={segments} />
        </div>
      </div>

      <div>
        {companies.map((company, index) => (
          <CompanyRow
            key={company.ticker}
            company={company}
            color={PALETTE[index % PALETTE.length]}
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

        <ChartBlock
          heading="Supply-chain dependency"
          description={`Companies ${post.symbol} relies on to design, manufacture, package, and assemble its hardware.`}
          companies={post.supplyChain}
        />

        <ChartBlock
          heading="Customer concentration"
          description={`Companies that make up an outsized share of ${post.symbol}'s revenue - who ${post.symbol} relies on to buy from it.`}
          companies={post.customers}
        />

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
    </main>
  );
}
