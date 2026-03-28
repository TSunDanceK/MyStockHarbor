import type { Metadata } from "next";
import Link from "next/link";
import AffiliateLink from "../../components/AffiliateLink";

export const metadata: Metadata = {
  title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
  description:
    "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, support levels, RSI, and MACD to make calmer investing decisions.",
  alternates: {
    canonical: "https://www.mystockharbor.com/markets/spx",
  },
  openGraph: {
    title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
    description:
      "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, support levels, RSI, and MACD to make calmer investing decisions.",
    url: "https://www.mystockharbor.com/markets/spx",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
    description:
      "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, support levels, RSI, and MACD to make calmer investing decisions.",
  },
};

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

export default function SPXPage() {
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
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
              MARKET ANALYSIS
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <Link href="/platforms" style={secondaryBtn()}>
                Compare Platforms
              </Link>
              <Link href="/learn" style={secondaryBtn()}>
                Learn Technical Analysis
              </Link>
            </div>
          </div>

          <section
            style={{
              borderRadius: 22,
              border: "1px solid rgba(59,130,246,0.22)",
              background:
                "linear-gradient(135deg, rgba(37,99,235,0.16), rgba(15,23,42,0.92))",
              padding: 22,
              boxShadow: "0 18px 40px rgba(0,0,0,0.24)",
            }}
          >
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
                maxWidth: 900,
              }}
            >
              S&amp;P 500 (SPX) Analysis (2026) – How to Read the Market Without
              Panicking
            </h1>

            <div
              style={{
                marginTop: 14,
                maxWidth: 860,
                fontSize: 19,
                lineHeight: 1.7,
                opacity: 0.92,
              }}
            >
              The S&amp;P 500 is one of the most important stock market indexes in
              the world. When it drops, many investors search for answers. This
              page explains what the SPX is, why markets pull back, what traders
              watch on the chart, and how to make calmer decisions.
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

            <div
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 16,
                border: "1px solid rgba(34,197,94,0.18)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(59,130,246,0.08))",
                fontSize: 14,
                lineHeight: 1.6,
                color: "#dbeafe",
                maxWidth: 860,
              }}
            >
              <strong>Simple setup:</strong> use <strong>TradingView</strong> to
              analyse SPX trend direction, key levels, RSI, and MACD. Then use a
              broker like <strong>eToro</strong> if you decide you want a simple
              route into investing.
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 14,
            }}
            className="spxTopGrid"
          >
            <div style={infoCardStyle()}>
              <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                WHAT IS SPX?
              </div>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>
                The main US market benchmark
              </div>
              <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.6 }}>
                The S&amp;P 500 tracks 500 large US companies and is often used as
                a snapshot of the overall stock market.
              </div>
            </div>

            <div style={infoCardStyle()}>
              <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                WHY DOES IT MATTER?
              </div>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>
                It shapes investor sentiment
              </div>
              <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.6 }}>
                When the SPX moves sharply, it usually reflects wider fear,
                confidence, economic expectations, or changes in risk appetite.
              </div>
            </div>

            <div style={infoCardStyle()}>
              <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                WHAT SHOULD YOU WATCH?
              </div>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>
                Trend, levels, and momentum
              </div>
              <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.6 }}>
                The most useful starting points are trend direction, support and
                resistance, RSI, MACD, and whether price is holding or breaking
                key levels.
              </div>
            </div>
          </section>

          <section style={infoCardStyle()}>
            <h2
              style={{
                margin: 0,
                fontSize: 30,
                letterSpacing: "-0.4px",
              }}
            >
              Why does the market go down?
            </h2>

            <div
              style={{
                marginTop: 12,
                opacity: 0.86,
                lineHeight: 1.7,
                fontSize: 16,
                maxWidth: 900,
              }}
            >
              Market declines are rarely caused by one single reason. They usually
              come from a mix of weaker sentiment, economic uncertainty, interest
              rate expectations, inflation fears, earnings disappointments, or a
              broader move away from risk.
            </div>

            <div
              style={{
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
              className="spxTwoCol"
            >
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(239,68,68,0.22)",
                  background: "rgba(239,68,68,0.06)",
                  padding: 16,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 10 }}>
                  Common reasons for a sell-off
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Interest rate changes or central bank comments
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Inflation staying higher than expected
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Weak earnings from large companies
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Recession fears or slower growth expectations
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Geopolitical stress or broad risk-off sentiment
                  </li>
                </ul>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(34,197,94,0.22)",
                  background: "rgba(34,197,94,0.06)",
                  padding: 16,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 10 }}>
                  What to remember
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Pullbacks are a normal part of market behaviour
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Sharp moves do not automatically mean a crash
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Structured analysis is better than emotional reacting
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Price action around key levels often matters more than headlines
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Good charting helps you see context more clearly
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section style={infoCardStyle()}>
            <h2
              style={{
                margin: 0,
                fontSize: 30,
                letterSpacing: "-0.4px",
              }}
            >
              How to analyse the S&amp;P 500 chart
            </h2>

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 14,
              }}
              className="spxAnalysisGrid"
            >
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                  1. TREND
                </div>
                <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900 }}>
                  Check the bigger direction
                </div>
                <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.55 }}>
                  Is SPX making higher highs and higher lows, or has that structure
                  broken down?
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                  2. LEVELS
                </div>
                <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900 }}>
                  Mark support and resistance
                </div>
                <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.55 }}>
                  Key zones often show where buyers step in or where rallies start
                  to struggle.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                  3. MOMENTUM
                </div>
                <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900 }}>
                  Use RSI and MACD
                </div>
                <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.55 }}>
                  Momentum tools can help you spot weakening moves, improving
                  strength, or possible trend exhaustion.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                  4. CONTEXT
                </div>
                <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900 }}>
                  Avoid reading one candle in isolation
                </div>
                <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.55 }}>
                  Look at the wider structure, not just one bad day. Context is
                  what helps you avoid panic decisions.
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 14,
                border: "1px solid rgba(59,130,246,0.22)",
                background: "rgba(59,130,246,0.08)",
                lineHeight: 1.6,
                color: "#dbeafe",
              }}
            >
              <strong>Why TradingView fits this page:</strong> it gives you a clean
              way to view SPX charts, add RSI and MACD, mark levels, and build
              confidence reading market structure.
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 0.8fr",
              gap: 16,
            }}
            className="spxDecisionGrid"
          >
            <div style={infoCardStyle()}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 30,
                  letterSpacing: "-0.4px",
                }}
              >
                What this means for beginners
              </h2>

              <div
                style={{
                  marginTop: 12,
                  opacity: 0.86,
                  lineHeight: 1.7,
                  fontSize: 16,
                }}
              >
                When markets fall, many beginners feel pressure to either sell in
                fear or buy impulsively. A better approach is to slow down, analyse
                the chart, understand the context, and decide what kind of investor
                you want to be.
              </div>

              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ opacity: 0.86, lineHeight: 1.6 }}>
                  <strong>If you want to learn chart analysis:</strong> use{" "}
                  <strong>TradingView</strong>.
                </div>
                <div style={{ opacity: 0.86, lineHeight: 1.6 }}>
                  <strong>If you want a simple broker route:</strong> use{" "}
                  <strong>eToro</strong>.
                </div>
                <div style={{ opacity: 0.86, lineHeight: 1.6 }}>
                  <strong>If you want to compare platforms first:</strong> visit the{" "}
                  <Link
                    href="/platforms"
                    style={{
                      color: "#93c5fd",
                      textDecoration: "none",
                      fontWeight: 800,
                    }}
                  >
                    platforms page
                  </Link>
                  .
                </div>
              </div>
            </div>

            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(250,204,21,0.20)",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.12), rgba(249,115,22,0.08))",
                padding: 18,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: "0.3px",
                  color: "#fde68a",
                }}
              >
                SIMPLE MARKET WORKFLOW
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                <div style={{ lineHeight: 1.55 }}>
                  <strong>1.</strong> Check SPX trend and key levels
                </div>
                <div style={{ lineHeight: 1.55 }}>
                  <strong>2.</strong> Use RSI and MACD for momentum context
                </div>
                <div style={{ lineHeight: 1.55 }}>
                  <strong>3.</strong> Avoid emotional reactions to one red day
                </div>
                <div style={{ lineHeight: 1.55 }}>
                  <strong>4.</strong> Invest only when your plan makes sense
                </div>
              </div>
            </div>
          </section>

          <section
            style={{
              borderRadius: 20,
              border: "1px solid rgba(34,197,94,0.22)",
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(59,130,246,0.08))",
              padding: 20,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 30,
                letterSpacing: "-0.4px",
              }}
            >
              Best next step
            </h2>

            <div
              style={{
                marginTop: 12,
                maxWidth: 860,
                lineHeight: 1.7,
                opacity: 0.9,
                fontSize: 16,
              }}
            >
              Use <strong>TradingView</strong> if you want to understand what the
              S&amp;P 500 is doing. Use <strong>eToro</strong> if you want a
              simpler route into investing after you have done your research.
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
        @media (max-width: 900px) {
          .spxTopGrid {
            grid-template-columns: 1fr !important;
          }

          .spxTwoCol {
            grid-template-columns: 1fr !important;
          }

          .spxAnalysisGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }

          .spxDecisionGrid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 760px) {
          .spxAnalysisGrid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
