import type { Metadata } from "next";

import StockSymbolPageClient from "./StockSymbolPageClient";
import {
  getCachedDailyHistory,
  type Point,
} from "../../../lib/server/historyCache";

type Props = {
  params: Promise<{ symbol: string }>;
};

type Snapshot = {
  latestClose: number | null;
  latestDate: string | null;
  ma50: number | null;
  ma200: number | null;
  oneMonthChangePct: number | null;
  threeMonthChangePct: number | null;
  trendLabel: string;
  maSummary: string;
};

function cleanSymbol(symbol: string) {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "");
}

function formatPrice(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return "Loading from dashboard";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 100 ? 2 : 2,
    maximumFractionDigits: value >= 100 ? 2 : 4,
  })}`;
}

function formatPct(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Loading";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function average(points: Point[], lookback: number) {
  const recent = points
    .slice(-lookback)
    .map((p) => p.close)
    .filter((v) => typeof v === "number" && Number.isFinite(v));

  if (recent.length < Math.min(lookback, 20)) return null;
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function percentChange(points: Point[], lookback: number) {
  if (points.length <= lookback) return null;

  const latest = points[points.length - 1]?.close;
  const previous = points[points.length - 1 - lookback]?.close;

  if (
    typeof latest !== "number" ||
    typeof previous !== "number" ||
    !Number.isFinite(latest) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }

  return ((latest - previous) / previous) * 100;
}

function buildSnapshot(points: Point[]): Snapshot {
  const latest = points[points.length - 1];
  const latestClose =
    typeof latest?.close === "number" && Number.isFinite(latest.close)
      ? latest.close
      : null;
  const latestDate = latest?.date ?? null;
  const ma50 = average(points, 50);
  const ma200 = average(points, 200);
  const oneMonthChangePct = percentChange(points, 21);
  const threeMonthChangePct = percentChange(points, 63);

  const above50 =
    typeof latestClose === "number" && typeof ma50 === "number"
      ? latestClose >= ma50
      : null;
  const above200 =
    typeof latestClose === "number" && typeof ma200 === "number"
      ? latestClose >= ma200
      : null;

  let trendLabel = "Dashboard loading market structure";
  if (above50 === true && above200 === true)
    trendLabel = "Trading above key moving averages";
  if (above50 === false && above200 === true)
    trendLabel = "Testing short-term trend support";
  if (above50 === true && above200 === false)
    trendLabel = "Reclaiming short-term momentum";
  if (above50 === false && above200 === false)
    trendLabel = "Trading below key moving averages";

  let maSummary =
    "The live dashboard below loads the latest moving average, RSI, MACD and chart context.";
  if (above50 !== null && above200 !== null) {
    maSummary = `Based on cached daily history, the latest close is ${above50 ? "above" : "below"} the 50-day moving average and ${above200 ? "above" : "below"} the 200-day moving average.`;
  }

  return {
    latestClose,
    latestDate,
    ma50,
    ma200,
    oneMonthChangePct,
    threeMonthChangePct,
    trendLabel,
    maSummary,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = cleanSymbol(symbol);

  return {
    title: `${upper} Stock Analysis: Chart, RSI, MACD & Macro Support | MyStockHarbor`,
    description: `View ${upper} stock analysis with chart context, RSI, MACD, moving averages, macro support levels, earnings links, stock news and trade context from MyStockHarbor.`,
    alternates: {
      canonical: `https://www.mystockharbor.com/stock/${upper}`,
    },
    openGraph: {
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description: `Stock chart context, trend score, RSI, MACD, moving averages, earnings links, news and macro support analysis for ${upper}.`,
      url: `https://www.mystockharbor.com/stock/${upper}`,
      siteName: "MyStockHarbor",
      type: "article",
      images: [
        {
          url: "https://www.mystockharbor.com/og-image-v2.png",
          width: 1200,
          height: 630,
          alt: "MyStockHarbor stock analysis dashboard",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock Analysis | MyStockHarbor`,
      description: `Chart context, RSI, MACD, moving averages, earnings links, news and macro support summary for ${upper}.`,
      images: ["https://www.mystockharbor.com/og-image-v2.png"],
    },
  };
}

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const upper = cleanSymbol(symbol);
  const cachedHistory = await getCachedDailyHistory(upper);
  const snapshot = buildSnapshot(cachedHistory);

  const jsonLd = {
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
        description: `View ${upper} stock analysis with chart context, RSI, MACD, moving averages, earnings links, stock news, macro support levels and chart-based insights from MyStockHarbor.`,
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
        description: `${upper} stock analysis with chart context, trend scoring, RSI, MACD, moving averages, earnings data, news and macro support context.`,
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
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />

      <aside
        className="stockSeoSnapshot"
        aria-label={`${upper} cached stock snapshot`}
      >
        <div>
          <span>Latest cached close</span>
          <strong>{formatPrice(snapshot.latestClose)}</strong>
          {snapshot.latestDate ? <small>{snapshot.latestDate}</small> : null}
        </div>

        <div>
          <span>1M move</span>
          <strong>{formatPct(snapshot.oneMonthChangePct)}</strong>
        </div>

        <div>
          <span>3M move</span>
          <strong>{formatPct(snapshot.threeMonthChangePct)}</strong>
        </div>

        <div>
          <span>50D avg</span>
          <strong>{formatPrice(snapshot.ma50)}</strong>
        </div>

        <div>
          <span>200D avg</span>
          <strong>{formatPrice(snapshot.ma200)}</strong>
        </div>

        <p>
          <strong>Snapshot:</strong> {snapshot.maSummary}
        </p>
      </aside>

      <StockSymbolPageClient symbol={upper} aiAnalysis={null} />

      <style>{`
        .stockSeoSnapshot {
          width: min(996px, calc(100% - 24px));
          margin: 18px auto -18px;
          padding: 14px;
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          align-items: stretch;
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 18px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.96));
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
          color: #e5e7eb;
          position: relative;
          z-index: 2;
        }

        .stockSeoSnapshot div {
          min-width: 0;
          padding: 12px;
          border-radius: 14px;
          background: rgba(2, 6, 23, 0.48);
          border: 1px solid rgba(148, 163, 184, 0.12);
        }

        .stockSeoSnapshot span {
          display: block;
          color: #94a3b8;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .stockSeoSnapshot strong {
          display: block;
          margin-top: 6px;
          color: #f8fafc;
          font-size: 18px;
          line-height: 1.1;
          overflow-wrap: anywhere;
        }

        .stockSeoSnapshot small {
          display: block;
          margin-top: 5px;
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
        }

        .stockSeoSnapshot p {
          grid-column: 1 / -1;
          margin: 0;
          padding: 11px 12px;
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.58);
          border: 1px solid rgba(148, 163, 184, 0.12);
          color: #cbd5e1;
          font-size: 12px;
          line-height: 1.55;
        }

        .stockSeoSnapshot p strong {
          display: inline;
          margin: 0;
          color: #f8fafc;
          font-size: inherit;
          line-height: inherit;
        }

        @media (max-width: 900px) {
          .stockSeoSnapshot {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            margin: 12px auto -10px;
          }

          .stockSeoSnapshot div:first-child {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 520px) {
          .stockSeoSnapshot {
            width: calc(100% - 18px);
            grid-template-columns: 1fr;
            padding: 10px;
            border-radius: 16px;
          }

          .stockSeoSnapshot div {
            padding: 11px;
          }
        }
      `}</style>
    </>
  );
}
