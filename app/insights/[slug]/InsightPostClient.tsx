"use client";

import Link from "next/link";
import { useMemo } from "react";
import PriceChart, { type Overlay } from "@/app/components/PriceChart";
import type { InsightSnapshot } from "@/lib/blog";

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
  chartBars: number | null;
  chartIndicators: Overlay[];
  contentHtml: string;
};

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

function rollingStd(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);

  for (let i = window - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - window + 1; j <= i; j++) mean += values[j];
    mean /= window;

    let variance = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const d = values[j] - mean;
      variance += d * d;
    }
    variance /= window;

    out[i] = Math.sqrt(variance);
  }

  return out;
}

function bollinger(values: number[], window = 20, k = 2) {
  const mid = movingAverage(values, window);
  const sd = rollingStd(values, window);
  const upper = mid.map((m, i) => (m == null || sd[i] == null ? null : m + k * sd[i]!));
  const lower = mid.map((m, i) => (m == null || sd[i] == null ? null : m - k * sd[i]!));
  return { upper, mid, lower };
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (!values.length) return out;

  const k = 2 / (period + 1);
  let emaPrev: number | null = null;
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];

    if (i < period) {
      sum += v;
      if (i === period - 1) {
        emaPrev = sum / period;
        out[i] = emaPrev;
      }
      continue;
    }

    emaPrev = emaPrev == null ? v : v * k + emaPrev * (1 - k);
    out[i] = emaPrev;
  }

  return out;
}

function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  const line: (number | null)[] = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (typeof f !== "number" || !Number.isFinite(f)) return null;
    if (typeof s !== "number" || !Number.isFinite(s)) return null;
    return f - s;
  });

  const sig: (number | null)[] = Array(values.length).fill(null);
  const hist: (number | null)[] = Array(values.length).fill(null);

  const validMacd: { index: number; value: number }[] = [];
  for (let i = 0; i < line.length; i++) {
    const v = line[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      validMacd.push({ index: i, value: v });
    }
  }

  if (validMacd.length < signal) {
    return { line, signal: sig, hist };
  }

  let signalSeed = 0;
  for (let i = 0; i < signal; i++) {
    signalSeed += validMacd[i].value;
  }

  let prevSignal = signalSeed / signal;
  sig[validMacd[signal - 1].index] = prevSignal;

  const k = 2 / (signal + 1);

  for (let i = signal; i < validMacd.length; i++) {
    prevSignal = validMacd[i].value * k + prevSignal * (1 - k);
    sig[validMacd[i].index] = prevSignal;
  }

  for (let i = 0; i < line.length; i++) {
    const l = line[i];
    const s = sig[i];
    if (typeof l === "number" && Number.isFinite(l) && typeof s === "number" && Number.isFinite(s)) {
      hist[i] = l - s;
    }
  }

  return { line, signal: sig, hist };
}

function vwma(values: number[], volumes: (number | undefined)[], window = 20): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) continue;

    let pvSum = 0;
    let vSum = 0;

    for (let j = i - window + 1; j <= i; j++) {
      const price = values[j];
      const volume = volumes[j];

      if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        typeof volume !== "number" ||
        !Number.isFinite(volume) ||
        volume <= 0
      ) {
        continue;
      }

      pvSum += price * volume;
      vSum += volume;
    }

    out[i] = vSum > 0 ? pvSum / vSum : null;
  }

  return out;
}

function stochastic(points: Point[], kPeriod = 14, dPeriod = 3) {
  const k: (number | null)[] = Array(points.length).fill(null);

  for (let i = 0; i < points.length; i++) {
    if (i < kPeriod - 1) continue;

    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (let j = i - kPeriod + 1; j <= i; j++) {
      const hh = points[j].high;
      const ll = points[j].low;

      if (typeof hh !== "number" || !Number.isFinite(hh)) {
        highestHigh = NaN;
        break;
      }
      if (typeof ll !== "number" || !Number.isFinite(ll)) {
        lowestLow = NaN;
        break;
      }

      if (hh > highestHigh) highestHigh = hh;
      if (ll < lowestLow) lowestLow = ll;
    }

    if (!Number.isFinite(highestHigh) || !Number.isFinite(lowestLow)) continue;

    const denom = highestHigh - lowestLow;
    if (denom <= 0) continue;

    k[i] = ((points[i].close - lowestLow) / denom) * 100;
  }

  const d = movingAverage(
    k.map((v) => (typeof v === "number" ? v : 0)),
    dPeriod
  ).map((v, i) => (k[i] == null ? null : v));

  return { k, d };
}

function atr(points: Point[], period = 14): (number | null)[] {
  const tr: (number | null)[] = Array(points.length).fill(null);

  for (let i = 0; i < points.length; i++) {
    const h = points[i].high;
    const l = points[i].low;
    const cPrev = i > 0 ? points[i - 1].close : null;

    if (typeof h !== "number" || !Number.isFinite(h)) continue;
    if (typeof l !== "number" || !Number.isFinite(l)) continue;

    const hl = h - l;
    const hc = cPrev == null ? hl : Math.abs(h - cPrev);
    const lc = cPrev == null ? hl : Math.abs(l - cPrev);

    tr[i] = Math.max(hl, hc, lc);
  }

  const out: (number | null)[] = Array(points.length).fill(null);

  let sum = 0;
  let count = 0;
  let prevATR: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const v = tr[i];

    if (v == null) {
      out[i] = prevATR;
      continue;
    }

    if (prevATR == null) {
      sum += v;
      count++;
      if (count === period) {
        prevATR = sum / period;
        out[i] = prevATR;
      }
      continue;
    }

    prevATR = (prevATR * (period - 1) + v) / period;
    out[i] = prevATR;
  }

  return out;
}

function normalizeInsightIndicators(indicators: Overlay[]) {
  const allowed = new Set<Overlay>([
    "MA50",
    "MA200",
    "EMA20",
    "VWMA(20)",
    "Bollinger(20,2)",
    "RSI(14)",
    "MACD(12,26,9)",
    "Stochastic(14,3)",
    "ATR(14)",
    "Volume",
  ]);

  return indicators.filter((item): item is Overlay => allowed.has(item));
}

function getFocusedOverlay(indicators: Overlay[]): Overlay {
  const lower = indicators.find(
    (item) =>
      item === "RSI(14)" ||
      item === "MACD(12,26,9)" ||
      item === "Stochastic(14,3)" ||
      item === "ATR(14)" ||
      item === "Volume"
  );

  return lower ?? "None";
}

function formatIndicatorLabel(indicators: Overlay[]) {
  if (!indicators.length) return "price";
  return indicators.join(" + ");
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

function inferInsightTag(title: string, excerpt: string, contentHtml: string) {
  const hay = `${title} ${excerpt} ${contentHtml}`.toLowerCase();

  if (
    hay.includes("breakdown") ||
    hay.includes("bearish") ||
    hay.includes("downside") ||
    hay.includes("support break")
  ) {
    return {
      label: "Breakdown Risk",
      color: "#fca5a5",
      border: "rgba(239,68,68,0.26)",
      bg: "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(127,29,29,0.08))",
    };
  }

  if (
    hay.includes("breakout") ||
    hay.includes("bullish") ||
    hay.includes("reclaim") ||
    hay.includes("upside")
  ) {
    return {
      label: "Bullish Watch",
      color: "#bbf7d0",
      border: "rgba(34,197,94,0.26)",
      bg: "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(16,185,129,0.08))",
    };
  }

  if (
    hay.includes("bounce") ||
    hay.includes("dip") ||
    hay.includes("pullback") ||
    hay.includes("oversold")
  ) {
    return {
      label: "Bounce Watch",
      color: "#fde68a",
      border: "rgba(250,204,21,0.26)",
      bg: "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(202,138,4,0.08))",
    };
  }

  return {
    label: "Chart Insight",
    color: "#dbeafe",
    border: "rgba(59,130,246,0.26)",
    bg: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.08))",
  };
}

function tradingViewHref(symbol: string) {
  return `/api/go/tradingview?symbol=${encodeURIComponent(symbol)}`;
}

export default function InsightPostClient({
  post,
  snapshot,
}: {
  post: InsightPostData;
  snapshot: InsightSnapshot | null;
}) {
  const symbol = post.symbol?.toUpperCase() ?? snapshot?.symbol?.toUpperCase() ?? "";

  const insightTag = useMemo(
    () => inferInsightTag(post.title, post.excerpt, post.contentHtml),
    [post.title, post.excerpt, post.contentHtml]
  );

  const dailyChartPoints: Point[] = Array.isArray(snapshot?.chartPoints)
    ? snapshot.chartPoints
    : [];

  const chartPoints = useMemo(
    () =>
      post.timeframe === "w"
        ? aggregateToWeekly(dailyChartPoints)
        : dailyChartPoints,
    [dailyChartPoints, post.timeframe]
  );

  const closes = useMemo(() => chartPoints.map((p) => p.close), [chartPoints]);
  const ma50 = useMemo(() => movingAverage(closes, 50), [closes]);
  const ma200 = useMemo(() => movingAverage(closes, 200), [closes]);
  const ema20 = useMemo(() => ema(closes, 20), [closes]);
  const boll = useMemo(() => bollinger(closes, 20, 2), [closes]);
  const rsi14 = useMemo(() => rsiWilder(closes, 14), [closes]);
  const macdValues = useMemo(() => macd(closes, 12, 26, 9), [closes]);
  const vwma20 = useMemo(
    () => vwma(chartPoints.map((p) => p.close), chartPoints.map((p) => p.volume), 20),
    [chartPoints]
  );
  const stoch = useMemo(() => stochastic(chartPoints, 14, 3), [chartPoints]);
  const atr14 = useMemo(() => atr(chartPoints, 14), [chartPoints]);

  const selectedIndicators = useMemo<Overlay[]>(() => {
    const normalized = normalizeInsightIndicators(post.chartIndicators);
    return normalized.length ? normalized : ["MA50", "MA200"];
  }, [post.chartIndicators]);

  const focusedOverlay = useMemo(
    () => getFocusedOverlay(selectedIndicators),
    [selectedIndicators]
  );

  const chartBars = post.chartBars ?? (post.timeframe === "w" ? 104 : 240);
  const chartStart = Math.max(0, chartPoints.length - chartBars);

  const chartSlice = chartPoints.slice(chartStart);
  const ma50Slice = ma50.slice(chartStart);
  const ma200Slice = ma200.slice(chartStart);
  const ema20Slice = ema20.slice(chartStart);
  const bollUpperSlice = boll.upper.slice(chartStart);
  const bollMidSlice = boll.mid.slice(chartStart);
  const bollLowerSlice = boll.lower.slice(chartStart);
  const rsi14Slice = rsi14.slice(chartStart);
  const macdLineSlice = macdValues.line.slice(chartStart);
  const macdSignalSlice = macdValues.signal.slice(chartStart);
  const macdHistSlice = macdValues.hist.slice(chartStart);
  const vwma20Slice = vwma20.slice(chartStart);
  const stochKSlice = stoch.k.slice(chartStart);
  const stochDSlice = stoch.d.slice(chartStart);
  const atr14Slice = atr14.slice(chartStart);
  const volumeSlice = chartPoints.slice(chartStart).map((p) =>
    typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
  );

  const hasSnapshot = Boolean(snapshot && chartPoints.length >= 2);

  const companyName = snapshot?.companyName ?? "";
  const lastPrice = typeof snapshot?.price === "number"
    ? snapshot.price
    : chartPoints.length
    ? chartPoints[chartPoints.length - 1]?.close ?? null
    : null;
  const trend = snapshot?.trend ?? (symbol ? "Archived snapshot" : "Article");

  const lastChartMA50 = ma50.length ? ma50[ma50.length - 1] : null;
  const lastChartMA200 = ma200.length ? ma200[ma200.length - 1] : null;

  const lastMA50 =
    post.timeframe === "w"
      ? lastChartMA50
      : snapshot?.lastMA50 ?? lastChartMA50;

  const lastMA200 =
    post.timeframe === "w"
      ? lastChartMA200
      : snapshot?.lastMA200 ?? lastChartMA200;

  const lastWeeklyMA200 = post.timeframe === "d" ? snapshot?.lastWeeklyMA200 : null;

  const ma50Pct =
    typeof lastPrice === "number" && typeof lastMA50 === "number" && lastPrice !== 0
      ? ((lastMA50 - lastPrice) / lastPrice) * 100
      : null;

  const ma200Pct =
    typeof lastPrice === "number" && typeof lastMA200 === "number" && lastPrice !== 0
      ? ((lastMA200 - lastPrice) / lastPrice) * 100
      : null;

  const weeklyMA200Pct =
    post.timeframe === "d"
      ? snapshot?.weeklyMA200Pct ?? null
      : null;
  
    const maSpreadPct =
    typeof lastMA50 === "number" && typeof lastMA200 === "number" && lastMA200 !== 0
      ? ((lastMA50 - lastMA200) / lastMA200) * 100
      : null;

  const timeframeLabel = post.timeframe === "w" ? "Weekly" : "Daily";
  const showWeeklyMA200Card = post.timeframe === "d";

  const snapshotDateText =
    snapshot?.snapshotDate && snapshot?.snapshotTime
      ? `${snapshot.snapshotDate} ${snapshot.snapshotTime}`
      : snapshot?.snapshotDate
      ? snapshot.snapshotDate
      : post.date
      ? `Snapshot from ${post.date}`
      : "Archived snapshot";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div className="wrap">
        <div
          className="insightTopActions"
          style={{
            display: "grid",
            gridTemplateColumns: symbol ? "repeat(2, minmax(0, 1fr))" : "1fr",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <Link href="/insights" style={topLinkStyle("blue")}>
            ← Back to Insights
          </Link>

          {symbol ? (
            <Link href={`/stock/${symbol}`} style={topLinkStyle("gold")}>
              {symbol} Stock Page →
            </Link>
          ) : null}
        </div>

        <section
          style={{
            border: "1px solid rgba(59,130,246,0.24)",
            borderRadius: 22,
            padding: 20,
            background:
              "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(7,11,22,0.98))",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.30)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            {symbol ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "7px 12px",
                  borderRadius: 999,
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                  border: "1px solid rgba(59,130,246,0.32)",
                  color: "#dbeafe",
                  fontWeight: 950,
                  letterSpacing: "0.08em",
                  fontSize: 12,
                  textTransform: "uppercase",
                }}
              >
                {symbol}
              </div>
            ) : null}

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background: insightTag.bg,
                border: `1px solid ${insightTag.border}`,
                color: insightTag.color,
                fontWeight: 900,
                fontSize: 12,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {insightTag.label}
            </div>
            <div
              className="insightTimeframePill"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#e2e8f0",
                fontWeight: 900,
                fontSize: 12,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              <span className="insightTimeframeDesktop">{timeframeLabel} Chart</span>
              <span className="insightTimeframeMobile">{post.timeframe === "w" ? "W.Chart" : "D.Chart"}</span>
            </div>

<div
  className="insightMetaRows"
  style={{
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  }}
>
  {snapshot?.snapshotDate ? (
    <div
      className="insightMetaGroup insightMetaSnapshot"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "6px 10px",
          borderRadius: 999,
          background: "rgba(59,130,246,0.10)",
          border: "1px solid rgba(59,130,246,0.20)",
          color: "#dbeafe",
          fontSize: 12,
          fontWeight: 900,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Snapshot
      </span>

      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#cbd5e1",
        }}
      >
        {snapshot?.snapshotDate
  ? formatPostDate(snapshot.snapshotDate)
  : snapshotDateText}
      </span>
    </div>
  ) : null}

  <div
    className="insightMetaGroup insightMetaPublished"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    }}
  >
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "#e2e8f0",
        fontSize: 12,
        fontWeight: 900,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      Published
    </span>

    <span
      style={{
        fontSize: 14,
        fontWeight: 800,
        color: "#f8fafc",
      }}
    >
      {formatPostDate(post.date)}
    </span>
  </div>
</div>
          </div>

          <h1
            className="insightHeroTitle"
            style={{
              margin: 0,
              fontSize: 42,
              lineHeight: 1.06,
              letterSpacing: "-0.05em",
            }}
          >
            {post.title}
          </h1>

          <p
            className="insightHeroText"
            style={{
              marginTop: 12,
              fontSize: 17,
              lineHeight: 1.68,
              opacity: 0.84,
              maxWidth: 860,
            }}
          >
            {post.excerpt}
          </p>

          <div className="insightSummaryGrid" style={{ marginTop: 18 }}>
            <div style={summaryCardStyle}>
              <div style={miniLabelStyle}>Last price</div>
              <div
                className="insightPriceValue"
                style={{ marginTop: 8, fontWeight: 950 }}
              >
                {typeof lastPrice === "number" ? `$${lastPrice.toFixed(2)}` : "—"}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
{hasSnapshot
  ? `Snapshot: ${
      snapshot?.snapshotDate
        ? formatPostDate(snapshot.snapshotDate)
        : snapshotDateText
    }`
  : symbol
  ? "Snapshot unavailable"
  : "No ticker linked"}
              </div>
            </div>

            <div style={summaryCardStyle}>
              <div style={miniLabelStyle}>Trend structure</div>
              <div
                className="insightTrendValue"
                style={{
                  marginTop: 8,
                  fontWeight: 950,
                  color:
                    trend === "Uptrend"
                      ? "#22c55e"
                      : trend === "Downtrend"
                      ? "#ef4444"
                      : "#eab308",
                }}
              >
                {trend}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                {companyName || (symbol ? `${symbol} archived chart structure` : "Editorial insight")}
              </div>
            </div>
          </div>

          {symbol ? (
            <section
              style={{
                marginTop: 18,
                border: "1px solid rgba(59,130,246,0.22)",
                borderRadius: 18,
                padding: 18,
                background:
                  "linear-gradient(180deg, rgba(8,14,28,0.98), rgba(6,10,18,0.98))",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "7px 12px",
                  borderRadius: 999,
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                  border: "1px solid rgba(59,130,246,0.32)",
                  color: "#dbeafe",
                  fontWeight: 950,
                  letterSpacing: "0.08em",
                  fontSize: 12,
                }}
              >
                CHART SNAPSHOT
              </div>

              <h2
                style={{
                  margin: "14px 0 0 0",
                  fontSize: 26,
                  lineHeight: 1.12,
                  letterSpacing: "-0.03em",
                }}
              >
                {symbol} chart showing {timeframeLabel.toLowerCase()} {formatIndicatorLabel(selectedIndicators)}
              </h2>

              <p
                style={{
                  margin: "10px 0 0 0",
                  lineHeight: 1.7,
                  opacity: 0.82,
                  maxWidth: 820,
                  fontSize: 15,
                }}
              >
                This {post.timeframe === "w" ? "weekly" : "daily"} chart snapshot is frozen to the original article analysis date, showing the last {chartSlice.length} bars with the indicators chosen for this article.
              </p>

              {hasSnapshot ? (
                <div>
                  <div style={{ marginTop: 16 }}>
                    <PriceChart
                      symbol={symbol}
                      data={chartSlice}
                      ma50={ma50Slice}
                      ma200={ma200Slice}
                      overlay={focusedOverlay}
                      selectedIndicators={selectedIndicators}
                      bollUpper={bollUpperSlice}
                      bollMid={bollMidSlice}
                      bollLower={bollLowerSlice}
                      ema20={ema20Slice}
                      vwma20={vwma20Slice}
                      rsi14={rsi14Slice}
                      macdLine={macdLineSlice}
                      macdSignal={macdSignalSlice}
                      macdHist={macdHistSlice}
                      stochK={stochKSlice}
                      stochD={stochDSlice}
                      atr14={atr14Slice}
                      volume={volumeSlice}
                      height={420}
                    />
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 13,
                      opacity: 0.72,
                    }}
                  >
                    Snapshot date:{" "}
{snapshot?.snapshotDate
  ? formatPostDate(snapshot.snapshotDate)
  : snapshotDateText}
                  </div>

                  <div
                    className="insightChartMetaGrid"
                    style={{
                      marginTop: 14,
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div className="insightSmallStatCard" style={smallStatCardStyle}>
                      <div className="insightSmallStatLabel" style={smallStatLabelStyle}>
                        {timeframeLabel} MA50
                      </div>
                      <div className="insightSmallStatValue" style={smallStatValueStyle}>
                        {typeof lastMA50 === "number" ? `$${lastMA50.toFixed(2)}` : "—"}
                      </div>
                      <div className="insightSmallStatMeta" style={smallStatMetaStyle}>
                        {typeof ma50Pct === "number"
                          ? `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}% vs price`
                          : "Distance unavailable"}
                      </div>
                    </div>

                    <div className="insightSmallStatCard" style={smallStatCardStyle}>
                      <div className="insightSmallStatLabel" style={smallStatLabelStyle}>
                        {timeframeLabel} MA200
                      </div>
                      <div className="insightSmallStatValue" style={smallStatValueStyle}>
                        {typeof lastMA200 === "number" ? `$${lastMA200.toFixed(2)}` : "—"}
                      </div>
                      <div className="insightSmallStatMeta" style={smallStatMetaStyle}>
                        {typeof ma200Pct === "number"
                          ? `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}% vs price`
                          : "Distance unavailable"}
                      </div>
                    </div>

                    {showWeeklyMA200Card ? (
                      <div
                        className="insightSmallStatCard insightDesktopOnlyStat"
                        style={smallStatCardStyle}
                      >
                        <div className="insightSmallStatLabel" style={smallStatLabelStyle}>
                          Weekly MA200
                        </div>
                        <div className="insightSmallStatValue" style={smallStatValueStyle}>
                          {typeof lastWeeklyMA200 === "number"
                            ? `$${lastWeeklyMA200.toFixed(2)}`
                            : "—"}
                        </div>
                        <div className="insightSmallStatMeta" style={smallStatMetaStyle}>
                          {typeof weeklyMA200Pct === "number"
                            ? `${weeklyMA200Pct >= 0 ? "+" : ""}${weeklyMA200Pct.toFixed(2)}% vs price`
                            : "Distance unavailable"}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="insightSmallStatCard insightDesktopOnlyStat"
                        style={smallStatCardStyle}
                      >
                        <div className="insightSmallStatLabel" style={smallStatLabelStyle}>
                          MA Spread
                        </div>
                        <div className="insightSmallStatValue" style={smallStatValueStyle}>
                          {typeof maSpreadPct === "number"
                            ? `${maSpreadPct >= 0 ? "+" : ""}${maSpreadPct.toFixed(2)}%`
                            : "—"}
                        </div>
                        <div className="insightSmallStatMeta" style={smallStatMetaStyle}>
                          {typeof lastMA50 === "number" && typeof lastMA200 === "number"
                            ? `${timeframeLabel} MA50 vs ${timeframeLabel} MA200`
                            : "Spread unavailable"}
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    className="insightChartActions"
                    style={{
                      marginTop: 14,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      className="insightChartActionsDesktop"
                      style={{ fontSize: 13, opacity: 0.74 }}
                    >
                      This article chart is frozen. Use the links to compare this {post.timeframe === "w" ? "weekly" : "daily"} setup with current data, headlines, or TradingView.
                    </div>

                    <div
                      className="insightChartActionsMobile"
                      style={{ fontSize: 13, opacity: 0.78 }}
                    >
                      Quick links for {symbol}
                    </div>

                    <div
                      className="insightChartActionsButtons"
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <Link
                        href={`/stock/${encodeURIComponent(symbol)}/news`}
                        className="insightDesktopOnly"
                        style={chartActionStyle("gold")}
                      >
                        Check out {symbol} headlines →
                      </Link>

                      <a
                        href={tradingViewHref(symbol)}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="insightDesktopOnly"
                        style={chartActionStyle("green")}
                      >
                        Open in TradingView ↗
                      </a>

                      <Link
                        href={`/?symbol=${encodeURIComponent(symbol)}`}
                        className="insightDesktopOnly"
                        style={chartActionStyle("blue")}
                      >
                        Open chart dashboard →
                      </Link>

                      <Link
                        href="/pickers"
                        className="insightDesktopOnly insightDesktopOnlyPickerCta"
                        style={chartActionStyle("picker")}
                      >
                        Find Similar Setups →
                      </Link>
                    </div>

                    <div className="insightMobileOnlyWrapper">
                      <Link
                        href={`/stock/${encodeURIComponent(symbol)}`}
                        className="insightMobileButton"
                        style={chartActionStyle("blue")}
                      >
                        {symbol} stock page
                    
                      </Link>

                      <Link
                        href="/pickers"
                        className="insightMobileButton insightPrimaryPickerCta"
                        style={chartActionStyle("picker")}
                      >
                        Find Similar Setups
                      </Link>

                      <Link
                        href={`/stock/${encodeURIComponent(symbol)}/news`}
                        className="insightMobileButton"
                        style={chartActionStyle("gold")}
                      >
                        {symbol} headlines
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 16, opacity: 0.78 }}>
                  Snapshot data was not saved for this article.
                </div>
              )}
            </section>
          ) : null}

          <section
            style={{
              marginTop: 18,
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 18,
              padding: 18,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div
              className="insightArticleBody"
              dangerouslySetInnerHTML={{ __html: post.contentHtml }}
              style={{
                lineHeight: 1.82,
                fontSize: 16,
                color: "#e5e7eb",
              }}
            />
          </section>
        </section>

        <section
          style={{
            marginTop: 18,
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            padding: 18,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>
            Continue exploring
          </div>

          <div className="insightExploreGrid">
            <Link href="/pickers" style={ctaStyle("green")}>
              Scan Stock Pickers
            </Link>

            <Link href="/platforms" style={ctaStyle("purple")}>
              Compare Platforms
            </Link>

            {symbol ? (
              <>
                <Link href={`/stock/${symbol}`} style={ctaStyle("gold")}>
                  Open {symbol} Analysis
                </Link>

                <Link href={`/stock/${symbol}/news`} style={ctaStyle("blue")}>
                  Read {symbol} News
                </Link>
              </>
            ) : null}
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 28px 20px 40px;
        }

        .insightSummaryGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .insightExploreGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .insightMobileOnlyWrapper {
          display: none;
        }

        .insightDesktopOnly {
          display: inline-flex;
        }

        .insightDesktopOnlyStat {
          display: flex;
        }

        .insightMobileOnly {
          display: none;
        }

        .insightChartActionsDesktop {
          display: block;
        }

        .insightChartActionsMobile {
          display: none;
        }

        .insightPrimaryPickerCta {
          position: relative;
          overflow: hidden;
          animation: insightPickerPulse 2.8s ease-in-out infinite;
        }

        .insightPrimaryPickerCta::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(
            120deg,
            rgba(255,255,255,0) 0%,
            rgba(255,255,255,0.18) 50%,
            rgba(255,255,255,0) 100%
          );
          transform: translateX(-130%);
          animation: insightPickerShine 3.6s ease-in-out infinite;
          pointer-events: none;
        }

        .insightPrimaryPickerCta:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.06) inset,
            0 14px 34px rgba(34,197,94,0.24);
          filter: brightness(1.05);
        }

        @keyframes insightPickerPulse {
          0%,
          100% {
            box-shadow:
              0 0 0 1px rgba(255,255,255,0.04) inset,
              0 10px 28px rgba(34,197,94,0.18);
          }
          50% {
            box-shadow:
              0 0 0 1px rgba(255,255,255,0.06) inset,
              0 14px 36px rgba(34,197,94,0.28);
          }
        }

        @keyframes insightPickerShine {
          0%,
          70%,
          100% {
            transform: translateX(-130%);
          }
          85% {
            transform: translateX(130%);
          }
        }

        .insightArticleBody h2 {
          margin: 26px 0 10px;
          font-size: 26px;
          line-height: 1.18;
          letter-spacing: -0.03em;
          color: #f8fafc;
        }

        .insightArticleBody h3 {
          margin: 20px 0 8px;
          font-size: 18px;
          line-height: 1.25;
          color: #f8fafc;
        }

        .insightArticleBody p {
          margin: 0 0 16px;
        }

        .insightArticleBody ul {
          margin: 0 0 18px;
          padding-left: 22px;
        }

        .insightArticleBody li {
          margin-bottom: 8px;
        }

        .insightArticleBody strong {
          color: #f8fafc;
        }

        .insightArticleBody a {
          color: #93c5fd;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        .insightTimeframeMobile {
          display: none;
        }

        .insightTimeframeDesktop {
          display: inline;
        }

        @media (min-width: 901px) {
          .insightPriceValue {
            font-size: 42px !important;
            line-height: 1.05 !important;
          }

          .insightTrendValue {
            font-size: 36px !important;
            line-height: 1.05 !important;
          }
        }

        @media (max-width: 900px) {
          .wrap {
            padding: 18px 16px 34px !important;
          }

          .insightHeroTitle {
            font-size: 34px !important;
            line-height: 1.08 !important;
          }
        }

        @media (max-width: 640px) {
          .wrap {
            padding-left: 12px !important;
            padding-right: 12px !important;
          }

          .insightMetaRows {
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 6px !important;
            width: 100%;
          }

          .insightMetaGroup {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            flex-wrap: wrap !important;
            width: 100%;
          }

          .insightDesktopOnlyPickerCta {
            display: none !important;
          }

          .insightMetaSnapshot {
            order: 1;
          }

          .insightMetaPublished {
            order: 2;
          }

          .insightTimeframeDesktop {
            display: none !important;
          }

          .insightTimeframeMobile {
            display: inline !important;
          }

          .insightMobileOnlyWrapper {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            width: 100%;
            align-items: stretch;
          }

          .insightMobileOnlyWrapper > :nth-child(3) {
            grid-column: 1 / -1;
          }

          .insightSmallStatCard {
            padding: 10px 10px !important;
            border-radius: 14px !important;
          }

          .insightSmallStatLabel {
            margin-bottom: 6px !important;
            font-size: 11px !important;
          }

          .insightSmallStatValue {
            margin-top: 2px !important;
            font-size: 16px !important;
          }

          .insightSmallStatMeta {
            margin-top: 2px !important;
            font-size: 11px !important;
            line-height: 1.35 !important;
          }

          .insightDesktopOnlyStat {
            display: none !important;
          }

          .insightPriceValue {
            font-size: 26px !important;
          }

          .insightTrendValue {
            font-size: 22px !important;
            line-height: 1.1 !important;
          }

          .insightMobileButton {
            font-size: 13px !important;
            padding: 10px 10px !important;
          }

          .insightHeroTitle {
            font-size: 30px !important;
            line-height: 1.1 !important;
            letter-spacing: -0.04em !important;
          }

          .insightHeroText {
            font-size: 15px !important;
            line-height: 1.6 !important;
          }

          .insightArticleBody h2 {
            font-size: 22px !important;
          }

          .insightArticleBody h3 {
            font-size: 17px !important;
          }

          .insightTopActions {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }

          .insightChartMetaGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 10px !important;
          }

          .insightExploreGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 10px !important;
          }

          .insightChartActions {
            align-items: stretch !important;
          }

          .insightChartActionsDesktop {
            display: none !important;
          }

          .insightChartActionsMobile {
            display: block !important;
            width: 100%;
          }

          .insightChartActionsButtons {
            width: 100%;
            display: flex !important;
            gap: 10px !important;
          }

          .insightDesktopOnly {
            display: none !important;
          }

          .insightMobileOnly {
            display: inline-flex !important;
          }
        }
      `}</style>
    </main>
  );
}

function topLinkStyle(tint: "blue" | "gold"): React.CSSProperties {
  if (tint === "gold") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      width: "100%",
      padding: "9px 12px",
      borderRadius: 14,
      border: "1px solid rgba(250,204,21,0.45)",
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.20), rgba(202,138,4,0.10))",
      color: "#fefce8",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 42,
    width: "100%",
    padding: "9px 12px",
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.45)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))",
    color: "#eff6ff",
    textDecoration: "none",
    fontWeight: 900,
    fontSize: 14,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
    transition:
      "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
  };
}

function ctaStyle(
  tint: "green" | "purple" | "gold" | "blue"
): React.CSSProperties {
  if (tint === "green") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      minWidth: 0,
      padding: "11px 12px",
      borderRadius: 12,
      border: "1px solid rgba(34,197,94,0.32)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.10))",
      color: "#ecfdf5",
      textDecoration: "none",
      fontWeight: 900,
      textAlign: "center",
    };
  }

  if (tint === "purple") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      minWidth: 0,
      padding: "11px 12px",
      borderRadius: 12,
      border: "1px solid rgba(168,85,247,0.32)",
      background:
        "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(59,130,246,0.10))",
      color: "#faf5ff",
      textDecoration: "none",
      fontWeight: 900,
      textAlign: "center",
    };
  }

  if (tint === "gold") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      minWidth: 0,
      padding: "11px 12px",
      borderRadius: 12,
      border: "1px solid rgba(250,204,21,0.32)",
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(245,158,11,0.10))",
      color: "#fefce8",
      textDecoration: "none",
      fontWeight: 900,
      textAlign: "center",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    minWidth: 0,
    padding: "11px 12px",
    borderRadius: 12,
    border: "1px solid rgba(59,130,246,0.32)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
    color: "#eff6ff",
    textDecoration: "none",
    fontWeight: 900,
    textAlign: "center",
  };
}

function chartActionStyle(
  tint: "gold" | "green" | "blue" | "picker"
): React.CSSProperties {
  if (tint === "gold") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "11px 14px",
      borderRadius: 14,
      border: "1px solid rgba(250,204,21,0.34)",
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.16), rgba(202,138,4,0.08))",
      color: "#fef3c7",
      textDecoration: "none",
      fontWeight: 900,
      whiteSpace: "nowrap",
      minWidth: 0,
      textAlign: "center",
      transition:
        "transform 160ms ease, box-shadow 160ms ease, filter 160ms ease, border-color 160ms ease",
    };
  }

  if (tint === "green") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "11px 14px",
      borderRadius: 14,
      border: "1px solid rgba(34,197,94,0.40)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
      color: "#ecfdf5",
      textDecoration: "none",
      fontWeight: 900,
      whiteSpace: "nowrap",
      minWidth: 0,
      textAlign: "center",
      transition:
        "transform 160ms ease, box-shadow 160ms ease, filter 160ms ease, border-color 160ms ease",
    };
  }

  if (tint === "picker") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "14px 22px",
      borderRadius: 16,
      border: "1px solid rgba(34,197,94,0.56)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.30), rgba(59,130,246,0.26))",
      color: "#f8fafc",
      textDecoration: "none",
      fontWeight: 950,
      whiteSpace: "nowrap",
      minWidth: 0,
      textAlign: "center",
      boxShadow:
        "0 0 0 1px rgba(255,255,255,0.04) inset, 0 10px 28px rgba(34,197,94,0.18)",
      transition:
        "transform 160ms ease, box-shadow 160ms ease, filter 160ms ease, border-color 160ms ease",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "11px 14px",
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.45)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.12))",
    color: "#eff6ff",
    textDecoration: "none",
    fontWeight: 900,
    whiteSpace: "nowrap",
    minWidth: 0,
    textAlign: "center",
    transition:
      "transform 160ms ease, box-shadow 160ms ease, filter 160ms ease, border-color 160ms ease",
  };
}

const summaryCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 18,
  padding: 18,
  background: "rgba(255,255,255,0.04)",
};

const miniLabelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const smallStatCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.04)",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  minHeight: 0,
};

const smallStatLabelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  marginBottom: 8,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const smallStatValueStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 22,
  fontWeight: 900,
};

const smallStatMetaStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.72,
  lineHeight: 1.45,
};
