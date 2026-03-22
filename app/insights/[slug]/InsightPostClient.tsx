"use client";

import Link from "next/link";
import { useMemo } from "react";
import StockPriceChart from "@/app/stock/[symbol]/StockPriceChart";
import type { InsightSnapshot } from "@/lib/blog";

/* ================= TYPES ================= */

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

/* ================= HELPERS ================= */

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
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;

    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + diff);

    const key = monday.toISOString().slice(0, 10);
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, {
        date: point.date,
        close: point.close,
        high: point.high ?? point.close,
        low: point.low ?? point.close,
        volume: point.volume ?? 0,
      });
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

/* ================= COMPONENT ================= */

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

  const dailyPoints: Point[] = snapshot?.chartPoints ?? [];

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

  const lastMA50 = ma50[ma50.length - 1];
  const lastMA200 = ma200[ma200.length - 1];

  const timeframeLabel = post.timeframe === "w" ? "Weekly" : "Daily";

  return (
    <main style={{ background: "#06080d", color: "#f1f5f9" }}>
      <div className="wrap">

        {/* TOP BUTTONS */}
        <div className="topBtns">
          <Link href="/insights" className="btn blue">
            ← Back
          </Link>

          {symbol && (
            <Link href={`/stock/${symbol}`} className="btn gold">
              <span className="desktop">View {symbol} Stock Page →</span>
              <span className="mobile">View Stock Page →</span>
            </Link>
          )}
        </div>

        {/* HEADER */}
        <div className="card">

          {/* PILLS */}
          <div className="pills">
            <span className="pill blue">{symbol}</span>
            <span className="pill red">Breakdown Risk</span>
            <span className="pill neutral">
              <span className="desktop">{timeframeLabel} Chart</span>
              <span className="mobile">
                {post.timeframe === "w" ? "W.CHART" : "D.CHART"}
              </span>
            </span>
          </div>

          {/* META */}
          <div className="meta">
            <div>Published: {formatPostDate(post.date)}</div>
            {snapshot?.snapshotDate && (
              <div>
                Snapshot: {formatPostDate(snapshot.snapshotDate)}
              </div>
            )}
          </div>

          {/* TITLE */}
          <h1>{post.title}</h1>
          <p className="excerpt">{post.excerpt}</p>

          {/* STATS */}
          <div className="stats">
            <div className="stat">
              <div>Last Price</div>
              <div className="big">
                ${lastPrice?.toFixed(2) ?? "—"}
              </div>
            </div>

            <div className="stat">
              <div>Trend</div>
              <div className="big red">
                {snapshot?.trend ?? "—"}
              </div>
            </div>
          </div>

          {/* CHART */}
          <div className="chartBox">
            <StockPriceChart
              symbol={symbol}
              data={chartSlice}
              ma50={ma50Slice}
              ma200={ma200Slice}
              height={420}
            />
          </div>

          {/* CTA */}
          <div className="cta">
            <a
              href={tradingViewHref(symbol)}
              target="_blank"
              className="btn green"
            >
              Open in TradingView ↗
            </a>

            <Link href="/pickers" className="btn purple desktop">
              Stock Scanner →
            </Link>
          </div>
        </div>
      </div>

      <style>{`
        .wrap { max-width:1100px; margin:auto; padding:20px; }

        .topBtns { display:grid; grid-template-columns:1fr 1fr; gap:10px; }

        .btn { padding:10px; border-radius:12px; text-align:center; font-weight:900; }
        .blue { background:#1d4ed8; }
        .gold { background:#ca8a04; }
        .green { background:#16a34a; }
        .purple { background:#7c3aed; }

        .card { margin-top:20px; padding:20px; border-radius:16px; background:#0b1220; }

        .pills { display:flex; gap:6px; overflow:hidden; }
        .pill { padding:6px 10px; border-radius:999px; font-size:11px; }
        .pill.blue { background:#1d4ed8; }
        .pill.red { background:#dc2626; }
        .pill.neutral { background:#334155; }

        .meta { margin-top:10px; font-size:12px; opacity:.7; }

        .stats { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:16px; }
        .stat { background:#111827; padding:14px; border-radius:12px; }
        .big { font-size:32px; font-weight:900; }
        .big.red { color:#ef4444; }

        .chartBox { margin-top:20px; }

        .cta { margin-top:16px; display:flex; gap:10px; }

        .desktop { display:inline; }
        .mobile { display:none; }

        @media(max-width:640px){
          .desktop{display:none}
          .mobile{display:inline}
          .cta{flex-direction:column}
        }
      `}</style>
    </main>
  );
}
