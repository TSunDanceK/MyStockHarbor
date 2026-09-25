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
    const points = await getDailyHistory("^GSPC", { caller: "spx-page" });

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
                The S&amp;P 500 closed at 7,744.64 on Friday, September 25 — up 0.53% on the day and about 2% for the week — leaving the index just 0.7% below its record closing high of 7,798.99 set on August 13. The rally came despite a sharp bond-market selloff that pushed the 10-year Treasury yield to roughly 5.2%, its highest level since 2007, after stronger-than-expected business-activity data lifted the odds of another Fed rate hike in October to about 70%. Stocks shrugged off the higher-yield backdrop as oil prices eased on reports of progress toward reopening the Strait of Hormuz, and President Trump's summit with China's Xi Jinping extended their trade truce into next year.
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
    the SPX closed at 7,744.64 on Friday, September 25 — a 0.53% gain that capped a roughly 2% weekly advance, leaving the index just 0.7% below its all-time high closing record of 7,798.99 set on Wednesday, August 13. The bigger story this week was the bond market, not a Fed meeting: the 10-year Treasury yield climbed to about 5.2%, its highest level since 2007, after S&amp;P Global's flash PMI showed the strongest business-activity growth in more than five years, lifting the market-implied odds of an October Fed rate hike to roughly 70% from about 55% a week earlier. Oil prices spiked on U.S.-Iran tension over the Strait of Hormuz before easing late in the week on reports both sides were discussing a phased deal, and President Trump's summit with China's Xi Jinping ended with their trade truce extended into January. Market breadth stayed narrow — only about a quarter of S&amp;P 500 members trade above their own 50-day moving average — even as the index itself closed the week within striking distance of a new record.
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
                    Rate pressure, not a rate decision
                  </div>
                  <div style={{ marginTop: 5, fontSize: 21, fontWeight: 950 }}>
                    Bond yields, not the Fed, drove this week's swings
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The SPX closed Friday, September 25 at 7,744.64, up 0.53% on the day and about 2% for the week, leaving it just 0.7% below its record close of 7,798.99 set on August 13. The catalyst wasn't a fresh Fed decision — it was the bond market. Strong PMI data pushed the 10-year Treasury yield to roughly 5.2%, its highest since 2007, and lifted the odds of an October rate hike to about 70%. Stocks absorbed the higher-yield backdrop better than bonds did, with easing oil prices and a calmer U.S.-China trade backdrop helping the index close the week near session highs.
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
                    Breadth narrowed further even as the index rallied
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                Market breadth weakened again this week — only about 25% of S&amp;P 500 members were trading above their own 50-day moving average as of midweek, down from roughly a third a week earlier, while about 45% held above their 200-day average. The CNN Fear &amp; Greed Index sits at 36, still in &ldquo;Fear&rdquo; territory, though it has ticked up from around 30 a week ago. A rally led by a narrower slice of the index, even a strong one, tends to be less durable than one built on broad participation.
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
                    Daily averages have converged just under the market
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                On the daily chart, the 50-day and 200-day moving averages have nearly converged around 7,681 — an unusual setup after weeks where the two lines sat further apart — and Friday's close moved the index back above both. RSI(14) sits in the high-40s to low-50s, a neutral reading with room to run in either direction before it flags as overbought or oversold. The weekly chart remains constructive, with price comfortably above its rising 50-week and 200-week averages, and the index now sits just 0.7% below its record high — a much narrower gap than a week or two ago.
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
                The S&amp;P 500 spent this week fighting the bond market rather than the Fed. It closed at 7,744.64 on Friday, up 0.53% on the day and roughly 2% for the week, and it now sits just 0.7% below its record closing high of 7,798.99 set on Wednesday, August 13. Sell-side year-end targets are little changed from a week ago: JPMorgan and Goldman Sachs are still around 8,000, UBS is near 8,100, and Ed Yardeni's more cautious 7,900 call — trimmed from 8,400 on the day of the Fed's September rate hike — is now within about 2% of where the index sits.
              </p>

              <p style={{ margin: 0 }}>
                The real driver of this week's volatility was the 10-year Treasury yield's climb toward 5.2%, its highest level since 2007, after S&amp;P Global's flash composite PMI showed the fastest pace of business-activity growth in more than five years. Stronger growth data cuts both ways for stocks: it reduces recession risk, but it also lifted the market-implied odds of another Fed rate hike in October to roughly 70%, up from about 55% the week before. Oil added to the pressure early in the week as U.S.-Iran tension over the Strait of Hormuz pushed crude prices higher, before easing back on reports the two sides were discussing a phased deal to reopen the strait and resume nuclear talks. Separately, President Trump's meeting with China's Xi Jinping in Washington extended their trade truce into January, removing one source of uncertainty markets had been pricing in.
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
                  <strong style={{ color: "#fca5a5" }}>Watch the bond market and the breadth:</strong> a 10-year Treasury yield at 5.2% — the highest since 2007 — is arguably a bigger swing factor for stocks right now than the Fed's own meeting calendar, since it raises the discount rate applied to future earnings and competes directly with equities for investor capital. Underneath the index-level gain, breadth remains a live concern: only about a quarter of S&amp;P 500 members trade above their own 50-day moving average, narrower than a week ago, while the daily 50-day and 200-day moving averages have converged to almost the same level near 7,681. RSI in the high-40s to low-50s is neutral, not stretched. From here, the path of long-term bond yields, any further easing in the Iran-related oil premium, and whether breadth can broaden out look more likely to move this market than any single headline.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                Zooming out to the <strong>weekly chart</strong>, the picture stays constructive: price sits comfortably above its rising 50-week and 200-week moving averages, both well below the current level, even though the daily chart spent much of the week testing its own 200-day average before Friday's rally moved back above it. This week's round trip — a bond-yield scare and an oil spike, followed by a broad Friday rally — is the kind of volatility a genuine uptrend can usually absorb, keeping the 7,900–8,100 range of targets from Yardeni, JPMorgan, Goldman Sachs and UBS as the more relevant markers for the rest of the year, provided long-term yields don't keep climbing and force a more serious reassessment.
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
                  Coming off a week dominated by the bond market rather than a Fed decision, the daily chart alone doesn't tell the full story. The weekly chart shows an index that remains comfortably above both its 50-week and 200-week moving averages, levels that sit well below the current ~7,700–7,750 range — this week's yield-driven volatility still has plenty of support beneath it before the longer-term trend would be seriously threatened.
                </p>

                <p style={{ margin: 0 }}>
                  The bigger picture: the S&amp;P 500 sits about 0.7% below the record closing high of 7,798.99 it set on August 13 — its closest approach to a new record since that day. Its daily 50-day and 200-day moving averages have converged to almost the same level, both near 7,681, after Friday's close moved the index back above both lines. The index remains within the range of year-end targets running from Yardeni's 7,900 up to UBS's 8,100.
                </p>

                <p style={{ margin: 0 }}>
                  The real question isn't whether the August record was real — a run of strong earnings and cooling data made it real, and this week's bounce back toward that level reinforces that the market still wants to extend the uptrend. It's whether a 10-year Treasury yield near 5.2%, the highest since 2007, keeps climbing and starts to compete more seriously with equities for investor capital, and whether breadth can broaden out from here rather than staying concentrated in a handful of AI names.
                </p>

                <p style={{ margin: 0 }}>
                  <strong>With the index back within 1% of its all-time high but bond yields at their highest level in nearly two decades, the primary uptrend gets the benefit of the doubt for now — provided the bond market doesn't force a repricing of stocks alongside it.</strong>
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
                  ["📈", "ATH", "record closing high of 7,798.99 set Wednesday, August 13, 2026 — the index dipped into the 7,600s in mid-September on the Fed's rate hike, then rallied back to close at 7,744.64 on Friday, September 25, just 0.7% below that record"],
                  ["⚠️", "Risk", "the 10-year Treasury yield climbed to about 5.2% this week, its highest level since 2007, after strong PMI data lifted the odds of an October Fed rate hike to roughly 70%; oil prices also spiked on U.S.-Iran tension over the Strait of Hormuz before easing on reports of a possible deal"],
                  ["🔎", "Weekly structure", "still bullish on the weekly chart, comfortably above its 50-week and 200-week moving averages; on the daily chart, the 50-day and 200-day moving averages have converged near 7,681, with RSI in the high-40s to low-50s (neutral)"],
                  ["🟡", "Current stance", "up solidly for the year and within 1% of a new record after a week driven more by bond yields than by equities themselves; the path of long-term yields and any further easing in oil are the next big catalysts"],
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
              The weekly chart shows the S&amp;P 500 pushing back toward its all-time highs after touching a record close of 7,798.99 on Wednesday, August 13. The index spent early-to-mid September consolidating and then pulling back toward the 7,600s after the Fed's first rate hike since 2023, before this week's rally — driven more by easing oil prices and a calmer trade backdrop than by any Fed news — lifted it to 7,744.64 by Friday, September 25, just 0.7% below the record. The weekly trend structure remains bullish, with the index comfortably above its rising 50-week and 200-week moving averages. On the daily chart, the 50-day and 200-day moving averages have converged to nearly the same level, around 7,681, with Friday's close back above both. RSI(14) in the high-40s to low-50s is neutral, and breadth — with roughly a quarter of members above their 50-day average — remains a swing factor to watch, with leadership still tilted toward a handful of AI-linked mega-caps.
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
                    SPX closes a full week below its daily 200-day moving average (roughly 7,681), rather than briefly testing it as it did earlier this week
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The 10-year Treasury yield pushes meaningfully above its current ~5.2% level — already the highest since 2007 — rather than stabilizing or easing back
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Market breadth (currently around 25% of members above their 50-day average) narrows further, or the CNN Fear &amp; Greed Index (currently 36, &ldquo;Fear&rdquo;) slides back toward its recent lows
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Progress toward reopening the Strait of Hormuz stalls and oil prices resume climbing, reviving the inflation and rate-hike concerns behind this week's bond selloff
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
                    Price clears its record closing high of 7,798.99 and pushes into the 7,900–8,100 range of year-end targets from Yardeni, JPMorgan, Goldman Sachs and UBS
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The 10-year Treasury yield eases back from its ~5.2% multi-year high, taking pressure off equity valuations
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The U.S. and Iran make further progress toward a deal over the Strait of Hormuz and oil prices continue to ease from this week's spike
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Breadth stops narrowing and Friday's broader participation carries into next week rather than fading
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
                The honest answer depends on timeframe. The weekly trend is still constructive — the SPX closed at 7,744.64 on Friday, September 25, just 0.7% below its record close of 7,798.99 set on August 13 — and the index shrugged off a genuine bond-market scare to post a roughly 2% weekly gain. Sell-side calls are little changed from last week: JPMorgan and Goldman Sachs still hold 8,000 targets and UBS is at 8,100, while Ed Yardeni's more cautious 7,900 call, trimmed from 8,400 on the day of the Fed's hike, is now within about 2% of where the index sits.
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
                  <strong style={{ color: "#93c5fd" }}>The nuance:</strong> this week showed how a rally can survive a real macro scare when it isn't really about the Fed. A 10-year Treasury yield at its highest level since 2007, driven by unexpectedly strong economic data rather than inflation fear alone, is arguably a bigger threat to valuations than one more rate hike would be on its own — yet stocks mostly shrugged it off, helped by easing oil prices and a calmer U.S.-China trade backdrop. Breadth remains narrow, with only about a quarter of members above their 50-day average, and leadership still concentrated in a handful of AI-linked mega-caps, even as the index itself closes in on a new record. None of that means the uptrend is over, but it's a reminder that a rally resting on a narrow base and rising bond yields has less margin for error than the index-level numbers alone suggest.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                The SPX near 7,700–7,750 is now closer to its all-time high than it has been in weeks, with sell-side targets still mostly pointing higher into next year. But with the 10-year Treasury yield at its highest level since 2007, breadth still narrow, and leadership concentrated in a handful of AI names, chasing a fresh record at this level looks less compelling than watching whether bond yields stabilize and participation broadens out first.
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
