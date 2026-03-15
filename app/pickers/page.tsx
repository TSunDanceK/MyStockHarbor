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

const panelStyle: React.CSSProperties = {
  marginTop: 22,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 20,
  background: "linear-gradient(180deg, rgba(9,13,20,0.92), rgba(7,10,16,0.96))",
  maxWidth: 980,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

const bundleGridStyle: React.CSSProperties = {
  marginTop: 16,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const compactLinkStyle: React.CSSProperties = {
  display: "block",
  textDecoration: "none",
  color: "#f1f5f9",
  borderRadius: 14,
  padding: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
};

const supportCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
  textDecoration: "none",
  color: "#f1f5f9",
  display: "block",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
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

            <Link href="/utilities" style={topNavBtnStyle("calculators")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("calculators")}
              </span>
              <span>Calculators</span>
            </Link>
          </div>

          <div
            className="heroGrid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.35fr) minmax(300px, 0.95fr)",
              gap: 16,
              alignItems: "stretch",
              maxWidth: 980,
            }}
          >
            <section
              style={{
                border: "1px solid rgba(59,130,246,0.20)",
                borderRadius: 22,
                padding: 18,
                background:
                  "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(7,11,22,0.98))",
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
                  border: "1px solid rgba(59,130,246,0.32)",
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
                  fontSize: 12,
                  fontWeight: 950,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#dbeafe",
                }}
              >
                STOCK PICKERS
              </div>

              <h1
                className="pickersHeroTitle"
                style={{
                  margin: "14px 0 0 0",
                  fontSize: 44,
                  lineHeight: 1.04,
                  letterSpacing: "-0.05em",
                }}
              >
                Find Your Next Stock
              </h1>

              <p
                className="pickersHeroText"
                style={{
                  marginTop: 12,
                  fontSize: 17,
                  lineHeight: 1.65,
                  opacity: 0.84,
                  maxWidth: 700,
                }}
              >
                Browse screened stock ideas across oversold rebounds, extended
                strength, divergence, dip-buy setups and breakout candidates,
                then open any symbol in the dashboard to review the chart in
                more detail.
              </p>

              <div
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 10,
                  maxWidth: 560,
                }}
              >
                <MiniStat
                  label="Results"
                  value="Screened Market Setups"
                  tint="green"
                />
                <MiniStat
                  label="Use Case"
                  value="Find Trade Ideas Faster"
                  tint="amber"
                />
              </div>

              <div
                style={{
                  marginTop: 18,
                  borderRadius: 18,
                  border: "1px dashed rgba(59,130,246,0.24)",
                  background:
                    "linear-gradient(180deg, rgba(59,130,246,0.05), rgba(15,23,42,0.10))",
                  padding: "18px 16px",
                  display: "grid",
                  placeItems: "center",
                  textAlign: "center",
                  minHeight: 96,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    letterSpacing: "0.06em",
                    color: "rgba(219,234,254,0.88)",
                    textTransform: "uppercase",
                  }}
                >
                  Screened stocks below
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 24,
                    lineHeight: 1,
                    color: "rgba(96,165,250,0.9)",
                    letterSpacing: "0.25em",
                  }}
                >
                  ↓ ↓ ↓
                </div>
              </div>
            </section>

            <section
              style={{
                border: "1px solid rgba(59,130,246,0.20)",
                borderRadius: 22,
                padding: 18,
                background:
                  "linear-gradient(180deg, rgba(8,14,28,0.98), rgba(6,10,18,0.98))",
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
                REAL SCREENED SETUPS
              </div>

              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <SignalCard
                  title="Oversold Rebound Signals"
                  text="Downside stretch with possible rebound potential."
                  tint="green"
                />
                <SignalCard
                  title="Extended Strength Signals"
                  text="Extended upside moves worth reviewing closely."
                  tint="red"
                />
                <SignalCard
                  title="Divergence Signals"
                  text="Momentum and price may be starting to disagree."
                  tint="amber"
                />
                <SignalCard
                  title="Buy-the-Dip Setups"
                  text="Pullback setups that may still fit a stronger trend."
                  tint="teal"
                />
                <SignalCard
                  title="Breakout Setups"
                  text="Strength, resistance pressure or momentum expansion."
                  tint="blue"
                />
              </div>
            </section>
          </div>
        </div>

        <section
          style={{
            marginTop: 24,
            maxWidth: 980,
            borderRadius: 22,
            border: "1px solid rgba(59,130,246,0.35)",
            background:
              "linear-gradient(180deg, rgba(6,12,24,1), rgba(4,8,16,1))",
            boxShadow:
              "0 0 0 1px rgba(59,130,246,0.15), 0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              borderRadius: 22,
              boxShadow: "0 0 40px rgba(59,130,246,0.18)",
            }}
          />

          <div
            style={{
              padding: 18,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.28))",
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
              Screened setups across the market
            </h2>

            <p
              style={{
                margin: "10px 0 0 0",
                lineHeight: 1.65,
                opacity: 0.82,
                maxWidth: 820,
                fontSize: 15,
              }}
            >
              These screened results are designed to help you find charts worth
              reviewing. They are starting points for analysis, not buy or sell
              recommendations. Click any symbol to open the full chart in the
              dashboard.
            </p>
          </div>

          <div style={{ padding: 18 }}>
            <PickersClient />
          </div>
        </section>

        <section style={panelStyle}>
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
            LEARN THE SETUPS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Learn the trading setups behind these ideas
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.74,
              maxWidth: 860,
            }}
          >
            Start with the main Trading Setups hub, then go deeper into the
            specific patterns you see in the screened results below. This keeps
            the Pickers page focused on finding ideas while the setup pages
            handle the deeper education.
          </p>

          <div style={bundleGridStyle}>
            <Link
              href="/trading-setups"
              style={{
                ...compactLinkStyle,
                border: "1px solid rgba(239,68,68,0.20)",
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(127,29,29,0.04))",
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Trading Setups Hub
              </div>
              <div style={smallLinkTextStyle}>
                Explore the main hub for breakouts, oversold setups, dip buys
                and divergence ideas.
              </div>
            </Link>

            <Link href="/oversold-stocks" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Oversold Stocks
              </div>
              <div style={smallLinkTextStyle}>
                Learn how traders review stretched downside conditions and
                rebound potential.
              </div>
            </Link>

            <Link href="/overbought-stocks" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Overbought Stocks
              </div>
              <div style={smallLinkTextStyle}>
                Understand when price may be stretched after strong upside
                momentum.
              </div>
            </Link>

            <Link href="/breakout-stocks" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Breakout Stocks
              </div>
              <div style={smallLinkTextStyle}>
                See how traders identify stocks pushing through resistance with
                strength.
              </div>
            </Link>

            <Link href="/buy-the-dip-stocks" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Buy The Dip Stocks
              </div>
              <div style={smallLinkTextStyle}>
                Review pullback setups that may still fit a stronger trend.
              </div>
            </Link>

            <Link href="/bullish-divergence-stocks" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Bullish Divergence
              </div>
              <div style={smallLinkTextStyle}>
                Learn how fading downside momentum can hint at reversal risk.
              </div>
            </Link>

            <Link href="/bearish-divergence-stocks" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Bearish Divergence
              </div>
              <div style={smallLinkTextStyle}>
                Understand when upside momentum may be losing strength.
              </div>
            </Link>
          </div>
        </section>

        <section style={panelStyle}>
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
            LEARN HOW TO SCAN
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Learn how traders scan for stock ideas
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.74,
              maxWidth: 860,
            }}
          >
            These guides explain how traders search for stock ideas, compare
            charting tools, review pullbacks, and use screeners to narrow down
            charts worth a closer look.
          </p>

          <div style={bundleGridStyle}>
            <Link href="/how-to-scan-stocks" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                How to Scan Stocks
              </div>
              <div style={smallLinkTextStyle}>
                Learn the basic process traders use to scan the market for
                ideas.
              </div>
            </Link>

            <Link href="/best-free-stock-screener" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Free Stock Screener
              </div>
              <div style={smallLinkTextStyle}>
                See what traders usually want from stock scanning tools.
              </div>
            </Link>

            <Link href="/stock-screener-for-breakouts" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stock Screener for Breakouts
              </div>
              <div style={smallLinkTextStyle}>
                Learn how traders scan for stocks approaching breakout levels.
              </div>
            </Link>

            <Link
              href="/stock-screener-for-oversold-stocks"
              style={compactLinkStyle}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stock Screener for Oversold Stocks
              </div>
              <div style={smallLinkTextStyle}>
                Understand how traders search for oversold and rebound
                candidates.
              </div>
            </Link>

            <Link
              href="/best-indicators-for-swing-trading"
              style={compactLinkStyle}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Indicators for Swing Trading
              </div>
              <div style={smallLinkTextStyle}>
                Explore common indicators traders use when reviewing swing
                setups.
              </div>
            </Link>

            <Link href="/best-charting-platforms" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Best Charting Platforms
              </div>
              <div style={smallLinkTextStyle}>
                Compare the kinds of charting tools traders use to analyse
                stocks.
              </div>
            </Link>

            <Link href="/how-to-analyse-stocks" style={compactLinkStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                How to Analyse Stocks
              </div>
              <div style={smallLinkTextStyle}>
                Read the broader guide to charts, indicators and stock
                analysis.
              </div>
            </Link>
          </div>
        </section>
  
        <section style={panelStyle}>
          <div style={{ maxWidth: 420 }}>
            <Link
              href="/stock-indicators"
              style={{
                ...compactLinkStyle,
                display: "block",
                border: "1px solid rgba(34,197,94,0.20)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(16,185,129,0.04))",
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Understand the indicators behind these signals
              </div>
              <div style={smallLinkTextStyle}>
                Start with the indicators hub, then go deeper into RSI, MACD,
                volume and moving average guides.
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
          <Link href="/" style={supportCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Open the full dashboard
            </div>
            <div style={midCardTextStyle}>
              Review price structure, overlays and indicators for any symbol you
              find on this page.
            </div>
          </Link>

          <Link href="/learn" style={supportCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Visit the Learn hub</div>
            <div style={midCardTextStyle}>
              Explore the main education hub for chart concepts, setups and
              beginner-friendly guides.
            </div>
          </Link>

          <Link href="/platforms" style={supportCardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Compare trading platforms
            </div>
            <div style={midCardTextStyle}>
              Review charting and broker platform options after narrowing down
              your ideas.
            </div>
          </Link>
        </section>

        <section style={panelStyle}>
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
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                Yes. It works like a stock idea screener built around technical
                setups such as oversold conditions, divergence, dip-buy setups
                and breakouts.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Are these buy or sell recommendations?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                No. These are idea filters only. They help you narrow down
                charts to review, but they are not personal financial advice.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What should I do after clicking a stock?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
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

        @media (max-width: 640px) {
          .pickersHeroTitle {
            font-size: 34px !important;
            line-height: 1.06 !important;
            letter-spacing: -0.04em !important;
          }

          .pickersHeroText {
            font-size: 15px !important;
            line-height: 1.65 !important;
          }
        }

        @media (max-width: 420px) {
          .pickersHeroTitle {
            font-size: 30px !important;
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
  tint: "green" | "amber";
}) {
  const styles =
    tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.24)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.94), rgba(7,12,11,0.98))",
          labelColor: "#bbf7d0",
        }
      : {
          border: "1px solid rgba(234,179,8,0.24)",
          background:
            "linear-gradient(180deg, rgba(18,16,10,0.94), rgba(12,10,7,0.98))",
          labelColor: "#fde68a",
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

function SignalCard({
  title,
  text,
  tint,
}: {
  title: string;
  text: string;
  tint: "green" | "red" | "amber" | "teal" | "blue";
}) {
  const styles =
    tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.35)",
          background:
            "linear-gradient(180deg, rgba(6,78,59,0.30), rgba(6,46,33,0.48))",
          titleColor: "#ecfdf5",
          textColor: "rgba(236,253,245,0.84)",
        }
      : tint === "red"
      ? {
          border: "1px solid rgba(239,68,68,0.35)",
          background:
            "linear-gradient(180deg, rgba(127,29,29,0.28), rgba(69,10,10,0.48))",
          titleColor: "#fef2f2",
          textColor: "rgba(254,242,242,0.84)",
        }
      : tint === "amber"
      ? {
          border: "1px solid rgba(234,179,8,0.34)",
          background:
            "linear-gradient(180deg, rgba(113,63,18,0.28), rgba(66,32,6,0.46))",
          titleColor: "#fefce8",
          textColor: "rgba(254,252,232,0.84)",
        }
      : tint === "teal"
      ? {
          border: "1px solid rgba(20,184,166,0.34)",
          background:
            "linear-gradient(180deg, rgba(17,94,89,0.28), rgba(4,47,46,0.46))",
          titleColor: "#ecfeff",
          textColor: "rgba(236,254,255,0.84)",
        }
      : {
          border: "1px solid rgba(59,130,246,0.35)",
          background:
            "linear-gradient(180deg, rgba(30,64,175,0.28), rgba(17,37,84,0.48))",
          titleColor: "#eff6ff",
          textColor: "rgba(239,246,255,0.84)",
        };

  return (
    <div
      style={{
        border: styles.border,
        background: styles.background,
        borderRadius: 16,
        padding: "14px 16px",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          fontWeight: 900,
          fontSize: 15,
          color: styles.titleColor,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          lineHeight: 1.55,
          color: styles.textColor,
        }}
      >
        {text}
      </div>
    </div>
  );
}

const smallLinkTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.72,
  lineHeight: 1.6,
};

const midCardTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 14,
  opacity: 0.74,
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
  type: "dashboard" | "platforms" | "learn" | "calculators"
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

  if (type === "calculators") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(168,85,247,0.45)",
      background:
        "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))",
      color: "#faf5ff",
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

function topNavIcon(type: "dashboard" | "platforms" | "learn" | "calculators") {
  if (type === "dashboard") return "📈";
  if (type === "platforms") return "🏦";
  if (type === "calculators") return "🧮";
  return "📘";
}
