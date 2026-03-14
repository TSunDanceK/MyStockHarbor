import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Bearish Divergence Stocks: How to Spot Early Weakness Signals | MyStockHarbor",
  description:
    "Learn what bearish divergence means in stocks, how traders use RSI and MACD divergence to spot weakening upside momentum, and how to explore live stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/bearish-divergence-stocks",
  },
  openGraph: {
    title: "Bearish Divergence Stocks | MyStockHarbor",
    description:
      "A beginner-friendly guide to bearish divergence stocks, early weakness signals and how to explore live stock ideas.",
    url: "https://mystockharbor.com/bearish-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bearish Divergence Stocks | MyStockHarbor",
    description:
      "Learn how traders identify bearish divergence stocks and early weakness setups.",
  },
};

export default function BearishDivergenceStocksPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
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

          <div style={{ maxWidth: 780 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
                border: "1px solid rgba(239,68,68,0.34)",
                color: "#fee2e2",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              BEARISH DIVERGENCE GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Bearish Divergence Stocks: How to Spot Early Weakness Signals
            </h1>

            <p
              style={{
                margin: "12px 0 0 0",
                fontSize: 17,
                lineHeight: 1.65,
                opacity: 0.84,
              }}
            >
              Bearish divergence happens when price makes a higher high, but momentum
              does not confirm that new strength. Traders watch for this because it
              can suggest upside pressure is fading even though price still looks
              strong on the surface.
            </p>

            <p
              style={{
                margin: "12px 0 0 0",
                opacity: 0.8,
                lineHeight: 1.65,
              }}
            >
              This can sometimes appear before a pullback, failed breakout or early
              reversal, but it is not a guarantee. Bearish divergence is most useful
              when it appears near resistance, after a stretched move up, or when
              other signs suggest buying pressure may be weakening.
            </p>
          </div>
        </div>

        <section
          style={{
            marginTop: 24,
            padding: 20,
            borderRadius: 18,
            border: "1px solid rgba(239,68,68,0.28)",
            background:
              "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(59,130,246,0.08))",
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
                "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))",
              border: "1px solid rgba(239,68,68,0.32)",
              color: "#fee2e2",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            SIMPLE WAY TO THINK ABOUT IT
          </div>

          <div
            style={{
              marginTop: 12,
              fontSize: 28,
              fontWeight: 950,
              lineHeight: 1.15,
              letterSpacing: "-0.5px",
            }}
          >
            Price looks stronger, but momentum is no longer improving at the same pace.
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <HighlightCard
              title="Price"
              text="Pushes to a higher high."
              tint="red"
            />
            <HighlightCard
              title="Momentum"
              text="Makes a lower high or a less strong reading."
              tint="blue"
            />
            <HighlightCard
              title="Idea"
              text="Buyers may be losing control even before price turns."
              tint="amber"
            />
          </div>
        </section>

        <section
          style={{
            marginTop: 24,
            display: "grid",
            gap: 18,
          }}
        >
          <ContentSection
            number="1"
            title="What is bearish divergence in stocks?"
            tint="red"
          >
            <p style={paragraphStyle}>
              Bearish divergence is a disagreement between price and momentum.
              Price makes a new high, but an indicator such as RSI or MACD fails to
              make a matching new high. That mismatch can suggest the bullish move
              is losing strength.
            </p>

            <p style={paragraphStyle}>
              Traders often look for bearish divergence after a strong rally or
              when a stock is approaching resistance. It can help identify charts
              that deserve a closer look rather than assuming strength will simply
              continue without pause.
            </p>
          </ContentSection>

          <ContentSection
            number="2"
            title="Indicators often used for bearish divergence"
            tint="purple"
          >
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <IndicatorCard
                title="RSI divergence"
                text="Price makes a higher high while RSI makes a lower high or refuses to confirm the same upside extreme."
              />
              <IndicatorCard
                title="MACD divergence"
                text="Price strengthens further, but MACD momentum does not make an equally strong new high."
              />
              <IndicatorCard
                title="Stochastic or other momentum tools"
                text="Other oscillators can also reveal when upside momentum is no longer confirming fresh strength in price."
              />
            </div>
          </ContentSection>

          <ContentSection
            number="3"
            title="Why traders look for bearish divergence"
            tint="amber"
          >
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gap: 10,
              }}
            >
              <BulletRow text="It can help identify early pullback or reversal candidates." />
              <BulletRow text="It may reveal fading upside momentum." />
              <BulletRow text="It works well alongside overbought conditions and resistance." />
              <BulletRow text="It can help traders avoid assuming every higher high means growing strength." />
            </div>

            <p style={paragraphStyle}>
              The strongest setups usually happen when divergence appears with a
              clear chart level or a broader reason for sellers to step in.
            </p>
          </ContentSection>

          <ContentSection
            number="4"
            title="The biggest mistake with bearish divergence"
            tint="blue"
          >
            <p style={paragraphStyle}>
              The biggest mistake is treating divergence as an automatic sell signal.
              A stock can show bearish divergence and still keep rising, especially
              in a strong uptrend or supportive market. Divergence is better used as
              an alert that something may be changing, not proof that the top is in.
            </p>

            <p style={paragraphStyle}>
              That is why chart structure matters. It helps to see whether price is
              near resistance, whether buying pressure is slowing, and whether the
              broader context supports a pullback attempt.
            </p>
          </ContentSection>

          <ContentSection
            number="5"
            title="How MyStockHarbor helps you find bearish divergence stocks"
            tint="green"
          >
            <p style={paragraphStyle}>
              MyStockHarbor helps you scan for stock ideas without checking large
              watchlists manually. Instead of building a complicated screen from
              scratch, you can browse grouped setups and then inspect the chart
              more closely.
            </p>

            <p style={paragraphStyle}>
              The{" "}
              <Link href="/pickers" style={inlineLinkStyle}>
                Find Your Next Stock
              </Link>{" "}
              page is useful here because it includes divergence setups alongside
              oversold-leaning stocks, buy-the-dip candidates and breakouts. That
              makes it easier to build a shortlist of possible weakness or reversal
              charts worth reviewing.
            </p>
          </ContentSection>

          <ContentSection
            number="6"
            title="A simple beginner approach"
            tint="red"
          >
            <p style={paragraphStyle}>
              Treat bearish divergence as a clue, not a conclusion. First look for
              the divergence. Then check resistance, trend structure, stretch and
              market context before deciding whether the chart deserves more attention.
            </p>

            <p style={paragraphStyle}>
              In practice, divergence helps you find interesting ideas earlier,
              but price action still needs to confirm the setup.
            </p>
          </ContentSection>
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
            NEXT STEP
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontWeight: 900,
              fontSize: 26,
              letterSpacing: "-0.4px",
            }}
          >
            Explore live bearish divergence stock ideas on MyStockHarbor
          </h2>

          <p
            style={{
              marginTop: 10,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 820,
            }}
          >
            Use MyStockHarbor to review trend, momentum, stretch, divergence and
            chart structure in one place. Start with live stock ideas, then open
            the chart and decide whether the setup deserves a closer look.
          </p>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/pickers"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "13px 18px",
                borderRadius: 14,
                border: "1px solid rgba(239,68,68,0.42)",
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
                color: "#fef2f2",
                textDecoration: "none",
                fontWeight: 900,
                minHeight: 48,
                whiteSpace: "nowrap",
              }}
            >
              Browse Stock Ideas →
            </Link>

            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "13px 18px",
                borderRadius: 14,
                border: "1px solid rgba(250,204,21,0.42)",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.22), rgba(202,138,4,0.12))",
                color: "#fefce8",
                textDecoration: "none",
                fontWeight: 900,
                minHeight: 48,
                whiteSpace: "nowrap",
              }}
            >
              Open the Dashboard →
            </Link>
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 900px;
          margin: 0 auto;
          padding: 28px 20px 40px;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        @media (max-width: 760px) {
          .wrap {
            padding: 18px 16px 34px !important;
          }
        }
      `}</style>
    </main>
  );
}

function ContentSection({
  number,
  title,
  tint,
  children,
}: {
  number: string;
  title: string;
  tint: "blue" | "green" | "red" | "amber" | "purple";
  children: React.ReactNode;
}) {
  const styles =
    tint === "blue"
      ? {
          border: "1px solid rgba(59,130,246,0.22)",
          background:
            "linear-gradient(180deg, rgba(10,18,34,0.96), rgba(7,12,24,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
          badgeBorder: "1px solid rgba(59,130,246,0.34)",
          badgeColor: "#dbeafe",
        }
      : tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.22)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
          badgeBorder: "1px solid rgba(34,197,94,0.34)",
          badgeColor: "#dcfce7",
        }
      : tint === "red"
      ? {
          border: "1px solid rgba(239,68,68,0.22)",
          background:
            "linear-gradient(180deg, rgba(24,12,12,0.96), rgba(14,7,7,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))",
          badgeBorder: "1px solid rgba(239,68,68,0.34)",
          badgeColor: "#fee2e2",
        }
      : tint === "amber"
      ? {
          border: "1px solid rgba(234,179,8,0.22)",
          background:
            "linear-gradient(180deg, rgba(18,16,10,0.96), rgba(12,10,7,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(234,179,8,0.18), rgba(202,138,4,0.10))",
          badgeBorder: "1px solid rgba(234,179,8,0.34)",
          badgeColor: "#fef3c7",
        }
      : {
          border: "1px solid rgba(168,85,247,0.22)",
          background:
            "linear-gradient(180deg, rgba(12,16,34,0.96), rgba(8,11,24,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(139,92,246,0.10))",
          badgeBorder: "1px solid rgba(168,85,247,0.34)",
          badgeColor: "#f3e8ff",
        };

  return (
    <section
      style={{
        border: styles.border,
        borderRadius: 18,
        padding: 20,
        background: styles.background,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "7px 12px",
          borderRadius: 999,
          background: styles.badgeBg,
          border: styles.badgeBorder,
          color: styles.badgeColor,
          fontWeight: 950,
          letterSpacing: "0.08em",
          fontSize: 12,
        }}
      >
        SECTION {number}
      </div>

      <h2
        style={{
          margin: "14px 0 0 0",
          fontSize: 26,
          lineHeight: 1.2,
          letterSpacing: "-0.4px",
        }}
      >
        {title}
      </h2>

      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

function HighlightCard({
  title,
  text,
  tint,
}: {
  title: string;
  text: string;
  tint: "blue" | "red" | "amber";
}) {
  const styles =
    tint === "blue"
      ? {
          border: "1px solid rgba(59,130,246,0.24)",
          background:
            "linear-gradient(180deg, rgba(10,18,34,0.94), rgba(7,12,24,0.98))",
        }
      : tint === "red"
      ? {
          border: "1px solid rgba(239,68,68,0.24)",
          background:
            "linear-gradient(180deg, rgba(24,12,12,0.94), rgba(14,7,7,0.98))",
        }
      : {
          border: "1px solid rgba(234,179,8,0.24)",
          background:
            "linear-gradient(180deg, rgba(18,16,10,0.94), rgba(12,10,7,0.98))",
        };

  return (
    <div
      style={{
        ...styles,
        borderRadius: 16,
        padding: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 15 }}>{title}</div>
      <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.55 }}>{text}</div>
    </div>
  );
}

function IndicatorCard({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.05)",
        padding: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
      <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

function BulletRow({ text }: { text: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.04)",
        padding: "12px 14px",
        lineHeight: 1.55,
        opacity: 0.9,
      }}
    >
      {text}
    </div>
  );
}

const paragraphStyle: React.CSSProperties = {
  marginTop: 12,
  opacity: 0.86,
  lineHeight: 1.7,
};

const inlineLinkStyle: React.CSSProperties = {
  color: "#60a5fa",
  fontWeight: 800,
  textDecoration: "none",
};

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

function topNavIcon(type: "dashboard" | "platforms" | "pickers" | "calculators") {
  if (type === "dashboard") return "📈";
  if (type === "platforms") return "🏦";
  if (type === "pickers") return "📊";
  return "🧮";
}
