"use client";

import Link from "next/link";
import { useMemo } from "react";
import PriceChart, { type Overlay } from "@/app/components/PriceChart";
import type { InsightSnapshot } from "@/lib/blog";
import ShareButton from "@/app/components/ShareButton";
import FeedbackButton from "@/app/components/FeedbackButton";

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
  overallBreakdown: string;
  latestNews: string;
  latestEarnings: string;
  investorUsefulInfo: string;
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

  const overallBreakdown =
    post.overallBreakdown ||
    post.excerpt ||
    "This insight is focused on the current chart structure and the key decision point for traders.";

  const latestNews =
    post.latestNews ||
    "No specific recent news catalyst was included in this insight. Treat the move as chart-led unless the article states otherwise.";

  const latestEarnings =
    post.latestEarnings ||
    "No specific earnings update was included in this insight. Check the latest company filings or earnings release before making an investment decision.";

  const investorUsefulInfo =
    post.investorUsefulInfo ||
    "The key investor question is whether price action confirms the thesis or starts to invalidate the setup.";

  // Share button config
  const postUrl = `https://www.mystockharbor.com/insights/${post.slug}`;
  const shareText = symbol
    ? `${symbol} chart insight: ${post.title} 📊`
    : `${post.title} 📊`;

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 24%), radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 24%), #06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div className="wrap">
        <nav className="insightTopNav" aria-label="Insight navigation">
          <Link href="/insights" className="insightQuietBack">
            ← Back to Insights
          </Link>

          <div className="insightTopNavLinks">
            {symbol ? (
              <Link href={`/stock/${symbol}`}>
                {symbol} stock page
              </Link>
            ) : null}

            {symbol ? (
              <Link href={`/stock/${symbol}/news`}>
                Latest news
              </Link>
            ) : null}

            <FeedbackButton />

            <ShareButton
              url={postUrl}
              title={post.title}
              text={shareText}
            />
          </div>
        </nav>

        <section className="insightHeroShell">
          <div className="insightHeroMain">
            <div className="insightHeroPills">
              {symbol ? <span className="symbolPill">{symbol}</span> : null}
              <span className="riskPill">{insightTag.label}</span>
              <span className="timeframePill">
                <span className="insightTimeframeDesktop">{timeframeLabel} chart</span>
                <span className="insightTimeframeMobile">{post.timeframe === "w" ? "W chart" : "D chart"}</span>
              </span>
              <span className="datePill">Published {formatPostDate(post.date)}</span>
            </div>

            <h1 className="insightHeroTitle">{post.title}</h1>

            <p className="insightHeroText">{post.excerpt}</p>

            <div className="simpleViewCard">
              <span className="simpleViewIcon">💡</span>
              <div>
                <strong>Simple view:</strong> {overallBreakdown}
              </div>
            </div>
          </div>

          <aside className="insightHeroSide">
            <div className="heroScoreCard">
              <div className="scoreTopRow">
                <div>
                  <div style={miniLabelStyle}>Insight snapshot</div>
                  <div className="scoreValue">{trend}</div>
                </div>
                <span className="scoreIcon">↘</span>
              </div>
              <p>
                This is an editorial chart note based on the frozen article snapshot,
                not a live buy or sell signal.
              </p>
            </div>

            <div className="heroMiniGrid">
              <div className="heroMiniCard">
                <div style={miniLabelStyle}>Last price</div>
                <strong>{typeof lastPrice === "number" ? `$${lastPrice.toFixed(2)}` : "—"}</strong>
                <span>
                  {hasSnapshot
                    ? snapshot?.snapshotDate
                      ? formatPostDate(snapshot.snapshotDate)
                      : snapshotDateText
                    : symbol
                    ? "Snapshot unavailable"
                    : "No ticker linked"}
                </span>
              </div>

              <div className="heroMiniCard">
                <div style={miniLabelStyle}>Company</div>
                <strong>{symbol || "Insight"}</strong>
                <span>{companyName || "Editorial stock setup"}</span>
              </div>
            </div>
          </aside>
        </section>

        <section className="insightShell">
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
                📊 CHART VIEW
              </div>

              <h2
                style={{
                  margin: "14px 0 0 0",
                  fontSize: 26,
                  lineHeight: 1.12,
                  letterSpacing: "-0.03em",
                }}
              >
                {symbol} {timeframeLabel.toLowerCase()} chart with {formatIndicatorLabel(selectedIndicators)}
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
                Use this frozen {post.timeframe === "w" ? "weekly" : "daily"} snapshot to see the original setup, then compare it with the current stock page before making decisions.
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
                      hideSourceToggle
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
                        href={`/stock/${encodeURIComponent(symbol)}`}
                        className="insightDesktopOnly"
                        style={chartActionStyle("blue")}
                      >
                        Current {symbol} stock page →
                      </Link>

                      <Link
                        href={`/stock/${encodeURIComponent(symbol)}/news`}
                        className="insightDesktopOnly"
                        style={chartActionStyle("green")}
                      >
                        Latest {symbol} headlines →
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
                        href={`/stock/${encodeURIComponent(symbol)}/news`}
                        className="insightMobileButton"
                        style={chartActionStyle("green")}
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

          <section className="insightArticleLayout">
            <article className="insightArticleCard">
              <div
                className="insightArticleBody"
                dangerouslySetInnerHTML={{ __html: post.contentHtml }}
              />
            </article>

            <aside className="insightSidebar">
              <section className="insightSideCard insightSideCardFeatured">
                <div className="insightSideHeader">
                  <span className="sideIcon">🎯</span>
                  <div>
                    <div style={miniLabelStyle}>Quick read</div>
                    <h2 className="insightSideTitle">Setup summary</h2>
                  </div>
                </div>

                <p className="insightSideLead">{overallBreakdown}</p>

                <ul className="insightSideList">
                  <li>Start with the key level from the article.</li>
                  <li>Wait for price behaviour to confirm demand or supply.</li>
                  <li>Compare the frozen snapshot with today's live chart.</li>
                </ul>
              </section>

              <section className="insightSideCard">
                <div className="insightSideHeader">
                  <span className="sideIcon sideIconGold">📰</span>
                  <div>
                    <div style={miniLabelStyle}>News context</div>
                    <h2 className="insightSideTitle">Latest relevant news</h2>
                  </div>
                </div>
                <p className="insightSideText">{latestNews}</p>
              </section>

              <section className="insightSideCard">
                <div className="insightSideHeader">
                  <span className="sideIcon sideIconBlue">📊</span>
                  <div>
                    <div style={miniLabelStyle}>Earnings context</div>
                    <h2 className="insightSideTitle">Latest earnings read</h2>
                  </div>
                </div>
                <p className="insightSideText">{latestEarnings}</p>
              </section>

              <section className="insightSideCard">
                <div className="insightSideHeader">
                  <span className="sideIcon sideIconGreen">👁</span>
                  <div>
                    <div style={miniLabelStyle}>Investor focus</div>
                    <h2 className="insightSideTitle">What to watch next</h2>
                  </div>
                </div>
                <p className="insightSideText">{investorUsefulInfo}</p>
              </section>
            </aside>
          </section>
        </section>

        {symbol ? (
          <section className="insightResearchStrip">
            <div>
              <div className="insightResearchTitle">Continue with current context</div>
              <div className="insightResearchText">
                Use the stock page for the current chart and the news page for the latest live headlines.
              </div>
            </div>

            <div className="insightResearchActions">
              <Link href={`/stock/${symbol}`} style={bottomActionStyle("blue")}>
                {symbol} stock page
              </Link>

              <Link href={`/stock/${symbol}/news`} style={bottomActionStyle("green")}>
                Latest {symbol} news
              </Link>
            </div>
          </section>
        ) : null}
      </div>
      <style>{`
        .wrap {
          max-width: 1280px;
          margin: 0 auto;
          padding: 28px 20px 44px;
        }

        .insightTopNav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          margin-bottom: 16px;
        }

        .insightQuietBack,
        .insightTopNavLinks a {
          color: rgba(226,232,240,0.82);
          text-decoration: none;
          font-weight: 850;
          font-size: 13px;
        }

        .insightTopNavLinks {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
          align-items: center;
        }

        .insightHeroShell {
          border: 1px solid rgba(59,130,246,0.22);
          border-radius: 28px;
          padding: 22px;
          background: linear-gradient(135deg, rgba(15,23,42,0.98), rgba(6,10,18,0.98));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 38px rgba(0,0,0,0.26);
          display: grid;
          grid-template-columns: minmax(0, 1fr) 360px;
          gap: 22px;
          align-items: stretch;
        }

        .insightHeroMain {
          min-width: 0;
        }

        .insightHeroTitle {
          margin: 0;
          max-width: 820px;
          font-size: 43px;
          line-height: 1.04;
          letter-spacing: -0.06em;
        }

        .insightHeroText {
          margin: 12px 0 0;
          max-width: 760px;
          color: rgba(226,232,240,0.80);
          font-size: 16px;
          line-height: 1.68;
        }

        .insightHeroPills {
          display: flex;
          align-items: center;
          gap: 9px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }

        .symbolPill,
        .riskPill,
        .timeframePill,
        .datePill {
          display: inline-flex;
          align-items: center;
          min-height: 27px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.045);
          color: rgba(226,232,240,0.90);
        }

        .symbolPill {
          border-color: rgba(59,130,246,0.34);
          background: rgba(59,130,246,0.14);
          color: #dbeafe;
        }

        .riskPill {
          border-color: rgba(248,113,113,0.28);
          background: rgba(127,29,29,0.16);
          color: #fecaca;
        }

        .timeframePill {
          border-color: rgba(147,197,253,0.22);
          color: #bfdbfe;
        }

        .datePill {
          color: rgba(203,213,225,0.78);
        }

        .simpleViewCard {
          margin-top: 18px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 12px;
          align-items: start;
          max-width: 760px;
          border: 1px solid rgba(34,197,94,0.22);
          border-radius: 18px;
          padding: 14px;
          background: linear-gradient(135deg, rgba(34,197,94,0.10), rgba(15,23,42,0.74));
          color: rgba(241,245,249,0.86);
          line-height: 1.62;
          font-size: 14px;
        }

        .simpleViewCard strong {
          color: #f8fafc;
        }

        .simpleViewIcon,
        .scoreIcon,
        .sideIcon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 999px;
          background: rgba(34,197,94,0.14);
          border: 1px solid rgba(34,197,94,0.24);
          flex: 0 0 auto;
        }

        .insightHeroSide {
          display: grid;
          gap: 12px;
          min-width: 0;
        }

        .heroScoreCard,
        .heroMiniCard {
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 20px;
          background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.022));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        }

        .heroScoreCard {
          padding: 18px;
          border-color: rgba(248,113,113,0.24);
          background: linear-gradient(135deg, rgba(127,29,29,0.20), rgba(15,23,42,0.88));
        }

        .scoreTopRow {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 14px;
        }

        .scoreValue {
          margin-top: 8px;
          color: #f87171;
          font-size: 35px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.06em;
        }

        .heroScoreCard p {
          margin: 12px 0 0;
          color: rgba(241,245,249,0.74);
          line-height: 1.58;
          font-size: 13px;
        }

        .heroMiniGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .heroMiniCard {
          padding: 14px;
        }

        .heroMiniCard strong {
          display: block;
          margin-top: 8px;
          font-size: 24px;
          line-height: 1;
          color: #f8fafc;
          letter-spacing: -0.04em;
        }

        .heroMiniCard span {
          display: block;
          margin-top: 7px;
          color: rgba(203,213,225,0.72);
          font-size: 12px;
          line-height: 1.35;
        }

        .insightShell {
          margin-top: 18px;
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
          align-items: stretch;
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

        .insightArticleLayout {
          margin-top: 18px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 360px;
          gap: 18px;
          align-items: start;
        }

        .insightArticleCard {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 24px;
          padding: 22px;
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.024));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
          min-width: 0;
        }

        .insightSidebar {
          position: sticky;
          top: 18px;
          display: grid;
          gap: 14px;
          min-width: 0;
        }

        .insightSideCard {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          padding: 18px;
          background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        }

        .insightSideCardFeatured {
          border-color: rgba(59,130,246,0.22);
          background: linear-gradient(135deg, rgba(59,130,246,0.10), rgba(7,12,22,0.96));
        }

        .insightSideHeader {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 11px;
          align-items: start;
        }

        .sideIconGold {
          background: rgba(250,204,21,0.12);
          border-color: rgba(250,204,21,0.24);
        }

        .sideIconBlue {
          background: rgba(59,130,246,0.13);
          border-color: rgba(59,130,246,0.26);
        }

        .sideIconGreen {
          background: rgba(34,197,94,0.13);
          border-color: rgba(34,197,94,0.26);
        }

        .insightSideTitle {
          margin: 8px 0 0;
          font-size: 21px;
          line-height: 1.12;
          letter-spacing: -0.03em;
          color: #f8fafc;
        }

        .insightSideLead {
          margin: 12px 0 0;
          font-size: 15px;
          line-height: 1.66;
          color: rgba(241,245,249,0.86);
        }

        .insightSideText {
          margin: 12px 0 0;
          font-size: 14px;
          line-height: 1.7;
          color: rgba(241,245,249,0.80);
        }

        .insightSideList {
          margin: 14px 0 0;
          padding-left: 18px;
          display: grid;
          gap: 8px;
          color: rgba(241,245,249,0.78);
          font-size: 14px;
          line-height: 1.55;
        }

        .insightSideList li::marker {
          color: #60a5fa;
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

        .insightArticleBody {
          line-height: 1.86;
          font-size: 17px;
          color: rgba(229,231,235,0.92);
        }

        .insightArticleBody h2 {
          margin: 30px 0 12px;
          padding-top: 6px;
          font-size: 27px;
          line-height: 1.14;
          letter-spacing: -0.035em;
          color: #f8fafc;
        }

        .insightArticleBody h2:first-child {
          margin-top: 0;
        }

        .insightArticleBody h3 {
          margin: 22px 0 8px;
          font-size: 18px;
          line-height: 1.25;
          color: #f8fafc;
        }

        .insightArticleBody p {
          margin: 0 0 17px;
        }

        .insightArticleBody ul {
          margin: 0 0 18px;
          padding-left: 22px;
        }

        .insightArticleBody li {
          margin-bottom: 8px;
          line-height: 1.65;
        }

        .insightArticleBody li::marker {
          color: #60a5fa;
        }

        .insightArticleBody strong {
          color: #f8fafc;
        }

        .insightArticleBody a {
          color: #93c5fd;
          text-decoration-color: rgba(147,197,253,0.38);
          text-underline-offset: 3px;
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

        .insightResearchStrip {
          margin-top: 18px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 22px;
          padding: 18px;
          background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02));
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: center;
        }

        .insightResearchTitle {
          font-size: 20px;
          line-height: 1.2;
          font-weight: 950;
          letter-spacing: -0.03em;
        }

        .insightResearchText {
          margin-top: 6px;
          font-size: 14px;
          line-height: 1.6;
          color: rgba(241,245,249,0.72);
        }

        .insightResearchActions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
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

          .insightHeroShell {
            grid-template-columns: 1fr !important;
          }

          .insightHeroSide {
            position: static !important;
          }

          .insightArticleLayout {
            grid-template-columns: 1fr !important;
          }

          .insightSidebar {
            position: static !important;
          }

          .insightResearchStrip {
            grid-template-columns: 1fr !important;
          }

          .insightResearchActions {
            justify-content: stretch !important;
          }
        }

        @media (max-width: 640px) {
          .wrap {
            padding-left: 12px !important;
            padding-right: 12px !important;
          }

          .insightTopNav {
            align-items: flex-start !important;
            flex-direction: column !important;
          }

          .insightTopNavLinks {
            width: 100%;
            justify-content: flex-start !important;
          }

          .heroMiniGrid {
            grid-template-columns: 1fr !important;
          }

          .insightSummaryGrid {
            grid-template-columns: 1fr !important;
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
            padding: 4px 2px !important;
            background: transparent !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            justify-content: flex-start !important;
            text-decoration: underline !important;
            text-underline-offset: 3px !important;
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

          .insightArticleCard {
            padding: 16px !important;
            border-radius: 20px !important;
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

          .insightResearchActions {
            display: grid !important;
            grid-template-columns: 1fr !important;
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

function bottomActionStyle(tint: "blue" | "green"): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    padding: "10px 14px",
    borderRadius: 14,
    border:
      tint === "green"
        ? "1px solid rgba(34,197,94,0.30)"
        : "1px solid rgba(59,130,246,0.34)",
    background:
      tint === "green"
        ? "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))"
        : "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
    color: tint === "green" ? "#dcfce7" : "#dbeafe",
    textDecoration: "none",
    fontWeight: 900,
    fontSize: 13,
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
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

function insightSidebarCardStyle(
  tint: "blue" | "gold" | "green" | "purple"
): React.CSSProperties {
  const tintMap = {
    blue: {
      border: "rgba(59,130,246,0.24)",
      background:
        "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(15,23,42,0.92))",
    },
    gold: {
      border: "rgba(250,204,21,0.24)",
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.11), rgba(15,23,42,0.92))",
    },
    green: {
      border: "rgba(34,197,94,0.24)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.11), rgba(15,23,42,0.92))",
    },
    purple: {
      border: "rgba(168,85,247,0.24)",
      background:
        "linear-gradient(135deg, rgba(168,85,247,0.11), rgba(15,23,42,0.92))",
    },
  };

  return {
    border: `1px solid ${tintMap[tint].border}`,
    borderRadius: 18,
    padding: 16,
    background: tintMap[tint].background,
    boxShadow: "0 12px 28px rgba(0,0,0,0.16)",
  };
}
