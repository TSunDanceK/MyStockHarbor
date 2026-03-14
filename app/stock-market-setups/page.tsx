import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stock Market Setups: Dip, Breakout, Divergence & Momentum Ideas | MyStockHarbor",
  description:
    "Explore common stock market setups including oversold stocks, breakouts, bullish divergence, and buy-the-dip opportunities. Learn how traders review these ideas.",
};

const setups = [
  {
    title: "Oversold Stocks",
    href: "/oversold-stocks",
    description:
      "Learn how traders identify oversold stocks and potential rebound setups when price becomes stretched downward.",
    tint: "blue" as const,
  },
  {
    title: "Overbought Stocks",
    href: "/overbought-stocks",
    description:
      "Understand how traders identify overbought conditions and stretched upside momentum.",
    tint: "amber" as const,
  },
  {
    title: "Breakout Stocks",
    href: "/breakout-stocks",
    description:
      "Learn how traders spot stocks breaking above resistance or moving into strong momentum.",
    tint: "red" as const,
  },
  {
    title: "Buy The Dip Stocks",
    href: "/buy-the-dip-stocks",
    description:
      "Explore how investors and traders review pullbacks in strong stocks and look for potential dip opportunities.",
    tint: "green" as const,
  },
  {
    title: "Stocks Down From Highs",
    href: "/stocks-down-from-highs",
    description:
      "Understand how traders review stocks that have fallen from recent highs and may be approaching interesting price levels.",
    tint: "purple" as const,
  },
  {
    title: "Bullish Divergence",
    href: "/bullish-divergence-stocks",
    description:
      "Learn how bullish divergence can signal fading downside momentum and possible reversal setups.",
    tint: "green" as const,
  },
  {
    title: "Bearish Divergence",
    href: "/bearish-divergence-stocks",
    description:
      "Understand how bearish divergence may highlight weakening upside momentum in rising stocks.",
    tint: "red" as const,
  },
];

export default function StockMarketSetupsPage() {
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

          <div style={{ maxWidth: 760 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.12))",
                border: "1px solid rgba(239,68,68,0.34)",
                color: "#fee2e2",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              TRADING SETUPS
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Common Stock Market Setups
            </h1>

            <p
              style={{
                margin: "12px 0 0 0",
                fontSize: 17,
                lineHeight: 1.65,
                opacity: 0.84,
              }}
            >
              Traders often look for specific chart conditions when reviewing stocks.
              These setups can help highlight opportunities where momentum, trend,
              stretch or price structure may be changing.
            </p>

            <p
              style={{
                margin: "12px 0 0 0",
                opacity: 0.8,
                lineHeight: 1.65,
              }}
            >
              Below are some common setups traders review including oversold
              conditions, breakouts, divergence signals and buy-the-dip pullbacks.
            </p>
          </div>
        </div>

        <section
          style={{
            marginTop: 24,
            borderRadius: 18,
            border: "1px solid rgba(59,130,246,0.24)",
            background:
              "linear-gradient(135deg, rgba(11,27,56,0.92), rgba(8,30,32,0.88))",
            padding: 20,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ fontWeight: 950, fontSize: 24 }}>How traders use setups</div>

          <div
            style={{
              marginTop: 8,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          >
            A setup does not guarantee a trade will work. It simply gives traders a
            structured way to review charts, compare risk, and spot recurring market
            behaviour. The more charts you review, the easier it becomes to recognise
            these patterns in real time.
          </div>
        </section>

        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {setups.map((setup) => (
            <SetupCard
              key={setup.href}
              href={setup.href}
              title={setup.title}
              description={setup.description}
              tint={setup.tint}
            />
          ))}
        </div>

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
            EXPLORE LIVE IDEAS
          </div>

          <h2 style={{ margin: "14px 0 0 0", fontWeight: 900, fontSize: 26 }}>
            Put these setups into practice
          </h2>

          <p
            style={{
              marginTop: 10,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 820,
            }}
          >
            You can explore many of these setups directly using the MyStockHarbor
            tools. Review live charts in the Dashboard, or use Stock Pickers to search
            for stocks that may match the setup you are learning.
          </p>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "11px 15px",
                borderRadius: 12,
                border: "1px solid rgba(250,204,21,0.42)",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.22), rgba(202,138,4,0.12))",
                color: "#fefce8",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Open the Dashboard →
            </Link>

            <Link
              href="/pickers"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "11px 15px",
                borderRadius: 12,
                border: "1px solid rgba(239,68,68,0.38)",
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
                color: "#fef2f2",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Find Your Next Stock →
            </Link>
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 1000px;
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

function SetupCard({
  href,
  title,
  description,
  tint,
}: {
  href: string;
  title: string;
  description: string;
  tint: "blue" | "green" | "red" | "amber" | "purple";
}) {
  const styles =
    tint === "blue"
      ? {
          border: "1px solid rgba(59,130,246,0.24)",
          background:
            "linear-gradient(180deg, rgba(10,18,34,0.96), rgba(7,12,24,0.98))",
        }
      : tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.24)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))",
        }
      : tint === "red"
      ? {
          border: "1px solid rgba(239,68,68,0.24)",
          background:
            "linear-gradient(180deg, rgba(24,12,12,0.96), rgba(14,7,7,0.98))",
        }
      : tint === "amber"
      ? {
          border: "1px solid rgba(234,179,8,0.24)",
          background:
            "linear-gradient(180deg, rgba(18,16,10,0.96), rgba(12,10,7,0.98))",
        }
      : {
          border: "1px solid rgba(168,85,247,0.24)",
          background:
            "linear-gradient(180deg, rgba(14,11,24,0.96), rgba(9,8,16,0.98))",
        };

  return (
    <Link
      href={href}
      style={{
        ...styles,
        borderRadius: 16,
        padding: 18,
        textDecoration: "none",
        color: "#f1f5f9",
        display: "block",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        transition:
          "transform 120ms ease, filter 120ms ease, border-color 120ms ease, background 120ms ease",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 18 }}>{title}</div>

      <p
        style={{
          marginTop: 8,
          opacity: 0.8,
          lineHeight: 1.6,
          fontSize: 14,
        }}
      >
        {description}
      </p>
    </Link>
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
