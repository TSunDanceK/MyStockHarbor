import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Position Sizing in Trading: How to Control Risk | MyStockHarbor",
  description:
    "Learn how position sizing works in trading, how to calculate trade size based on stop loss and risk, and why proper position sizing protects your capital.",
  alternates: {
    canonical: "/position-sizing-guide",
  },
  openGraph: {
    title: "Position Sizing in Trading | MyStockHarbor",
    description:
      "Understand how to size trades properly using risk management and stop losses.",
    url: "https://mystockharbor.com/position-sizing-guide",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Position Sizing in Trading | MyStockHarbor",
    description:
      "Learn how to calculate position size and protect your capital when trading.",
  },
};

export default function PositionSizingGuidePage() {
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

          {/* NAV BUTTONS */}

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
              {topNavIcon("dashboard")} Dashboard
            </Link>

            <Link href="/learn" style={topNavBtnStyle("learn")}>
              {topNavIcon("learn")} Learn
            </Link>

            <Link href="/pickers" style={topNavBtnStyle("pickers")}>
              {topNavIcon("pickers")} Stock Pickers
            </Link>

            <Link href="/utilities" style={topNavBtnStyle("calculators")}>
              {topNavIcon("calculators")} Calculators
            </Link>
          </div>

          {/* HEADER */}

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
              POSITION SIZING GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Position Sizing in Trading: How to Control Risk
            </h1>

            <p style={paragraphStyle}>
              Position sizing is one of the most important ideas in trading
              risk management. It determines how much capital you commit to a
              trade based on the amount you are prepared to lose if the trade
              goes wrong.
            </p>

            <p style={paragraphStyle}>
              Many beginners focus only on finding the right stock, but
              experienced traders focus just as much on controlling risk.
              Position sizing ensures that one bad trade cannot damage your
              account.
            </p>
          </div>
        </div>

        {/* SIMPLE IDEA SECTION */}

        <section style={highlightBoxStyle()}>
          <div style={highlightLabelStyle()}>SIMPLE WAY TO THINK ABOUT IT</div>

          <div style={highlightTitleStyle()}>
            Position size should be based on risk, not confidence.
          </div>

          <div style={highlightGridStyle()}>
            <HighlightCard
              title="Good practice"
              text="Decide how much money you are willing to lose before entering a trade."
              tint="green"
            />

            <HighlightCard
              title="Common mistake"
              text="Buying too many shares simply because the trade looks attractive."
              tint="red"
            />

            <HighlightCard
              title="Better approach"
              text="Let your stop loss distance determine the number of shares you buy."
              tint="blue"
            />
          </div>
        </section>

        {/* CONTENT SECTIONS */}

        <ContentSection
          number="1"
          title="What is position sizing?"
          tint="blue"
        >
          <p style={paragraphStyle}>
            Position sizing means deciding how large a trade should be based on
            your risk tolerance and stop loss distance. Instead of randomly
            choosing a number of shares, traders calculate trade size so that
            losses stay within a controlled limit.
          </p>

          <p style={paragraphStyle}>
            For example, if you are willing to risk $100 on a trade and your
            stop loss is $2 away from your entry price, you would buy about
            50 shares.
          </p>
        </ContentSection>

        <ContentSection
          number="2"
          title="Why position sizing matters"
          tint="green"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="Protects your account from large losses." />
            <BulletRow text="Keeps risk consistent across different trades." />
            <BulletRow text="Prevents emotional decision making." />
            <BulletRow text="Helps traders survive losing streaks." />
          </div>
        </ContentSection>

        <ContentSection
          number="3"
          title="How traders calculate position size"
          tint="purple"
        >
          <p style={paragraphStyle}>
            Most traders start with a maximum dollar risk per trade. For
            example, some traders risk 1% of their account on each trade.
          </p>

          <p style={paragraphStyle}>
            They then divide that risk amount by the distance between their
            entry price and stop loss. The result determines how many shares
            they can buy.
          </p>
        </ContentSection>

        <ContentSection
          number="4"
          title="Position sizing and stop losses"
          tint="amber"
        >
          <p style={paragraphStyle}>
            Position sizing only works properly when combined with a clear stop
            loss. Without a stop loss, traders cannot control their downside
            risk effectively.
          </p>

          <p style={paragraphStyle}>
            This is why many traders plan their exit level before deciding how
            large the trade should be.
          </p>
        </ContentSection>

        {/* CTA */}

        <section style={ctaBoxStyle()}>
          <div style={{ fontWeight: 900, fontSize: 22 }}>
            Calculate your trade size with MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            Use the MyStockHarbor risk calculator to estimate position size,
            stop loss risk and risk-reward before entering a trade.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/utilities" style={ctaPrimaryStyle()}>
              Open the Risk Calculators →
            </Link>

            <Link href="/" style={ctaSecondaryStyle()}>
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
  tint: "blue" | "green" | "purple" | "amber";
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
          margin: "14px 0 0",
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
