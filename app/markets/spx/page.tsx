import type React from "react";
import type { Metadata } from "next";
import AffiliateLink from "../../components/AffiliateLink";
import SPXChartClient from "./SPXChartClient";
import { getDailyHistory } from "@/lib/server/historyCache";
import { getSpxMarketAnalysis } from "@/lib/ai-market";
import { buildMarketMoodScore } from "@/lib/market-mood";
import { rsiWilder as sharedRsiWilder, lastNum } from "@/lib/indicators";
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

// Mirrors the Feed<T> shape in lib/server/feedCache.ts, and for the same
// reason: a bare `catch { return [] }` here made a FAILED read
// indistinguishable from "the S&P 500 has no price history" -- a state that
// never occurs. Everything downstream then treated the failure as data. See
// claude/traps/return-type-cannot-express-failure.md.
type SpxChartRead = {
  points: Point[];
  // True when `points` reflects a real answer from upstream. False ONLY when
  // the read failed, in which case `points` is [] and means nothing.
  ok: boolean;
};

async function getSpxChartPoints(): Promise<SpxChartRead> {
  try {
    const points = await getDailyHistory("^GSPC");

    const mapped = points
      .map((point) => ({
        date: String(point?.date ?? ""),
        close: Number(point?.close),
        high: point?.high == null ? undefined : Number(point.high),
        low: point?.low == null ? undefined : Number(point.low),
        volume: point?.volume == null ? undefined : Number(point.volume),
      }))
      .filter((point) => point.date && Number.isFinite(point.close));

    // A successful read returning nothing is not a real market state -- the
    // S&P 500 has price history every trading day it has ever existed. Same
    // free monitor as warnIfImplausiblyEmpty in feedCache: it catches a parser
    // drifting off FMP's field names, or a silently changed schema, neither of
    // which surfaces as an error.
    if (mapped.length === 0) {
      console.warn(
        "[spx] history read SUCCEEDED but returned an empty series. The S&P 500 " +
          "always has history, so this is a parse or schema problem, not an " +
          "empty market."
      );
    }

    return { points: mapped, ok: true };
  } catch (err) {
    console.error(
      "[spx] history read failed -- page renders as unavailable, not as a " +
        "market with no data:",
      err
    );
    return { points: [], ok: false };
  }
}

function movingAverage(values: number[], window: number): number | null {
  if (values.length < window) return null;

  const slice = values.slice(-window);
  const sum = slice.reduce((total, value) => total + value, 0);

  return sum / window;
}

// This page's local rsiWilder was NOT Wilder's RSI. It took a flat mean of the
// last 14 differences and stopped -- no recursive smoothing -- which is a
// different indicator (closer to Cutler's RSI) wearing Wilder's name. On a
// 300-bar test series it returned 98.42 where the seven other rsiWilder copies
// in this repo all returned 74.06, agreeing with each other at every index.
//
// It fed buildMarketMoodScore's +/-5 RSI term, which is enough to cross a
// Fear/Neutral/Greed band boundary on the gauge this page renders.
//
// Now imported from lib/indicators.ts rather than re-fixed locally: an eighth
// copy of an algorithm the other seven already agree on is what allowed one of
// them to be wrong unnoticed. lastNum takes the final value, since this page
// wants a scalar and the shared function returns the full series.
function rsiWilder(values: number[], period = 14): number | null {
  return lastNum(sharedRsiWilder(values, period));
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
  const { points: spxChartPoints, ok: chartOk } = await getSpxChartPoints();
  const marketAnalysis = await getSpxMarketAnalysis();

  const closes = spxChartPoints.map((point) => point.close);
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const rsi = rsiWilder(closes, 14);

  // buildMarketMoodScore starts at 50 and only moves when it has real inputs,
  // so on a failed read every branch is skipped and it returns a confident
  // "50/100 -- Neutral". That is a specific market assessment derived from zero
  // data, rendered identically to a real one, on a page about the S&P 500.
  // Compute it only when the read actually answered.
  const marketMood = chartOk
    ? buildMarketMoodScore({ lastClose, ma50, ma200, rsi })
    : null;

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
                The S&amp;P 500 closed at 7,674.31 on Friday, August 21 — about 1.6% below its record closing high of 7,798.99 set on August 13 — after rising Treasury yields and a bond-market selloff snapped a three-week winning streak with the index's first weekly loss (-1.9%) since late July. The index is still up roughly 11–12% for the year, with the run-up to Fed Chair Warsh's Jackson Hole debut, the U.S.-Iran standoff, and Nvidia's upcoming earnings the key things to watch from here.
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

            {marketMood ? (
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
            ) : (
              // The read failed, so there is no mood to report. Saying so is
              // the only honest option: the alternative is a 50/100 Neutral
              // gauge that looks exactly like a real reading.
              <aside style={marketMoodCardStyle(50)}>
                <div style={statLabelStyle()}>Market mood</div>
                <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5, color: "rgba(241,245,249,0.72)" }}>
                  We couldn&apos;t load the S&amp;P 500 price history just now, so the
                  mood reading is unavailable. This is a problem on our side, not a
                  market with no data &mdash; it should return on a refresh.
                </div>
              </aside>
            )}

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
    the SPX closed at 7,674.31 on Friday, August 21 — about 1.6% below its all-time high closing record of 7,798.99 set on Wednesday, August 13 — after a rough week for bonds spilled over into stocks. Rising long-term Treasury yields, a spike in oil prices on U.S.-Iran tensions, and a disappointing sales update from Walmart combined to snap the index's three-week winning streak, with the S&amp;P 500 down 1.9% for the week even after Friday's late bounce. Treasury Secretary Scott Bessent's move to double the size of the government's debt buybacks (to at least $4 billion per operation) helped calm yields into the weekend. Sentiment has cooled alongside price: the CNN Fear &amp; Greed Index sits at 52.5 (&quot;Neutral&quot;), down from 57 a week earlier, and RSI has eased back to a neutral reading in the mid-50s after touching an overbought extreme near 74–75 in early August — a sign some of the summer's froth has come out of the market even as it holds close to record territory.
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
                    Near record highs, but pulling back
                  </div>
                  <div style={{ marginTop: 5, fontSize: 21, fontWeight: 950 }}>
                    First weekly loss in a month as bond yields bite
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The SPX closed Friday, August 21 at 7,674.31, about 1.6% below its record close of 7,798.99 set on August 13. Rising Treasury yields, an oil-price spike tied to U.S.-Iran tensions, and weak retail sales data from Walmart drove the index to a 1.9% weekly loss — its first down week after three straight weekly gains — even as Friday brought a partial bounce. Sentiment has cooled to &quot;Neutral&quot; on the CNN Fear &amp; Greed Index (52.5), down from 57 a week earlier.
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
                    Leadership still skews toward AI mega-caps
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                Breadth has softened somewhat alongside this week's pullback, with fewer S&amp;P 500 members holding above their own 200-day moving average than during the early-August highs — a reminder that the index's gains still lean heavily on a handful of AI-linked mega-caps. Nvidia's upcoming earnings report looks like the next big test of whether that leadership can broaden out or stays this narrow.
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
                    Uptrend intact, momentum back to neutral
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The S&amp;P 500 remains above its rising daily and weekly moving averages even after this week's pullback, with the broader trend structure still bullish. RSI(14) has eased to a neutral reading in the mid-50s, down from an overbought extreme near 74–75 touched in early August — suggesting this week's dip has worked off some of the summer's froth rather than signaling a trend change.
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
                The S&amp;P 500's uptrend remains intact heading into the week of August 24, though it just logged its first weekly loss in a month. The index closed Friday, August 21 at 7,674.31, up 0.43% on the day but down 1.9% for the week and about 1.6% below its record closing high of 7,798.99 set on Wednesday, August 13. The index is up roughly 11–12% for the year. Sell-side targets have kept climbing into the pullback: JPMorgan raised its year-end target to 8,000 (from 7,800) on August 11, citing a strong Q2 earnings season in which 86% of S&amp;P 500 companies beat EPS estimates and clearer signs that AI investment is translating into revenue growth. Goldman Sachs holds a matching 8,000 target, raised from 7,600 back in May on the same AI-earnings thesis.
              </p>

              <p style={{ margin: 0 }}>
                The trigger for this week's pullback was a bond-market story rather than an equity-specific one. Long-term Treasury yields moved higher through the week, reviving worries that elevated borrowing costs will weigh on already-rich valuations. Crude oil jumped as U.S.-Iran tensions escalated — with U.S. officials signaling further economic pressure on Iran — pushing WTI above $86 a barrel and adding an inflation wrinkle to the yield story. Walmart's disappointing comparable-sales update added to the unease around the health of the consumer. Treasury Secretary Scott Bessent tried to steady the bond market by doubling the size of debt buyback operations, from $2 billion to at least $4 billion per operation, and that move — along with an oversold bounce — helped stocks recover somewhat on Friday. None of this displaces the bigger picture: cooling July inflation data (headline CPI of 3.4%, core at 2.5%) was the catalyst that drove the index to its record close on August 13 in the first place, and that disinflation trend hasn't reversed.
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
                  <strong style={{ color: "#fca5a5" }}>Watch the breadth and the crowded trade:</strong> leadership remains concentrated in a handful of AI-linked mega-caps, and breadth has softened somewhat during this week's pullback as fewer members hold above their own 200-day moving average than at the early-August highs. Sentiment has cooled from &quot;Greed&quot; to &quot;Neutral&quot; on the CNN Fear &amp; Greed Index (52.5, down from 57), and RSI has eased from an overbought extreme near 74–75 in early August to a neutral mid-50s reading. From here, Fed Chair Warsh's Jackson Hole debut (August 27–29), developments in the U.S.-Iran standoff, and Nvidia's earnings report look more likely to move this market than another routine macro data print.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                Zooming out to the <strong>weekly chart</strong>, the picture stays constructive: price sits comfortably above its rising 50-week and 200-week moving averages, both well below the current level, and the daily 50-day moving average has remained above the 200-day for months. This week's 1.9% pullback is the kind of routine give-back a genuine three-week rally can absorb without threatening the broader uptrend, keeping the cluster of 8,000 year-end targets from JPMorgan and Goldman Sachs as the more relevant markers for the rest of the year.
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
                  Coming off a week that saw the S&amp;P 500 slip 1.9% — its first weekly loss in a month — the daily chart alone doesn't tell the full story. The weekly chart shows an index that remains comfortably above both its 50-week and 200-week moving averages, levels that sit well below the current ~7,650–7,700 range — this week's pullback has plenty of room before it would threaten the longer-term trend.
                </p>

                <p style={{ margin: 0 }}>
                  The bigger picture: the S&amp;P 500 is up roughly 11–12% for the year and sits only about 1.6% below the record closing high of 7,798.99 it set on August 13. Its daily 200-day moving average — unbroken for months — sits comfortably beneath current levels, and the index remains within reach of the 8,000 year-end targets now shared by JPMorgan and Goldman Sachs.
                </p>

                <p style={{ margin: 0 }}>
                  The real question isn't whether the early-August records were real — cooling inflation data made them real. It's whether the rally can shake off a bond-market scare once Fed Chair Warsh's Jackson Hole debut and the next read on U.S.-Iran tensions land, especially with breadth softening slightly and leadership still concentrated in a narrow group of AI names.
                </p>

                <p style={{ margin: 0 }}>
                  <strong>Until the 200-day moving average — unbroken for months and still hundreds of points below the market — is seriously tested, the primary uptrend still gets the benefit of the doubt.</strong>
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
                  ["📈", "ATH", "record closing high of 7,798.99 set Wednesday, August 13, 2026, with an intraday record near 7,817 — the index has since pulled back about 1.6%, closing at 7,674.31 on Friday, August 21"],
                  ["⚠️", "Risk", "rising Treasury yields, an oil-price spike tied to U.S.-Iran tensions, and weak retail sales data drove a 1.9% weekly loss — the index's first down week in a month — with breadth softening slightly and leadership still concentrated in AI mega-caps"],
                  ["🔎", "Weekly structure", "still bullish — price sits well above its 50-week and 200-week moving averages, with RSI back to a neutral mid-50s reading after touching overbought levels in early August"],
                  ["🟡", "Current stance", "up roughly 11–12% for the year after a cooling-inflation-driven summer rally; Fed Chair Warsh's Jackson Hole debut, the U.S.-Iran standoff, and Nvidia's earnings are the next big catalysts"],
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
              The weekly chart shows the S&amp;P 500 pulling back modestly from its all-time highs after touching a record close of 7,798.99 on Wednesday, August 13 and an intraday record near 7,817 — the index has since eased about 1.6% to 7,674.31 by Friday, August 21, logging its first weekly loss (-1.9%) in a month. The broader trend structure remains bullish, with the index comfortably above its rising daily and weekly moving averages. Momentum has cooled from an overbought RSI near 74–75 in early August to a calmer mid-50s reading, while breadth has softened slightly as fewer S&amp;P 500 members hold above their own 200-day moving average — a backdrop that still looks constructive heading into Fed Chair Warsh's Jackson Hole debut, even with leadership still concentrated in a handful of AI-linked mega-caps.
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
                    SPX closes back below its rising daily 50-day moving average on a weekly basis
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Treasury yields keep climbing and the bond-market selloff deepens rather than stabilizes, even after Treasury's expanded buybacks
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The U.S.-Iran standoff escalates further, sending oil prices — and inflation expectations — higher
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
                    Signs the rally keeps running
                  </div>
                </div>

                <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Price reclaims the record high of 7,798.99 and pushes on toward the 8,000 year-end targets from JPMorgan and Goldman Sachs
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Treasury yields stabilize or ease, taking pressure off equity valuations
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Nvidia's upcoming earnings reinforce the AI-monetization story that's been driving mega-cap leadership
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Market breadth stops narrowing, with a growing share of members holding above their 200-day moving average
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
                The honest answer depends on timeframe. The weekly trend is still constructive — the SPX closed at 7,674.31 on Friday, August 21, only about 1.6% below its record close of 7,798.99 set on August 13, and up roughly 11–12% for the year — but this week's 1.9% pullback, its first down week in a month, is a reminder the summer rally hasn't been a one-way street. None of the bullish sell-side calls have been walked back; JPMorgan and Goldman Sachs both hold year-end targets of 8,000.
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
                  <strong style={{ color: "#93c5fd" }}>The nuance:</strong> this week's pullback was a bond-market story — rising Treasury yields, an oil-price spike from U.S.-Iran tensions, and weak retail sales data — rather than a reassessment of the earnings backdrop that drove the index to records in the first place. Sentiment has cooled with price: the CNN Fear &amp; Greed Index sits at 52.5 (&quot;Neutral&quot;), down from 57 a week ago, and RSI has eased to a neutral mid-50s reading from an overbought extreme near 74–75 in early August. Market leadership still leans on a fairly narrow set of AI-linked mega-caps, and breadth has softened slightly during the pullback. None of that means the uptrend is over — the 200-day moving average is nowhere close — but it's a reminder that valuations can wobble when bond yields move, even with earnings still coming in strong. Fed Chair Warsh's Jackson Hole debut and Nvidia's earnings are the next real tests of that thesis.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                The SPX near 7,650–7,700 is sitting just below a fresh all-time high, up solidly for the year with real earnings growth doing work beneath the surface. But with breadth softening, leadership still concentrated in a handful of AI names, and bond-market volatility still unresolved heading into Jackson Hole, chasing this specific level looks less compelling than waiting for either a clearer stabilization in Treasury yields or confirmation from Fed Chair Warsh's speech and Nvidia's earnings later this month.
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
