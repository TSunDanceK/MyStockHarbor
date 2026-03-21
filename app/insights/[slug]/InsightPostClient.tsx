"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import StockPriceChart from "@/app/stock/[symbol]/StockPriceChart";

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

type InsightPostData = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol?: string | null;
  contentHtml: string;
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

export default function InsightPostClient({ post }: { post: InsightPostData }) {
  const symbol = post.symbol?.toUpperCase() ?? "";

  const [quote, setQuote] = useState<Quote | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [loadingMarket, setLoadingMarket] = useState(Boolean(symbol));
  const [marketError, setMarketError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setLoadingMarket(false);
      setMarketError(null);
      setQuote(null);
      setHistory([]);
      setCompanyName("");
      return;
    }

    let cancelled = false;

    async function load() {
      setLoadingMarket(true);
      setMarketError(null);

      try {
        const [quoteRes, historyRes, symbolsRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, {
            cache: "no-store",
          }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=400`, {
            cache: "no-store",
          }),
          fetch(`/api/symbols?q=${encodeURIComponent(symbol)}`, {
            cache: "no-store",
          }),
        ]);

        if (!quoteRes.ok) throw new Error("Quote fetch failed");
        if (!historyRes.ok) throw new Error("History fetch failed");

        const quoteData = (await quoteRes.json()) as Quote;
        const historyData = (await historyRes.json()) as { points: any[] };

        let name = "";
        if (symbolsRes.ok) {
          const symbolsData = (await symbolsRes.json()) as {
            results?: SymbolResult[];
          };
          const exact = (symbolsData.results ?? []).find(
            (r) => (r.symbol ?? "").toUpperCase() === symbol
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
        setMarketError("Could not load chart data for this insight.");
        setQuote(null);
        setHistory([]);
        setCompanyName("");
      } finally {
        if (!cancelled) setLoadingMarket(false);
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

  const lastClose = history.length ? history[history.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);

  const trend = useMemo(
    () =>
      trendLabel({
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      }),
    [lastClose, lastMA50, lastMA200]
  );

  const ma50Pct = pctFromBase(lastClose, typeof lastMA50 === "number" ? lastMA50 : null);
  const ma200Pct = pctFromBase(lastClose, typeof lastMA200 === "number" ? lastMA200 : null);

  const insightTag = useMemo(
    () => inferInsightTag(post.title, post.excerpt, post.contentHtml),
    [post.title, post.excerpt, post.contentHtml]
  );


  const chartSlice = history.slice(-240);
  const ma50Slice = ma50.slice(-240);
  const ma200Slice = ma200.slice(-240);

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
              View {symbol} Stock Page →
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
              style={{
                fontSize: 13,
                opacity: 0.68,
                fontWeight: 700,
              }}
            >
              {post.date}
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
              <div className="insightPriceValue" style={{ marginTop: 8, fontWeight: 950 }}>
                {typeof quote?.price === "number" ? `$${quote.price.toFixed(2)}` : "—"}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                {quote?.date && quote?.time
                  ? `${quote.date} ${quote.time}`
                  : symbol
                  ? loadingMarket
                    ? "Loading latest quote..."
                    : "Latest quote unavailable"
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
                {symbol ? trend : "Article"}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                {companyName || (symbol ? `${symbol} chart structure` : "Editorial insight")}
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
                 {symbol} chart with Daily MA50 and Daily MA200
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
                This insight includes a daily chart snapshot so the written
                breakdown can be compared against daily price structure, Daily MA50
                and Daily MA200.
              </p>

              {loadingMarket ? (
                <div style={{ marginTop: 16, opacity: 0.78 }}>
                  Loading chart snapshot…
                </div>
              ) : marketError ? ( 
                <div style={{ marginTop: 16, opacity: 0.78 }}>{marketError}</div>
              ) : chartSlice.length >= 2 ? (
                <>
                  <div style={{ marginTop: 16 }}>
                    <StockPriceChart
                      symbol={symbol}
                      data={chartSlice}
                      ma50={ma50Slice}
                      ma200={ma200Slice}
                      height={360}
                    />
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
                    <div style={smallStatCardStyle}>
                      <div style={smallStatLabelStyle}>Daily MA50</div>
                      <div style={smallStatValueStyle}>
                        {typeof lastMA50 === "number" ? `$${lastMA50.toFixed(2)}` : "—"}
                      </div>
                      <div style={smallStatMetaStyle}>
                        {typeof ma50Pct === "number"
                          ? `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}% vs price`
                          : "Distance unavailable"}
                      </div>
                    </div>

                    <div style={smallStatCardStyle}>
                      <div style={smallStatLabelStyle}>Daily MA200</div>
                      <div style={smallStatValueStyle}>
                        {typeof lastMA200 === "number" ? `$${lastMA200.toFixed(2)}` : "—"}
                      </div>
                      <div style={smallStatMetaStyle}>
                        {typeof ma200Pct === "number"
                          ? `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}% vs price`
                          : "Distance unavailable"}
                      </div>
                    </div>
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
                    <div className="insightChartActionsDesktop" style={{ fontSize: 13, opacity: 0.74 }}>
                      Compare this chart snapshot with the full dashboard, latest headlines, or TradingView.
                    </div>

                    <div className="insightChartActionsMobile" style={{ fontSize: 13, opacity: 0.78 }}>
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
  href={`/stock/${encodeURIComponent(symbol)}/news`}
  className="insightMobileOnly insightMobileButton"
  style={chartActionStyle("gold")}
>
  {symbol} headlines
</Link>

<Link
  href={`/stock/${encodeURIComponent(symbol)}`}
  className="insightMobileOnly insightMobileButton"
  style={chartActionStyle("blue")}
>
  {symbol} stock page
</Link>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 16, opacity: 0.78 }}>
                  Not enough chart data to show a snapshot.
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
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Continue exploring</div>

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

        .insightDesktopOnly {
          display: inline-flex;
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
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
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
  tint: "gold" | "green" | "blue"
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

function smallStatCardStyle(): React.CSSProperties {
  return {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    padding: "10px 10px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minHeight: 0,
  };
}

const smallStatLabelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  marginBottom: 8,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

function smallStatMetaStyle(): React.CSSProperties {
  return {
    marginTop: 2,
    fontSize: 11,
    opacity: 0.7,
  };
}

const smallStatMetaStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.72,
  lineHeight: 1.55,
};
