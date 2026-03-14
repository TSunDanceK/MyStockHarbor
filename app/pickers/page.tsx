import type { Metadata } from "next";
import Link from "next/link";
import PickersClient from "./PickersClient";

export const metadata: Metadata = {
  title:
    "Stock Screener Ideas: Oversold, Overbought, Divergence, Dip Buys & Breakouts | MyStockHarbor",
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
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.035)",
  textDecoration: "none",
  color: "#f1f5f9",
  display: "block",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
};

const seoSectionStyle: React.CSSProperties = {
  marginTop: 22,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 20,
  background: "linear-gradient(180deg, rgba(10,14,22,0.92), rgba(8,11,18,0.96))",
  maxWidth: 980,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

const signalCardBaseStyle: React.CSSProperties = {
  borderRadius: 16,
  padding: "16px 18px",
  minHeight: 112,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  textAlign: "left",
};

export default function PickersPage() {
  return (
    <main
      style={{
        padding: 0,
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <div className="wrap">
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "flex-start",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Link href="/" style={topNavBtnStyle("dashboard")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("dashboard")}
              </span>
              <span>Dashboard</span>
            </Link>

            <Link href="/platforms" style={topNavBtnStyle("platforms")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("platforms")}
              </span>
              <span>Platforms</span>
            </Link>

            <Link href="/learn" style={topNavBtnStyle("learn")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("learn")}
              </span>
              <span>Learn</span>
            </Link>
          </div>

          <div
            className="heroGrid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.45fr) minmax(280px, 0.8fr)",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            <section
              style={{
                border: "1px solid rgba(239,68,68,0.22)",
                borderRadius: 22,
                padding: 22,
                background:
                  "linear-gradient(135deg, rgba(14,18,34,0.98), rgba(10,14,26,0.98))",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.30)",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(239,68,68,0.34)",
                  background:
                    "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.08))",
                  fontSize: 12,
                  fontWeight: 950,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#fee2e2",
                }}
              >
                STOCK PICKERS
              </div>

              <h1
                style={{
                  margin: "16px 0 0 0",
                  fontSize: 44,
                  lineHeight: 1.04,
                  letterSpacing: "-0.05em",
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
                This is the stock scanner workspace inside MyStockHarbor. Use it to
                search for oversold stocks, overbought stocks, divergence setups,
                buy-the-dip candidates and breakout stocks, then open any symbol
                directly in the dashboard to inspect the chart in more detail.
              </p>

              <div
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 10,
                }}
              >
                <MiniStat
                  label="Scanner Type"
                  value="Setup-Based"
                  tint="blue"
                />
                <MiniStat
                  label="Results"
                  value="Data-Driven"
                  tint="green"
                />
                <MiniStat
                  label="Use"
                  value="Build a Shortlist"
                  tint="amber"
                />
                <MiniStat
                  label="Next Step"
                  value="Open Dashboard"
                  tint="red"
                />
              </div>
            </section>

            <section
              style={{
                border: "1px solid rgba(59,130,246,0.20)",
                borderRadius: 22,
                padding: 20,
                background:
                  "linear-gradient(180deg, rgba(9,16,32,0.98), rgba(7,11,20,0.98))",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.28)",
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
                WHAT YOU CAN SCAN
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                <ToolBullet
                  title="Oversold ideas"
                  text="Stocks that may be stretched to the downside and worth reviewing."
                />
                <ToolBullet
                  title="Overbought ideas"
                  text="Stocks that may be extended after strong moves higher."
                />
                <ToolBullet
                  title="Divergence setups"
                  text="Charts where momentum may be disagreeing with price."
                />
                <ToolBullet
                  title="Breakout candidates"
                  text="Stocks pressing into strength, highs or fresh momentum."
                />
              </div>
            </section>
          </div>
        </div>

        <section
          style={{
            marginTop: 24,
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 20,
            padding: 18,
            background:
              "linear-gradient(180deg, rgba(10,16,30,0.98), rgba(8,12,22,0.98))",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.04), 0 16px 36px rgba(0,0,0,0.30)",
            maxWidth: 1040,
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
                  "linear-gradient(180deg, rgba(6,78,59,0.34), rgba(6,46,33,0.52))",
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
                  "linear-gradient(180deg, rgba(127,29,29,0.30), rgba(69,10,10,0.52))",
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
                  "linear-gradient(180deg, rgba(113,63,18,0.28), rgba(66,32,6,0.50))",
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
                  "linear-gradient(180deg, rgba(30,64,175,0.28), rgba(17,37,84,0.52))",
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

        <section
          style={{
            marginTop: 26,
            maxWidth: 1040,
            borderRadius: 22,
            border: "1px solid rgba(59,130,246,0.22)",
            background:
              "linear-gradient(180deg, rgba(8,15,30,0.99), rgba(6,10,18,1))",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 40px rgba(0,0,0,0.34)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 18,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(15,23,42,0.20))",
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
              DATA-DRIVEN SCREENED RESULTS
            </div>

            <h2
              style={{
                margin: "14px 0 0 0",
                fontSize: 28,
                lineHeight: 1.12,
                letterSpacing: "-0.03em",
              }}
            >
              Technical setups detected across the market
            </h2>

            <p
              style={{
                margin: "10px 0 0 0",
                lineHeight: 1.7,
                opacity: 0.82,
                maxWidth: 860,
              }}
            >
              Browse stock ideas generated from technical market scans such as
              oversold conditions, divergence signals, breakout setups and
              pullbacks. These are data-driven screened results, not random stock
              suggestions.
            </p>

            <p
              style={{
                margin: "8px 0 0 0",
                lineHeight: 1.65,
                opacity: 0.7,
                maxWidth: 860,
                fontSize: 14,
              }}
            >
              Open any symbol in the dashboard to inspect the chart and indicators.
            </p>
          </div>

          <div style={{ padding: 18 }}>
            <PickersClient />
          </div>
        </section>

        <section style={seoSectionStyle}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
              border: "1px solid rgba(59,130,246,0.26)",
              color: "#dbeafe",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            UNDERSTAND THE SIGNALS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Learn what these stock signals mean
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.76,
              maxWidth: 820,
            }}
          >
            These guides explain the main technical ideas behind the signals on this
            page, including oversold conditions, overbought conditions, breakouts,
            dip-buy setups and divergence.
          </p>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <Link
              href="/trading-setups"
              style={{
                ...linkCardStyle,
                border: "1px solid rgba(239,68,68,0.20)",
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(127,29,29,0.04))",
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Trading Setups Hub
              </div>
              <div style={smallCardTextStyle}>
                Explore the full hub for breakouts, oversold stocks, overbought
                setups, dip buys and bullish or bearish divergence.
              </div>
            </Link>

            <Link href="/stock-market-setups" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stock Market Setups
              </div>
              <div style={smallCardTextStyle}>
                Overview of the main setups used across MyStockHarbor.
              </div>
            </Link>

            <Link href="/oversold-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Oversold Stocks
              </div>
              <div style={smallCardTextStyle}>
                Learn how traders review stretched downside conditions.
              </div>
            </Link>

            <Link href="/overbought-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Overbought Stocks
              </div>
              <div style={smallCardTextStyle}>
                Understand when price may be stretched to the upside.
              </div>
            </Link>

            <Link href="/breakout-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Breakout Stocks
              </div>
              <div style={smallCardTextStyle}>
                See how traders identify stocks pushing through resistance.
              </div>
            </Link>

            <Link href="/buy-the-dip-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Buy The Dip Stocks
              </div>
              <div style={smallCardTextStyle}>
                Review pullback setups that may still fit a healthy trend.
              </div>
            </Link>

            <Link href="/stocks-down-from-highs" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks Down From Highs
              </div>
              <div style={smallCardTextStyle}>
                Explore stocks that have pulled back from recent highs.
              </div>
            </Link>

            <Link href="/bullish-divergence-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Bullish Divergence
              </div>
              <div style={smallCardTextStyle}>
                Learn how fading downside momentum can hint at reversal risk.
              </div>
            </Link>

            <Link href="/bearish-divergence-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Bearish Divergence
              </div>
              <div style={smallCardTextStyle}>
                Understand when upside momentum may be losing strength.
              </div>
            </Link>
          </div>
        </section>

        <section
          style={{
            marginTop: 22,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            maxWidth: 980,
          }}
        >
          <Link href="/learn" style={linkCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Learn the setups
            </div>
            <div style={midCardTextStyle}>
              Visit the Learn hub to understand RSI, MACD, VWAP, ATR, divergence
              and other chart concepts behind these filters.
            </div>
          </Link>

          <Link href="/what-is-rsi-indicator" style={linkCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Understand RSI</div>
            <div style={midCardTextStyle}>
              Read how RSI can help identify oversold and overbought zones when
              reviewing stock ideas from this page.
            </div>
          </Link>

          <Link href="/what-is-macd-indicator" style={linkCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Learn MACD divergence
            </div>
            <div style={midCardTextStyle}>
              MACD can help confirm momentum shifts, trend strength and divergence
              setups that appear in screened results.
            </div>
          </Link>

          <Link href="/" style={linkCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Open the full dashboard
            </div>
            <div style={midCardTextStyle}>
              Use the dashboard to inspect price action, overlays and technical
              indicators for any symbol you find here.
            </div>
          </Link>
        </section>

        <section style={seoSectionStyle}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(139,92,246,0.08))",
              border: "1px solid rgba(168,85,247,0.26)",
              color: "#f3e8ff",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            MORE SCREENER IDEAS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            More stock screener ideas
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.76,
              maxWidth: 860,
            }}
          >
            These are additional stock screener ideas traders often search for when
            narrowing down charts. They connect indicator-based searches with
            setup-based scans.
          </p>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <Link href="/stocks-with-high-rsi" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks With High RSI
              </div>
              <div style={smallCardTextStyle}>
                Learn what high RSI can mean and how traders review overextended
                momentum.
              </div>
            </Link>

            <Link href="/stocks-with-low-rsi" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks With Low RSI
              </div>
              <div style={smallCardTextStyle}>
                Explore how traders use low RSI readings to look for stretched
                downside moves.
              </div>
            </Link>

            <Link href="/stocks-with-unusual-volume" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks With Unusual Volume
              </div>
              <div style={smallCardTextStyle}>
                See why unusual volume can matter when reviewing breakouts and
                momentum.
              </div>
            </Link>

            <Link
              href="/stocks-above-200-day-moving-average"
              style={linkCardStyle}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks Above 200 Day Moving Average
              </div>
              <div style={smallCardTextStyle}>
                Understand how traders use the 200-day moving average as a long-term
                trend filter.
              </div>
            </Link>
          </div>
        </section>

        <section style={seoSectionStyle}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(16,185,129,0.08))",
              border: "1px solid rgba(34,197,94,0.26)",
              color: "#dcfce7",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            LEARN TO SCAN
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
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
              opacity: 0.76,
              maxWidth: 860,
            }}
          >
            These guides go one level deeper than the setup pages. They explain how
            traders scan stocks, compare charting tools, look for breakout
            candidates, analyse pullbacks and use indicators when reviewing possible
            stock ideas.
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
              <div style={smallCardTextStyle}>
                Learn how traders scan for stocks approaching breakout levels.
              </div>
            </Link>

            <Link
              href="/stock-screener-for-oversold-stocks"
              style={linkCardStyle}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stock Screener for Oversold Stocks
              </div>
              <div style={smallCardTextStyle}>
                Understand how traders search for oversold and rebound candidates.
              </div>
            </Link>

            <Link href="/stocks-down-20-percent" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks Down 20 Percent
              </div>
              <div style={smallCardTextStyle}>
                Learn how traders review bigger pullbacks before calling them
                opportunities.
              </div>
            </Link>

            <Link href="/best-free-stock-screener" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Free Stock Screener
              </div>
              <div style={smallCardTextStyle}>
                See what traders actually want from stock scanning tools.
              </div>
            </Link>

            <Link href="/how-to-find-buy-the-dip-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                How to Find Buy the Dip Stocks
              </div>
              <div style={smallCardTextStyle}>
                Learn how traders search for pullbacks inside stronger trends.
              </div>
            </Link>

            <Link href="/bullish-divergence-explained" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Bullish Divergence Explained
              </div>
              <div style={smallCardTextStyle}>
                Understand how weakening downside momentum can show up on charts.
              </div>
            </Link>

            <Link href="/bearish-divergence-explained" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Bearish Divergence Explained
              </div>
              <div style={smallCardTextStyle}>
                Learn how fading upside momentum can warn of a weaker move.
              </div>
            </Link>

            <Link
              href="/best-indicators-for-swing-trading"
              style={linkCardStyle}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Indicators for Swing Trading
              </div>
              <div style={smallCardTextStyle}>
                Explore common indicators traders use when reviewing swing setups.
              </div>
            </Link>

            <Link href="/how-to-scan-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                How to Scan Stocks
              </div>
              <div style={smallCardTextStyle}>
                Learn the basic process traders use to scan the market for ideas.
              </div>
            </Link>

            <Link href="/stocks-ready-to-break-out" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stocks Ready to Break Out
              </div>
              <div style={smallCardTextStyle}>
                See what traders look for when a stock approaches resistance.
              </div>
            </Link>

            <Link href="/best-charting-platforms" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Charting Platforms
              </div>
              <div style={smallCardTextStyle}>
                Compare the kinds of charting tools traders use to analyse stocks.
              </div>
            </Link>

            <Link href="/how-to-analyse-stocks" style={linkCardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                How to Analyse Stocks
              </div>
              <div style={smallCardTextStyle}>
                Read the broader guide to charts, indicators and stock analysis.
              </div>
            </Link>
          </div>
        </section>

        <section style={seoSectionStyle}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(250,204,21,0.16), rgba(202,138,4,0.08))",
              border: "1px solid rgba(250,204,21,0.26)",
              color: "#fef3c7",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            FAQ
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Frequently asked questions
          </h2>

          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Is this a stock screener?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.78 }}>
                Yes. It works like a stock idea screener built around technical
                setups such as oversold conditions, divergence, dip-buy setups and
                breakouts.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Are these buy or sell recommendations?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.78 }}>
                No. These are idea filters only. They help you narrow down charts to
                review, but they are not personal financial advice.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What should I do after clicking a stock?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.78 }}>
                Open it in the dashboard, review the chart structure, check key
                indicators and confirm whether the setup still makes sense.
              </p>
            </div>
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 28px 20px 40px;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        @media (max-width: 900px) {
          .wrap {
            padding: 18px 16px 34px !important;
          }
        }

        @media (max-width: 860px) {
          .heroGrid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}

function MiniStat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint: "blue" | "green" | "amber" | "red";
}) {
  const styles =
    tint === "blue"
      ? {
          border: "1px solid rgba(59,130,246,0.24)",
          background:
            "linear-gradient(180deg, rgba(10,18,34,0.94), rgba(7,12,24,0.98))",
          labelColor: "#bfdbfe",
        }
      : tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.24)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.94), rgba(7,12,11,0.98))",
          labelColor: "#bbf7d0",
        }
      : tint === "amber"
      ? {
          border: "1px solid rgba(234,179,8,0.24)",
          background:
            "linear-gradient(180deg, rgba(18,16,10,0.94), rgba(12,10,7,0.98))",
          labelColor: "#fde68a",
        }
      : {
          border: "1px solid rgba(239,68,68,0.24)",
          background:
            "linear-gradient(180deg, rgba(24,12,12,0.94), rgba(14,7,7,0.98))",
          labelColor: "#fecaca",
        };

  return (
    <div
      style={{
        border: styles.border,
        background: styles.background,
        borderRadius: 16,
        padding: 14,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 900,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: styles.labelColor,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 16,
          fontWeight: 900,
          lineHeight: 1.35,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ToolBullet({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.04)",
        padding: "12px 14px",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 15 }}>{title}</div>
      <div
        style={{
          marginTop: 5,
          fontSize: 13,
          lineHeight: 1.55,
          opacity: 0.8,
        }}
      >
        {text}
      </div>
    </div>
  );
}

const smallCardTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.74,
  lineHeight: 1.6,
};

const midCardTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 14,
  opacity: 0.76,
  lineHeight: 1.6,
};

const topNavIconWrapStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function topNavBtnStyle(
  type: "dashboard" | "platforms" | "learn"
): React.CSSProperties {
  if (type === "dashboard") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
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

  if (type === "platforms") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(34,197,94,0.45)",
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))",
      color: "#f0fdf4",
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
    padding: "9px 13px",
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

function topNavIcon(type: "dashboard" | "platforms" | "learn") {
  if (type === "dashboard") return "📈";
  if (type === "platforms") return "🏦";
  return "📘";
}
