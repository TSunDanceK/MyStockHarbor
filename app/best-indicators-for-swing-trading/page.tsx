import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Best Indicators for Swing Trading | MyStockHarbor",
  description:
    "Learn about common indicators used in swing trading, how traders combine indicators with price action, and how to explore stock ideas using MyStockHarbor.",
  alternates: {
    canonical: "/best-indicators-for-swing-trading",
  },
  openGraph: {
    title: "Best Indicators for Swing Trading | MyStockHarbor",
    description:
      "Explore common indicators swing traders use to evaluate stock setups.",
    url: "https://mystockharbor.com/best-indicators-for-swing-trading",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Indicators for Swing Trading | MyStockHarbor",
    description:
      "Learn which indicators swing traders often use to review chart setups.",
  },
};

export default function BestIndicatorsForSwingTradingPage() {
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
          maxWidth: 900,
          margin: "0 auto",
          padding: "28px 20px 40px",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
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
            href="/pickers"
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
            Find Your Next Stock →
          </Link>
        </div>

        <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800 }}>
          SWING TRADING GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
          }}
        >
          Best Indicators for Swing Trading
        </h1>

        <p style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.86 }}>
          Swing trading focuses on capturing price moves that unfold over several
          days or weeks. Because of this timeframe, traders often rely on a small
          set of indicators to help them judge momentum, trend strength, and
          potential entry points.
        </p>

        <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
          Indicators are rarely used alone. Most traders combine them with chart
          structure, support and resistance levels, and broader market context to
          build a more complete view of a stock setup.
        </p>

        <div
          style={{
            marginTop: 18,
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(59,130,246,0.28)",
            background:
              "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(168,85,247,0.08))",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.78 }}>
            KEY IDEA
          </div>

          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>
            Indicators support decisions — price action leads them.
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2>1. RSI (Relative Strength Index)</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            The{" "}
            <Link
              href="/what-is-rsi-indicator"
              style={{ color: "#93c5fd", textDecoration: "underline" }}
            >
              RSI indicator
            </Link>{" "}
            measures the speed and magnitude of price movements. Swing traders
            sometimes use it to identify overbought or oversold conditions that
            may suggest a potential pause or reversal.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>2. MACD (Moving Average Convergence Divergence)</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            The{" "}
            <Link
              href="/what-is-macd-indicator"
              style={{ color: "#93c5fd", textDecoration: "underline" }}
            >
              MACD indicator
            </Link>{" "}
            helps traders track momentum shifts and trend changes. Some traders
            use MACD crossovers or divergence patterns when evaluating swing
            setups.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>3. VWAP (Volume Weighted Average Price)</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            The{" "}
            <Link
              href="/what-is-vwap-indicator"
              style={{ color: "#93c5fd", textDecoration: "underline" }}
            >
              VWAP indicator
            </Link>{" "}
            is commonly used to evaluate where price sits relative to average
            traded value. While VWAP is often used by intraday traders, it can
            also help highlight areas where price may react during swings.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>4. Combining indicators with chart structure</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Indicators become more useful when they align with chart structure.
            For example, a pullback toward support combined with improving
            momentum can sometimes make a setup more interesting.
          </p>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            This is why many traders start with chart structure first, then use
            indicators as confirmation tools rather than decision-makers.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>5. Tools that help research swing trading setups</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Researching swing setups across hundreds of stocks manually can be
            slow. Many traders use idea platforms and screening tools to surface
            potential candidates before reviewing charts more closely.
          </p>

          <div
            style={{
              marginTop: 16,
              padding: 18,
              borderRadius: 16,
              border: "1px solid rgba(34,197,94,0.28)",
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 20 }}>
              Explore swing trading ideas
            </div>

            <p style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.86 }}>
              Use the MyStockHarbor stock pickers to explore stocks that may be
              forming swing setups and review their charts in detail.
            </p>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link
                href="/pickers"
                style={{
                  padding: "12px 18px",
                  borderRadius: 14,
                  border: "1px solid rgba(34,197,94,0.45)",
                  background:
                    "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
                  color: "#f8fafc",
                  textDecoration: "none",
                  fontWeight: 900,
                }}
              >
                Open Stock Pickers →
              </Link>

              <Link
                href="/platforms"
                style={{
                  padding: "12px 18px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#f8fafc",
                  textDecoration: "none",
                  fontWeight: 900,
                }}
              >
                Compare Trading Platforms →
              </Link>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h2>Related guides</h2>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <Link href="/best-stock-indicators-for-beginners">
              Best Stock Indicators for Beginners
            </Link>
            <Link href="/stock-market-setups">Stock Market Setups</Link>
            <Link href="/breakout-stocks">Breakout Stocks</Link>
            <Link href="/oversold-stocks">Oversold Stocks</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
