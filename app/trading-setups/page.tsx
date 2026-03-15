import Link from "next/link";

export default function TradingSetupsPage() {
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
              Trading Setups
            </h1>

            <p
              style={{
                margin: "12px 0 0 0",
                opacity: 0.8,
                lineHeight: 1.6,
                fontSize: 17,
              }}
            >
              Trading setups help traders spot repeatable opportunities in the stock
              market. Explore common setups like breakouts, oversold reversals, buy the
              dip ideas and bullish or bearish divergence so you can recognise what the
              chart is trying to tell you.
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
          <div style={{ fontWeight: 950, fontSize: 24 }}>How to use this page</div>

          <div
            style={{
              marginTop: 8,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          >
            Start with the setup you see most often on charts. Learn the basic idea,
            then compare it against live stocks using the Dashboard or Stock Pickers.
            The goal is not to memorise everything at once, but to build pattern
            recognition through repetition.
          </div>
        </section>

        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          <SetupCard
            href="/breakout-stocks"
            title="Breakout Stocks"
            desc="Stocks pushing above resistance with strong momentum and price expansion."
            tint="red"
          />

          <SetupCard
            href="/oversold-stocks"
            title="Oversold Stocks"
            desc="Stocks that may be stretched to the downside after heavy selling."
            tint="blue"
          />

          <SetupCard
            href="/overbought-stocks"
            title="Overbought Stocks"
            desc="Stocks that may be stretched after strong upside moves and fast rallies."
            tint="amber"
          />

          <SetupCard
            href="/buy-the-dip-stocks"
            title="Buy The Dip"
            desc="Pullback opportunities within stronger trends where buyers may step back in."
            tint="green"
          />

          <SetupCard
            href="/stocks-down-from-highs"
            title="Stocks Down From Highs"
            desc="Stocks that have pulled back significantly from recent highs and may be worth reviewing."
            tint="purple"
          />

          <SetupCard
            href="/bullish-divergence-stocks"
            title="Bullish Divergence"
            desc="When momentum starts improving even while price still looks weak."
            tint="green"
          />

          <SetupCard
            href="/bearish-divergence-stocks"
            title="Bearish Divergence"
            desc="When momentum starts weakening during rising prices and trend exhaustion may be building."
            tint="red"
          />
        </div>

        <section
          style={{
            marginTop: 24,
            border: "1px solid rgba(34,197,94,0.22)",
            borderRadius: 18,
            padding: 20,
            background:
              "linear-gradient(180deg, rgba(8,20,16,0.96), rgba(7,12,11,0.98))",
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

          <h2 style={{ margin: "14px 0 0 0", fontSize: 26, letterSpacing: "-0.4px" }}>
            Turn these lessons into live chart practice
          </h2>

          <p
            style={{
              margin: "10px 0 0 0",
              opacity: 0.82,
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          >
            Once you understand a setup in theory, the next step is seeing it on real
            stocks. Use the Dashboard to inspect charts and use Stock Pickers to search
            for ideas that match the setup you are learning.
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
              Explore Stock Pickers →
            </Link>
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 1000px;
          margin: 0 auto;
          padding: 24px;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
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

function SetupCard({
  href,
  title,
  desc,
  tint,
}: {
  href: string;
  title: string;
  desc: string;
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
        padding: 16,
        textDecoration: "none",
        color: "#f1f5f9",
        display: "block",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        transition:
          "transform 120ms ease, filter 120ms ease, border-color 120ms ease, background 120ms ease",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 17 }}>{title}</div>

      <div
        style={{
          marginTop: 7,
          fontSize: 13,
          opacity: 0.78,
          lineHeight: 1.55,
        }}
      >
        {desc}
      </div>
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
