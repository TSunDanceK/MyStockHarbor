"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

  let trendParagraph = `${companyLead} is currently showing a ${trend.toLowerCase()} structure, with ${trendScore.passed} of ${trendScore.total} core trend checks passing. The latest available price is ${priceText}.`;

  if (typeof ma50Pct === "number" && typeof ma200Pct === "number") {
    trendParagraph += ` Price is ${ma50Pct >= 0 ? "trading above" : "trading below"} its 50-day moving average by ${Math.abs(ma50Pct).toFixed(1)}% and ${ma200Pct >= 0 ? "above" : "below"} its 200-day moving average by ${Math.abs(ma200Pct).toFixed(1)}%.`;
  }

  let momentumParagraph = `${symbol} currently looks more balanced from a momentum perspective.`;
  if (typeof rsi === "number") {
    if (rsi >= 70) {
      momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests stronger momentum but also a more extended short-term state. This can sometimes happen when a stock has already made a strong move.`;
    } else if (rsi <= 30) {
      momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests weaker momentum and a more oversold short-term condition. Some traders may review this kind of setup for bounce-watch ideas rather than trend continuation.`;
    } else {
      momentumParagraph = `${symbol} currently has an RSI reading of ${rsi.toFixed(1)}, which suggests a more neutral momentum backdrop rather than an extreme stretched condition.`;
    }
  }

  let structureParagraph = `This MyStockHarbor stock page is designed to act as a starting point for chart review, not a buy or sell recommendation. Traders may use this page to judge whether ${symbol} is trending cleanly, pulling back into support, or moving in a more mixed structure before opening the full interactive dashboard.`;

  return {
    trendParagraph,
    momentumParagraph,
    structureParagraph,
  };
}

export default function StockSymbolPageClient({ symbol }: { symbol: string }) {
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
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=400`, { cache: "no-store" }),
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
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div className="wrap">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link href="/" style={topLinkStyle("blue")}>
              ← Dashboard
            </Link>
            <Link href="/pickers" style={topLinkStyle("red")}>
              Stock Pickers
            </Link>
            <Link href="/learn" style={topLinkStyle("green")}>
              Learn
            </Link>
          </div>

          <Link
            href={`/?symbol=${encodeURIComponent(symbol)}`}
            style={{
              ...topLinkStyle("blue"),
              fontWeight: 900,
            }}
          >
            Open Full Interactive Chart →
          </Link>
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

          <h1
            style={{
              margin: "14px 0 0 0",
              fontSize: 42,
              lineHeight: 1.04,
              letterSpacing: "-0.05em",
            }}
          >
            {symbol} Stock Analysis
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
            {companyName ? `(${symbol})` : ""}. Review trend structure, moving averages,
            momentum context and a direct route into the full MyStockHarbor dashboard.
          </p>

          {loading ? (
            <div style={{ marginTop: 18, opacity: 0.8 }}>Loading stock page…</div>
          ) : err ? (
            <div style={{ marginTop: 18, opacity: 0.8 }}>{err}</div>
          ) : (
            <>
              <div className="heroGrid" style={{ marginTop: 18 }}>
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 18,
                    padding: 18,
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Last price
                  </div>
                  <div style={{ marginTop: 8, fontSize: 34, fontWeight: 950 }}>
                    {typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "—"}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                    {quote?.date && quote?.time ? `${quote.date} ${quote.time}` : "Latest timestamp unavailable"}
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
                  <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Trend score
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 34,
                      fontWeight: 950,
                      color: toneColor(trendTone),
                    }}
                  >
                    {trendScore.passed}/{trendScore.total}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                    Based on price vs MA50, price vs MA200 and MA50 vs MA200.
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
                  <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Regime
                  </div>
                  <div style={{ marginTop: 8, fontSize: 34, fontWeight: 950 }}>
                    {trend}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                    A quick read on overall market structure.
                  </div>
                </div>
              </div>

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
                  INTERACTIVE CHART
                </div>

                <h2
                  style={{
                    margin: "14px 0 0 0",
                    fontSize: 26,
                    lineHeight: 1.12,
                    letterSpacing: "-0.03em",
                  }}
                >
                  Open the live dashboard chart for {symbol}
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
                  Use the full MyStockHarbor dashboard to explore the interactive chart,
                  indicator controls, timeframe switching, benchmarks and related market news.
                </p>

                <div
                  style={{
                    marginTop: 16,
                    borderRadius: 18,
                    border: "1px dashed rgba(59,130,246,0.24)",
                    background:
                      "linear-gradient(180deg, rgba(59,130,246,0.05), rgba(15,23,42,0.10))",
                    padding: "20px 18px",
                    display: "grid",
                    gap: 12,
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: 18 }}>
                    View {symbol} with the full chart engine
                  </div>
                  <div style={{ opacity: 0.76, lineHeight: 1.65 }}>
                    This SEO page gives the written stock summary Google can read. The dashboard
                    gives the full interactive charting experience for deeper analysis.
                  </div>

                  <div>
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
                      }}
                    >
                      Open {symbol} in Dashboard →
                    </Link>
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
                  <h2 style={articleHeadingStyle}>Momentum and structure context</h2>
                  <p style={articleTextStyle}>{longSummary.momentumParagraph}</p>
                </article>

                <article style={articleStyle}>
                  <h2 style={articleHeadingStyle}>What traders may watch</h2>
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

          .heroGrid,
          .learnGrid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}

function topLinkStyle(tint: "blue" | "green" | "red"): React.CSSProperties {
  if (tint === "green") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(34,197,94,0.45)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))",
      color: "#f0fdf4",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  if (tint === "red") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(239,68,68,0.45)",
      background:
        "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
      color: "#fef2f2",
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
    padding: "9px 13px",
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
  tint: "blue" | "green" | "red"
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
