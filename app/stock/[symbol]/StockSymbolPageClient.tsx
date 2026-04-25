"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AiStockAnalysis } from "@/lib/ai-stock-analysis";
import StockPriceChart from "./StockPriceChart";
import StockTickerJump from "./StockTickerJump";

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

type StockSymbolPageClientProps = {
  symbol: string;
  aiAnalysis: AiStockAnalysis | null;
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

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
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

function buildTrendScore(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { lastClose, ma50, ma200 } = args;

  const checks = [
    typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : null,
    typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : null,
    typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : null,
  ];

  const passed = checks.reduce((acc, v) => acc + (v === true ? 1 : 0), 0);
  return { passed, total: 3 };
}

function trendLabel(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { lastClose, ma50, ma200 } = args;

  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Uptrend";
    if (lastClose < ma50 && ma50 < ma200) return "Downtrend";
  }

  return "Range / Mixed";
}

function toneColor(tone: "green" | "yellow" | "red") {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  return "#ef4444";
}

function pctFromBase(last: number | null, base: number | null) {
  if (
    typeof last !== "number" ||
    typeof base !== "number" ||
    !Number.isFinite(last) ||
    !Number.isFinite(base) ||
    base === 0
  ) {
    return null;
  }

  return ((last - base) / base) * 100;
}

function scoreBandLabel(score: number) {
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 50) return "Mixed";
  if (score >= 35) return "Weak";
  return "High risk";
}

function scoreTone(score: number): "green" | "yellow" | "red" {
  if (score >= 65) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

function formatAiUpdatedLabel(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "Unknown";

  return dt.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildLongSummary(args: {
  symbol: string;
  companyName: string;
  quote: Quote | null;
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
  trend: string;
  trendScore: { passed: number; total: number };
  rsi: number | null;
}) {
  const { symbol, companyName, quote, lastClose, ma50, ma200, trend, trendScore, rsi } = args;

  const companyLead = companyName ? `${companyName} (${symbol})` : symbol;
  const priceText =
    typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "an unavailable latest price";

  const ma50Pct = pctFromBase(lastClose, ma50);
  const ma200Pct = pctFromBase(lastClose, ma200);

  let trendLead = `${companyLead} currently looks mixed rather than cleanly directional.`;
  if (trend === "Uptrend") {
    if (trendScore.passed === trendScore.total) {
      trendLead = `${companyLead} is still trading in a constructive trend overall.`;
    } else if (trendScore.passed >= 2) {
      trendLead = `${companyLead} still shows some constructive trend features, even if the setup is not perfect.`;
    } else {
      trendLead = `${companyLead} is holding some bullish traits, but the chart no longer looks especially clean.`;
    }
  } else if (trend === "Downtrend") {
    if (trendScore.passed <= 1) {
      trendLead = `${companyLead} currently looks weaker on the chart and is not showing much trend strength.`;
    } else {
      trendLead = `${companyLead} is leaning weaker overall, although not every signal is fully bearish.`;
    }
  } else {
    if (trendScore.passed >= 2) {
      trendLead = `${companyLead} looks more range-bound than strongly trending, but there are still a few supportive signs on the chart.`;
    } else {
      trendLead = `${companyLead} currently looks more uncertain than directional, with a fairly mixed technical picture.`;
    }
  }

  let movingAverageText = "";
  if (typeof ma50Pct === "number" && typeof ma200Pct === "number") {
    movingAverageText =
      ` Price is ${ma50Pct >= 0 ? "trading above" : "trading below"} the 50-day moving average by ${Math.abs(ma50Pct).toFixed(1)}% ` +
      `and ${ma200Pct >= 0 ? "above" : "below"} the 200-day moving average by ${Math.abs(ma200Pct).toFixed(1)}%.`;
  } else if (typeof ma50Pct === "number") {
    movingAverageText =
      ` Price is ${ma50Pct >= 0 ? "trading above" : "trading below"} the 50-day moving average by ${Math.abs(ma50Pct).toFixed(1)}%.`;
  } else if (typeof ma200Pct === "number") {
    movingAverageText =
      ` Price is ${ma200Pct >= 0 ? "trading above" : "trading below"} the 200-day moving average by ${Math.abs(ma200Pct).toFixed(1)}%.`;
  }

  const trendParagraph =
    `${trendLead} The latest available price is ${priceText}, and ${trendScore.passed} of ${trendScore.total} core trend checks are currently passing.` +
    movingAverageText;

  let momentumParagraph = `${symbol} currently looks fairly balanced from a momentum perspective.`;

  if (typeof rsi === "number") {
    if (rsi >= 75) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which points to very strong short-term momentum but also a fairly extended setup. Stocks can stay strong for longer than expected, but this kind of reading often tells beginners not to confuse strength with low-risk entry timing.`;
    } else if (rsi >= 70) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests stronger momentum and a more stretched short-term backdrop. Trend traders may still find that attractive, while more patient traders may prefer to wait and see whether the stock cools off first.`;
    } else if (rsi <= 25) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which places it in a deeply oversold zone. That can sometimes lead to bounce-watch setups, but it can also reflect genuine weakness, so the chart still needs proper confirmation rather than hope alone.`;
    } else if (rsi <= 30) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests weaker momentum and a more oversold condition. Some traders may review this kind of setup for a rebound or buy-the-dip idea, but oversold readings by themselves do not guarantee a reversal.`;
    } else if (rsi >= 55) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which leans mildly positive without looking too stretched. In other words, momentum is supportive, but not yet extreme enough to dominate the entire chart read.`;
    } else if (rsi <= 45) {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which leans a little softer than neutral. That does not automatically make the chart bearish, but it does suggest momentum is not especially strong right now.`;
    } else {
      momentumParagraph =
        `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which sits in a neutral range. That usually means momentum is not especially stretched in either direction, so traders may need to rely more on chart structure than on oscillator extremes alone.`;
    }
  }

  let structureParagraph =
    `This page is designed to help you quickly understand what the ${symbol} chart looks like before opening the full dashboard. The aim is not to tell you what to buy or sell, but to make it easier to judge whether the stock is trending cleanly, becoming stretched, or simply moving in a more awkward range.`;

  if (trend === "Uptrend") {
    structureParagraph =
      `For traders reviewing ${symbol} next, the key question is whether the trend still looks healthy or whether price has started to outrun itself. A strong uptrend can stay strong, but entries often become more difficult when price is already extended, so many traders will watch for pullbacks, support reactions, or fresh bases rather than chasing strength blindly.`;
  } else if (trend === "Downtrend") {
    structureParagraph =
      `For traders reviewing ${symbol} next, the main question is whether weakness is starting to stabilise or whether the chart still looks vulnerable to further downside. Some traders may watch for bounce attempts, but others will want to see stronger proof that the trend is improving before treating the stock as a cleaner setup.`;
  } else if (typeof rsi === "number" && rsi <= 30) {
    structureParagraph =
      `Because ${symbol} is showing a more oversold-style momentum reading inside a mixed structure, the next step is usually to watch how price behaves rather than assuming a rebound is guaranteed. Traders often want to see a stabilisation phase, a stronger reclaim, or some sign that selling pressure is starting to fade.`;
  } else if (typeof rsi === "number" && rsi >= 70) {
    structureParagraph =
      `Because ${symbol} is showing stronger momentum inside a more extended backdrop, the next step is often about timing rather than direction. A stock can keep pushing higher, but many traders will still watch for whether the move stays orderly or starts to look too stretched to offer a comfortable entry.`;
  }

  return {
    trendParagraph,
    momentumParagraph,
    structureParagraph,
  };
}

export default function StockSymbolPageClient({
  symbol,
  aiAnalysis,
}: StockSymbolPageClientProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const [quoteRes, historyRes, symbolsRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=400`, {
            cache: "no-store",
          }),
          fetch(`/api/symbols?q=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
        ]);

        if (!quoteRes.ok) throw new Error("Quote fetch failed");
        if (!historyRes.ok) throw new Error("History fetch failed");

        const quoteData = (await quoteRes.json()) as Quote;
        const historyData = (await historyRes.json()) as { symbol: string; points: any[] };

        let name = "";
        if (symbolsRes.ok) {
          const symbolsData = (await symbolsRes.json()) as { results?: SymbolResult[] };
          const exact = (symbolsData.results ?? []).find(
            (r) => (r.symbol ?? "").toUpperCase() === symbol.toUpperCase()
          );
          name = exact?.name ?? "";
        }

        if (cancelled) return;

        const ptsRaw = Array.isArray(historyData.points) ? historyData.points : [];
        const pts: Point[] = ptsRaw
          .map((p: any) => ({
            date: String(p?.date ?? ""),
            close: Number(p?.close),
            high: p?.high == null ? undefined : Number(p.high),
            low: p?.low == null ? undefined : Number(p.low),
            volume: p?.volume == null ? undefined : Number(p.volume),
          }))
          .filter((p) => p.date && Number.isFinite(p.close));

        setQuote(quoteData);
        setHistory(pts);
        setCompanyName(name);
      } catch {
        if (cancelled) return;
        setErr("Failed to load stock page.");
        setQuote(null);
        setHistory([]);
        setCompanyName("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const closes = useMemo(() => history.map((p) => p.close), [history]);
  const ma50 = useMemo(() => movingAverage(closes, 50), [closes]);
  const ma200 = useMemo(() => movingAverage(closes, 200), [closes]);
  const rsi14 = useMemo(() => rsiWilder(closes, 14), [closes]);

  const lastClose = history.length ? history[history.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);
  const lastRsi = lastNum(rsi14);

  const trendScore = useMemo(
    () =>
      buildTrendScore({
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      }),
    [lastClose, lastMA50, lastMA200]
  );

  const trend = useMemo(
    () =>
      trendLabel({
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      }),
    [lastClose, lastMA50, lastMA200]
  );

  const trendTone: "green" | "yellow" | "red" =
    trendScore.passed >= 3 ? "green" : trendScore.passed === 2 ? "yellow" : "red";

  const longSummary = useMemo(
    () =>
      buildLongSummary({
        symbol,
        companyName,
        quote,
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
        trend,
        trendScore,
        rsi: typeof lastRsi === "number" ? lastRsi : null,
      }),
    [symbol, companyName, quote, lastClose, lastMA50, lastMA200, trend, trendScore, lastRsi]
  );

  const ma50Pct = pctFromBase(lastClose, typeof lastMA50 === "number" ? lastMA50 : null);
  const ma200Pct = pctFromBase(lastClose, typeof lastMA200 === "number" ? lastMA200 : null);

  return (
<main
  style={{
    minHeight: "100vh",
    background:
      trendScore.passed >= 3
        ? "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), radial-gradient(circle at top right, rgba(34,197,94,0.16), transparent 24%), #06080d"
        : trendScore.passed === 2
        ? "radial-gradient(circle at top left, rgba(37,99,235,0.16), transparent 22%), radial-gradient(circle at top right, rgba(250,204,21,0.14), transparent 24%), #06080d"
        : "radial-gradient(circle at top left, rgba(37,99,235,0.14), transparent 22%), radial-gradient(circle at top right, rgba(239,68,68,0.16), transparent 24%), #06080d",
    color: "#f1f5f9",
    fontFamily: "system-ui, Arial",
  }}
>
      <div className="wrap">
        <div className="analysisTopUtilityRow" style={topUtilityRowStyle}>
  <div className="analysisTopUtilityInner" style={topUtilityInnerStyle}>
    <Link
      href={`/?symbol=${encodeURIComponent(symbol)}`}
      className="analysisTopBtn"
      style={topUtilityBtnStyle("gold")}
    >
      📈 Dashboard
    </Link>

    <Link
      href="/platforms"
      className="analysisTopBtn"
      style={topUtilityBtnStyle("green")}
    >
      🏦 Platforms
    </Link>

    <Link
      href="/pickers"
      className="analysisTopBtn"
      style={topUtilityBtnStyle("red")}
    >
      📊 Stock Pickers
    </Link>

    <Link
      href="/learn"
      className="analysisTopBtn"
      style={topUtilityBtnStyle("blue")}
    >
      📘 Learn
    </Link>
  </div>
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
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid rgba(59,130,246,0.32)",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
              fontSize: 12,
              fontWeight: 950,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#dbeafe",
            }}
          >
            STOCK ANALYSIS PAGE
          </div>

          <div className="stockAnalysisHeroGrid">
            <div>
<h1
style={{
  margin: "14px 0 0 0",
  fontSize: 34,
  lineHeight: 1.2,
  fontWeight: 700,
}}
>
  {symbol} Stock Analysis, Chart Overview, Trend Signals & Technical Summary
</h1>

          <p
            style={{
              marginTop: 12,
              fontSize: 16,
              lineHeight: 1.7,
              opacity: 0.84,
              maxWidth: 860,
            }}
          >
            {companyName || `${symbol} technical overview`}{" "}
            {companyName ? `(${symbol})` : ""}. Review the chart, trend structure,
            moving averages and momentum context in a more readable, beginner-friendly way.
          </p>

          <div style={{ marginTop: 18, maxWidth: 520 }}>
            <StockTickerJump currentSymbol={symbol} />
          </div>
            </div>

            {!loading && !err ? (
              <div className="stockAnalysisSidePanel">
                <div style={featuredMetricCardStyle(trendTone)}>
                  <div style={miniLabelStyle}>Trend score</div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 42,
                      lineHeight: 1,
                      fontWeight: 950,
                      letterSpacing: "-0.06em",
                      color: toneColor(trendTone),
                    }}
                  >
                    {trendScore.passed}/{trendScore.total}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.65, opacity: 0.8 }}>
                    Price vs MA50, price vs MA200 and MA50 vs MA200.
                  </div>
                </div>

                <div className="stockAnalysisMiniGrid">
                  <div style={miniMetricCardStyle}>
                    <div style={miniLabelStyle}>Last price</div>
                    <div style={miniMetricValueStyle}>
                      {typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "—"}
                    </div>
                    <div style={miniMetricSubStyle}>
                      {quote?.date && quote?.time ? `${quote.date} ${quote.time}` : "Timestamp unavailable"}
                    </div>
                  </div>

                  <div style={miniMetricCardStyle}>
                    <div style={miniLabelStyle}>Regime</div>
                    <div style={miniMetricValueStyle}>{trend}</div>
                    <div style={miniMetricSubStyle}>Overall chart structure</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {loading ? (
            <div style={{ marginTop: 18, opacity: 0.8 }}>Loading stock page…</div>
          ) : err ? (
            <div style={{ marginTop: 18, opacity: 0.8 }}>{err}</div>
          ) : (
            <>

              {aiAnalysis ? (
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
                    COMPANY OUTLOOK
                  </div>

                  <h2
                    style={{
                      margin: "14px 0 0 0",
                      fontSize: 26,
                      lineHeight: 1.12,
                      letterSpacing: "-0.03em",
                    }}
                  >
                    Company snapshot, outlook scores and future potential for {symbol}
                  </h2>

                  <p
                    style={{
                      margin: "10px 0 0 0",
                      lineHeight: 1.7,
                      opacity: 0.82,
                      maxWidth: 860,
                      fontSize: 15,
                    }}
                  >
                    Review a broader business snapshot, outlook summary, and key points investors may want to watch alongside the live chart view.
                  </p>

                  <div
                    style={{
                      marginTop: 16,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 18,
                        padding: 18,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div style={miniLabelStyle}>Fundamentals score</div>
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 34,
                          fontWeight: 950,
                          color: toneColor(scoreTone(aiAnalysis.fundamentalsScore)),
                        }}
                      >
                        {aiAnalysis.fundamentalsScore}/100
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                        {scoreBandLabel(aiAnalysis.fundamentalsScore)}
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 18,
                        padding: 18,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div style={miniLabelStyle}>Future potential score</div>
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 34,
                          fontWeight: 950,
                          color: toneColor(scoreTone(aiAnalysis.futurePotentialScore)),
                        }}
                      >
                        {aiAnalysis.futurePotentialScore}/100
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                        {scoreBandLabel(aiAnalysis.futurePotentialScore)}
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 18,
                        padding: 18,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div style={miniLabelStyle}>Summary updated</div>
                      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 950 }}>
                        {formatAiUpdatedLabel(aiAnalysis.generatedAt)}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                        Refreshed separately from live price and chart data.
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      display: "grid",
                      gap: 18,
                    }}
                  >
                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}>What this company broadly does</h3>
                      <p style={articleTextStyle}>{aiAnalysis.businessSummary}</p>
                    </article>

                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}>Fundamentals-style read</h3>
                      <p style={articleTextStyle}>{aiAnalysis.fundamentalsSummary}</p>
                    </article>

                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}>Future potential analysis</h3>
                      <p style={articleTextStyle}>{aiAnalysis.futurePotentialSummary}</p>
                    </article>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <div style={statCardStyle}>
                      <div style={pillStyle("green")}>Bullish factors</div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.bullishFactors.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={statCardStyle}>
                      <div style={pillStyle("red")}>Risk factors</div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.bearishFactors.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={statCardStyle}>
                      <div style={pillStyle("yellow")}>What investors may watch</div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.watchPoints.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

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
                  CHART VIEW
                </div>

                <h2
                  style={{
                    margin: "14px 0 0 0",
                    fontSize: 26,
                    lineHeight: 1.12,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {symbol} chart with MA50 and MA200
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
                  Use this chart to quickly review recent price action, moving averages and overall trend structure before opening the full dashboard.
                </p>
                
                <div style={{ marginTop: 16 }}>
                  <StockPriceChart
                    symbol={symbol}
                    data={history.slice(-240)}
                    ma50={ma50.slice(-240)}
                    ma200={ma200.slice(-240)}
                    height={360}
                  />
                </div>

                <div
                  style={{
                    marginTop: 16,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 13, opacity: 0.74 }}>
                    Prefer the full tool layout? Open the live dashboard view for {symbol}, view the latest headlines, or open it on TradingView.
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <Link
                      href={`/?symbol=${encodeURIComponent(symbol)}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "12px 16px",
                        borderRadius: 14,
                        border: "1px solid rgba(59,130,246,0.45)",
                        background:
                          "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.12))",
                        color: "#eff6ff",
                        textDecoration: "none",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Open {symbol} in Dashboard →
                    </Link>

                    <Link
                      href={`/stock/${encodeURIComponent(symbol)}/news`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "12px 16px",
                        borderRadius: 14,
                        border: "1px solid rgba(248,113,113,0.34)",
                        background:
                        "linear-gradient(135deg, rgba(248,113,113,0.18), rgba(185,28,28,0.10))",
                        color: "#fee2e2",
                        textDecoration: "none",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Latest News on {symbol} →
                    </Link>

                    <a
                      href={`/api/go/tradingview?symbol=${encodeURIComponent(symbol)}`}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "12px 16px",
                        borderRadius: 14,
                        border: "1px solid rgba(34,197,94,0.40)",
                        background:
                          "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
                        color: "#ecfdf5",
                        textDecoration: "none",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Open in TradingView ↗
                    </a>
                  </div>
                </div>
              </section>

              <section
                style={{
                  marginTop: 18,
                  display: "grid",
                  gap: 18,
                }}
              >
                <article style={articleStyle}>
                  <h2 style={articleHeadingStyle}>Trend summary for {symbol}</h2>
                  <p style={articleTextStyle}>{longSummary.trendParagraph}</p>
                </article>

                <article style={articleStyle}>
                  <h2 style={articleHeadingStyle}>Momentum and stretch context</h2>
                  <p style={articleTextStyle}>{longSummary.momentumParagraph}</p>
                </article>

                <article style={articleStyle}>
                  <h2 style={articleHeadingStyle}>What traders may watch next</h2>
                  <p style={articleTextStyle}>{longSummary.structureParagraph}</p>
                </article>
              </section>

              <section
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <div style={statCardStyle}>
                  <div style={statLabelStyle}>MA50</div>
                  <div style={statValueStyle}>
                    {typeof lastMA50 === "number" ? `$${lastMA50.toFixed(2)}` : "—"}
                  </div>
                  <div style={statMetaStyle}>
                    {typeof ma50Pct === "number"
                      ? `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}% vs price`
                      : "Distance unavailable"}
                  </div>
                </div>

                <div style={statCardStyle}>
                  <div style={statLabelStyle}>MA200</div>
                  <div style={statValueStyle}>
                    {typeof lastMA200 === "number" ? `$${lastMA200.toFixed(2)}` : "—"}
                  </div>
                  <div style={statMetaStyle}>
                    {typeof ma200Pct === "number"
                      ? `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}% vs price`
                      : "Distance unavailable"}
                  </div>
                </div>

                <div style={statCardStyle}>
                  <div style={statLabelStyle}>RSI(14)</div>
                  <div style={statValueStyle}>
                    {typeof lastRsi === "number" ? lastRsi.toFixed(1) : "—"}
                  </div>
                  <div style={statMetaStyle}>
                    {typeof lastRsi === "number"
                      ? lastRsi >= 70
                        ? "Overbought zone"
                        : lastRsi <= 30
                        ? "Oversold zone"
                        : "Neutral zone"
                      : "Momentum unavailable"}
                  </div>
                </div>
              </section>

              <section
                style={{
                  marginTop: 22,
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 20,
                  padding: 20,
                  background:
                    "linear-gradient(180deg, rgba(9,13,20,0.92), rgba(7,10,16,0.96))",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "7px 12px",
                    borderRadius: 999,
                    background:
                      "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(16,185,129,0.08))",
                    border: "1px solid rgba(34,197,94,0.26)",
                    color: "#dcfce7",
                    fontWeight: 950,
                    letterSpacing: "0.08em",
                    fontSize: 12,
                  }}
                >
                  LEARN MORE
                </div>

                <h2
                  style={{
                    margin: "14px 0 0 0",
                    fontSize: 24,
                    lineHeight: 1.15,
                    letterSpacing: "-0.03em",
                  }}
                >
                  Learn the indicators behind this stock page
                </h2>

                <div className="learnGrid" style={{ marginTop: 16 }}>
                  <Link href="/learn/moving-averages" style={learnCardStyle("blue")}>
                    <div style={{ fontSize: 17, fontWeight: 950 }}>Moving Averages</div>
                    <div style={learnTextStyle}>
                      Learn how traders use MA50 and MA200 to judge medium and long-term structure.
                    </div>
                  </Link>

                  <Link href="/learn/rsi" style={learnCardStyle("green")}>
                    <div style={{ fontSize: 17, fontWeight: 950 }}>RSI Guide</div>
                    <div style={learnTextStyle}>
                      Understand how RSI highlights momentum, overbought conditions and oversold conditions.
                    </div>
                  </Link>

                  <Link href="/learn/macd" style={learnCardStyle("red")}>
                    <div style={{ fontSize: 17, fontWeight: 950 }}>MACD Guide</div>
                    <div style={learnTextStyle}>
                      Explore how MACD helps traders read momentum strength and weakening trend behaviour.
                    </div>
                  </Link>
                </div>
              </section>

              <section
  style={{
    marginTop: 22,
    border: "1px solid rgba(59,130,246,0.22)",
    borderRadius: 20,
    padding: 20,
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
    EXPLORE MORE
  </div>

  <h2
    style={{
      margin: "14px 0 0 0",
      fontSize: 24,
      lineHeight: 1.15,
      letterSpacing: "-0.03em",
    }}
  >
    Explore more stock opportunities
  </h2>

  <div
    style={{
      marginTop: 16,
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 12,
    }}
  >
    <Link href="/oversold-stocks-today" style={learnCardStyle("green")}>
      Oversold Stocks (Potential Rebounds)
    </Link>

    <Link href="/overbought-stocks-today" style={learnCardStyle("red")}>
      Overbought Stocks (Pullback Watch)
    </Link>

    <Link href="/stocks-ready-to-break-out" style={learnCardStyle("blue")}>
      Breakout Stocks
    </Link>

<Link href="/stocks-near-200-day-moving-average" style={learnCardStyle("yellow")}>
  Stocks Near 200-Day Moving Average
</Link>
  </div>
</section>

              <section
                style={{
                  marginTop: 22,
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 20,
                  padding: 20,
                  background:
                    "linear-gradient(180deg, rgba(9,13,20,0.92), rgba(7,10,16,0.96))",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "7px 12px",
                    borderRadius: 999,
                    background:
                      "linear-gradient(135deg, rgba(250,204,21,0.16), rgba(202,138,4,0.08))",
                    border: "1px solid rgba(250,204,21,0.26)",
                    color: "#fef3c7",
                    fontWeight: 950,
                    letterSpacing: "0.08em",
                    fontSize: 12,
                  }}
                >
                  FAQ
                </div>

                <h2
                  style={{
                    margin: "14px 0 0 0",
                    fontSize: 24,
                    lineHeight: 1.15,
                    letterSpacing: "-0.03em",
                  }}
                >
                  Common questions about {symbol}
                </h2>

                <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 17 }}>
                      Is this page a buy or sell recommendation?
                    </h3>
                    <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                      No. This page is designed to help you review chart structure, momentum and
                      technical context more quickly, but it is not personal financial advice.
                    </p>
                  </div>

                  <div>
                    <h3 style={{ margin: 0, fontSize: 17 }}>
                      Why can a stock look bullish and overbought at the same time?
                    </h3>
                    <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                      Strong trending stocks can still become stretched in the short term. That is
                      why trend traders and dip buyers can read the same chart differently.
                    </p>
                  </div>

                  <div>
                    <h3 style={{ margin: 0, fontSize: 17 }}>
                      What should I do next after reading this page?
                    </h3>
                    <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                      Open the full dashboard, review the chart in more detail, compare indicators,
                      and decide whether the setup still makes sense within your own process.
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}
        </section>
      </div>

<style>{`
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 28px 20px 40px;
  }

  .stockAnalysisHeroGrid {
    margin-top: 14px;
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
    gap: 18px;
    align-items: start;
  }

  .stockAnalysisSidePanel {
    display: grid;
    gap: 14px;
  }

  .stockAnalysisMiniGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .heroGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .learnGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        @media (max-width: 900px) {
          .wrap {
            padding: 18px 16px 34px !important;
          }
.stockAnalysisHeroGrid {
  grid-template-columns: 1fr !important;
}
          .heroGrid,
          .learnGrid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 820px) {
          .analysisTopUtilityRow {
            justify-content: stretch !important;
          }

          .analysisTopUtilityInner {
            width: 100%;
            justify-content: stretch !important;
            gap: 10px !important;
          }

          .analysisTopBtn {
            flex: 1 1 calc(50% - 5px);
            justify-content: center !important;
            min-height: 44px !important;
            padding: 11px 12px !important;
            font-size: 13px !important;
          }
        }

        @media (max-width: 560px) {
          .analysisTopUtilityInner {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            width: 100%;
          }

          .stockAnalysisMiniGrid {
  grid-template-columns: 1fr !important;
}

          .analysisTopBtn {
            width: 100%;
            min-width: 0;
          }
        }
      `}</style>
    </main>
  );
}

const topUtilityRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  marginBottom: 18,
};

function featuredMetricCardStyle(tone: "green" | "yellow" | "red"): React.CSSProperties {
  return {
    border:
      tone === "green"
        ? "1px solid rgba(34,197,94,0.26)"
        : tone === "red"
        ? "1px solid rgba(248,113,113,0.24)"
        : "1px solid rgba(250,204,21,0.24)",
    borderRadius: 20,
    padding: 18,
    background:
      tone === "green"
        ? "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(7,16,12,0.96))"
        : tone === "red"
        ? "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(18,10,10,0.96))"
        : "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(18,16,8,0.96))",
  };
}

const miniMetricCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.04)",
};

const miniMetricValueStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 24,
  lineHeight: 1.08,
  fontWeight: 950,
  letterSpacing: "-0.04em",
};

const miniMetricSubStyle: React.CSSProperties = {
  marginTop: 7,
  fontSize: 13,
  lineHeight: 1.5,
  opacity: 0.72,
};

const topUtilityInnerStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

function pillStyle(tone: "green" | "red" | "yellow"): React.CSSProperties {
  if (tone === "green") {
    return {
      display: "inline-flex",
      alignItems: "center",
      width: "fit-content",
      padding: "7px 12px",
      borderRadius: 999,
      border: "1px solid rgba(34,197,94,0.30)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
      color: "#dcfce7",
      fontSize: 12,
      fontWeight: 950,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    };
  }

  if (tone === "red") {
    return {
      display: "inline-flex",
      alignItems: "center",
      width: "fit-content",
      padding: "7px 12px",
      borderRadius: 999,
      border: "1px solid rgba(248,113,113,0.30)",
      background: "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(185,28,28,0.08))",
      color: "#fee2e2",
      fontSize: 12,
      fontWeight: 950,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    width: "fit-content",
    padding: "7px 12px",
    borderRadius: 999,
    border: "1px solid rgba(250,204,21,0.30)",
    background: "linear-gradient(135deg, rgba(250,204,21,0.16), rgba(202,138,4,0.08))",
    color: "#fef3c7",
    fontSize: 12,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
}

function topUtilityBtnStyle(
  type: "gold" | "green" | "red" | "blue"
): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 40,
    padding: "9px 14px",
    borderRadius: 14,
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
  };

  if (type === "gold") {
    return {
      ...base,
      border: "1px solid rgba(250,204,21,0.34)",
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(202,138,4,0.08))",
      color: "#fef3c7",
    };
  }

  if (type === "green") {
    return {
      ...base,
      border: "1px solid rgba(34,197,94,0.30)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
      color: "#dcfce7",
    };
  }

  if (type === "red") {
    return {
      ...base,
      border: "1px solid rgba(248,113,113,0.28)",
      background:
        "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(185,28,28,0.08))",
      color: "#fee2e2",
    };
  }

  return {
    ...base,
    border: "1px solid rgba(59,130,246,0.30)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
    color: "#dbeafe",
  };
}

const miniLabelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const articleStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 18,
  padding: 18,
  background: "rgba(255,255,255,0.03)",
};

const articleHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  fontWeight: 900,
  lineHeight: 1.15,
  letterSpacing: "-0.03em",
};

const articleTextStyle: React.CSSProperties = {
  margin: "12px 0 0 0",
  fontSize: 16,
  lineHeight: 1.8,
  opacity: 0.9,
};

const statCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  marginBottom: 8,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const statValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 900,
};

const statMetaStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.72,
  lineHeight: 1.6,
};

function learnCardStyle(
  tint: "blue" | "green" | "red" | "yellow"
): React.CSSProperties {
  if (tint === "green") {
    return {
      display: "block",
      textDecoration: "none",
      color: "#f1f5f9",
      borderRadius: 14,
      padding: 14,
      border: "1px solid rgba(34,197,94,0.20)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(16,185,129,0.04))",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
    };
  }

  if (tint === "red") {
    return {
      display: "block",
      textDecoration: "none",
      color: "#f1f5f9",
      borderRadius: 14,
      padding: 14,
      border: "1px solid rgba(239,68,68,0.20)",
      background:
        "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(127,29,29,0.04))",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
    };
  }
  
  if (tint === "yellow") {
  return {
    display: "block",
    textDecoration: "none",
    color: "#f1f5f9",
    borderRadius: 14,
    padding: 14,
    border: "1px solid rgba(250,204,21,0.20)",
    background:
      "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(202,138,4,0.05))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
    transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
  };
}

  return {
    display: "block",
    textDecoration: "none",
    color: "#f1f5f9",
    borderRadius: 14,
    padding: 14,
    border: "1px solid rgba(59,130,246,0.20)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(37,99,235,0.04))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
    transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
  };
}

const learnTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.72,
  lineHeight: 1.6,
};
