import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Risk Reward Ratio Explained for Beginners | MyStockHarbor",
  description:
    "Learn what risk reward ratio means in trading, how to calculate it, and why traders use risk reward to judge whether a setup is worth taking.",
  alternates: {
    canonical: "/risk-reward-ratio",
  },
  openGraph: {
    title: "Risk Reward Ratio Explained for Beginners | MyStockHarbor",
    description:
      "Understand how risk reward ratio works and how traders use it to plan trades more clearly.",
    url: "https://mystockharbor.com/risk-reward-ratio",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Risk Reward Ratio Explained for Beginners | MyStockHarbor",
    description:
      "Learn how risk reward ratio helps traders compare potential upside and downside before entering a trade.",
  },
};

export default function RiskRewardRatioPage() {
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
                  "linear-gradient(135deg, rgba(234,179,8,0.20), rgba(202,138,4,0.10))",
                border: "1px solid rgba(234,179,8,0.34)",
                color: "#fef3c7",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              RISK REWARD GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Risk Reward Ratio Explained for Beginners
            </h1>

            <p style={paragraphStyle}>
              Risk reward ratio compares how much you could lose on a trade with
              how much you could potentially make. Traders use it to judge
              whether a setup offers enough upside compared with the downside
              they are accepting.
            </p>

            <p style={paragraphStyle}>
              It is one of the simplest trade-planning concepts, but it becomes
              much more powerful when combined with stop loss placement,
              position sizing, and chart structure.
            </p>
          </div>
        </div>

        <section style={highlightBoxStyle()}>
          <div style={highlightLabelStyle()}>SIMPLE WAY TO THINK ABOUT IT</div>

          <div style={highlightTitleStyle()}>
            A trade is not just about being right. It is about whether the
            upside is worth the risk.
          </div>

          <div style={highlightGridStyle()}>
            <HighlightCard
              title="Good sign"
              text="The possible upside is meaningfully larger than the downside."
              tint="green"
            />
            <HighlightCard
              title="Warning sign"
              text="You are risking a lot for very limited potential reward."
              tint="red"
            />
            <HighlightCard
              title="Best use"
              text="Use it before entry to compare setups more clearly."
              tint="blue"
            />
          </div>
        </section>

        <ContentSection
          number="1"
          title="What is risk reward ratio?"
          tint="blue"
        >
          <p style={paragraphStyle}>
            Risk reward ratio measures the relationship between your potential
            loss and your potential gain on a trade. For example, if you are
            risking $2 per share to potentially make $6 per share, that is a
            1:3 risk reward ratio.
          </p>

          <p style={paragraphStyle}>
            Traders often use it to decide whether a setup is attractive enough
            to take. A higher ratio generally means the trade offers more upside
            relative to the risk being accepted.
          </p>
        </ContentSection>

        <ContentSection
          number="2"
          title="Why traders use risk reward"
          tint="green"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="It helps compare trade ideas more objectively." />
            <BulletRow text="It encourages better planning before entry." />
            <BulletRow text="It can improve long-term discipline." />
            <BulletRow text="It helps avoid low-quality setups with poor upside." />
          </div>

          <p style={paragraphStyle}>
            Risk reward does not guarantee success, but it can help traders
            avoid entering trades that offer little upside compared with the
            downside.
          </p>
        </ContentSection>

        <ContentSection
          number="3"
          title="How to calculate risk reward ratio"
          tint="purple"
        >
          <p style={paragraphStyle}>
            First, work out your entry price, stop loss, and target price. The
            distance from entry to stop is your risk. The distance from entry to
            target is your reward.
          </p>

          <p style={paragraphStyle}>
            Then divide reward by risk. If reward is $8 and risk is $4, the
            ratio is 2, meaning the trade has a 1:2 risk reward profile.
          </p>
        </ContentSection>

        <ContentSection
          number="4"
          title="What is considered good or bad?"
          tint="amber"
        >
          <p style={paragraphStyle}>
            There is no single perfect number, but many traders prefer setups
            where reward is clearly larger than risk. Ratios such as 1:2 or 1:3
            are often seen as more attractive than 1:1 or worse.
          </p>

          <p style={paragraphStyle}>
            Even so, risk reward should always be judged in context. A high
            ratio is not useful if the target is unrealistic or the stop loss
            placement makes no sense on the chart.
          </p>
        </ContentSection>

        <ContentSection
          number="5"
          title="Common mistakes with risk reward"
          tint="red"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="Using unrealistic profit targets just to make the ratio look better." />
            <BulletRow text="Ignoring chart structure when placing stops and targets." />
            <BulletRow text="Focusing only on the ratio and ignoring setup quality." />
            <BulletRow text="Taking low-quality trades just because the math looks attractive." />
          </div>
        </ContentSection>

        <ContentSection
          number="6"
          title="How risk reward fits with stop losses and position sizing"
          tint="blue"
        >
          <p style={paragraphStyle}>
            Risk reward is most useful when paired with a clear stop loss and
            sensible position sizing. The stop defines the downside, the target
            defines the upside, and the position size keeps total account risk
            under control.
          </p>

          <p style={paragraphStyle}>
            That is why good trade planning usually starts with structure and
            risk control, not just with a target price.
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
            Use MyStockHarbor to calculate risk reward before entering a trade
          </h2>

          <p
            style={{
              marginTop: 10,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 820,
            }}
          >
            The MyStockHarbor calculators help you estimate risk reward,
            position size, and stop loss planning before committing capital.
            You can also use the dashboard and stock pickers to review chart
            structure first, then test whether the setup offers enough upside.
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

            <Link href="/stop-loss-strategy" style={ctaSecondaryStyle()}>
              Read Stop Loss Guide →
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
    border: "1px solid rgba(234,179,8,0.28)",
    background:
      "linear-gradient(135deg, rgba(234,179,8,0.14), rgba(168,85,247,0.08))",
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
      "linear-gradient(135deg, rgba(234,179,8,0.18), rgba(168,85,247,0.10))",
    border: "1px solid rgba(234,179,8,0.32)",
    color: "#fef3c7",
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
      <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.55 }}>
        {text}
      </div>
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
