// app/trading-risk-management/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Trading Risk Management for Beginners | MyStockHarbor",
  description:
    "Learn the basics of trading risk management including stop losses, position sizing, risk reward, and why protecting capital matters more than chasing trades.",
  alternates: {
    canonical: "/trading-risk-management",
  },
  openGraph: {
    title: "Trading Risk Management for Beginners | MyStockHarbor",
    description:
      "A beginner-friendly guide to trading risk management, position sizing, and protecting your account.",
    url: "https://mystockharbor.com/trading-risk-management",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trading Risk Management for Beginners | MyStockHarbor",
    description:
      "Learn the core principles of trading risk management before risking real capital.",
  },
};

export default function TradingRiskManagementPage() {
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
                  "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))",
                border: "1px solid rgba(34,197,94,0.34)",
                color: "#dcfce7",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              RISK MANAGEMENT GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Trading Risk Management for Beginners
            </h1>

            <p style={paragraphStyle}>
              Risk management is the part of trading that protects your account
              when a trade does not work. Most beginners spend too much time
              looking for entries and not enough time deciding how much they can
              lose if they are wrong.
            </p>

            <p style={paragraphStyle}>
              Good traders are not just trying to find winning trades. They are
              also trying to keep losses controlled, position sizes sensible,
              and risk consistent enough to survive over time.
            </p>
          </div>
        </div>

        <section style={highlightBoxStyle()}>
          <div style={highlightLabelStyle()}>SIMPLE WAY TO THINK ABOUT IT</div>

          <div style={highlightTitleStyle()}>
            Risk management is not what makes trading exciting. It is what keeps
            you in the game.
          </div>

          <div style={highlightGridStyle()}>
            <HighlightCard
              title="Main purpose"
              text="Protect capital so one bad trade does not cause outsized damage."
              tint="green"
            />
            <HighlightCard
              title="Big mistake"
              text="Taking random position sizes and hoping the trade works out."
              tint="red"
            />
            <HighlightCard
              title="Best mindset"
              text="Plan the downside first, then decide whether the upside is worth it."
              tint="blue"
            />
          </div>
        </section>

        <ContentSection
          number="1"
          title="What is trading risk management?"
          tint="blue"
        >
          <p style={paragraphStyle}>
            Trading risk management is the process of controlling how much you
            could lose on any one trade or across a series of trades. It
            includes things like stop losses, position sizing, risk reward, and
            deciding how much of your capital is exposed at once.
          </p>

          <p style={paragraphStyle}>
            The goal is not to avoid all losses. Losses are part of trading. The
            goal is to make sure losses stay small enough that they do not wreck
            your account or your confidence.
          </p>
        </ContentSection>

        <ContentSection
          number="2"
          title="Why risk management matters more than beginners expect"
          tint="green"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="Even strong setups fail sometimes." />
            <BulletRow text="A few oversized losses can undo many smaller wins." />
            <BulletRow text="Consistent risk makes trading easier to evaluate." />
            <BulletRow text="Protecting capital gives you more chances to improve." />
          </div>

          <p style={paragraphStyle}>
            Many traders do not fail because they never had a good idea. They
            fail because they sized trades too aggressively, moved stops
            emotionally, or let one mistake become much larger than it should
            have been.
          </p>
        </ContentSection>

        <ContentSection
          number="3"
          title="The basic building blocks of risk management"
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
            <InfoCard
              title="Stop loss"
              text="Defines where the trade is wrong and where losses should be limited."
            />
            <InfoCard
              title="Position size"
              text="Controls how large the trade should be based on your risk amount."
            />
            <InfoCard
              title="Risk reward"
              text="Helps compare whether the upside is attractive enough versus the downside."
            />
            <InfoCard
              title="Exposure control"
              text="Prevents too much capital being tied to one idea, sector, or theme."
            />
          </div>
        </ContentSection>

        <ContentSection
          number="4"
          title="Why stop losses matter"
          tint="red"
        >
          <p style={paragraphStyle}>
            A stop loss gives structure to your downside. It tells you where the
            setup has failed and where the trade should be exited before damage
            becomes much larger.
          </p>

          <p style={paragraphStyle}>
            Without a stop, losses can grow based on hope rather than logic.
            That usually leads to poor decisions, larger drawdowns, and much
            harder recovery.
          </p>
        </ContentSection>

        <ContentSection
          number="5"
          title="Why position sizing matters"
          tint="amber"
        >
          <p style={paragraphStyle}>
            Position sizing decides how many shares or how much capital should
            go into a trade. This is where many beginners go wrong. They find a
            setup they like and then choose trade size emotionally rather than
            logically.
          </p>

          <p style={paragraphStyle}>
            A better approach is to decide your maximum acceptable dollar risk
            first, then size the trade according to the stop loss distance.
          </p>
        </ContentSection>

        <ContentSection
          number="6"
          title="Why risk reward matters"
          tint="blue"
        >
          <p style={paragraphStyle}>
            Risk reward helps you compare the possible upside of a trade against
            the downside you are accepting. It does not make a setup good on its
            own, but it helps you avoid taking trades where the upside is too
            small for the risk involved.
          </p>

          <p style={paragraphStyle}>
            The key is to keep targets realistic. A fake target that only exists
            to improve the ratio is not useful.
          </p>
        </ContentSection>

        <ContentSection
          number="7"
          title="A simple beginner framework"
          tint="green"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="Start with chart structure and identify where the setup fails." />
            <BulletRow text="Place the stop where the trade idea is clearly invalidated." />
            <BulletRow text="Choose a fixed dollar amount you are willing to risk." />
            <BulletRow text="Size the position from the stop distance, not from emotion." />
            <BulletRow text="Check whether the reward justifies the risk before entering." />
          </div>
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
            Use MyStockHarbor to plan risk before entering a trade
          </h2>

          <p
            style={{
              marginTop: 10,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 820,
            }}
          >
            The MyStockHarbor calculators can help you estimate position size,
            risk reward, and liquidation distance before taking a trade. You can
            then use the dashboard and stock pickers to review whether the chart
            setup actually supports the idea.
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
              Open the Calculators →
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
    border: "1px solid rgba(34,197,94,0.28)",
    background:
      "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(59,130,246,0.08))",
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
      "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.10))",
    border: "1px solid rgba(34,197,94,0.32)",
    color: "#dcfce7",
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
    border: "1px solid rgba(59,130,246,0.28)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(168,85,247,0.08))",
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
    border: "1px solid rgba(34,197,94,0.42)",
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
      <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.55 }}>
        {text}
      </div>
    </div>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
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
