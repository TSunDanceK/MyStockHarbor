"use client";

import Link from "next/link";
import { useMemo } from "react";
import StockPriceChart from "@/app/stock/[symbol]/StockPriceChart";
import type { InsightSnapshot } from "@/lib/blog";

/* TYPES */
type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type InsightPostData = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol?: string | null;
  timeframe: "d" | "w";
  contentHtml: string;
};

/* HELPERS */
function formatPostDate(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }

  return out;
}

function aggregateToWeekly(points: Point[]): Point[] {
  if (!points.length) return [];

  const buckets = new Map<string, Point>();

  for (const point of points) {
    const d = new Date(`${point.date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;

    const utcDay = d.getUTCDay();
    const diffToMonday = utcDay === 0 ? -6 : 1 - utcDay;

    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + diffToMonday);

    const key = monday.toISOString().slice(0, 10);
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, { ...point });
    } else {
      existing.close = point.close;
      existing.high = Math.max(existing.high ?? 0, point.high ?? point.close);
      existing.low = Math.min(existing.low ?? 0, point.low ?? point.close);
      existing.volume = (existing.volume ?? 0) + (point.volume ?? 0);
      existing.date = point.date;
    }
  }

  return Array.from(buckets.values());
}

function tradingViewHref(symbol: string) {
  return `/api/go/tradingview?symbol=${encodeURIComponent(symbol)}`;
}

/* COMPONENT */
export default function InsightPostClient({
  post,
  snapshot,
}: {
  post: InsightPostData;
  snapshot: InsightSnapshot | null;
}) {
  const symbol =
    post.symbol?.toUpperCase() ??
    snapshot?.symbol?.toUpperCase() ??
    "";

  const dailyPoints = snapshot?.chartPoints ?? [];

  const chartPoints =
    post.timeframe === "w"
      ? aggregateToWeekly(dailyPoints)
      : dailyPoints;

  const closes = chartPoints.map((p) => p.close);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);

  const chartSlice =
    post.timeframe === "w" ? chartPoints : chartPoints.slice(-240);

  const ma50Slice =
    post.timeframe === "w" ? ma50 : ma50.slice(-240);

  const ma200Slice =
    post.timeframe === "w" ? ma200 : ma200.slice(-240);

  const lastPrice =
    snapshot?.price ??
    chartPoints[chartPoints.length - 1]?.close ??
    null;

  const timeframeLabel = post.timeframe === "w" ? "Weekly" : "Daily";

  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9" }}>
      <div className="wrap">

        {/* TOP BUTTONS */}
        <div className="insightTopActions">
          <Link href="/insights" style={topLinkStyle("blue")}>
            ← Back to Insights
          </Link>

          {symbol && (
            <Link href={`/stock/${symbol}`} style={topLinkStyle("gold")}>
              <span className="desktopOnly">View {symbol} Stock Page →</span>
              <span className="mobileOnly">View Stock Page →</span>
            </Link>
          )}
        </div>

        {/* HEADER */}
        <section className="card">

          {/* PILLS */}
          <div className="pillRow">
            <div className="pill blue">{symbol}</div>
            <div className="pill red">Breakdown Risk</div>
            <div className="pill neutral">
              <span className="desktopOnly">{timeframeLabel} Chart</span>
              <span className="mobileOnly">
                {post.timeframe === "w" ? "W.CHART" : "D.CHART"}
              </span>
            </div>
          </div>

          {/* DATES */}
          <div className="dates">
            <div>Published: {formatPostDate(post.date)}</div>
            {snapshot?.snapshotDate && (
              <div>Snapshot: {formatPostDate(snapshot.snapshotDate)}</div>
            )}
          </div>

          <h1>{post.title}</h1>
          <p className="excerpt">{post.excerpt}</p>

          {/* STATS */}
          <div className="stats">
            <div className="stat">
              <div>Last Price</div>
              <div className="price">
                ${lastPrice?.toFixed(2) ?? "—"}
              </div>
            </div>

            <div className="stat">
              <div>Trend</div>
              <div className="trend">{snapshot?.trend}</div>
            </div>
          </div>

          {/* CHART */}
          <StockPriceChart
            symbol={symbol}
            data={chartSlice}
            ma50={ma50Slice}
            ma200={ma200Slice}
            height={360}
          />

          {/* CTA */}
          <div className="ctaRow">

            {/* MOBILE ONLY */}
            <a
              href={tradingViewHref(symbol)}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="mobileOnly"
              style={chartActionStyle("green")}
            >
              Open in TradingView ↗
            </a>

            {/* DESKTOP ONLY */}
            <div className="desktopOnly ctaDesktop">
              <Link
                href={`/?symbol=${symbol}`}
                style={chartActionStyle("blue")}
              >
                Open chart dashboard →
              </Link>

              <Link
                href="/pickers"
                style={chartActionStyle("purple")}
              >
                Stock Scanner →
              </Link>
            </div>
          </div>

          {/* BLOG */}
          <section className="content">
            <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
          </section>
        </section>
      </div>

      <style>{`
        .wrap { max-width:1100px; margin:auto; padding:20px; }

        .pillRow {
          display:flex;
          gap:6px;
          overflow-x:auto;
          white-space:nowrap;
        }

        .pill {
          padding:6px 10px;
          border-radius:999px;
          font-size:11px;
          font-weight:900;
        }

        .dates { margin-top:10px; font-size:13px; opacity:.8; }

        .stats {
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:12px;
          margin-top:16px;
        }

        .price { font-size:32px; font-weight:900; }
        .trend { font-size:28px; font-weight:900; color:#ef4444; }

        .ctaRow { margin-top:16px; }

        .ctaDesktop { display:flex; gap:10px; }

        .desktopOnly { display:inline-flex; }
        .mobileOnly { display:none; }

        @media (max-width:640px){
          .desktopOnly { display:none !important; }
          .mobileOnly { display:inline-flex !important; }

          .price { font-size:24px; }
          .trend { font-size:22px; }
        }

        @media (min-width:900px){
          .price { font-size:44px; }
          .trend { font-size:36px; }
        }
      `}</style>
    </main>
  );
}
