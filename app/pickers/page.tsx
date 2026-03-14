import type { Metadata } from "next";
import Link from "next/link";
import PickersClient from "./PickersClient";

export const metadata: Metadata = {
  title: "Stock Screener Ideas: Oversold, Overbought, Divergence, Dip Buys & Breakouts | MyStockHarbor",
  description:
    "Find stock ideas using signal-based filters including oversold setups, overbought setups, divergence scans, buy-the-dip candidates and breakout stocks. Open any symbol directly in the MyStockHarbor dashboard.",
  alternates: {
    canonical: "/pickers",
  },
  openGraph: {
    title: "Stock Screener Ideas | MyStockHarbor",
    description:
      "Browse stock ideas by setup: oversold, overbought, divergence, dip buys and breakouts.",
    url: "/pickers",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Screener Ideas | MyStockHarbor",
    description:
      "Browse stock ideas by setup: oversold, overbought, divergence, dip buys and breakouts.",
  },
};

const linkCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.04)",
  textDecoration: "none",
  color: "#f1f5f9",
  display: "block",
};

const greySectionStyle: React.CSSProperties = {
  marginTop: 24,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 18,
  padding: 22,
  background: "rgba(255,255,255,0.03)",
  maxWidth: 980,
};

const signalCardBaseStyle: React.CSSProperties = {
  borderRadius: 14,
  padding: "16px 18px",
  minHeight: 104,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  textAlign: "left",
};

export default function PickersPage() {
  return (
    <main
      style={{
        padding: "40px 20px 72px",
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ maxWidth: 760 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.05)",
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                opacity: 0.9,
              }}
            >
              Stock Ideas Scanner
            </div>

            <h1
              style={{
                margin: "16px 0 0",
                fontSize: 40,
                lineHeight: 1.05,
                letterSpacing: "-0.04em",
              }}
            >
              Find Your Next Stock
            </h1>

            <p
              style={{
                marginTop: 14,
                fontSize: 17,
                lineHeight: 1.7,
                opacity: 0.86,
                maxWidth: 760,
              }}
            >
              This page groups live stock ideas by technical setup so you can
              quickly scan for oversold stocks, overbought stocks, divergence
              setups, buy-the-dip candidates and breakout stocks. Click any
              symbol to open it inside the MyStockHarbor dashboard and review
              the chart in more detail.
            </p>
          </div>

          <Link
            href="/"
            style={{
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.18)",
              textDecoration: "none",
              color: "#f1f5f9",
              fontWeight: 900,
              background: "rgba(255,255,255,0.06)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>

        <section
          style={{
            marginTop: 24,
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 18,
            padding: 18,
            background:
              "linear-gradient(180deg, rgba(12,18,32,0.96), rgba(8,12,24,0.98))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              alignItems: "stretch",
            }}
          >
            <div
              style={{
                ...signalCardBaseStyle,
                border: "1px solid rgba(34,197,94,0.35)",
                background:
                  "linear-gradient(180deg, rgba(6,78,59,0.34), rgba(6,46,33,0.5))",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 15,
                  color: "#ecfdf5",
                }}
              >
                Green Overall Signal
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "rgba(236,253,245,0.84)",
                  maxWidth: 260,
                }}
              >
                Oversold-leaning stocks that may be setting up for a rebound.
              </div>
            </div>

            <div
              style={{
                ...signalCardBaseStyle,
                border: "1px solid rgba(239,68,68,0.35)",
                background:
                  "linear-gradient(180deg, rgba(127,29,29,0.3), rgba(69,10,10,0.5))",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 15,
                  color: "#fef2f2",
                }}
              >
                Red Overall Signal
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "rgba(254,242,242,0.84)",
                  maxWidth: 260,
                }}
              >
                Overbought-leaning stocks that may be stretched or vulnerable.
              </div>
            </div>

            <div
              style={{
                ...signalCardBaseStyle,
                border: "1px solid rgba(234,179,8,0.34)",
                background:
                  "linear-gradient(180deg, rgba(113,63,18,0.28), rgba(66,32,6,0.48))",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 15,
                  color: "#fefce8",
                }}
              >
                Divergences
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "rgba(254,252,232,0.84)",
                  maxWidth: 260,
                }}
              >
                Stocks showing possible momentum disagreement versus price.
              </div>
            </div>

            <div
              style={{
                ...signalCardBaseStyle,
                border: "1px solid rgba(59,130,246,0.35)",
                background:
                  "linear-gradient(180deg, rgba(30,64,175,0.28), rgba(17,37,84,0.5))",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 15,
                  color: "#eff6ff",
                }}
              >
                Breakouts
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "rgba(239,246,255,0.84)",
                  maxWidth: 260,
                }}
              >
                Stocks pressing into strength, new highs or fresh momentum.
              </div>
            </div>
          </div>
        </section>

        <div style={{ marginTop: 36 }}>
          <PickersClient />
        </div>

        <section style={greySectionStyle}>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Understand these stock signals
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 820,
            }}
          >
            These beginner-friendly guides explain what the main stock signals on
            this page actually mean, including oversold conditions, overbought
            conditions, breakout setups, dip-buy ideas and divergence.
          </p>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <Link href="/stock-market-setups" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stock Market Setups
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Overview of the main setups used across MyStockHarbor.
              </div>
            </Link>

            <Link href="/oversold-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>Oversold Stocks</div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Learn how traders review stretched downside conditions.
              </div>
            </Link>

            <Link href="/overbought-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>Overbought Stocks</div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Understand when price may be stretched to the upside.
              </div>
            </Link>

            <Link href="/breakout-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>Breakout Stocks</div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                See how traders identify stocks pushing through resistance.
              </div>
            </Link>

            <Link href="/buy-the-dip-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>Buy The Dip Stocks</div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Review pullback setups that may still fit a healthy trend.
              </div>
            </Link>

            <Link href="/stocks-down-from-highs" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>Stocks Down From Highs</div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Explore stocks that have pulled back from recent highs.
              </div>
            </Link>

            <Link href="/bullish-divergence-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>Bullish Divergence</div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Learn how fading downside momentum can hint at reversal risk.
              </div>
            </Link>

            <Link href="/bearish-divergence-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>Bearish Divergence</div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Understand when upside momentum may be losing strength.
              </div>
            </Link>
          </div>
        </section>

        <section
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          <Link href="/learn" style={linkCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Learn the setups</div>
            <div style={{ marginTop: 8, fontSize: 14, opacity: 0.78, lineHeight: 1.6 }}>
              Visit the Learn hub to understand RSI, MACD, VWAP, ATR,
              divergence and other chart concepts behind these filters.
            </div>
          </Link>

          <Link href="/what-is-rsi-indicator" style={linkCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Understand RSI</div>
            <div style={{ marginTop: 8, fontSize: 14, opacity: 0.78, lineHeight: 1.6 }}>
              Read how RSI can help identify oversold and overbought zones when
              reviewing stock ideas from this page.
            </div>
          </Link>

          <Link href="/what-is-macd-indicator" style={linkCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Learn MACD divergence
            </div>
            <div style={{ marginTop: 8, fontSize: 14, opacity: 0.78, lineHeight: 1.6 }}>
              MACD can help confirm momentum shifts, trend strength and
              divergence setups that appear in live scans.
            </div>
          </Link>

          <Link href="/" style={linkCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Open the full dashboard
            </div>
            <div style={{ marginTop: 8, fontSize: 14, opacity: 0.78, lineHeight: 1.6 }}>
              Use the dashboard to inspect price action, overlays and technical
              indicators for any symbol you find here.
            </div>
          </Link>
        </section>

        <section style={greySectionStyle}>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Learn how to find stock ideas
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            These guides go one level deeper than the setup pages. They explain
            how traders scan stocks, compare charting tools, look for breakout
            candidates, analyse pullbacks and use indicators when reviewing
            possible stock ideas.
          </p>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <Link href="/stock-screener-for-breakouts" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stock Screener for Breakouts
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Learn how traders scan for stocks approaching breakout levels.
              </div>
            </Link>

            <Link href="/stock-screener-for-oversold-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stock Screener for Oversold Stocks
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Understand how traders search for oversold and rebound candidates.
              </div>
            </Link>

            <Link href="/stocks-down-20-percent" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks Down 20 Percent
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Learn how traders review bigger pullbacks before calling them opportunities.
              </div>
            </Link>

            <Link href="/best-free-stock-screener" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Free Stock Screener
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                See what traders actually want from stock scanning tools.
              </div>
            </Link>

            <Link href="/how-to-find-buy-the-dip-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                How to Find Buy the Dip Stocks
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Learn how traders search for pullbacks inside stronger trends.
              </div>
            </Link>

            <Link href="/bullish-divergence-explained" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Bullish Divergence Explained
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Understand how weakening downside momentum can show up on charts.
              </div>
            </Link>

            <Link href="/bearish-divergence-explained" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Bearish Divergence Explained
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Learn how fading upside momentum can warn of a weaker move.
              </div>
            </Link>

            <Link href="/best-indicators-for-swing-trading" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Indicators for Swing Trading
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Explore common indicators traders use when reviewing swing setups.
              </div>
            </Link>

            <Link href="/how-to-scan-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                How to Scan Stocks
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Learn the basic process traders use to scan the market for ideas.
              </div>
            </Link>

            <Link href="/stocks-ready-to-break-out" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks Ready to Break Out
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                See what traders look for when a stock approaches resistance.
              </div>
            </Link>

            <Link href="/best-charting-platforms" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Charting Platforms
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Compare the kinds of charting tools traders use to analyse stocks.
              </div>
            </Link>

            <Link href="/how-to-analyse-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                How to Analyse Stocks
              </div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
                Read the broader guide to charts, indicators and stock analysis.
              </div>
            </Link>
          </div>
        </section>

        <section style={greySectionStyle}>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            FAQ
          </h2>

          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Is this a stock screener?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Yes. It works like a stock idea screener built around technical
                setups such as oversold conditions, divergence, dip-buy setups
                and breakouts.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Are these buy or sell recommendations?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                No. These are idea filters only. They help you narrow down
                charts to review, but they are not personal financial advice.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What should I do after clicking a stock?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Open it in the dashboard, review the chart structure, check key
                indicators and confirm whether the setup still makes sense.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
