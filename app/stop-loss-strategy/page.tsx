import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stop Loss Strategy for Beginners | MyStockHarbor",
  description:
    "Learn how stop loss strategy works in trading, where traders place stop losses, and how stop losses help control downside risk.",
  alternates: {
    canonical: "/stop-loss-strategy",
  },
  openGraph: {
    title: "Stop Loss Strategy for Beginners | MyStockHarbor",
    description:
      "Understand how stop losses work and how traders use them to control risk.",
    url: "https://mystockharbor.com/stop-loss-strategy",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stop Loss Strategy for Beginners | MyStockHarbor",
    description:
      "Learn how stop losses help traders control downside risk and plan trades more clearly.",
  },
};

export default function StopLossStrategyPage() {
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
                  "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
                border: "1px solid rgba(239,68,68,0.34)",
                color: "#fee2e2",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              STOP LOSS GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Stop Loss Strategy for Beginners
            </h1>

            <p style={paragraphStyle}>
              A stop loss is one of the simplest risk management tools in
              trading. It helps you define where you will exit a trade if price
              moves against you, rather than hoping the market turns around.
            </p>

            <p style={paragraphStyle}>
              Many beginners spend too much time thinking about entry and not
              enough time planning the downside. A good stop loss strategy helps
              protect capital, reduce emotional decision making, and keep losses
              controlled.
            </p>
          </div>
        </div>

        <section style={highlightBoxStyle()}>
          <div style={highlightLabelStyle()}>SIMPLE WAY TO THINK ABOUT IT</div>

          <div style={highlightTitleStyle()}>
            A stop loss is not a prediction. It is a risk boundary.
          </div>

          <div style={highlightGridStyle()}>
            <HighlightCard
              title="Main purpose"
              text="It tells you where the trade idea is no longer working."
              tint="blue"
            />
            <HighlightCard
              title="Big mistake"
              text="Moving a stop loss further away just to avoid taking a loss."
              tint="red"
            />
            <HighlightCard
              title="Best use"
              text="Set it before entry, then size the trade around that risk."
              tint="green"
            />
          </div>
        </section>

        <ContentSection
          number="1"
          title="What is a stop loss?"
          tint="blue"
        >
          <p style={paragraphStyle}>
            A stop loss is a predefined exit level used to limit risk if a trade
            moves the wrong way. Instead of waiting and hoping, the trader
            decides in advance where the setup would be invalidated.
          </p>

          <p style={paragraphStyle}>
            In practical terms, a stop loss is the level where you accept that
            the trade is not behaving as expected and you want to protect your
            account from larger damage.
          </p>
        </ContentSection>

        <ContentSection
          number="2"
          title="Why stop losses matter"
          tint="green"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="They protect capital from large unexpected losses." />
            <BulletRow text="They help traders stay disciplined under pressure." />
            <BulletRow text="They make position sizing possible." />
            <BulletRow text="They reduce emotional decision making after entry." />
          </div>

          <p style={paragraphStyle}>
            A trader without a stop loss often ends up making decisions after
            price has already moved too far against them.
          </p>
        </ContentSection>

        <ContentSection
          number="3"
          title="Where traders place stop losses"
          tint="purple"
        >
          <p style={paragraphStyle}>
            Traders usually place stop losses at levels where the setup would no
            longer make sense. That might be below support, below a recent swing
            low, above resistance on a short trade, or beyond a volatility-based
            level.
          </p>

          <p style={paragraphStyle}>
            The key idea is that the stop should reflect the structure of the
            chart, not just an arbitrary dollar amount.
          </p>
        </ContentSection>

        <ContentSection
          number="4"
          title="Common stop loss mistakes"
          tint="red"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="Placing stops too tight with no regard for normal volatility." />
            <BulletRow text="Placing stops too far away and taking oversized risk." />
            <BulletRow text="Moving stops further away once price moves against the trade." />
            <BulletRow text="Using the same stop style for every stock and market condition." />
          </div>
        </ContentSection>

        <ContentSection
          number="5"
          title="How stop losses connect to position sizing"
          tint="amber"
        >
          <p style={paragraphStyle}>
            Stop losses and position sizing work together. Once you know where
            your stop loss is, you can work out how many shares fit your
            acceptable dollar risk.
          </p>

          <p style={paragraphStyle}>
            For example, if your stop is $2 away from entry and you only want to
            risk $100, your size should be about 50 shares. This is why stop
            placement comes before position size, not after.
          </p>
        </ContentSection>

        <ContentSection
          number="6"
          title="A simple beginner approach"
          tint="blue"
        >
          <p style={paragraphStyle}>
            Before entering a trade, ask yourself: where would this setup be
            clearly wrong? That level is often a better stop loss candidate than
            a random percentage or emotional guess.
          </p>

          <p style={paragraphStyle}>
            Then calculate position size so that the loss stays small and
            manageable if the stop is hit.
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
            Use MyStockHarbor to plan your stop loss and trade risk
          </h2>

          <p
            style={{
              marginTop: 10,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 820,
            }}
          >
            The MyStockHarbor calculators help you work out position size, risk,
            and trade planning before you enter a setup. You can also use the
            dashboard and stock pickers to review chart structure first, then
            come back to calculate risk more clearly.
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
              Open the Risk Calculators →
            </Link>

            <Link href="/position-sizing-guide" style={ctaSecondaryStyle()}>
              Read Position Sizing Guide →
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
    border: "1px solid rgba(239,68,68,0.28)",
    background:
      "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(168,85,247,0.08))",
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
      "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(168,85,247,0.10))",
    border: "1px solid rgba(239,68,68,0.32)",
    color: "#fee2e2",
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
