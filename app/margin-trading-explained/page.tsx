// app/margin-trading-explained/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Margin Trading Explained for Beginners | MyStockHarbor",
  description:
    "Learn what margin trading means, how leverage works, why liquidation risk matters, and how beginners should think about margin before using it.",
  alternates: {
    canonical: "/margin-trading-explained",
  },
  openGraph: {
    title: "Margin Trading Explained for Beginners | MyStockHarbor",
    description:
      "Understand margin trading, leverage, and liquidation risk in simple beginner-friendly language.",
    url: "https://mystockharbor.com/margin-trading-explained",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Margin Trading Explained for Beginners | MyStockHarbor",
    description:
      "Learn how margin trading works and why leverage can increase both opportunity and risk.",
  },
};

export default function MarginTradingExplainedPage() {
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
                  "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))",
                border: "1px solid rgba(168,85,247,0.34)",
                color: "#f3e8ff",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              MARGIN TRADING GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Margin Trading Explained for Beginners
            </h1>

            <p style={paragraphStyle}>
              Margin trading allows traders to control a larger position than
              their own cash would normally allow. It can increase gains when a
              trade works, but it also increases losses when price moves the
              wrong way.
            </p>

            <p style={paragraphStyle}>
              That is why margin should never be treated as free extra buying
              power. It is borrowed exposure, which means risk builds faster,
              liquidation can become a real issue, and small mistakes can do far
              more damage than beginners expect.
            </p>
          </div>
        </div>

        <section style={highlightBoxStyle()}>
          <div style={highlightLabelStyle()}>SIMPLE WAY TO THINK ABOUT IT</div>

          <div style={highlightTitleStyle()}>
            Margin makes your position bigger. It also makes your risk bigger.
          </div>

          <div style={highlightGridStyle()}>
            <HighlightCard
              title="Useful idea"
              text="Margin can increase exposure without committing the full trade value in cash."
              tint="blue"
            />
            <HighlightCard
              title="Main danger"
              text="Losses are magnified too, and forced liquidation can happen if price moves too far against you."
              tint="red"
            />
            <HighlightCard
              title="Best use"
              text="Only after you understand stop loss placement, position sizing, and liquidation risk."
              tint="green"
            />
          </div>
        </section>

        <ContentSection
          number="1"
          title="What is margin trading?"
          tint="blue"
        >
          <p style={paragraphStyle}>
            Margin trading means borrowing funds from a broker so you can open a
            larger trade than your own capital would normally allow. Instead of
            paying for the full position value yourself, you only provide part
            of it and the broker provides the rest.
          </p>

          <p style={paragraphStyle}>
            This is often described through leverage. For example, 2x leverage
            means you can control roughly twice as much position value as your
            own committed capital.
          </p>
        </ContentSection>

        <ContentSection
          number="2"
          title="How leverage works"
          tint="purple"
        >
          <p style={paragraphStyle}>
            Leverage increases exposure. If you have $1,000 and use 2x leverage,
            you may be able to control a $2,000 position. If the trade rises,
            gains on your own capital are amplified. If it falls, losses are
            amplified too.
          </p>

          <p style={paragraphStyle}>
            That is the core trade-off. Leverage can make returns look more
            attractive, but it also shortens the distance between a normal pullback
            and a serious loss.
          </p>
        </ContentSection>

        <ContentSection
          number="3"
          title="Why margin trading is riskier than normal trading"
          tint="red"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="Losses increase faster because the position is larger." />
            <BulletRow text="A smaller move against you can cause meaningful damage." />
            <BulletRow text="Liquidation risk becomes part of trade planning." />
            <BulletRow text="Emotion usually gets worse when leverage is involved." />
          </div>

          <p style={paragraphStyle}>
            Many beginners underestimate how quickly leverage changes the feel of
            a trade. A move that would be manageable in a normal cash position
            can feel far more stressful on margin.
          </p>
        </ContentSection>

        <ContentSection
          number="4"
          title="What is liquidation?"
          tint="amber"
        >
          <p style={paragraphStyle}>
            Liquidation is when a broker forces a position to close because the
            trade has moved too far against you and there is no longer enough
            margin to support it.
          </p>

          <p style={paragraphStyle}>
            This is one of the biggest reasons margin trading deserves respect.
            If a trader does not understand where liquidation may sit, they can
            be exposed to forced exits before they have a chance to manage the
            trade properly.
          </p>
        </ContentSection>

        <ContentSection
          number="5"
          title="Common beginner mistakes with margin"
          tint="red"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="Using leverage before learning basic risk management." />
            <BulletRow text="Trading too large because the broker allows it." />
            <BulletRow text="Ignoring liquidation distance." />
            <BulletRow text="Treating borrowed buying power as if it were their own cash." />
          </div>
        </ContentSection>

        <ContentSection
          number="6"
          title="A better beginner approach"
          tint="green"
        >
          <p style={paragraphStyle}>
            Beginners are usually better off learning chart structure, stop
            placement, and position sizing before using margin. The cleaner your
            risk process is, the easier it becomes to judge whether leverage is
            even appropriate.
          </p>

          <p style={paragraphStyle}>
            In other words, margin should sit on top of a solid risk framework,
            not replace one.
          </p>
        </ContentSection>

        <section style={ctaBoxStyle()}>
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
            Use MyStockHarbor to estimate liquidation risk before using leverage
          </h2>

          <p
            style={{
              marginTop: 10,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 820,
            }}
          >
            The MyStockHarbor margin calculator helps you estimate liquidation
            price and distance to liquidation so you can think more clearly
            about risk before opening a leveraged trade.
          </p>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Link href="/utilities" style={ctaPrimaryStyle()}>
              Open the Margin Calculator →
            </Link>

            <Link href="/risk-reward-ratio" style={ctaSecondaryStyle()}>
              Read Risk Reward Guide →
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

function topNavBtnStyle(
  type: "dashboard" | "learn" | "pickers" | "calculators"
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

function topNavIcon(
  type: "dashboard" | "learn" | "pickers" | "calculators"
) {
  if (type === "dashboard") return "📈";
  if (type === "learn") return "📘";
  if (type === "pickers") return "📊";
  return "🧮";
}

function highlightBoxStyle(): React.CSSProperties {
  return {
    marginTop: 24,
    padding: 20,
    borderRadius: 18,
    border: "1px solid rgba(168,85,247,0.28)",
    background:
      "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(59,130,246,0.08))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

function highlightLabelStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 12px",
    borderRadius: 999,
    background:
      "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(59,130,246,0.10))",
    border: "1px solid rgba(168,85,247,0.32)",
    color: "#f3e8ff",
    fontWeight: 950,
    letterSpacing: "0.08em",
    fontSize: 12,
  };
}

function highlightTitleStyle(): React.CSSProperties {
  return {
    marginTop: 12,
    fontSize: 28,
    fontWeight: 950,
    lineHeight: 1.15,
    letterSpacing: "-0.5px",
  };
}

function highlightGridStyle(): React.CSSProperties {
  return {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  };
}

function bulletGridStyle(): React.CSSProperties {
  return {
    marginTop: 14,
    display: "grid",
    gap: 10,
  };
}

function ctaBoxStyle(): React.CSSProperties {
  return {
    marginTop: 28,
    padding: 20,
    borderRadius: 18,
    border: "1px solid rgba(34,197,94,0.28)",
    background:
      "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

function ctaPrimaryStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "13px 18px",
    borderRadius: 14,
    border: "1px solid rgba(168,85,247,0.42)",
    background:
      "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.18))",
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

function ContentSection({
  number,
  title,
  tint,
  children,
}: {
  number: string;
  title: string;
  tint: "blue" | "green" | "purple" | "amber" | "red";
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
        marginTop: 24,
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
  tint: "blue" | "green" | "red";
}) {
  const styles =
    tint === "blue"
      ? {
          border: "1px solid rgba(59,130,246,0.24)",
          background:
            "linear-gradient(180deg, rgba(10,18,34,0.94), rgba(7,12,24,0.98))",
        }
      : tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.24)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.94), rgba(7,12,11,0.98))",
        }
      : {
          border: "1px solid rgba(239,68,68,0.24)",
          background:
            "linear-gradient(180deg, rgba(24,12,12,0.94), rgba(14,7,7,0.98))",
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
