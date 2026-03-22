import type { Metadata } from "next";
import StockSymbolPageClient from "./StockSymbolPageClient";

type Props = {
  params: Promise<{ symbol: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  return {
    title: `${upper} Stock Analysis, Trend, Moving Averages & Technical Summary | MyStockHarbor`,
    description: `View ${upper} stock analysis with trend structure, moving averages, technical summary and a direct link into the MyStockHarbor chart dashboard.`,
    alternates: {
      canonical: `/stock/${upper}`,
    },
    openGraph: {
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description: `Trend, market structure and technical analysis for ${upper}.`,
      url: `/stock/${upper}`,
      siteName: "MyStockHarbor",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description: `Trend, moving averages and technical summary for ${upper}.`,
    },
  };
}

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebPage",
                "@id": `https://www.mystockharbor.com/stock/${upper}#webpage`,
                url: `https://www.mystockharbor.com/stock/${upper}`,
                name: `${upper} Stock Analysis | MyStockHarbor`,
                isPartOf: {
                  "@id": "https://www.mystockharbor.com/#website",
                },
                about: {
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
              },
            ],
          }),
        }}
      />

      <section
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "20px 16px 0",
          fontFamily: "system-ui, Arial",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            lineHeight: 1.1,
            fontWeight: 950,
            letterSpacing: "-0.02em",
          }}
        >
          {upper} Stock Analysis, Trend & Technical Summary
        </h1>

        <p
          style={{
            margin: "10px 0 0",
            maxWidth: 860,
            fontSize: 15,
            lineHeight: 1.7,
            color: "rgba(241,245,249,0.72)",
          }}
        >
          Explore {upper} stock analysis with trend structure, moving averages,
          technical context and chart-based insights from MyStockHarbor.
        </p>
      </section>

      <StockSymbolPageClient symbol={upper} />
    </>
  );
}
