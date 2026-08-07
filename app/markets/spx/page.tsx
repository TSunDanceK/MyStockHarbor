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
                The S&amp;P 500 closed at a fresh record high of 7,757.64 on Friday, August 7, capping its best week since April with a roughly 3.6% weekly gain after a surprisingly weak July jobs report (payrolls fell by 23,000 versus forecasts for an 80,000 gain) eased fears the Fed would need to hike rates again in September. The index is now up more than 12% for the year, with the Fed's September rate decision and the tail end of Q2 earnings season the next catalysts on deck.
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
    the SPX just closed out its best week since April, finishing Friday at a record 7,757.64. The rally was set off by an unusual catalyst: July's jobs report showed the economy actually lost 23,000 jobs (economists expected an 80,000-job gain), and while a weak labor market isn't normally welcome news, investors read it as reducing the odds the Fed hikes rates again in September — those odds fell to roughly 44%, down from about 67% a week earlier. Treasury yields eased on the news, Q2 earnings season has been strong (roughly 87% of S&amp;P 500 companies have beaten estimates so far), and market breadth stayed healthy, with about 72% of S&amp;P 500 members trading above their own 200-day moving average. Not everything lines up bullishly, though: the index's RSI touched an overbought 74.5 earlier in the week, short interest in S&amp;P 500 stocks just hit a record 3.79% of free float as some investors bet against further gains, and the index has now cleared several banks' full-year 2026 targets months early. Next up: the tail end of Q2 earnings and the Fed's September policy decision.
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
                    Fresh record high
                  </div>
                  <div style={{ marginTop: 5, fontSize: 21, fontWeight: 950 }}>
                    Sentiment catches up to price
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The SPX closed Friday at a record 7,757.64, up roughly 3.6% for the week — its best since April — after July's jobs report badly missed expectations (payrolls fell 23,000 versus a forecast +80,000 gain), which investors read as lowering the odds of a September Fed rate hike. Sentiment has followed price higher: the CNN Fear &amp; Greed Index sits at 60 ("Greed"), a marked shift from the caution seen earlier this summer.
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
                    Breadth holds up at the highs
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                Unlike narrower rallies of the past, this move has real participation underneath it: roughly 72% of S&amp;P 500 members trade above their own 200-day moving average, the strongest reading since December 2024. The one flashing caution light is positioning — short interest in S&amp;P 500 stocks just climbed to a record 3.79% of free float, a sign some investors are hedging even as the index keeps grinding higher.
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
                    Uptrend still firmly intact
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The S&amp;P 500 enters next week trading comfortably above its daily 50-day (~7,578) and 200-day (~7,510) moving averages, with every major moving average from the 5-day out to the 200-day aligned bullishly. RSI(14) has eased back to the mid-60s after touching an overbought 74.5 earlier in the week — firm momentum without being as stretched as it was a few days ago.
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
                The S&amp;P 500 is in a genuine melt-up. The index closed Friday at a record 7,757.64, capping its best week since April with a roughly 3.6% weekly gain — the Nasdaq rose about 5.2% and the Dow about 3.0% over the same stretch, with the Dow also closing above 54,000 for the first time. The index is now up more than 12% for the year. Bank of America's own technical target for the S&amp;P 500 in 2026, 7,741, was reached on Wednesday, and the bank's technicians now see potential room to 8,000, 8,234 and even 8,541 — even as BofA's separate, more cautious fundamental strategist target of 7,100 now sits well behind the market entirely. Citi (8,100), Wells Fargo (7,950) and Goldman Sachs (8,000) remain the more representative Street targets for where the year finishes.
              </p>

              <p style={{ margin: 0 }}>
                The trigger for this week's leg higher was, oddly enough, weak economic data. Friday's July jobs report showed nonfarm payrolls fell by 23,000 versus expectations for an 80,000-job gain — one of the bigger misses in recent memory — while the unemployment rate actually ticked down to 4.1% from 4.2%. Rather than spooking investors, the soft print reduced the odds the Fed hikes rates again in September; futures markets now price roughly a 44% chance of a September hike, down from about 55% the prior session and 67% a week earlier. Treasury yields eased across the curve, though the 30-year, still near 5.19%, remains at some of its highest levels in years — a reminder that the debate over new Fed Chair Kevin Warsh's inflation-fighting credibility from earlier this summer hasn't fully gone away. Q2 earnings season has also helped: roughly 87% of S&amp;P 500 companies have beaten estimates so far, and Deutsche Bank raised its 2026 S&amp;P 500 earnings estimate to $358 per share (from $342) this week on the back of broad-based margin strength and continued AI-related capital spending.
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
                  <strong style={{ color: "#fca5a5" }}>Watch September and the crowded trade:</strong> the SPX's RSI touched an overbought 74.5 earlier in the week before easing to the mid-60s, and short interest in S&amp;P 500 stocks just hit a record 3.79% of free float — some investors are clearly hedging even as the index grinds higher. Bank of America itself flagged seasonal weakness from August through October, along with "overheated momentum" and geopolitical risk, as reasons this rally could pause. The next real test is the Fed's September meeting: another hawkish surprise, or a reversal in the current ~44% odds of a hike, could matter more to this rally than any single earnings report from here.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                Zooming out to the <strong>weekly chart</strong>, the picture is unambiguously bullish for now: price sits well above its 50-week and 200-week moving averages, both of which remain far below the current ~7,700–7,760 range, and every major moving average on the daily and weekly charts is aligned in a bullish configuration. Market breadth has broadened out meaningfully from where it stood earlier this summer, and this week's jobs-driven rally pushed the index past Bank of America's technical target and close to Wells Fargo's 7,950 mark, leaving Citi's 8,100 and Goldman's 8,000 as the more relevant markers for the rest of the year.
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
                  After a week that saw the S&amp;P 500 add roughly 3.6%, notch its best week since April, and close at a fresh record high on the back of a surprisingly weak jobs report, the daily chart alone doesn't tell the full story. The weekly chart shows an index that remains comfortably above both its 50-week and 200-week moving averages, levels that sit well below the current ~7,700–7,760 range — this week's move, as sharp as it was, has plenty of room before it would threaten the longer-term trend.
                </p>

                <p style={{ margin: 0 }}>
                  The bigger picture: the S&amp;P 500 is up more than 12% for the year, has now cleared several Wall Street banks' full-year 2026 targets months early, and its daily 200-day moving average (~7,510) — unbroken for months — sits firmly beneath current levels.
                </p>

                <p style={{ margin: 0 }}>
                  The real question isn't whether this week's rally was real — a roughly 3.6% weekly gain on a genuine catalyst (falling rate-hike odds) makes it real. It's whether the market can hold these levels once the initial relief from the jobs report fades, especially with RSI having touched overbought territory, short interest at a record high, and Bank of America itself warning of seasonally weak months ahead from August through October.
                </p>

                <p style={{ margin: 0 }}>
                  <strong>Until the 200-day moving average — unbroken for months and now roughly 250 points below the market — is seriously tested, the primary uptrend still gets the benefit of the doubt.</strong>
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
                  ["📈", "ATH", "fresh record close of 7,757.64 set Friday, August 7, 2026, capping the index's best week since April"],
                  ["⚠️", "Risk", "RSI touched an overbought 74.5 earlier in the week, short interest in S&P 500 stocks hit a record 3.79% of free float, and Bank of America is flagging seasonally weak months (Aug–Oct) ahead"],
                  ["🔎", "Weekly structure", "still bullish — price sits well above its 200-day (~7,510) and 200-week moving averages, and roughly 72% of members trade above their own 200-day MA"],
                  ["🟡", "Current stance", "up more than 12% for the year after a jobs-report-driven rally; September's Fed decision and the back half of Q2 earnings season are the next big catalysts"],
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
              The weekly chart shows the S&amp;P 500 breaking out to a fresh record high this week, closing Friday at 7,757.64 after a roughly 3.6% weekly advance — its best week since April — sparked by a surprisingly weak July jobs report that eased fears of a Fed rate hike. Every major daily and weekly moving average remains aligned bullishly, with the index comfortably above its 50-day (~7,578) and 200-day (~7,510) levels. Momentum has eased from an overbought RSI near 74.5 earlier in the week back to a firmer mid-60s reading, while market breadth stays healthy at roughly 72% of members above their 200-day moving average — a backdrop that looks constructive heading into September's Fed meeting.
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
                    Signs the rally is losing steam
                  </div>
                </div>

                <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    SPX closes back below its daily MA50 (currently near 7,578) on a weekly basis
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    September's FOMC decision surprises hawkish and rate-hike odds climb back above the current ~44%
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Short interest keeps climbing beyond its already-record 3.79% of free float, or a real bout of profit-taking hits mega-cap tech
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Weekly close below the 200-day moving average (~7,510) — the primary trend line that's held for months
                  </li>
                </ul>
              </div>

              <div style={themedOverviewCardStyle("green")}>
                <div style={overviewCardHeaderStyle}>
                  <div style={overviewIconStyle("green")}>↗</div>
                  <div style={{ ...statLabelStyle(), color: "#4ade80", opacity: 1 }}>
                    Signs the rally keeps running
                  </div>
                </div>

                <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Price holds above its daily MA50 and pushes on toward Bank of America's next resistance levels near 8,000 and 8,234
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The Fed's September meeting confirms rates on hold, keeping hike odds near or below the current ~44%
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Q2 earnings season finishes with the beat rate holding near its current ~87%
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
                The honest answer depends on timeframe. The weekly trend is unambiguously bullish — the SPX just closed at a fresh record high, up more than 12% for the year, and has already cleared Bank of America's technical target of 7,741. Citi (8,100), Wells Fargo (7,950) and Goldman Sachs (8,000) remain the more forward-looking Street targets for where 2026 finishes; none of the bullish calls have been walked back.
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
                  <strong style={{ color: "#93c5fd" }}>The nuance:</strong> this rally was set off by weak economic data (a 23,000-job decline), not strong data — a reminder that markets have largely been trading on "bad news is good news for the Fed" logic rather than pure economic strength. Sentiment has caught up to price too: the CNN Fear &amp; Greed Index sits at 60 ("Greed"), and RSI touched an overbought 74.5 earlier in the week. Short interest in S&amp;P 500 stocks just hit a record 3.79% of free float, and Bank of America itself is flagging seasonally weak months (August–October) and "overheated momentum" as reasons this run could pause. None of that means the uptrend is over — breadth is genuinely healthy and the 200-day moving average is nowhere close — but it does mean the easy, undervalued entry point of a few months ago is behind us.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                The SPX at 7,757.64 is at a fresh all-time high, up solidly for the year with real participation beneath the surface. But with RSI having touched overbought levels, short interest at a record, sentiment back in "Greed" territory, and Bank of America itself flagging seasonally weak months just ahead, chasing this specific week's move looks less compelling than waiting for either a routine pullback toward the rising 50-day moving average or confirmation from the Fed's September decision.
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
