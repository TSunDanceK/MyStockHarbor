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
                The S&amp;P 500 closed at 7,712 on Friday, September 4 — about 1.1% below its record closing high of 7,798.99 set on August 13 — pulling back from Thursday's 7,747.71 close after a much-stronger-than-expected August jobs report reignited worries that the Federal Reserve may need to hold rates higher for longer rather than cut them. The index is still up roughly 13% for the year after rallying for most of the week as Treasury yields eased, before Friday's data reversed some of that relief — further Fed commentary and how policymakers weigh labor-market strength against inflation are the key things to watch from here.
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
    the SPX closed at 7,712 on Friday, September 4 — about 1.1% below its all-time high closing record of 7,798.99 set on Wednesday, August 13 — after a choppy week that ended on a sour note. Stocks rallied Monday through Thursday as Treasury yields retreated and a weaker dollar helped sentiment, with the index adding 1.1% on Thursday alone to close at 7,747.71. That reversed on Friday after the Labor Department reported 162,000 new jobs for August, far above the roughly 45,000–55,000 economists expected, pushing the odds of a Fed rate hike at the September meeting back up toward the 50–60% range and sending the 10-year Treasury yield to around 4.77–4.79%. Individual-investor sentiment (AAII) actually improved on the week, with bullish respondents climbing to 39.7% from 32.9% and bearish respondents easing to 37.6% from 44.4% — but under the surface, market breadth remains a concern after narrowing sharply through late August, with leadership still concentrated in a handful of mega-cap AI names.
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
                    Near record highs, whipsawed by a hot jobs report
                  </div>
                  <div style={{ marginTop: 5, fontSize: 21, fontWeight: 950 }}>
                    A strong labor market cuts both ways for stocks
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The SPX closed Friday, September 4 at 7,712, about 1.1% below its record close of 7,798.99 set on August 13. The index had rallied through midweek — gaining 1.1% on Thursday to 7,747.71 as Treasury yields eased — before August's jobs report (162,000 new positions versus roughly 45,000–55,000 expected) reignited concern that a resilient labor market could keep the Fed from cutting rates, or even push it toward a hike. Individual-investor sentiment (AAII) improved on the week even so, with bullish respondents rising to 39.7% from 32.9%.
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
                    Breadth has narrowed, and leadership stays concentrated
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                Market breadth thinned out sharply through late August, with roughly half of S&amp;P 500 members trading above their own 50-day moving average versus around 70% in mid-August. This week's rally looked somewhat broader as Treasury yields fell, but leadership still leans heavily on a handful of AI-linked mega-caps, and Friday's jobs-driven pullback is a reminder of how sensitive this market remains to a single data point.
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
                    Uptrend intact, but the cushion is thinner
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The S&amp;P 500 remains above its rising daily 50-day (roughly 7,700) and 200-day (roughly 7,645) moving averages, and the broader weekly trend structure stays bullish. RSI(14) has cooled from the overbought extreme near 74–75 touched in early August into a calmer, closer-to-neutral reading — but with the index still within about 1.1% of its record high, there's less room for error if sentiment turns.
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
                The S&amp;P 500's uptrend remains intact heading deeper into September, even after a bumpy finish to the week. The index closed at 7,712 on Friday, down modestly on the day, after touching 7,747.71 on Thursday — itself a 1.1% daily gain — and sits about 1.1% below its record closing high of 7,798.99 set on Wednesday, August 13. The index is up roughly 13% for the year. Sell-side targets have kept climbing this year: JPMorgan and Goldman Sachs have both raised their year-end 2026 targets to 8,000, while UBS has gone further, to 8,100 — all still above current levels.
              </p>

              <p style={{ margin: 0 }}>
                This week's swings were driven by a genuine shift in the interest-rate outlook rather than a one-off headline. Stocks rallied Monday through Thursday as Treasury yields retreated — helped along by a stronger yen weighing on the dollar — with Fed Governor Chris Waller signaling mid-week that he leaned toward holding rates steady rather than raising them. That relief evaporated on Friday when the Labor Department reported 162,000 new jobs for August, far above the roughly 45,000–55,000 expected, alongside an upward revision to July's payrolls from a decline to a modest gain. Traders responded by pushing the probability of a Fed rate hike at the September meeting back up into the 50–60% range, and the 10-year Treasury yield rose to around 4.77–4.79%.
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
                  <strong style={{ color: "#fca5a5" }}>Watch the Fed path and the breadth:</strong> a resilient labor market is good news for the economy but complicates the rate-cut case markets had been leaning on, and Friday's reaction shows how quickly sentiment can flip on a single data point. Underneath the index-level moves, breadth remains a live concern — market participation narrowed sharply through late August and leadership still skews toward a handful of AI-linked mega-caps. RSI has cooled from the overbought extreme near 74–75 touched in early August into a calmer, closer-to-neutral zone, and individual-investor sentiment (AAII) has actually firmed a little, with bullish respondents up to 39.7% from 32.9% the prior week. From here, additional Fed commentary, the next round of jobs and inflation data, and whether participation can broaden beyond mega-cap tech look more likely to move this market than any single headline.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                Zooming out to the <strong>weekly chart</strong>, the picture stays constructive: price sits comfortably above its rising 50-week and 200-week moving averages, both well below the current level, and the daily 50-day moving average (roughly 7,700) has remained above the 200-day (roughly 7,645) for months. This week's round trip — a yield-driven rally followed by a jobs-report pullback — is the kind of volatility a genuine uptrend can absorb, keeping the 8,000–8,100 targets from JPMorgan, Goldman Sachs and UBS as the more relevant markers for the rest of the year, provided the labor-market data doesn't force the Fed's hand.
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
                  Coming off a week that saw the S&amp;P 500 swing from a 1.1% one-day gain to a jobs-report-driven pullback, the daily chart alone doesn't tell the full story. The weekly chart shows an index that remains comfortably above both its 50-week and 200-week moving averages, levels that sit well below the current ~7,650–7,800 range — this week's volatility still has plenty of support beneath it before the longer-term trend would be threatened.
                </p>

                <p style={{ margin: 0 }}>
                  The bigger picture: the S&amp;P 500 is up roughly 13% for the year and sits only about 1.1% below the record closing high of 7,798.99 it set on August 13. Its daily 200-day moving average, at roughly 7,645, sits comfortably beneath current levels, and the index remains within reach of the 8,000 year-end targets from JPMorgan and Goldman Sachs and UBS's higher 8,100 target.
                </p>

                <p style={{ margin: 0 }}>
                  The real question isn't whether the August records were real — a run of cooling inflation data made them real, and this week's rally on falling Treasury yields reinforced that the market still wants to believe the Fed's next move is a cut, not a hike. It's whether a stronger-than-expected labor market like Friday's forces the Fed to hold rates higher for longer, especially with breadth still narrow and leadership concentrated in a handful of AI names.
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
                  ["📈", "ATH", "record closing high of 7,798.99 set Wednesday, August 13, 2026, with an intraday record near 7,817 — the index has since traded in a range and closed at 7,712 on Friday, September 4, about 1.1% below that record"],
                  ["⚠️", "Risk", "a much-stronger-than-expected August jobs report (162,000 vs. roughly 45,000–55,000 expected) revived fears the Fed could hold rates higher for longer, pushing the odds of a September rate hike back toward 50–60% and the 10-year Treasury yield to about 4.77–4.79%"],
                  ["🔎", "Weekly structure", "still bullish — price sits well above its 50-week and 200-week moving averages, with RSI cooling from an overbought reading in early August into a calmer, closer-to-neutral zone"],
                  ["🟡", "Current stance", "up roughly 13% for the year after a week that swung from a yield-driven rally to a jobs-report pullback; further Fed commentary and how policymakers read the labor market are the next big catalysts"],
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
              The weekly chart shows the S&amp;P 500 holding just below its all-time highs after touching a record close of 7,798.99 on Wednesday, August 13 and an intraday record near 7,817 — the index has spent the weeks since consolidating in a roughly 7,650–7,800 range, rallying to 7,747.71 by Thursday, September 3 before slipping back to 7,712 on Friday as a stronger-than-expected jobs report revived Fed rate-hike concerns. The broader trend structure remains bullish, with the index comfortably above its rising daily and weekly moving averages. Momentum has cooled from an overbought RSI near 74–75 in early August to a calmer, closer-to-neutral reading, while breadth — which narrowed sharply through late August — remains a swing factor to watch, with leadership still tilted toward a handful of AI-linked mega-caps.
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
                    SPX closes back below its rising daily 50-day moving average (roughly 7,700) on a weekly basis
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The Fed's September meeting delivers a rate hike, or clearly opens the door to one, rather than holding steady
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Treasury yields keep climbing on hawkish Fed commentary, with the 10-year pushing meaningfully above its current ~4.77–4.79% level
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Weekly close below the 200-day moving average (roughly 7,645) — the primary trend line that's held for months
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
                    Price reclaims the record high of 7,798.99 and pushes on toward the 8,000–8,100 year-end targets from JPMorgan, Goldman Sachs and UBS
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The Fed signals it's comfortable holding rates steady, or still leaning toward a cut, despite the strong jobs data
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Treasury yields stabilize or ease back from their post-jobs-report levels, taking pressure off equity valuations
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Breadth stops narrowing, with the share of members above their 50-day moving average climbing back toward the ~70% seen in mid-August
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
                The honest answer depends on timeframe. The weekly trend is still constructive — the SPX closed at 7,712 on Friday, September 4, only about 1.1% below its record close of 7,798.99 set on August 13, and up roughly 13% for the year — and the index rallied through most of the week before a stronger-than-expected jobs report triggered Friday's pullback. None of the bullish sell-side calls have been walked back; JPMorgan and Goldman Sachs both hold 8,000 targets, and UBS has gone further, to 8,100.
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
                  <strong style={{ color: "#93c5fd" }}>The nuance:</strong> this week's rally leaned heavily on the market's confidence that the Fed is done raising rates — and Friday showed how fast that confidence can wobble on a single strong jobs report. Breadth has narrowed sharply since mid-August, with leadership still concentrated in a handful of AI-linked mega-caps, even as individual-investor sentiment (AAII) has actually firmed, with bullish respondents up to 39.7% from 32.9% the prior week. A much-stronger-than-expected August jobs report and the 10-year Treasury yield's climb to around 4.77–4.79% are reminders that the path to lower rates isn't a straight line. None of that means the uptrend is over — the 200-day moving average is nowhere close — but it's a reminder that a rally built on rate-cut hopes is vulnerable to strong economic data, not just weak data.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                The SPX near 7,700–7,750 is sitting just below a fresh all-time high, up solidly for the year, with sell-side targets still pointing higher into next year. But with breadth narrowing, leadership still concentrated in a handful of AI names, and the Fed's next move now genuinely uncertain after a hot jobs report, chasing this specific level looks less compelling than waiting for either a broadening in participation or clearer signals from the Fed's September meeting.
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
