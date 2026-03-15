// app/learn/page.tsx
import Link from "next/link";
import { lessonsByCategory } from "./lessons";

export default function LearnPage() {
  const basics = lessonsByCategory("Basics");
  const indicators = lessonsByCategory("Indicators");
  const divergencies = lessonsByCategory("Divergencies");

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
    >
      <div className="wrap">
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "flex-end",
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

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                border: "1px solid rgba(59,130,246,0.34)",
                color: "#dbeafe",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              LEARN
            </div>

            <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.4px" }}>
              Learn the Basics
            </h1>

            <p
              style={{
                margin: "10px 0 0 0",
                opacity: 0.75,
                lineHeight: 1.5,
                maxWidth: 760,
              }}
            >
              Short lessons on reading charts, key concepts, and the indicators used in
              MyStockHarbor.
            </p>
          </div>
        </div>

        <div
          style={{
            marginTop: 22,
            borderRadius: 16,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
            padding: 18,
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 6 }}>New to trading?</div>

          <div style={{ opacity: 0.85, lineHeight: 1.55 }}>
            Before learning indicators and chart patterns, it&apos;s helpful to choose a
            trading platform. Most people analyse charts using <strong>TradingView</strong>{" "}
            and place trades using a broker like Trading 212 or Interactive Brokers.
          </div>

          <div style={{ marginTop: 12 }}>
            <Link
              href="/platforms"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(34,197,94,0.45)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Choose Your Trading Platform →
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 22, display: "grid", gap: 18 }}>
          <Section title="BASICS" items={basics} />
          <Section title="INDICATORS" items={indicators} />
          <Section title="DIVERGENCIES" items={divergencies} />
          <section
  style={{
    border: "1px solid rgba(34,197,94,0.22)",
    borderRadius: 18,
    padding: 18,
    background: "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  }}
>
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "7px 12px",
      borderRadius: 999,
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
      border: "1px solid rgba(34,197,94,0.34)",
      color: "#dcfce7",
      fontWeight: 950,
      letterSpacing: "0.08em",
      fontSize: 12,
    }}
  >
    RISK MANAGEMENT
  </div>

  <div
    style={{
      marginTop: 14,
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      gap: 12,
    }}
  >
    <Link href="/position-sizing-guide" style={learnGuideCard()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>Position Sizing Guide</div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
        Learn how traders size positions based on stop loss distance and account risk.
      </div>
    </Link>

    <Link href="/stop-loss-strategy" style={learnGuideCard()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>Stop Loss Strategy</div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
        Understand how stop losses help limit downside and improve trade discipline.
      </div>
    </Link>

    <Link href="/trading-risk-management" style={learnGuideCard()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>Trading Risk Management</div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
        Explore the core principles traders use to protect capital and manage losses.
      </div>
    </Link>

    <Link href="/risk-reward-ratio" style={learnGuideCard()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>Risk Reward Ratio</div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
        Learn how traders compare potential reward against possible downside before entering.
      </div>
    </Link>

    <Link href="/margin-trading-explained" style={learnGuideCard()}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>Margin Trading Explained</div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
        Understand leverage, liquidation risk and why margin needs careful control.
      </div>
    </Link>
  </div>
</section>

          <section
            style={{
              border: "1px solid rgba(34,197,94,0.22)",
              borderRadius: 18,
              padding: 18,
              background: "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
                border: "1px solid rgba(34,197,94,0.34)",
                color: "#dcfce7",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              EXTRA GUIDES
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              <Link href="/how-to-read-stock-charts" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>How to Read Stock Charts</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  A beginner-friendly guide to trend, support, resistance, and chart
                  context.
                </div>
              </Link>

              <Link href="/best-stock-indicators-for-beginners" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  Best Stock Indicators for Beginners
                </div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Learn which indicators matter most when you are just starting out.
                </div>
              </Link>

              <Link href="/how-to-identify-stock-trends" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>How to Identify Stock Trends</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Learn how to recognise uptrends, downtrends, and sideways markets.
                </div>
              </Link>
            </div>
          </section>

          <section
            style={{
              border: "1px solid rgba(239,68,68,0.24)",
              borderRadius: 18,
              padding: 18,
              background: "linear-gradient(180deg, rgba(24,12,12,0.96), rgba(14,7,7,0.98))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.12))",
                border: "1px solid rgba(239,68,68,0.36)",
                color: "#fee2e2",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              TRADING SETUPS
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              <Link
                href="/trading-setups"
                style={{
                  ...learnGuideCard(),
                  border: "1px solid rgba(239,68,68,0.30)",
                  background:
                    "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(127,29,29,0.08))",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 16 }}>Trading Setups Hub</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.78, lineHeight: 1.5 }}>
                  Explore the full hub for breakouts, oversold stocks, buy-the-dip setups
                  and bullish or bearish divergence.
                </div>
              </Link>

              <Link href="/stock-market-setups" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Stock Market Setups</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Overview of common trading setups including dips, breakouts and
                  divergences.
                </div>
              </Link>

              <Link href="/oversold-stocks" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Oversold Stocks</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Learn how traders identify stretched downside moves.
                </div>
              </Link>

              <Link href="/overbought-stocks" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Overbought Stocks</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Understand when stocks may be stretched to the upside.
                </div>
              </Link>

              <Link href="/breakout-stocks" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Breakout Stocks</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Learn how traders identify strong momentum breakouts.
                </div>
              </Link>

              <Link href="/buy-the-dip-stocks" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Buy The Dip Stocks</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Explore pullback opportunities within strong trends.
                </div>
              </Link>

              <Link href="/stocks-down-from-highs" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Stocks Down From Highs</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Review stocks that have pulled back significantly from recent highs.
                </div>
              </Link>

              <Link href="/bullish-divergence-stocks" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Bullish Divergence</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Learn how divergence can signal weakening downside momentum.
                </div>
              </Link>

              <Link href="/bearish-divergence-stocks" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Bearish Divergence</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
                  Understand when momentum may be weakening in rising stocks.
                </div>
              </Link>
            </div>
          </section>
        </div>
      </div>

      <style>{`
        .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        @media (max-width: 760px) {
          .wrap { padding: 16px !important; }
        }
      `}</style>
    </main>
  );
}

function learnCardHref(slug: string) {
  if (slug === "macd-divergence") return "/learn/macd";
  if (slug === "rsi-divergence") return "/learn/rsi";
  if (slug === "how-to-identify-stock-trends") return "/how-to-identify-stock-trends";
  return `/learn/${encodeURIComponent(slug)}`;
}

function Section(props: {
  title: string;
  items: { slug: string; title: string; summary: string }[];
}) {
  const { title, items } = props;

  const sectionTint =
    title === "BASICS"
      ? {
          border: "1px solid rgba(59,130,246,0.22)",
          background: "linear-gradient(180deg, rgba(10,18,34,0.96), rgba(7,12,24,0.98))",
          labelBg: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
          labelBorder: "1px solid rgba(59,130,246,0.34)",
          labelColor: "#dbeafe",
        }
      : title === "INDICATORS"
      ? {
          border: "1px solid rgba(168,85,247,0.22)",
          background: "linear-gradient(180deg, rgba(12,16,34,0.96), rgba(8,11,24,0.98))",
          labelBg: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(139,92,246,0.10))",
          labelBorder: "1px solid rgba(168,85,247,0.34)",
          labelColor: "#f3e8ff",
        }
      : {
          border: "1px solid rgba(234,179,8,0.22)",
          background: "linear-gradient(180deg, rgba(18,16,10,0.96), rgba(12,10,7,0.98))",
          labelBg: "linear-gradient(135deg, rgba(234,179,8,0.18), rgba(202,138,4,0.10))",
          labelBorder: "1px solid rgba(234,179,8,0.34)",
          labelColor: "#fef3c7",
        };

  return (
    <section
      style={{
        border: sectionTint.border,
        borderRadius: 18,
        padding: 18,
        background: sectionTint.background,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "7px 12px",
          borderRadius: 999,
          background: sectionTint.labelBg,
          border: sectionTint.labelBorder,
          color: sectionTint.labelColor,
          fontWeight: 950,
          letterSpacing: "0.08em",
          fontSize: 12,
        }}
      >
        {title}
      </div>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {items.map((it) => (
          <Link
            key={it.slug}
            href={learnCardHref(it.slug)}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 14,
              padding: 14,
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              display: "block",
              transition: "transform 120ms ease, background 120ms ease, border-color 120ms ease",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16 }}>{it.title}</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
              {it.summary}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function topNavBtnStyle(
  type: "dashboard" | "platforms" | "pickers" | "calculators"
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

function topNavIcon(type: "dashboard" | "platforms" | "pickers" | "calculators") {
  if (type === "dashboard") return "📈";
  if (type === "platforms") return "🏦";
  if (type === "pickers") return "📊";
  return "🧮";
}

function learnGuideCard(): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(255,255,255,0.06)",
    color: "#f1f5f9",
    textDecoration: "none",
    display: "block",
    transition: "transform 120ms ease, background 120ms ease",
  };
}
