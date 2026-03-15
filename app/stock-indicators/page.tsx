import Link from "next/link";

export default function StockIndicatorsPage() {
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

          <div style={{ maxWidth: 780 }}>
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
              INDICATORS
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Understand the indicators behind these signals
            </h1>

            <p
              style={{
                margin: "12px 0 0 0",
                opacity: 0.82,
                lineHeight: 1.65,
                fontSize: 17,
                maxWidth: 760,
              }}
            >
              Technical indicators help traders measure momentum, trend,
              overextension and participation. Use this hub to understand the
              main indicators connected to screened stock ideas on
              MyStockHarbor, then go deeper into the individual guides below.
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
            maxWidth: 980,
          }}
        >
          <div style={{ fontWeight: 950, fontSize: 24 }}>
            Why these indicators matter
          </div>

          <div
            style={{
              marginTop: 8,
              opacity: 0.86,
              lineHeight: 1.65,
              maxWidth: 860,
            }}
          >
            Indicators do not replace price action, but they can help traders
            organise what they are seeing on a chart. Some indicators focus on
            momentum, some on trend direction, and some on volume or longer-term
            structure. The goal is not to memorise formulas, but to understand
            what each indicator is trying to highlight.
          </div>
        </section>

        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
            maxWidth: 980,
          }}
        >
          <IndicatorCard
            href="/what-is-rsi-indicator"
            title="Understand RSI"
            desc="Read how RSI can help identify oversold and overbought zones."
            tint="green"
          />

          <IndicatorCard
            href="/what-is-macd-indicator"
            title="Learn MACD Divergence"
            desc="MACD can help confirm momentum shifts, trend strength and divergence."
            tint="blue"
          />

          <IndicatorCard
            href="/stocks-with-high-rsi"
            title="Stocks With High RSI"
            desc="Learn what high RSI can mean when momentum becomes extended."
            tint="amber"
          />

          <IndicatorCard
            href="/stocks-with-low-rsi"
            title="Stocks With Low RSI"
            desc="Explore how traders use low RSI readings to review stretched downside moves."
            tint="green"
          />

          <IndicatorCard
            href="/stocks-with-unusual-volume"
            title="Stocks With Unusual Volume"
            desc="See why unusual volume can matter when reviewing breakouts and momentum."
            tint="purple"
          />

          <IndicatorCard
            href="/stocks-above-200-day-moving-average"
            title="Stocks Above 200 Day Moving Average"
            desc="Understand how traders use the 200-day moving average as a long-term trend filter."
            tint="blue"
          />
        </div>

        <section
          style={{
            marginTop: 24,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            padding: 20,
            background:
              "linear-gradient(180deg, rgba(9,13,20,0.92), rgba(7,10,16,0.96))",
            maxWidth: 980,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 26,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Common types of stock indicators
          </h2>

          <div
            style={{
              marginTop: 12,
              display: "grid",
              gap: 14,
              maxWidth: 860,
              opacity: 0.8,
              lineHeight: 1.7,
            }}
          >
            <p style={{ margin: 0 }}>
              Momentum indicators such as RSI and MACD help traders judge
              whether buying or selling pressure may be strengthening or fading.
              These tools are often used when reviewing oversold stocks,
              overbought stocks and divergence setups.
            </p>

            <p style={{ margin: 0 }}>
              Trend filters such as the 200-day moving average help traders step
              back and judge the bigger picture. A stock trading above or below
              a major moving average can change how a setup is interpreted.
            </p>

            <p style={{ margin: 0 }}>
              Volume-based clues can also matter. Unusual volume does not
              guarantee anything, but it can help confirm whether a breakout,
              pullback or momentum move is attracting real participation.
            </p>
          </div>
        </section>

        <section
          style={{
            marginTop: 24,
            border: "1px solid rgba(34,197,94,0.22)",
            borderRadius: 18,
            padding: 20,
            background:
              "linear-gradient(180deg, rgba(8,20,16,0.96), rgba(7,12,11,0.98))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            maxWidth: 980,
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
              fontSize: 26,
              letterSpacing: "-0.4px",
            }}
          >
            Put the indicators into live chart practice
          </h2>

          <p
            style={{
              margin: "10px 0 0 0",
              opacity: 0.82,
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          >
            Once you understand what an indicator is measuring, the next step is
            to see it on real charts. Use the Dashboard to inspect symbols one
            by one, or use Stock Pickers to find screened ideas that may already
            match the kinds of signals you are learning about.
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
                border: "1px solid rgba(59,130,246,0.38)",
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))",
                color: "#eff6ff",
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

function IndicatorCard({
  href,
  title,
  desc,
  tint,
}: {
  href: string;
  title: string;
  desc: string;
  tint: "blue" | "green" | "amber" | "purple";
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
      border: "1px solid rgba(59,130,246,0.45)",
      background:
        "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))",
      color: "#eff6ff",
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
  type: "dashboard" | "platforms" | "pickers" | "calculators"
) {
  if (type === "dashboard") return "📈";
  if (type === "platforms") return "🏦";
  if (type === "pickers") return "📊";
  return "🧮";
}
