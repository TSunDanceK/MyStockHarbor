import Link from "next/link";
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

      <section
        className="stockSeoIntro"
        aria-label={`${upper} stock analysis summary`}
      >
        <div className="stockSeoInner">
          <div className="stockSeoCopy">
            <p className="stockSeoEyebrow">Stock analysis dashboard</p>
            <h1>{upper} Stock Analysis</h1>
            <p className="stockSeoLead">
              Review {upper} stock using chart structure, moving averages, RSI,
              MACD, trend context, latest news links and earnings data. The live
              dashboard below is designed for research and education, not
              financial advice.
            </p>

            <nav
              className="stockSeoNav"
              aria-label={`${upper} stock page navigation`}
            >
              <Link href={`/stock/${upper}`}>Overview</Link>
              <Link href={`/stock/${upper}/news`}>News</Link>
              <Link href={`/stock/${upper}/earnings`}>Earnings</Link>
            </nav>
          </div>

          <div
            className="stockSeoCard"
            aria-label={`${upper} cached trend snapshot`}
          >
            <div>
              <span>Latest cached close</span>
              <strong>{formatPrice(snapshot.latestClose)}</strong>
              {snapshot.latestDate ? (
                <small>Snapshot date: {snapshot.latestDate}</small>
              ) : null}
            </div>

            <div className="stockSeoMetricGrid">
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
            </div>

            <p>{snapshot.trendLabel}</p>
          </div>
        </div>

        <div className="stockSeoNote">
          <strong>How to read this page:</strong> {snapshot.maSummary} Use the
          overview with the linked news and earnings pages to compare price
          action with fresh company context.
        </div>
      </section>

      <StockSymbolPageClient symbol={upper} />

      <style>{`
        .stockSeoIntro {
          background: #020617;
          color: #e5e7eb;
          padding: 34px 16px 10px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.14);
        }

        .stockSeoInner {
          width: min(1180px, 100%);
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.55fr);
          gap: 18px;
          align-items: stretch;
        }

        .stockSeoCopy,
        .stockSeoCard,
        .stockSeoNote {
          border: 1px solid rgba(148, 163, 184, 0.16);
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.88), rgba(2, 6, 23, 0.92));
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.32);
          border-radius: 24px;
        }

        .stockSeoCopy {
          padding: 24px;
        }

        .stockSeoEyebrow {
          margin: 0 0 10px;
          color: #38bdf8;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .stockSeoCopy h1 {
          margin: 0;
          color: #f8fafc;
          font-size: clamp(36px, 6vw, 64px);
          line-height: 0.98;
          letter-spacing: -0.06em;
        }

        .stockSeoLead {
          max-width: 760px;
          margin: 16px 0 0;
          color: #cbd5e1;
          font-size: 16px;
          line-height: 1.75;
        }

        .stockSeoNav {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 20px;
        }

        .stockSeoNav a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 40px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.24);
          background: rgba(15, 23, 42, 0.78);
          color: #e5e7eb;
          font-size: 13px;
          font-weight: 900;
          text-decoration: none;
        }

        .stockSeoNav a:hover {
          border-color: rgba(56, 189, 248, 0.58);
          background: rgba(14, 165, 233, 0.12);
        }

        .stockSeoCard {
          padding: 20px;
        }

        .stockSeoCard span,
        .stockSeoMetricGrid span {
          display: block;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .stockSeoCard strong {
          display: block;
          margin-top: 7px;
          color: #f8fafc;
          font-size: 28px;
          line-height: 1.1;
        }

        .stockSeoCard small {
          display: block;
          margin-top: 6px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .stockSeoMetricGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 18px;
        }

        .stockSeoMetricGrid div {
          padding: 12px;
          border-radius: 16px;
          background: rgba(2, 6, 23, 0.58);
          border: 1px solid rgba(148, 163, 184, 0.12);
        }

        .stockSeoMetricGrid strong {
          font-size: 18px;
        }

        .stockSeoCard p {
          margin: 16px 0 0;
          color: #cbd5e1;
          font-size: 13px;
          line-height: 1.6;
          font-weight: 800;
        }

        .stockSeoNote {
          width: min(1180px, 100%);
          margin: 12px auto 0;
          padding: 13px 16px;
          color: #cbd5e1;
          font-size: 13px;
          line-height: 1.6;
        }

        .stockSeoNote strong {
          color: #f8fafc;
        }

        @media (max-width: 860px) {
          .stockSeoIntro {
            padding: 18px 10px 8px;
          }

          .stockSeoInner {
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .stockSeoCopy,
          .stockSeoCard,
          .stockSeoNote {
            border-radius: 18px;
          }

          .stockSeoCopy,
          .stockSeoCard {
            padding: 15px;
          }

          .stockSeoCopy h1 {
            font-size: clamp(32px, 11vw, 46px);
            line-height: 1.04;
          }

          .stockSeoLead {
            font-size: 14px;
            line-height: 1.65;
          }

          .stockSeoNav {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .stockSeoNav a {
            width: 100%;
            min-height: 44px;
          }

          .stockSeoMetricGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
