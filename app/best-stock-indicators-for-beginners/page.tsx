import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Best Stock Indicators for Beginners | MyStockHarbor",
  description:
    "Learn the best stock indicators for beginners including RSI, moving averages, MACD, VWAP, and Bollinger Bands, and how to use them to read stock charts more clearly.",
};

export default function BestStockIndicatorsForBeginnersPage() {
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
        className="wrap"
        style={{
          maxWidth: 940,
          margin: "0 auto",
          padding: "28px 20px 40px",
        }}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "nowrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.72,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                }}
              >
                BEGINNER INDICATOR GUIDE
              </div>

              <h1
                style={{
                  margin: "8px 0 0",
                  fontSize: 36,
                  lineHeight: 1.15,
                  letterSpacing: "-0.5px",
                }}
              >
                Best Stock Indicators for Beginners
              </h1>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "flex-end",
                alignItems: "flex-start",
                flex: "0 0 auto",
                marginLeft: "auto",
              }}
            >
              <Link href="/" style={topNavBtnStyle("dashboard")}>
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 15,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {topNavIcon("dashboard")}
                </span>
                <span>Dashboard</span>
              </Link>

              <Link href="/learn" style={topNavBtnStyle("learn")}>
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 15,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {topNavIcon("learn")}
                </span>
                <span>Learn</span>
              </Link>

              <Link href="/platforms" style={topNavBtnStyle("platforms")}>
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 15,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {topNavIcon("platforms")}
                </span>
                <span>Platforms</span>
              </Link>

              <Link href="/pickers" style={topNavBtnStyle("pickers")}>
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 15,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {topNavIcon("pickers")}
                </span>
                <span>Stock Pickers</span>
              </Link>

              <Link href="/utilities" style={topNavBtnStyle("calculators")}>
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 15,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {topNavIcon("calculators")}
                </span>
                <span>Calculators</span>
              </Link>
            </div>
          </div>

          <p
            style={{
              margin: 0,
              fontSize: 17,
              lineHeight: 1.7,
              opacity: 0.86,
              maxWidth: 760,
            }}
          >
            Stock indicators help traders understand what price is doing beneath
            the surface. They can reveal momentum, trend strength, and whether a
            stock is becoming stretched or weak.
          </p>

          <p
            style={{
              margin: 0,
              opacity: 0.82,
              lineHeight: 1.7,
              maxWidth: 760,
            }}
          >
            The biggest mistake beginners make is trying to use too many
            indicators at once. A better approach is to understand what a few
            simple indicators show and combine them with basic chart reading.
          </p>
        </div>

        <section
          style={{
            marginTop: 20,
            padding: 20,
            borderRadius: 18,
            border: "1px solid rgba(59,130,246,0.28)",
            background:
              "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(168,85,247,0.08))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ fontWeight: 900 }}>Simple rule for beginners</div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>Start with trend</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Use price structure and moving averages to understand direction first.
              </div>
            </div>

            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>Use 1 or 2 indicators</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Let indicators confirm what price is already showing.
              </div>
            </div>

            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>Avoid clutter</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Too many indicators make charts harder to read, not easier.
              </div>
            </div>
          </div>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>1. Moving Averages (MA50 / MA200)</h2>

          <p style={bodyTextStyle()}>
            Moving averages are one of the easiest ways to understand trend.
            The 50-day and 200-day moving averages are widely used by traders
            to see whether a stock is in a long-term uptrend or downtrend.
          </p>

          <p style={bodyTextStyle()}>
            If price stays above the moving average, the trend is generally
            considered strong. If price falls below it, momentum may be
            weakening.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>2. RSI (Relative Strength Index)</h2>

          <p style={bodyTextStyle()}>
            RSI is one of the most popular indicators for beginners. It measures
            momentum and shows whether a stock may be overbought or oversold.
          </p>

          <p style={bodyTextStyle()}>
            When RSI rises above 70, price may be becoming stretched upward.
            When RSI drops below 30, price may be becoming stretched downward.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>3. MACD</h2>

          <p style={bodyTextStyle()}>
            MACD is a momentum indicator that helps traders see when momentum is
            strengthening or weakening. It can also show when trend shifts may
            be starting.
          </p>

          <p style={bodyTextStyle()}>
            MACD is useful when combined with trend analysis. It should confirm
            what price is already suggesting rather than replace chart reading.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>4. VWAP</h2>

          <p style={bodyTextStyle()}>
            VWAP (Volume Weighted Average Price) helps traders understand where
            price sits relative to its average value during the day.
          </p>

          <p style={bodyTextStyle()}>
            When price moves far above VWAP it can signal that a stock is
            becoming stretched. When price returns toward VWAP it can indicate a
            move back toward equilibrium.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>5. Bollinger Bands</h2>

          <p style={bodyTextStyle()}>
            Bollinger Bands show how far price is moving away from its normal
            range. The outer bands expand when volatility increases and contract
            when volatility slows down.
          </p>

          <p style={bodyTextStyle()}>
            Traders often use Bollinger Bands to identify when price may be
            reaching extremes.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>Best indicator combination for beginners</h2>

          <p style={bodyTextStyle()}>
            A simple and effective setup for beginners is:
          </p>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>MA50</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Use it for trend direction and basic chart structure.
              </div>
            </div>

            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>RSI</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Use it to judge whether momentum is becoming stretched.
              </div>
            </div>

            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>MACD</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Use it for momentum confirmation and weakening signals.
              </div>
            </div>
          </div>

          <p style={bodyTextStyle()}>
            This combination gives you trend, momentum, and stretch signals
            without overcrowding the chart.
          </p>
        </section>

        <section
          style={{
            marginTop: 30,
            padding: 20,
            borderRadius: 18,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20 }}>
            Try these indicators on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            The MyStockHarbor dashboard helps you quickly check trend,
            divergence, momentum, and stretch across multiple indicators in one
            place.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            If you want to practise using these ideas with real chart examples,
            explore the{" "}
            <Link
              href="/pickers"
              style={{
                color: "#60a5fa",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Find Your Next Stock
            </Link>{" "}
            page. It groups live stocks into categories like oversold setups,
            divergence signals, buy-the-dip candidates and breakout stocks so you
            can quickly open charts and study the setup in more detail.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={ctaPrimaryStyle()}>
              Open the Dashboard →
            </Link>

            <Link href="/pickers" style={ctaSecondaryStyle()}>
              Browse Stock Ideas →
            </Link>
          </div>
        </section>
      </div>

      <style>{`
        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        @media (max-width: 900px) {
          .wrap {
            padding: 22px 18px 36px !important;
          }
        }

        @media (max-width: 760px) {
          .wrap {
            padding: 16px !important;
          }
        }
      `}</style>
    </main>
  );
}

function topNavBtnStyle(
  type: "dashboard" | "learn" | "platforms" | "pickers" | "calculators"
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

  if (type === "learn") {
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
      color: "#dbeafe",
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

  if (type === "pickers") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(239,68,68,0.45)",
      background:
        "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
      color: "#fef2f2",
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

function topNavIcon(type: "dashboard" | "learn" | "platforms" | "pickers" | "calculators") {
  if (type === "dashboard") return "📈";
  if (type === "learn") return "📘";
  if (type === "platforms") return "🏦";
  if (type === "pickers") return "📊";
  return "🧮";
}

function heroInfoCard(): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(255,255,255,0.05)",
  };
}

function contentSectionStyle(): React.CSSProperties {
  return {
    marginTop: 28,
    padding: 18,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
  };
}

function sectionHeadingStyle(): React.CSSProperties {
  return {
    margin: 0,
    fontSize: 24,
    lineHeight: 1.2,
  };
}

function bodyTextStyle(): React.CSSProperties {
  return {
    marginTop: 12,
    opacity: 0.86,
    lineHeight: 1.7,
  };
}

function ctaPrimaryStyle(): React.CSSProperties {
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
    minHeight: 48,
    whiteSpace: "nowrap",
  };
}

function ctaSecondaryStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "13px 18px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#f8fafc",
    textDecoration: "none",
    fontWeight: 900,
    minHeight: 48,
    whiteSpace: "nowrap",
  };
}
