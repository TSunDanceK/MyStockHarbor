import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Read Stock Charts | MyStockHarbor",
  description:
    "Learn how to read stock charts as a beginner, including trend, support and resistance, indicators, and how to understand price action more clearly.",
};

export default function HowToReadStockChartsPage() {
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
                BEGINNER CHART GUIDE
              </div>

              <h1
                style={{
                  margin: "8px 0 0",
                  fontSize: 36,
                  lineHeight: 1.15,
                  letterSpacing: "-0.5px",
                }}
              >
                How to Read Stock Charts
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
            Learning how to read stock charts is one of the most useful skills for any
            trader or investor. A stock chart helps you see trend, momentum, support and
            resistance, and whether price is becoming stretched or weak.
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
          <div
            style={{
              fontSize: 12,
              fontWeight: 900,
              opacity: 0.78,
              letterSpacing: "0.08em",
            }}
          >
            SIMPLE WAY TO THINK ABOUT IT
          </div>

          <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900 }}>
            A chart tells you three things:
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>Direction</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Is price moving up, down, or sideways?
              </div>
            </div>

            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>Strength</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Is momentum improving or weakening?
              </div>
            </div>

            <div style={heroInfoCard()}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>Location</div>
              <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>
                Is price near support, resistance, or stretched away from value?
              </div>
            </div>
          </div>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>1. Start with trend</h2>
          <p style={bodyTextStyle()}>
            The first thing to read on any stock chart is trend. Ask whether price is
            making higher highs and higher lows, lower highs and lower lows, or moving
            sideways in a range.
          </p>
          <p style={bodyTextStyle()}>
            Beginners often make charts too complicated too early. In most cases, trend
            should come first before you look at any indicator.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>2. Find support and resistance</h2>
          <p style={bodyTextStyle()}>
            Support is an area where price has previously held up. Resistance is an area
            where price has previously struggled to move higher. These areas help traders
            judge whether a stock is near a level where buyers or sellers may react again.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>3. Use indicators to confirm, not to lead</h2>
          <p style={bodyTextStyle()}>
            Indicators are most useful when they support what price is already showing.
            For example, RSI can help identify whether momentum is stretched, MACD can
            help show whether momentum is strengthening or fading, and moving averages
            can help define the bigger trend.
          </p>
          <p style={bodyTextStyle()}>
            The mistake many beginners make is trying to let indicators replace chart
            reading. A better approach is to read price first, then use indicators as
            confirmation.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>4. Learn to recognise stretch</h2>
          <p style={bodyTextStyle()}>
            A stock can be trending well and still become stretched in the short term.
            This is where tools like RSI, Stochastic, Bollinger Bands, VWAP, and
            moving-average distance can help. They show whether price is becoming
            overbought, oversold, or extended away from a more normal range.
          </p>
        </section>

        <section style={contentSectionStyle()}>
          <h2 style={sectionHeadingStyle()}>5. Read market context, not just the stock</h2>
          <p style={bodyTextStyle()}>
            A stock chart does not exist in isolation. It helps to know whether the wider
            market is strong or weak, whether volatility is rising, and whether the move
            is happening with real participation. That is why market context and benchmark
            tracking matter.
          </p>
        </section>

        <section
          style={{
            marginTop: 28,
            padding: 20,
            borderRadius: 18,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20 }}>Use MyStockHarbor to practise</div>

          <p style={{ margin: "10px 0 0", opacity: 0.86, lineHeight: 1.65 }}>
            MyStockHarbor was built to make chart reading easier for beginner and
            intermediate users. You can quickly check trend, stretch, momentum,
            divergence, and market context in one place.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            If you want to practise reading charts using real examples, you can explore the{" "}
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
            page. It groups live stocks into categories like oversold setups, divergence
            signals, buy-the-dip candidates and breakout stocks so you can quickly open
            charts and practise analysing them.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={ctaPrimaryStyle()}>
              Open the Dashboard →
            </Link>

            <Link href="/learn" style={ctaSecondaryStyle()}>
              Explore Learn Page →
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
      background: "linear-gradient(135deg, rgba(250,204,21,0.20), rgba(202,138,4,0.10))",
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
      background: "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))",
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
      background: "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))",
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
      background: "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
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
    background: "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))",
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
    background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
    color: "#f8fafc",
    textDecoration: "none",
    fontWeight: 900,
    minHeight: 48,
    boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
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
