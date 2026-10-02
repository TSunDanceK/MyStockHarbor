import type React from "react";
import type { Metadata } from "next";
import AffiliateLink from "../../components/AffiliateLink";
import SPXChartClient from "./SPXChartClient";
import { getDailyHistory } from "@/lib/server/historyCache";
import { getSpxMarketAnalysis } from "@/lib/ai-market";
import { buildMarketMoodScore } from "@/lib/market-mood";
import { rsiWilder as sharedRsiWilder, lastNum } from "@/lib/indicators";
import PageShareBar from "@/app/components/PageShareBar";
import { priceProviderFor } from "@/lib/server/marketData/provider";
import { readTiingoHistory } from "@/lib/server/marketData/read";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";

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
  /**
   * Which series `points` is. "SPY" on the Tiingo path: Tiingo does not
   * license index levels, so the chart is the SPDR S&P 500 ETF, and the page
   * says so under it (#553 CODE-B #42 §3, #563 COWORK #30/#31).
   */
  series: "^GSPC" | "SPY";
};

/**
 * THE TIINGO PATH (#563 COWORK #30), behind PRICE_PROVIDER_SPX: SPY's stored
 * EOD bars, read through B's adapter (one cached entry, 24 h safety TTL). Null
 * on no data, so the page keeps the FMP ^GSPC path: FMP stays this surface's
 * fallback until the owner flips it. ^GSPC is not requested on this path.
 */
async function getSpyPointsTiingo(): Promise<Point[] | null> {
  const eod = await readTiingoHistory("SPY").catch(() => null);
  const points = (eod?.bars ?? [])
    .map(([date, , high, low, close, volume]) => ({ date, close, high, low, volume }))
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0);
  return points.length ? points : null;
}

async function getSpxChartPoints(): Promise<SpxChartRead> {
  if (priceProviderFor("SPX") === "tiingo") {
    const spy = await getSpyPointsTiingo();
    if (spy) return { points: spy, ok: true, series: "SPY" };
  }
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

    return { points: mapped, ok: true, series: "^GSPC" };
  } catch (err) {
    console.error(
      "[spx] history read failed -- page renders as unavailable, not as a " +
        "market with no data:",
      err
    );
    return { points: [], ok: false, series: "^GSPC" };
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
  const { points: spxChartPoints, ok: chartOk, series: chartSeries } = await getSpxChartPoints();
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
                The S&amp;P 500 closed at 7,678.25 on Thursday, October 1 — up 0.34% on the day — leaving the index about 1.5% below its record closing high of 7,798.99 set on August 13. There's no single fresh catalyst behind the move: the index has spent the past several weeks consolidating just under its record as the 10-year Treasury yield pushed to roughly 5.3%, its highest level since 2002, and a federal government shutdown that began October 1 suspended the Labor Department's data releases, including the September jobs report. Markets have mostly treated the shutdown as noise rather than a growth shock, with chip and AI-linked stocks — lifted by OpenAI's roughly $500 billion valuation and a new Samsung/SK Hynix supply partnership — doing more to hold the index near its highs than any single policy decision.
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
    the SPX closed at 7,678.25 on Thursday, October 1 — a 0.34% gain that leaves the index about 1.5% below its all-time high closing record of 7,798.99 set on Wednesday, August 13. The bigger story continues to be the bond market, not any single headline: the 10-year Treasury yield has pushed to roughly 5.3%, its highest level since 2002, as a resilient economy and a tight labor market keep the Fed cautious about cutting further after its September 16 rate hike. A federal government shutdown that began October 1 has suspended official jobs and inflation data, but markets have largely shrugged it off as a procedural standoff rather than an economic threat. Market breadth has deteriorated further — only around 40% of S&amp;P 500 members now trade above their own 200-day moving average, down sharply from more than 70% in August — even as a handful of AI-linked mega-caps keep the index itself within striking distance of a new record.
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
                    Bond yields keep climbing, not the Fed
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.65 }}>
                The SPX closed Thursday, October 1 at 7,678.25, up 0.34% on the day, leaving it about 1.5% below its record close of 7,798.99 set on August 13. There was no FOMC meeting this week — the next one isn't until October 27-28 — so the catalyst is the bond market, not fresh Fed guidance. The 10-year Treasury yield has pushed to roughly 5.3%, its highest level since 2002, as resilient growth and a tight labor market keep rate-cut hopes in check. A government shutdown that began October 1 has frozen official data releases, adding uncertainty without, so far, triggering a real selloff.
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
                Market breadth has deteriorated sharply over the past six weeks — just over 40% of S&amp;P 500 members now trade above their own 200-day moving average, down from roughly 73% in mid-August, while only around a quarter hold above their 50-day average. The CNN Fear &amp; Greed Index sits at 27, in &ldquo;Fear&rdquo; territory and down from 30 the prior session. The index's resilience near its highs is increasingly a story about a handful of AI-linked mega-caps rather than broad-based strength, which historically makes a rally more vulnerable to a reversal.
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
                On the daily chart, the 50-day (around 7,696) and 200-day (around 7,676) moving averages sit within about 20 points of each other, and Thursday's close landed right between them. RSI(14) reads about 46, a neutral level with plenty of room to run before it would flag as overbought or oversold. The weekly chart remains constructive, with price still comfortably above its rising 50-week and 200-week averages, even as the daily chart spends this stretch consolidating only about 1.5% below the record high.
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
                The S&amp;P 500 has spent the past several weeks consolidating just under its record high rather than reacting to any single headline. It closed at 7,678.25 on Thursday, up 0.34% on the day, and now sits about 1.5% below its record closing high of 7,798.99 set on Wednesday, August 13. Sell-side year-end targets are little changed: JPMorgan and Goldman Sachs are still around 8,000, Citi and UBS sit near 8,100, and Ed Yardeni's more cautious 7,900 call — trimmed from 8,400 on September 16, the day of the Fed's last rate hike — is now within roughly 3% of where the index sits.
              </p>

              <p style={{ margin: 0 }}>
                The real driver has continued to be the 10-year Treasury yield, which pushed to roughly 5.3% this week — its highest level since 2002 — as resilient economic growth, a tight labor market, and the Fed's own balance-sheet runoff keep upward pressure on long-term borrowing costs. A federal government shutdown that began October 1 compounded the uncertainty by suspending the Labor Department's data releases, including the September jobs report, leaving investors with a weaker read on the economy just as yields test multi-decade highs. Even so, chip and AI-infrastructure names have continued to rally on company-specific news — OpenAI's roughly $500 billion valuation round and a new Samsung/SK Hynix partnership tied to its Stargate data-center buildout chief among them — which has done more to hold the index near its highs than any macro data point this week.
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
                  <strong style={{ color: "#fca5a5" }}>Watch the bond market and the breadth:</strong> a 10-year Treasury yield at 5.3% — the highest since 2002 — is a bigger swing factor for stocks right now than anything on the Fed's calendar, since it raises the discount rate applied to future earnings and competes directly with equities for investor capital. Underneath the index-level resilience, breadth is the clearest warning sign: just over 40% of S&amp;P 500 members trade above their own 200-day moving average, down from roughly 73% in mid-August, and only about a quarter hold above their 50-day average. RSI near 46 is neutral, not stretched. From here, the path of long-term bond yields, how long the government shutdown drags on, and whether breadth can broaden beyond a handful of AI names look more likely to move this market than any single headline.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                Zooming out to the <strong>weekly chart</strong>, the picture stays constructive: price sits comfortably above its rising 50-week and 200-week moving averages, both well below the current level, even though the daily chart has spent the past couple of weeks consolidating just under its record high rather than extending it. This stretch of sideways trading — rising bond yields and a government shutdown, absorbed without a disorderly selloff — is the kind of test a genuine uptrend can usually handle, keeping the 7,900–8,100 range of targets from Yardeni, JPMorgan, Goldman Sachs and UBS/Citi as the more relevant markers for the rest of the year, provided long-term yields don't keep climbing and force a more serious reassessment.
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
                  Coming off a stretch dominated by the bond market and a government shutdown rather than any Fed decision, the daily chart alone doesn't tell the full story. The weekly chart shows an index that remains comfortably above both its 50-week and 200-week moving averages, levels that sit well below the current ~7,650–7,700 range — this pullback still has plenty of support beneath it before the longer-term uptrend would be seriously threatened.
                </p>

                <p style={{ margin: 0 }}>
                  The bigger picture: the S&amp;P 500 sits about 1.5% below the record closing high of 7,798.99 it set on August 13 — a modest pullback rather than a correction. Its daily 50-day (around 7,696) and 200-day (around 7,676) moving averages sit within about 20 points of each other, with Thursday's close landing right between them. The index remains within the range of year-end targets running from Yardeni's 7,900 up to UBS and Citi's 8,100.
                </p>

                <p style={{ margin: 0 }}>
                  The real question isn't whether the August record was real — a run of strong earnings made it real, and the index's ability to hold within striking distance of it for six weeks reinforces that the market still wants to extend the uptrend. It's whether a 10-year Treasury yield near 5.3%, the highest since 2002, keeps climbing and starts to compete more seriously with equities for investor capital, and whether breadth can broaden out from here rather than staying concentrated in a handful of AI names while roughly 60% of the index trades below its 200-day average.
                </p>

                <p style={{ margin: 0 }}>
                  <strong>With the index still within 2% of its all-time high but bond yields at their highest level in roughly two decades, the primary uptrend gets the benefit of the doubt for now — provided the bond market doesn't force a repricing of stocks alongside it.</strong>
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
                  ["📈", "ATH", "record closing high of 7,798.99 set Wednesday, August 13, 2026 — the index has spent the six weeks since consolidating just below that record, closing at 7,678.25 on Thursday, October 1, about 1.5% below it"],
                  ["⚠️", "Risk", "the 10-year Treasury yield has climbed to about 5.3%, its highest level since 2002, as resilient growth and a tight labor market push back against rate-cut hopes; a government shutdown that began October 1 has also suspended official jobs and inflation data"],
                  ["🔎", "Weekly structure", "still bullish on the weekly chart, comfortably above its 50-week and 200-week moving averages; on the daily chart, the 50-day (~7,696) and 200-day (~7,676) moving averages sit close together, with RSI near 46 (neutral)"],
                  ["🟡", "Current stance", "up solidly for the year and within 2% of a new record, with the index's resilience increasingly reliant on a handful of AI-linked mega-caps while broader breadth keeps thinning; the path of long-term yields and the shutdown's duration are the next big catalysts"],
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
              The weekly chart shows the S&amp;P 500 holding just below its all-time highs after touching a record close of 7,798.99 on Wednesday, August 13. The index has spent the six weeks since largely consolidating in a roughly 7,600–7,750 range rather than extending the record, with the latest leg lower coming as the 10-year Treasury yield pushed to its highest level since 2002 and a federal government shutdown that began October 1 froze the usual flow of economic data. The index closed at 7,678.25 on Thursday, October 1, about 1.5% below the record. The weekly trend structure remains bullish, with the index comfortably above its rising 50-week and 200-week moving averages. On the daily chart, the 50-day (around 7,696) and 200-day (around 7,676) moving averages sit within about 20 points of each other. RSI(14) near 46 is neutral, and breadth — with just over 40% of members above their 200-day average, down from roughly 73% in mid-August — remains the clearest swing factor to watch, with leadership still concentrated in a handful of AI-linked mega-caps.
            </div>

            <div style={{ marginTop: 18 }}>
              <SPXChartClient chartPoints={spxChartPoints} symbol={chartSeries === "SPY" ? "SPY" : "SPX"} />
            </div>

            {/* THE CHART IS THE ETF ON THE TIINGO PATH, and says so (#563 COWORK
                #31 §3, wording approved there): the weekly copy above quotes
                index levels, a SPY chart runs at about a tenth of them. The
                credit is linked (COWORK #31 §5). */}
            {chartSeries === "SPY" ? (
              <p style={{ margin: "12px 0 0", fontSize: 13, opacity: 0.7, lineHeight: 1.6 }}>
                Chart shows the SPDR S&amp;P 500 ETF (SPY). Levels quoted in the text refer to the S&amp;P 500 index.{" "}
                <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{TIINGO_CREDIT}</a>
              </p>
            ) : null}
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
                    SPX closes a full week below its daily 200-day moving average (roughly 7,676), rather than hovering around it as it has this week
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The 10-year Treasury yield pushes meaningfully above its current ~5.3% level — already the highest since 2002 — rather than stabilizing or easing back
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Market breadth (currently just over 40% of members above their 200-day average, down from roughly 73% in mid-August) narrows further, or the CNN Fear &amp; Greed Index (currently 27, &ldquo;Fear&rdquo;) slides toward &ldquo;Extreme Fear&rdquo;
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The government shutdown drags on long enough to meaningfully delay economic data or weigh on Q4 earnings guidance, rather than resolving as a short-lived standoff
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
                    Price clears its record closing high of 7,798.99 and pushes into the 7,900–8,100 range of year-end targets from Yardeni, JPMorgan, Goldman Sachs, UBS and Citi
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The 10-year Treasury yield eases back from its ~5.3% multi-decade high, taking pressure off equity valuations
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    The government shutdown is resolved quickly, restoring the normal flow of jobs and inflation data
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Breadth stops narrowing and participation broadens out beyond a handful of AI-linked mega-caps
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
                The honest answer depends on timeframe. The weekly trend is still constructive — the SPX closed at 7,678.25 on Thursday, October 1, about 1.5% below its record close of 7,798.99 set on August 13 — and the index has absorbed a genuine bond-market and political shock (a government shutdown) without a disorderly selloff. Sell-side calls are little changed: JPMorgan and Goldman Sachs still hold 8,000 targets, UBS and Citi sit near 8,100, while Ed Yardeni's more cautious 7,900 call, trimmed from 8,400 on the day of the Fed's September hike, is now within roughly 3% of where the index sits.
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
                  <strong style={{ color: "#93c5fd" }}>The nuance:</strong> this stretch has shown how an index can hold near record highs even through a real bond-market and political shock. A 10-year Treasury yield at its highest level since 2002, driven by resilient growth rather than inflation fear alone, is arguably a bigger threat to valuations than the government shutdown itself — yet stocks have mostly absorbed both without a disorderly selloff, helped along by continued AI-infrastructure spending announcements. Breadth is the clearest warning sign: just over 40% of members trade above their 200-day average, down from roughly 73% in mid-August, and leadership remains concentrated in a handful of AI-linked mega-caps even as the index itself sits within striking distance of a new record. None of that means the uptrend is over, but it's a reminder that a rally resting on a narrowing base and rising bond yields has less margin for error than the index-level numbers alone suggest.
                </div>
              </div>

              <p style={{ margin: 0 }}>
                The SPX near 7,650–7,700 remains within striking distance of its all-time high, with sell-side targets still mostly pointing higher into next year. But with the 10-year Treasury yield at its highest level since 2002, breadth near its weakest point since the spring, and leadership concentrated in a handful of AI names, chasing a fresh record at this level looks less compelling than watching whether bond yields stabilize, the shutdown gets resolved, and participation broadens out first.
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
