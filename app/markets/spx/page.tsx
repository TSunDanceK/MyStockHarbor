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
                The S&amp;P 500 closed at 7,637.76 on Thursday, September 17 — up 1.14% on the day — clawing back most of Wednesday's selloff after the Federal Reserve delivered its first interest-rate hike since 2023, lifting its target range by a quarter point to 3.75%–4.00%. The index sits about 2.1% below its record closing high of 7,798.99 set on August 13, after new Fed Chair Kevin Warsh's hawkish comments on inflation briefly knocked the Dow down more than 600 points on decision day. Major indexes were still on track for a down week even after Thursday's bounce, with the 10-year Treasury yield hovering near 5% and traders now watching for how much further the Fed intends to raise rates before year-end.
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
    the SPX closed at 7,637.76 on Thursday, September 17 — a 1.14% rebound that recovered most of the prior session's losses, leaving the index about 2.1% below its all-time high closing record of 7,798.99 set on Wednesday, August 13. The Federal Reserve raised its benchmark rate by a quarter point to a 3.75%–4.00% target range on Wednesday, September 16 — its first hike since 2023 — in a unanimous vote. New Fed Chair Kevin Warsh said policy needed to support a &ldquo;timelier return&rdquo; to the Fed&apos;s 2% inflation goal, comments markets read as hawkish; the S&amp;P 500 fell about 1% and the Dow dropped more than 600 points that day before Thursday's relief rally, helped by broad buying across technology and cyclical sectors. The Fed's own projections point to roughly another half-point of hikes before year-end and no cuts expected in 2027. The 10-year Treasury yield remains elevated near 4.9%–5%, and market breadth stayed weak — only around a third of S&amp;P 500 members trade above their own 50-day moving average — even though Thursday's advance was broad, with roughly half the index's members participating.
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
                    The Fed's first hike since 2023
                  </div>
                  <div style={{ marginTop: 5, fontSize: 21, fontWeight: 950 }}>
                    A hawkish rate hike jolted stocks, then a rebound
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The SPX closed Thursday, September 17 at 7,637.76, up 1.14% on the day but still about 2.1% below its record close of 7,798.99 set on August 13. On Wednesday, the Fed raised its benchmark rate a quarter point to 3.75%–4.00%, and new Chair Kevin Warsh's hawkish comment about a &ldquo;timelier return&rdquo; to 2% inflation sent the index down roughly 1% and the Dow down more than 600 points. Thursday's broad-based rally, led by technology and cyclical stocks, recovered most of that decline.
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
                Market breadth has narrowed further since the Fed decision — as of Thursday, only about 33% of S&amp;P 500 members were trading above their own 50-day moving average, and roughly 44% were above their own 200-day moving average, both weak readings. Thursday's rebound was reasonably broad, with about 259 of the index's 503 members advancing, led by technology (+2.25%), but one strong session isn't enough to repair weeks of narrowing leadership, and the CNN Fear &amp; Greed Index remains in &ldquo;Fear&rdquo; territory at a reading of 29.
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
                    Daily trend has flipped shakier, even as the weekly holds
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                On the daily chart, the picture has weakened: the 50-day moving average (around 7,622) has slipped below the 200-day moving average (around 7,690), and Thursday's close of 7,637.76 sits above the 50-day but still below the 200-day — a level the index was comfortably clear of only a few weeks ago. RSI(14) sits around 56, a neutral reading, neither overbought nor oversold. The weekly chart still looks more constructive, with price well above its rising 50-week and 200-week averages, but with the index about 2.1% below its record high, there's less cushion if the Fed's next moves or bond yields surprise to the downside.
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
                The S&amp;P 500 just lived through its first Fed decision under a new chair, and the index passed the test — barely. It closed at 7,637.76 on Thursday, up 1.14% on the day, after Wednesday's rate-hike selloff had pulled it lower, and it sits about 2.1% below its record closing high of 7,798.99 set on Wednesday, August 13. Sell-side targets are mixed: JPMorgan and Goldman Sachs had been holding year-end 2026 targets of 8,000, and UBS at 8,100, but Ed Yardeni cut his target from 8,400 to 7,900 on the day of the Fed decision, citing the recent backup in Treasury yields.
              </p>

              <p style={{ margin: 0 }}>
                This week's swings were driven by a genuine policy shock rather than a one-off headline. The Federal Reserve raised its benchmark rate by a quarter point to 3.75%–4.00% on Wednesday, September 16 — its first hike since 2023 — in a unanimous vote. New Fed Chair Kevin Warsh's comment that policy needed to support a &ldquo;timelier return&rdquo; to the Fed's 2% inflation target was read as hawkish, and the Fed's own projections point to roughly another half-point of hikes before year-end with no cuts expected in 2027. The decision also drew public criticism from President Trump, who called the Fed &ldquo;very hostile&rdquo; and &ldquo;very political&rdquo; and called for rates near 1% — a reminder that pressure on the Fed's independence is itself now something markets are pricing around. The S&amp;P 500 fell about 1% and the Dow dropped more than 600 points on decision day before Thursday's broad, risk-on rebound; the 10-year Treasury yield eased slightly to 4.934% but remains close to its highest levels since 2023.
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
                  <strong style={{ color: "#fca5a5" }}>Watch the Fed path and the breadth:</strong> a hike driven by a Fed chair signaling more tightening ahead is a different animal than one the market shrugs off as a one-time move — it raises the odds of further hikes weighing on valuations even as Thursday's rally showed the market can absorb one. Underneath the index-level moves, breadth remains a live concern: only about a third of S&amp;P 500 members trade above their own 50-day moving average, and the daily 50-day moving average has now slipped below the 200-day moving average, a shift from a few weeks ago when the longer-term line sat comfortably below the market. RSI near 56 is neutral, not stretched in either direction. From here, further Fed commentary, the path of Treasury yields near 5%, and whether breadth can broaden out look more likely to move this market than any single headline.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                Zooming out to the <strong>weekly chart</strong>, the picture stays more constructive: price sits comfortably above its rising 50-week and 200-week moving averages, both well below the current level, even though the daily chart shows the 50-day moving average (around 7,622) now under the 200-day (around 7,690). This week's round trip — a hawkish-hike selloff followed by a broad-based rally — is the kind of volatility a genuine uptrend can usually absorb, keeping the 7,900–8,100 range of targets from Yardeni, JPMorgan, Goldman Sachs and UBS as the more relevant markers for the rest of the year, provided the Fed's next moves and the path of bond yields don't force a more serious reassessment.
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
                  Coming off a week that saw the S&amp;P 500 fall on the Fed's hike, then rally back most of the way, the daily chart alone doesn't tell the full story. The weekly chart shows an index that remains comfortably above both its 50-week and 200-week moving averages, levels that sit well below the current ~7,600–7,700 range — this week's volatility still has plenty of support beneath it before the longer-term trend would be seriously threatened.
                </p>

                <p style={{ margin: 0 }}>
                  The bigger picture: the S&amp;P 500 sits about 2.1% below the record closing high of 7,798.99 it set on August 13. Its daily 200-day moving average, at roughly 7,690, now sits just above Thursday's 7,637.76 close — the first time in weeks the index has traded below that line rather than comfortably above it — while the 50-day average (around 7,622) has slipped beneath the 200-day. The index remains within the range of year-end targets running from Yardeni's newly-cut 7,900 up to UBS's 8,100.
                </p>

                <p style={{ margin: 0 }}>
                  The real question isn't whether the August records were real — a run of cooling data made them real, and Thursday's broad rally reinforced that the market still wants to believe this week's hawkish surprise was a one-time repricing rather than the start of a longer tightening cycle. It's whether the Fed's dot plot, which points to roughly another half-point of hikes before year-end, actually plays out, and whether breadth can broaden out from here rather than staying concentrated in a handful of AI names.
                </p>

                <p style={{ margin: 0 }}>
                  <strong>With the daily chart now testing its 200-day moving average for the first time in weeks, but the weekly chart still comfortably above its own long-term averages, the primary uptrend gets a more cautious benefit of the doubt than it did a few weeks ago.</strong>
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
                  ["📈", "ATH", "record closing high of 7,798.99 set Wednesday, August 13, 2026, with an intraday record near 7,817 — the index fell on the Fed's rate hike this week before rebounding to close at 7,637.76 on Thursday, September 17, about 2.1% below that record"],
                  ["⚠️", "Risk", "the Fed raised rates a quarter point to 3.75%–4.00% on September 16, its first hike since 2023, and new Chair Kevin Warsh's hawkish comments point to roughly another half-point of hikes before year-end; the 10-year Treasury yield remains near 4.9%–5%, its highest since 2023"],
                  ["🔎", "Weekly structure", "still bullish on the weekly chart, comfortably above its 50-week and 200-week moving averages, but the daily chart is weaker — the 50-day moving average has slipped below the 200-day, and Thursday's close sits just under the 200-day average, with RSI near 56 (neutral)"],
                  ["🟡", "Current stance", "still up solidly for the year after a week that swung from a hawkish-hike selloff to a broad Thursday rally; further Fed commentary and the path of Treasury yields are the next big catalysts"],
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
              The weekly chart shows the S&amp;P 500 holding just below its all-time highs after touching a record close of 7,798.99 on Wednesday, August 13 and an intraday record near 7,817 — the index has spent the weeks since consolidating, then sold off on Wednesday, September 16 as the Federal Reserve delivered its first rate hike since 2023, before a broad-based rally lifted it back to 7,637.76 by Thursday. The weekly trend structure remains bullish, with the index comfortably above its rising 50-week and 200-week moving averages. The daily chart is less clean: the 50-day moving average has slipped below the 200-day, and Thursday's close sits just beneath that 200-day line, a level the index had comfortably cleared for weeks. RSI(14) near 56 is neutral, and breadth — with roughly a third of members above their 50-day average — remains a swing factor to watch, with leadership still tilted toward a handful of AI-linked mega-caps.
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
                    SPX closes a full week below its daily 200-day moving average (roughly 7,690), rather than just briefly dipping under it as it did this week
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Fed officials' speeches or minutes confirm the dot plot's roughly half-point of additional hikes penciled in for the rest of 2026, rather than pushing back on it
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The 10-year Treasury yield pushes meaningfully above its recent ~4.9%–5% range, or market breadth (currently ~33% of members above their 50-day average) narrows further
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    SPX closes back below its daily 50-day moving average (roughly 7,622) after having reclaimed it on Thursday
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
                    Price reclaims its 200-day moving average (roughly 7,690) and pushes back toward the record high of 7,798.99 and the 7,900–8,100 range of year-end targets from Yardeni, JPMorgan, Goldman Sachs and UBS
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Upcoming Fed commentary leans toward pausing rather than confirming the dot plot's additional half-point of hikes penciled in for the rest of 2026
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The 10-year Treasury yield eases back from its ~4.9%–5% range, taking pressure off equity valuations
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Breadth stops narrowing and Thursday's broad, risk-on participation carries into next week rather than fading
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
                The honest answer depends on timeframe. The weekly trend is still constructive — the SPX closed at 7,637.76 on Thursday, September 17, about 2.1% below its record close of 7,798.99 set on August 13 — and the index clawed back most of a Fed-driven selloff in a single broad-based session. Sell-side calls are mixed but not broken: JPMorgan and Goldman Sachs still hold 8,000 targets and UBS is at 8,100, though Ed Yardeni trimmed his target from 8,400 to 7,900 the day of the Fed decision.
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
                  <strong style={{ color: "#93c5fd" }}>The nuance:</strong> this week showed how fast sentiment can swing on a real policy decision rather than just a data surprise. The Fed's first hike since 2023, paired with new Chair Kevin Warsh's hawkish tone and a dot plot pointing to more hikes ahead, briefly pulled the daily chart below its 200-day moving average for the first time in weeks — even as the weekly chart stayed comfortably above its own long-term averages. Breadth remains narrow, with only about a third of members above their 50-day average, and leadership still concentrated in a handful of AI-linked mega-caps, even after Thursday's broad-based bounce. The Fed's decision also drew unusually public criticism from President Trump, adding a layer of political uncertainty to the rate path. None of that means the uptrend is over, but it's a reminder that a rally built partly on hopes for easier policy is vulnerable when the Fed signals the opposite.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                The SPX near 7,600–7,700 is sitting a little further below its all-time high than it was before this week's Fed decision, with sell-side targets still mostly pointing higher into next year even after Yardeni's trim. But with breadth narrow, leadership still concentrated in a handful of AI names, and the Fed now signaling more hikes rather than the cuts many had hoped for, chasing this specific level looks less compelling than waiting for either a broadening in participation or clearer signals on how far the Fed intends to go.
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
