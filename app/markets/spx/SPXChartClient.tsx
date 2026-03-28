"use client";

import { useMemo } from "react";
import PriceChart from "@/app/components/PriceChart";

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

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

  const buckets = new Map<
    string,
    {
      date: string;
      close: number;
      high: number;
      low: number;
      volume: number;
    }
  >();

  for (const point of points) {
    const d = new Date(`${point.date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;

    const utcDay = d.getUTCDay();
    const diffToMonday = utcDay === 0 ? -6 : 1 - utcDay;

    const weekStart = new Date(d);
    weekStart.setUTCDate(d.getUTCDate() + diffToMonday);

    const key = weekStart.toISOString().slice(0, 10);
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, {
        date: point.date,
        close: point.close,
        high: point.high ?? point.close,
        low: point.low ?? point.close,
        volume: point.volume ?? 0,
      });
      continue;
    }

    existing.date = point.date;
    existing.close = point.close;
    existing.high = Math.max(existing.high, point.high ?? point.close);
    existing.low = Math.min(existing.low, point.low ?? point.close);
    existing.volume += point.volume ?? 0;
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
}

function formatPostDate(dateString: string) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) return dateString;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function SPXChartClient({
  chartPoints,
}: {
  chartPoints: Point[];
}) {
  const weeklyPoints = useMemo(() => aggregateToWeekly(chartPoints), [chartPoints]);

  const fullWeeklyCloses = useMemo(
    () => weeklyPoints.map((p) => p.close),
    [weeklyPoints]
  );

  const fullWeeklyMA50 = useMemo(
    () => movingAverage(fullWeeklyCloses, 50),
    [fullWeeklyCloses]
  );

  const fullWeeklyMA200 = useMemo(
    () => movingAverage(fullWeeklyCloses, 200),
    [fullWeeklyCloses]
  );

  const chartStart = Math.max(0, weeklyPoints.length - 104);

  const chartSlice = useMemo(() => {
    return weeklyPoints.slice(chartStart);
  }, [weeklyPoints, chartStart]);

  const ma50 = useMemo(() => fullWeeklyMA50.slice(chartStart), [fullWeeklyMA50, chartStart]);
  const ma200 = useMemo(() => fullWeeklyMA200.slice(chartStart), [fullWeeklyMA200, chartStart]);

  const lastPrice =
    chartSlice.length > 0 ? chartSlice[chartSlice.length - 1]?.close ?? null : null;
  const lastMA50 = ma50.length > 0 ? ma50[ma50.length - 1] : null;
  const lastMA200 = ma200.length > 0 ? ma200[ma200.length - 1] : null;
  const lastDate =
    chartSlice.length > 0 ? chartSlice[chartSlice.length - 1]?.date ?? null : null;

  if (chartSlice.length < 2) {
    return (
      <div
        style={{
          marginTop: 16,
          borderRadius: 16,
          border: "1px solid rgba(239,68,68,0.22)",
          background: "rgba(239,68,68,0.06)",
          padding: 18,
          color: "#fecaca",
          lineHeight: 1.6,
        }}
      >
        Not enough SPX chart data to render the weekly snapshot yet.
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 16,
        display: "grid",
        gap: 14,
      }}
    >
      <PriceChart
        symbol="SPX"
        data={chartSlice}
        ma50={ma50}
        ma200={ma200}
        overlay="None"
        selectedIndicators={["MA50", "MA200"]}
        height={420}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
        className="spxChartMetaGrid"
      >
        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 12,
              opacity: 0.72,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Last weekly close
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 22,
              fontWeight: 900,
            }}
          >
            {typeof lastPrice === "number" ? lastPrice.toFixed(2) : "—"}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              opacity: 0.72,
              lineHeight: 1.45,
            }}
          >
            {lastDate ? `Latest bar: ${formatPostDate(lastDate)}` : "Latest weekly bar"}
          </div>
        </div>

        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(96,165,250,0.22)",
            background: "rgba(96,165,250,0.06)",
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 12,
              opacity: 0.72,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Weekly MA50
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 22,
              fontWeight: 900,
              color: "#dbeafe",
            }}
          >
            {typeof lastMA50 === "number" ? lastMA50.toFixed(2) : "—"}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              opacity: 0.72,
              lineHeight: 1.45,
            }}
          >
            Medium-term trend support area
          </div>
        </div>

        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(245,158,11,0.22)",
            background: "rgba(245,158,11,0.06)",
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 12,
              opacity: 0.72,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Weekly MA200
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 22,
              fontWeight: 900,
              color: "#fde68a",
            }}
          >
            {typeof lastMA200 === "number" ? lastMA200.toFixed(2) : "—"}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              opacity: 0.72,
              lineHeight: 1.45,
            }}
          >
            Long-term structure reference
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .spxChartMetaGrid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
