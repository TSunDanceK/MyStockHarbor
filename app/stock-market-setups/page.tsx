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
  },
  {
    title: "Overbought Stocks",
    href: "/overbought-stocks",
    description:
      "Understand how traders identify overbought conditions and stretched upside momentum.",
  },
  {
    title: "Breakout Stocks",
    href: "/breakout-stocks",
    description:
      "Learn how traders spot stocks breaking above resistance or moving into strong momentum.",
  },
  {
    title: "Buy The Dip Stocks",
    href: "/buy-the-dip-stocks",
    description:
      "Explore how investors and traders review pullbacks in strong stocks and look for potential dip opportunities.",
  },
  {
    title: "Stocks Down From Highs",
    href: "/stocks-down-from-highs",
    description:
      "Understand how traders review stocks that have fallen from recent highs and may be approaching interesting price levels.",
  },
  {
    title: "Bullish Divergence",
    href: "/bullish-divergence-stocks",
    description:
      "Learn how bullish divergence can signal fading downside momentum and possible reversal setups.",
  },
  {
    title: "Bearish Divergence",
    href: "/bearish-divergence-stocks",
    description:
      "Understand how bearish divergence may highlight weakening upside momentum in rising stocks.",
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
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          padding: "28px 20px 40px",
        }}
      >
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <Link
            href="/"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              fontWeight: 850,
            }}
          >
            ← Dashboard
          </Link>

          <Link
            href="/learn"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              fontWeight: 850,
            }}
          >
            Learn →
          </Link>
        </div>

        <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
          TRADING SETUPS
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
          }}
        >
          Common Stock Market Setups
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
            maxWidth: 720,
          }}
        >
          Traders often look for specific chart conditions when reviewing stocks.
          These setups can help highlight opportunities where momentum, trend,
          stretch or price structure may be changing.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
            maxWidth: 720,
          }}
        >
          Below are some common setups traders review including oversold
          conditions, breakouts, divergence signals and buy-the-dip pullbacks.
        </p>

        <div
          style={{
            marginTop: 28,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {setups.map((setup) => (
            <Link
              key={setup.href}
              href={setup.href}
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 18,
                textDecoration: "none",
                color: "#f1f5f9",
                display: "block",
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>{setup.title}</div>

              <p
                style={{
                  marginTop: 8,
                  opacity: 0.8,
                  lineHeight: 1.6,
                  fontSize: 14,
                }}
              >
                {setup.description}
              </p>
            </Link>
          ))}
        </div>

        <div
          style={{
            marginTop: 32,
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20 }}>
            Explore Live Stock Ideas
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            You can explore many of these setups directly using the MyStockHarbor
            scanner.
          </p>

          <div style={{ marginTop: 14 }}>
            <Link
              href="/pickers"
              style={{
                padding: "13px 18px",
                borderRadius: 14,
                border: "1px solid rgba(34,197,94,0.45)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 900,
                display: "inline-block",
              }}
            >
              Find Your Next Stock →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
