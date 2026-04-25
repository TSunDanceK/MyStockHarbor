import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { getAiStockAnalysis } from "@/lib/ai-stock-analysis";
import StockSymbolPageClient from "./StockSymbolPageClient";
import StockTickerJump from "./StockTickerJump";

type Props = {
  params: Promise<{ symbol: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  return {
    title: `${upper} Stock Analysis, Company Overview, Scores & Technical Summary | MyStockHarbor`,
    description: `View ${upper} stock analysis with company overview, AI outlook, fundamentals-style scores, moving averages and chart context from MyStockHarbor.`,
    alternates: {
      canonical: `https://www.mystockharbor.com/stock/${upper}`,
    },
    openGraph: {
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description: `Company overview, AI outlook and technical analysis for ${upper}.`,
      url: `https://www.mystockharbor.com/stock/${upper}`,
      siteName: "MyStockHarbor",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description: `Company overview, AI outlook and technical summary for ${upper}.`,
    },
  };
}


  if (type === "gold") {
    return {
      ...base,
      border: "1px solid rgba(250,204,21,0.34)",
      background: "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(202,138,4,0.08))",
      color: "#fef3c7",
    };
  }

  if (type === "green") {
    return {
      ...base,
      border: "1px solid rgba(34,197,94,0.30)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
      color: "#dcfce7",
    };
  }

  if (type === "red") {
    return {
      ...base,
      border: "1px solid rgba(248,113,113,0.28)",
      background: "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(185,28,28,0.08))",
      color: "#fee2e2",
    };
  }

  return {
    ...base,
    border: "1px solid rgba(59,130,246,0.30)",
    background: "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
    color: "#dbeafe",
  };
}

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();
  const aiAnalysis = await getAiStockAnalysis(upper);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
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
                "@type": "WebSite",
                "@id": "https://www.mystockharbor.com/#website",
                name: "MyStockHarbor",
                url: "https://www.mystockharbor.com",
                publisher: {
                  "@id": "https://www.mystockharbor.com/#organization",
                },
              },
              {
                "@type": "WebPage",
                "@id": `https://www.mystockharbor.com/stock/${upper}#webpage`,
                url: `https://www.mystockharbor.com/stock/${upper}`,
                name: `${upper} Stock Analysis | MyStockHarbor`,
                description: `View ${upper} stock analysis with company overview, AI outlook, technical summary and chart-based insights from MyStockHarbor.`,
                isPartOf: {
                  "@id": "https://www.mystockharbor.com/#website",
                },
                about: {
                  "@id": `https://www.mystockharbor.com/stock/${upper}#financialproduct`,
                },
                mainEntity: {
                  "@id": `https://www.mystockharbor.com/stock/${upper}#financialproduct`,
                },
              },
              {
                "@type": "FinancialProduct",
                "@id": `https://www.mystockharbor.com/stock/${upper}#financialproduct`,
                name: `${upper} Stock`,
                tickerSymbol: upper,
                category: "Equity",
                provider: {
                  "@id": "https://www.mystockharbor.com/#organization",
                },
                url: `https://www.mystockharbor.com/stock/${upper}`,
                description: `${upper} stock analysis with AI business overview, outlook scores and chart-based market context.`,
              },
              {
                "@type": "BreadcrumbList",
                "@id": `https://www.mystockharbor.com/stock/${upper}#breadcrumb`,
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
                    name: `${upper} Stock Analysis`,
                    item: `https://www.mystockharbor.com/stock/${upper}`,
                  },
                ],
              },
            ],
          }),
        }}
      />

      <section
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "20px 16px 0",
          fontFamily: "system-ui, Arial",
        }}
      >

      </section>

      <style>{`
        @media (max-width: 820px) {
          .stockHeaderNavRow {
            width: 100% !important;
            justify-content: stretch !important;
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 10px !important;
            margin-bottom: 22px !important;
          }

          .stockHeaderNavRow a {
            width: 100% !important;
          }
        }
      `}</style>

      <StockSymbolPageClient symbol={upper} aiAnalysis={aiAnalysis} />
    </>
  );
}

const pageTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 32,
  lineHeight: 1.1,
  fontWeight: 950,
  letterSpacing: "-0.02em",
};

const pageIntroStyle: CSSProperties = {
  margin: "10px 0 0",
  maxWidth: 720,
  fontSize: 15,
  lineHeight: 1.7,
  color: "rgba(241,245,249,0.72)",
};
