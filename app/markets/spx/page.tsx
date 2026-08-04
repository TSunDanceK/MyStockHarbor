import type React from "react";
import type { Metadata } from "next";
import AffiliateLink from "../../components/AffiliateLink";
import SPXChartClient from "./SPXChartClient";
import { getDailyHistory } from "@/lib/server/historyCache";
import { getSpxMarketAnalysis } from "@/lib/ai-market";
import { buildMarketMoodScore } from "@/lib/market-mood";
import PageShareBar from "@/app/components/PageShareBar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
  description:
    "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
  alternates: {
    canonical: "https://www.mystockharbor.com/markets/spx",
  },
  openGraph: {
    title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
    description:
      "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
    url: "https://www.mystockharbor.com/markets/spx",
    siteName: "MyStockHarbor",
    type: "website",
    images: [
      {
        url: "https://www.mystockharbor.com/og-image-v2.png",
        width: 1200,
        height: 630,
        alt: "MyStockHarbor trading dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
    description:
      "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
    images: ["https://www.mystockharbor.com/og-image-v2.png"],
  },
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

async function getSpxChartPoints(): Promise<Point[]> {
  try {
    const points = await getDailyHistory("^GSPC");

    return points
      .map((point) => ({
        date: String(point?.date ?? ""),
        close: Number(point?.close),
        high: point?.high == null ? undefined : Number(point.high),
        low: point?.low == null ? undefined : Number(point.low),
        volume: point?.volume == null ? undefined : Number(point.volume),
      }))
      .filter((point) => point.date && Number.isFinite(point.close));
  } catch {
    return [];
  }
}

function movingAverage(values: number[], window: number): number | null {
  if (values.length < window) return null;

  const slice = values.slice(-window);
  const sum = slice.reduce((total, value) => total + value, 0);

  return sum / window;
}

function rsiWilder(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;

  let gain = 0;
  let loss = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += Math.abs(diff);
  }

  const avgGain = gain / period;
  const avgLoss = loss / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function primaryBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "13px 18px",
    borderRadius: 14,
    border: "1px solid rgba(34,197,94,0.45)",
    background:
      "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
    color: "#f8fafc",
    textDecoration: "none",
    fontWeight: 900,
    letterSpacing: "0.2px",
    minHeight: 48,
    boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
    whiteSpace: "nowrap",
  };
}

function secondaryBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "13px 18px",
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.35)",
    background: "rgba(59,130,246,0.12)",
    color: "#dbeafe",
    textDecoration: "none",
    fontWeight: 900,
    letterSpacing: "0.2px",
    minHeight: 48,
    whiteSpace: "nowrap",
  };
}

function infoCardStyle(): React.CSSProperties {
  return {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 18,
  };
}

function sectionCardStyle(): React.CSSProperties {
  return {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 18,
  };
}

function statLabelStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    opacity: 0.72,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };
}

function marketMoodCardStyle(score: number): React.CSSProperties {
  const tone = score >= 56 ? "green" : score <= 44 ? "red" : "yellow";

  return {
    borderRadius: 20,
    border:
      tone === "green"
        ? "1px solid rgba(34,197,94,0.30)"
        : tone === "red"
        ? "1px solid rgba(248,113,113,0.30)"
        : "1px solid rgba(250,204,21,0.30)",
    background:
      tone === "green"
        ? "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(7,16,12,0.96))"
        : tone === "red"
        ? "linear-gradient(135deg, rgba(248,113,113,0.14), rgba(18,10,10,0.96))"
        : "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(18,16,8,0.96))",
    padding: 18,
    minHeight: "auto",
    height: "fit-content",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
  };
}

function thermometerFillStyle(score: number): React.CSSProperties {
  const safeScore = Math.max(0, Math.min(100, score));

  return {
    position: "absolute",
    left: 7,
    right: 7,
    bottom: 7,
    height: `${Math.max(7, safeScore)}%`,
    borderRadius: 999,
    background:
      "linear-gradient(0deg, #ef4444 0%, #f97316 28%, #eab308 50%, #84cc16 72%, #22c55e 100%)",
    boxShadow: "0 0 18px rgba(34,197,94,0.35)",
  };
}

const overviewCardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

function overviewIconStyle(type: "green" | "red" | "blue"): React.CSSProperties {
  return {
    width: 44,
    height: 44,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    fontSize: 22,
    fontWeight: 950,
    background:
      type === "green"
        ? "rgba(34,197,94,0.18)"
        : type === "red"
        ? "rgba(239,68,68,0.18)"
        : "rgba(59,130,246,0.18)",
    border:
      type === "green"
        ? "1px solid rgba(34,197,94,0.34)"
        : type === "red"
        ? "1px solid rgba(239,68,68,0.34)"
        : "1px solid rgba(59,130,246,0.34)",
    color:
      type === "green"
        ? "#4ade80"
        : type === "red"
        ? "#f87171"
        : "#60a5fa",
  };
}

function themedOverviewCardStyle(type: "green" | "red" | "blue"): React.CSSProperties {
  return {
    borderRadius: 16,
    padding: 16,
    border:
      type === "green"
        ? "1px solid rgba(34,197,94,0.24)"
        : type === "red"
        ? "1px solid rgba(239,68,68,0.24)"
        : "1px solid rgba(59,130,246,0.24)",
    background:
      type === "green"
        ? "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(255,255,255,0.03))"
        : type === "red"
        ? "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(255,255,255,0.03))"
        : "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(255,255,255,0.03))",
  };
}


function insightCardStyle(type: "red" | "blue" | "yellow"): React.CSSProperties {
  return {
    borderRadius: 18,
    border:
      type === "red"
        ? "1px solid rgba(239,68,68,0.24)"
        : type === "blue"
        ? "1px solid rgba(59,130,246,0.24)"
        : "1px solid rgba(250,204,21,0.24)",
    background:
      type === "red"
        ? "linear-gradient(135deg, rgba(239,68,68,0.11), rgba(255,255,255,0.035))"
        : type === "blue"
        ? "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(255,255,255,0.035))"
        : "linear-gradient(135deg, rgba(250,204,21,0.12), rgba(255,255,255,0.035))",
    padding: 18,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
}

function insightIconStyle(type: "red" | "blue" | "yellow"): React.CSSProperties {
  return {
    width: 42,
    height: 42,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    fontSize: 21,
    background:
      type === "red"
        ? "rgba(239,68,68,0.16)"
        : type === "blue"
        ? "rgba(59,130,246,0.16)"
        : "rgba(250,204,21,0.16)",
    border:
      type === "red"
        ? "1px solid rgba(239,68,68,0.34)"
        : type === "blue"
        ? "1px solid rgba(59,130,246,0.34)"
        : "1px solid rgba(250,204,21,0.34)",
    boxShadow:
      type === "red"
        ? "0 0 18px rgba(239,68,68,0.16)"
        : type === "blue"
        ? "0 0 18px rgba(59,130,246,0.16)"
        : "0 0 18px rgba(250,204,21,0.16)",
  };
}

function sectionEyebrowStyle(type: "green" | "red" | "blue" | "yellow"): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color:
      type === "green"
        ? "#86efac"
        : type === "red"
        ? "#fca5a5"
        : type === "blue"
        ? "#93c5fd"
        : "#fde68a",
  };
}

export default async function SPXPage() {
  const spxChartPoints = await getSpxChartPoints();
  const marketAnalysis = await getSpxMarketAnalysis();

  const closes = spxChartPoints.map((point) => point.close);
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const rsi = rsiWilder(closes, 14);

  const marketMood = buildMarketMoodScore({
    lastClose,
    ma50,
    ma200,
    rsi,
  });

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: 24,
        }}
      >
        <PageShareBar
          url="https://www.mystockharbor.com/markets/spx"
          title="S&P 500 (SPX) Analysis | MyStockHarbor"
          text="S&P 500 market analysis — trend, moving averages, RSI and what's happening right now 📊 MyStockHarbor"
        />

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
              MARKET ANALYSIS
            </div>
          </div>

          <section
            className="spxHeroGrid"
            style={{
              borderRadius: 22,
              border: "1px solid rgba(59,130,246,0.22)",
              background:
                "linear-gradient(135deg, rgba(37,99,235,0.16), rgba(15,23,42,0.92))",
              padding: 22,
              boxShadow: "0 18px 40px rgba(0,0,0,0.24)",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 330px",
              gap: 22,
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(250,204,21,0.28)",
                  background: "rgba(250,204,21,0.12)",
                  color: "#fde68a",
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: "0.35px",
                }}
              >
                SPX GUIDE
              </div>

              <h1
                style={{
                  margin: "12px 0 0",
                  fontSize: 42,
                  lineHeight: 1.08,
                  letterSpacing: "-0.9px",
                  maxWidth: 760,
                  fontWeight: 500,
                }}
              >
                S&amp;P 500 (SPX) Analysis (2026) – What the Market Is Actually Doing Right Now
              </h1>

              <div
                style={{
                  marginTop: 14,
                  maxWidth: 760,
                  fontSize: 19,
                  lineHeight: 1.7,
                  opacity: 0.92,
                }}
              >
                The S&amp;P 500 enters this week at 7,489.72, Friday's close and still about 1.6% below its June 2 record close of 7,609.78, after a volatile prior week in which a hawkish Fed dissent and Middle East tensions gave way to a blowout Amazon earnings beat and the index's first winning week in three months. The longer-term uptrend, up roughly 9% for the year, remains intact, and this week's spotlight is squarely on the labor market, culminating in Friday's July nonfarm payrolls report.
              </div>

              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <AffiliateLink
                  href="/api/go/tradingview"
                  eventLabel="SPX Page Hero CTA TradingView"
                  style={primaryBtn()}
                >
                  Use TradingView for SPX Charts →
                </AffiliateLink>

                <AffiliateLink
                  href="/api/go/etoro"
                  eventLabel="SPX Page Hero CTA eToro"
                  style={secondaryBtn()}
                >
                  Visit eToro →
                </AffiliateLink>
              </div>


            </div>

            <aside style={marketMoodCardStyle(marketMood.score)}>
              <div style={statLabelStyle()}>Market mood</div>

              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "64px minmax(0, 1fr)",
                  gap: 14,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    minHeight: 230,
                    height: "100%",
                    display: "flex",
                    alignItems: "stretch",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: 34,
                      height: "100%",
                      minHeight: 210,
                      borderRadius: 999,
                      border: "3px solid rgba(255,255,255,0.48)",
                      background: "rgba(2,6,23,0.62)",
                      overflow: "hidden",
                      boxShadow: "0 0 24px rgba(255,255,255,0.10)",
                    }}
                  >
                    <div style={thermometerFillStyle(marketMood.score)} />
                  </div>

                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      width: 48,
                      height: 48,
                      borderRadius: 999,
                      border: "3px solid rgba(255,255,255,0.48)",
                      background:
                        marketMood.score >= 56
                          ? "#22c55e"
                          : marketMood.score <= 44
                          ? "#ef4444"
                          : "#eab308",
                      boxShadow:
                        marketMood.score >= 56
                          ? "0 0 20px rgba(34,197,94,0.45)"
                          : marketMood.score <= 44
                          ? "0 0 20px rgba(239,68,68,0.45)"
                          : "0 0 20px rgba(234,179,8,0.42)",
                    }}
                  />


                </div>

                <div>
                  <div
                    style={{
                      fontSize: 38,
                      lineHeight: 1,
                      fontWeight: 950,
                      letterSpacing: "-0.06em",
                    }}
                  >
                    {marketMood.score}/100
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 18,
                      fontWeight: 950,
                      color:
                        marketMood.score >= 56
                          ? "#86efac"
                          : marketMood.score <= 44
                          ? "#fecaca"
                          : "#fde68a",
                    }}
                  >
                    {marketMood.label}
                  </div>

                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: 13,
                      lineHeight: 1.55,
                      opacity: 0.82,
                    }}
                  >
                    MyStockHarbor mood read based on SPX trend, moving averages and RSI momentum.
                  </p>

                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: "1px solid rgba(255,255,255,0.12)",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 950,
                        letterSpacing: "0.08em",
                        opacity: 0.72,
                      }}
                    >
                      KEY DRIVERS
                    </div>

                    <div style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.86 }}>
                      • Price vs MA50 and MA200
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.86 }}>
                      • MA50 vs MA200 structure
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.86 }}>
                      • RSI momentum reading
                    </div>
                  </div>
                </div>
              </div>
            </aside>

<div
  style={{
    marginTop: 16,
    padding: "14px 16px",
    borderRadius: 16,
    border: "1px solid rgba(34,197,94,0.32)",
    background:
      "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(8,18,30,0.92))",
    fontSize: 15,
    lineHeight: 1.65,
    color: "#e5e7eb",
    maxWidth: "100%",
    gridColumn: "1 / -1",
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
  }}
>
  <div
    style={{
      width: 42,
      height: 42,
      borderRadius: 999,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      background: "rgba(34,197,94,0.18)",
      border: "1px solid rgba(34,197,94,0.34)",
      color: "#4ade80",
      fontSize: 22,
      boxShadow: "0 0 18px rgba(34,197,94,0.20)",
    }}
  >
    💡
  </div>

  <div>
    <strong style={{ color: "#4ade80", letterSpacing: "0.02em" }}>SIMPLE VIEW:</strong>{" "}
    the SPX heads into this week about 1.6% below its all-time high, sitting at Friday's close of 7,489.72. Last week was genuinely wild: Wednesday brought the index's worst single day since April — a hawkish Fed dissent (three regional presidents wanted a rate hike, not a cut), a spike in long-dated Treasury yields to their highest since 2007, and fresh Middle East missile tensions all hit at once — before a blowout Amazon earnings beat helped the index snap back sharply into its first winning week in three months. Market breadth has quietly gotten healthier too — around 72% of S&amp;P 500 members now trade above their own 200-day moving average, the best reading since December 2024. This week's calendar is loaded with labor-market data (ISM PMI, JOLTS, ADP, jobless claims) culminating in Friday's nonfarm payrolls report, the follow-up to June's disappointing 57,000-job reading, all while the index remains roughly 9% higher for the year.
  </div>
</div>
          </section>

          {marketAnalysis ? (
            <section
              style={{
                marginTop: 4,
                border: "1px solid rgba(59,130,246,0.22)",
                borderRadius: 18,
                padding: 18,
                background:
                  "linear-gradient(180deg, rgba(8,14,28,0.98), rgba(6,10,18,0.98))",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: "0.08em",
                  color: "#dbeafe",
                }}
              >
                MARKET OVERVIEW
              </div>

              <h2
                style={{
                  margin: "10px 0 0",
                  fontSize: 26,
                  letterSpacing: "-0.03em",
                }}
              >
                Current S&amp;P 500 market backdrop
              </h2>

              <p
                style={{
                  marginTop: 10,
                  opacity: 0.82,
                  lineHeight: 1.7,
                  maxWidth: 820,
                }}
              >
                {marketAnalysis.summary}
              </p>

              <div
                style={{
                  marginTop: 16,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
<div style={themedOverviewCardStyle("green")}>
  <div style={overviewCardHeaderStyle}>
    <div style={overviewIconStyle("green")}>↗</div>
    <div style={{ ...statLabelStyle(), color: "#4ade80", opacity: 1 }}>
      Bullish factors
    </div>
  </div>

  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
    {marketAnalysis.bullish.map((item) => (
      <div key={item} style={{ lineHeight: 1.6, opacity: 0.88 }}>
        • {item}
      </div>
    ))}
  </div>
</div>

<div style={themedOverviewCardStyle("red")}>
  <div style={overviewCardHeaderStyle}>
    <div style={overviewIconStyle("red")}>🛡</div>
    <div style={{ ...statLabelStyle(), color: "#f87171", opacity: 1 }}>
      Risk factors
    </div>
  </div>

  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
    {marketAnalysis.bearish.map((item) => (
      <div key={item} style={{ lineHeight: 1.6, opacity: 0.88 }}>
        • {item}
      </div>
    ))}
  </div>
</div>

<div style={themedOverviewCardStyle("blue")}>
  <div style={overviewCardHeaderStyle}>
    <div style={overviewIconStyle("blue")}>👁</div>
    <div style={{ ...statLabelStyle(), color: "#60a5fa", opacity: 1 }}>
      What to watch
    </div>
  </div>

  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
    {marketAnalysis.watch.map((item) => (
      <div key={item} style={{ lineHeight: 1.6, opacity: 0.88 }}>
        • {item}
      </div>
    ))}
  </div>
</div>

              </div>

              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
                Updated: {new Date(marketAnalysis.generatedAt).toLocaleString("en-GB")}
              </div>
            </section>
          ) : null}

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 14,
            }}
            className="spxTopGrid"
          >
            <div style={insightCardStyle("yellow")}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={insightIconStyle("yellow")}>📈</div>
                <div>
                  <div style={{ ...statLabelStyle(), color: "#fde68a", opacity: 1 }}>
                    Off the record high
                  </div>
                  <div style={{ marginTop: 5, fontSize: 21, fontWeight: 950 }}>
                    Sentiment still cautious
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The SPX closed last week at 7,489.72 — about 1.6% below its June 2 record close of 7,609.78 — after a week that included its worst single day since April. Sentiment gauges have stayed stuck in "Fear" territory for well over a week now, even though Friday's earnings-driven rally delivered the index's first winning week in three months heading into this week's jobs-heavy data slate.
              </div>
            </div>

            <div style={insightCardStyle("red")}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
<div style={insightIconStyle("red")}>
  <span
    style={{
      fontSize: 20,
      lineHeight: "20px",
      height: 20,
      display: "block",
      transform: "translateY(-1px)",
    }}
  >
    ⚠
  </span>
</div>
                <div>
                  <div style={{ ...statLabelStyle(), color: "#fca5a5", opacity: 1 }}>
                    Under the surface
                  </div>
                  <div style={{ marginTop: 5, fontSize: 21, fontWeight: 950 }}>
                    Breadth broadens out
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                Market breadth remains meaningfully improved: roughly 72% of S&amp;P 500 members now trade above their own 200-day moving average, the strongest reading since December 2024, up from a much narrower ~60% earlier this summer. Leadership has broadened beyond mega-cap AI names into software, financials, industrials, healthcare and consumer discretionary, even as semiconductor stocks stayed under pressure.
              </div>
            </div>

            <div style={insightCardStyle("blue")}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={insightIconStyle("blue")}>🔎</div>
                <div>
                  <div style={{ ...statLabelStyle(), color: "#93c5fd", opacity: 1 }}>
                    Weekly chart
                  </div>
                  <div style={{ marginTop: 5, fontSize: 21, fontWeight: 950 }}>
                    Uptrend still intact
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The S&amp;P 500 enters this week having reclaimed its daily 50-day moving average after briefly dipping below it during last Wednesday's selloff, and it remains comfortably above its 200-day moving average — a line it hasn't closed below in months. With the data-heavy week building toward Friday's payrolls report, the weekly chart's longer-term structure looks undisturbed for now.
              </div>
            </div>
          </section>

          <section
            style={{
              ...sectionCardStyle(),
              border: "1px solid rgba(59,130,246,0.22)",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(255,255,255,0.035))",
            }}
          >
            <div style={sectionEyebrowStyle("blue")}>
              <span aria-hidden="true">🌊</span>
              Market read
            </div>

            <h2 style={{ margin: "10px 0 0", fontSize: 30, letterSpacing: "-0.4px" }}>
              What's actually happening in the market right now?
            </h2>

            <div
              style={{
                marginTop: 14,
                opacity: 0.87,
                lineHeight: 1.75,
                fontSize: 16,
                maxWidth: 930,
                display: "grid",
                gap: 14,
              }}
            >
              <p style={{ margin: 0 }}>
                The S&amp;P 500 remains in a resilient 2026 uptrend, up roughly 9% year-to-date, despite a genuinely choppy prior week. Wall Street's targets still reflect confidence in the bigger picture: Citi raised its year-end target to <strong>8,100</strong> in June on AI-driven earnings optimism, Goldman Sachs sits at <strong>8,000</strong>, and Wells Fargo at <strong>7,950</strong> — though Bank of America has taken a more cautious stance at <strong>7,100</strong>, citing "too many red flags." The index set a record close of <strong>7,609.78 on June 2, 2026</strong>, then spent the following weeks consolidating and pulling back on AI-capex and geopolitical worries before closing out July at <strong>7,489.72</strong> — about 1.6% off that high, a level it carries into this new week.
              </p>

              <p style={{ margin: 0 }}>
                Last week had more than one driver, and they mostly cut against each other. Wednesday's FOMC meeting saw the Fed hold rates steady at 3.50%–3.75% for a fifth straight meeting, but three regional Fed presidents dissented in favor of a rate hike — the most hawkish dissent since 2016 — and long-dated Treasury yields spiked to multi-year highs (the 30-year topped 5.2%, its highest since 2007) as investors questioned new Fed Chair Kevin Warsh's inflation-fighting resolve. On the same day, intercepted missiles targeting US forces in the Middle East pushed oil sharply higher and sent the S&amp;P 500 down 1.51% to 7,316.15, its worst day since April. Friday told a very different story: Amazon surged roughly 15% on a strong cloud-computing beat, part of a Q2 earnings season where about 87% of reporting S&amp;P 500 companies have topped expectations with average year-over-year earnings growth near 22%. That rally pulled the index back to 7,489.72, its first winning week in three months, even though Apple fell 7.4% on soft guidance tied to AI-related component constraints. This week, the market's attention shifts from single-day headlines to a full slate of labor-market data — ISM Manufacturing and JOLTS early in the week, ADP employment and ISM Services midweek, then jobless claims and finally Friday's nonfarm payrolls report, the follow-through to June's soft 57,000-job print.
              </p>

              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(239,68,68,0.24)",
                  background:
                    "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(8,18,30,0.82))",
                  padding: 16,
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div style={overviewIconStyle("red")}>⚠️</div>
                <div style={{ lineHeight: 1.65 }}>
                  <strong style={{ color: "#fca5a5" }}>Watch the bond market and Friday's jobs report:</strong> the S&amp;P 500 is only about 1.6% off its highs, and breadth has actually gotten healthier — roughly 72% of members now trade above their 200-day moving average, the best reading since December 2024. The bigger swing factors now are the bond market and the labor market: 10-year Treasury yields near 4.7% and 30-year yields above 5.2% reflect real doubt about whether new Fed Chair Kevin Warsh can get inflation back to 2%, and Friday's nonfarm payrolls report — following June's disappointing 57,000-job reading — could either calm or reignite those doubts. If long-end yields keep climbing or the jobs data disappoints again, that could matter more to this rally than any single earnings report or geopolitical headline.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                Zooming out to the <strong>weekly chart</strong> smooths over most of this noise. The index remains solidly above its 200-day moving average — a level it has held for months — even though it briefly dipped below its 50-day moving average during Wednesday's selloff before reclaiming it by Friday. Market breadth is no longer the main worry it was earlier this summer: with around 72% of members now above their 200-day moving average, this year's advance looks meaningfully broader than it did even a few weeks ago, though the bond market, the Fed's policy path, and this week's employment data are now the more pressing swing factors to watch.
              </p>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1.15fr 0.85fr",
              gap: 16,
            }}
            className="spxContextGrid"
          >
            <div
              style={{
                ...sectionCardStyle(),
                border: "1px solid rgba(59,130,246,0.22)",
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.07), rgba(255,255,255,0.035))",
              }}
            >
              <div style={sectionEyebrowStyle("blue")}>
                <span aria-hidden="true">🧭</span>
                Timeframe context
              </div>

              <h2 style={{ margin: "10px 0 0", fontSize: 30, letterSpacing: "-0.4px" }}>
                Why the weekly chart still matters more
              </h2>

              <div
                style={{
                  marginTop: 12,
                  opacity: 0.86,
                  lineHeight: 1.75,
                  fontSize: 16,
                  display: "grid",
                  gap: 14,
                }}
              >
                <p style={{ margin: 0 }}>
                  After a genuinely volatile prior week — a hawkish Fed dissent and a Middle East scare on Wednesday, followed by an earnings-fueled rally on Friday — the daily chart briefly dipped below its 50-day moving average before reclaiming it, while the S&amp;P 500's weekly chart remains comfortably above its own 50-week and 200-week moving averages, levels that sit well below the current ~7,400–7,500 range. Short-term swings like that one have plenty of room before they'd threaten the longer-term trend, and this week's employment data will be the next real test of that resilience.
                </p>

                <p style={{ margin: 0 }}>
                  The bigger picture: despite a genuine mix of Fed-policy, bond-market and geopolitical worries, the index is still only about 1.6% below its all-time high, up roughly 9% for the year, and its 200-day moving average — unbroken for months — remains firmly beneath current levels.
                </p>

                <p style={{ margin: 0 }}>
                  The real question isn't whether volatility is showing up — clearly it is, with a hawkish Fed dissent, surging bond yields and Middle East tensions all in the mix recently. It's whether Friday's nonfarm payrolls report and the rest of this week's labor-market data show the economy holding up, the way earnings did last Friday, or whether a repeat of June's weak 57,000-job print forces a real test of the primary trend.
                </p>

                <p style={{ margin: 0 }}>
                  <strong>Until the 200-day moving average — unbroken for months — is seriously tested, the primary uptrend still gets the benefit of the doubt.</strong>
                </p>
              </div>
            </div>

            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(250,204,21,0.26)",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.13), rgba(249,115,22,0.08), rgba(8,13,23,0.96))",
                padding: 18,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              <div style={sectionEyebrowStyle("yellow")}>
                <span aria-hidden="true">💬</span>
                Current take
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {[
                  ["📈", "ATH", "record close of 7,609.78 on June 2, 2026; SPX now roughly 1.6% below that after closing last Friday, July 31, at 7,489.72"],
                  ["⚠️", "Risk", "a hawkish Fed dissent, a spike in long-dated Treasury yields, and Middle East missile tensions drove the index's worst day since April last Wednesday; Friday's nonfarm payrolls report is this week's next big test"],
                  ["🔎", "Weekly structure", "still bullish — price remains well above its 200-day and weekly moving averages, and breadth has broadened to roughly 72% of members above their 200-day MA"],
                  ["🟡", "Current stance", "up roughly 9% YTD entering a jobs-data-heavy week, after last week ended with the first winning week in three months on a strong Amazon earnings beat and broad Q2 earnings strength"],
                ].map(([icon, label, text]) => (
                  <div
                    key={label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "32px minmax(0, 1fr)",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "10px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(250,204,21,0.12)",
                        border: "1px solid rgba(250,204,21,0.22)",
                        fontSize: 15,
                      }}
                    >
                      {icon}
                    </div>
                    <div style={{ lineHeight: 1.55 }}>
                      <strong style={{ color: "#fde68a" }}>{label}:</strong> {text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section
            style={{
              ...sectionCardStyle(),
              border: "1px solid rgba(59,130,246,0.22)",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.07), rgba(255,255,255,0.035))",
            }}
          >
            <div style={sectionEyebrowStyle("blue")}>
              <span aria-hidden="true">📈</span>
              Weekly chart
            </div>

            <h2 style={{ margin: "10px 0 0", fontSize: 30, letterSpacing: "-0.4px" }}>
              Weekly SPX chart snapshot
            </h2>

            <div
              style={{
                marginTop: 12,
                opacity: 0.86,
                lineHeight: 1.7,
                fontSize: 16,
                maxWidth: 920,
              }}
            >
              The weekly chart shows the S&amp;P 500 recovering into the end of July after a genuinely volatile week — Wednesday's Fed-driven, geopolitically charged selloff followed by Friday's earnings-fueled rally — leaving the index about 1.6% below its June 2 record close as it enters this new week. Price briefly dipped below its daily 50-day moving average before reclaiming it, and its weekly structure — still comfortably above its 200-day and weekly moving averages — remains intact. Momentum sits in neutral-to-firm territory, well off the overbought extremes seen in early June, with market breadth at its healthiest reading since December 2024 heading into a data-heavy week capped by Friday's payrolls report.
            </div>

            <div style={{ marginTop: 18 }}>
              <SPXChartClient chartPoints={spxChartPoints} />
            </div>
          </section>

          <section
            style={{
              ...sectionCardStyle(),
              border: "1px solid rgba(255,255,255,0.12)",
              background:
                "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(255,255,255,0.035))",
            }}
          >
            <div style={sectionEyebrowStyle("yellow")}>
              <span aria-hidden="true">👁</span>
              What to watch
            </div>

            <h2 style={{ margin: "10px 0 0", fontSize: 30, letterSpacing: "-0.4px" }}>
              What should investors watch next?
            </h2>

            <div
              style={{
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
              className="spxTwoCol"
            >
              <div style={themedOverviewCardStyle("red")}>
                <div style={overviewCardHeaderStyle}>
                  <div style={overviewIconStyle("red")}>
                    <span
                      style={{
                        fontSize: 20,
                        lineHeight: "20px",
                        height: 20,
                        display: "block",
                        transform: "translateY(-1px)",
                      }}
                    >
                      ⚠
                    </span>
                  </div>
                  <div style={{ ...statLabelStyle(), color: "#f87171", opacity: 1 }}>
                    Signs the pullback is deepening
                  </div>
                </div>

                <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    SPX slips back below its daily MA50 (currently in the ~7,470–7,550 area) on a closing basis
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Friday's nonfarm payrolls report repeats June's weak 57,000-job print, or the unemployment rate climbs further
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Long-dated Treasury yields keep climbing — a 30-year yield meaningfully above 5.2% would add real pressure on equity valuations
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Weekly close below the 200-day moving average — the primary trend line that's held for months
                  </li>
                </ul>
              </div>

              <div style={themedOverviewCardStyle("green")}>
                <div style={overviewCardHeaderStyle}>
                  <div style={overviewIconStyle("green")}>↗</div>
                  <div style={{ ...statLabelStyle(), color: "#4ade80", opacity: 1 }}>
                    Signs the bull run resumes
                  </div>
                </div>

                <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Price holds above its daily MA50 and pushes back toward the 7,600 record area
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Friday's jobs report comes in close to Barclays' ~100,000 estimate without a fresh downside surprise
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Treasury yields stabilize or ease from their multi-year highs, easing pressure on richly valued growth stocks
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Market breadth keeps improving beyond the current ~72% of members above their 200-day MA
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section
            style={{
              ...sectionCardStyle(),
              border: "1px solid rgba(250,204,21,0.22)",
              background:
                "linear-gradient(135deg, rgba(250,204,21,0.08), rgba(255,255,255,0.035))",
            }}
          >
            <div style={sectionEyebrowStyle("yellow")}>
              <span aria-hidden="true">⚖</span>
              Balanced view
            </div>

            <h2 style={{ margin: "10px 0 0", fontSize: 30, letterSpacing: "-0.4px" }}>
              So is this a buying opportunity or a reason to be cautious?
            </h2>

            <div
              style={{
                marginTop: 14,
                opacity: 0.86,
                lineHeight: 1.75,
                fontSize: 16,
                maxWidth: 920,
                display: "grid",
                gap: 14,
              }}
            >
              <p style={{ margin: 0 }}>
                The honest answer depends on timeframe. The weekly trend is still constructive — the SPX is up roughly 9% year-to-date, and several Wall Street banks remain at 8,000 or higher for year-end (Goldman Sachs at 8,000, Citi at 8,100, Wells Fargo at 7,950), even though Bank of America has taken a more cautious 7,100 stance. None of the bullish targets have been walked back.
              </p>

              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(59,130,246,0.24)",
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(8,18,30,0.82))",
                  padding: 16,
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div style={overviewIconStyle("blue")}>🧭</div>
                <div style={{ lineHeight: 1.65 }}>
                  <strong style={{ color: "#93c5fd" }}>The nuance:</strong> sentiment has stayed stuck in "Fear" territory for well over a week now, even though the index is only about 1.6% off its all-time high and just posted its first winning week in three months. That gap between price action and sentiment is worth noting — it's arguably healthier than the Extreme Greed readings seen back in June, which themselves preceded a pullback. The improvement in market breadth (now roughly 72% of members above their 200-day moving average, the best since December 2024) is a genuine positive, but the hawkish Fed dissent and the spike in long-dated Treasury yields are a reminder that the path to the Fed's 2% inflation target is still unresolved under new leadership — and Friday's nonfarm payrolls report, following June's soft 57,000-job print, is the next data point that could shift the picture either way.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                The SPX at 7,489.72 is about 1.6% below its all-time high — not remotely a crisis level, and up solidly for the year with broadening participation beneath the surface. But with long-dated bond yields at multi-year highs, the Fed's inflation path still uncertain under new leadership, sentiment yet to catch up with the recent rebound, and a full week of labor-market data — including Friday's payrolls report — still to come, chasing new highs immediately looks less compelling than waiting for either bond yields to stabilize, a clean jobs report, or a cleaner test of the 200-day trend line.
              </p>
            </div>
          </section>

          <section
            style={{
              borderRadius: 20,
              border: "1px solid rgba(34,197,94,0.24)",
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08), rgba(8,13,23,0.96))",
              padding: 20,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <div style={sectionEyebrowStyle("green")}>
              <span aria-hidden="true">✅</span>
              Best next step
            </div>

            <h2 style={{ margin: "10px 0 0", fontSize: 30, letterSpacing: "-0.4px" }}>
              Check the weekly structure before making a decision
            </h2>

            <div
              style={{
                marginTop: 12,
                maxWidth: 900,
                lineHeight: 1.7,
                opacity: 0.9,
                fontSize: 16,
              }}
            >
              Use <strong>TradingView</strong> to study the SPX weekly chart yourself — look at where price sits relative to the MA50 and MA200, and check whether breadth is improving or deteriorating. Use <strong>eToro</strong> if you want a simpler route into the market once you've done that work.
            </div>

            <div
              style={{
                marginTop: 16,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <AffiliateLink
                href="/api/go/tradingview"
                eventLabel="SPX Bottom CTA TradingView"
                style={primaryBtn()}
              >
                Visit TradingView →
              </AffiliateLink>

              <AffiliateLink
                href="/api/go/etoro"
                eventLabel="SPX Bottom CTA eToro"
                style={secondaryBtn()}
              >
                Visit eToro →
              </AffiliateLink>
            </div>
          </section>
        </div>
      </div>

      <style>{`
        .topNavShowDesktop {
          display: inline;
        }

        .topNavShowMobile {
          display: none;
        }

        @media (max-width: 900px) {
          .spxHeroGrid {
            grid-template-columns: 1fr !important;
          }

          .spxTopGrid {
            grid-template-columns: 1fr !important;
          }

          .spxTwoCol {
            grid-template-columns: 1fr !important;
          }

          .spxContextGrid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 760px) {
          .topNavRow {
            display: grid !important;
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.05fr) 60px 60px !important;
            gap: 8px !important;
            align-items: stretch !important;
          }

          .topNavRow a {
            width: 100% !important;
            min-width: 0 !important;
            min-height: 40px !important;
            padding: 8px 10px !important;
            font-size: 12px !important;
            border-radius: 12px !important;
            gap: 6px !important;
            justify-content: center !important;
          }

          .topNavIconOnlyMobile {
            padding-left: 0 !important;
            padding-right: 0 !important;
          }

          .topNavHideOnMobile {
            display: none !important;
          }

          .topNavShowDesktop {
            display: none !important;
          }

          .topNavShowMobile {
            display: inline !important;
          }
        }
      `}</style>
    </main>
  );
}
