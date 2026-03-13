import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Best Stock Indicators for Beginners | MyStockHarbor",
  description:
    "Learn the best stock indicators for beginners including RSI, moving averages, MACD, VWAP, and Bollinger Bands, and how to use them to read stock charts more clearly.",
};

export default function BestStockIndicatorsForBeginnersPage() {
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
        {/* Top Navigation */}
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

        <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800 }}>
          BEGINNER INDICATOR GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Best Stock Indicators for Beginners
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          Stock indicators help traders understand what price is doing beneath
          the surface. They can reveal momentum, trend strength, and whether a
          stock is becoming stretched or weak.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          The biggest mistake beginners make is trying to use too many
          indicators at once. A better approach is to understand what a few
          simple indicators show and combine them with basic chart reading.
        </p>

        {/* Simple Rule Box */}
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
          <div style={{ fontWeight: 900 }}>Simple rule for beginners</div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <div style={{ opacity: 0.9 }}>
              Start with <strong>trend first</strong>.
            </div>

            <div style={{ opacity: 0.9 }}>
              Then use <strong>one or two indicators</strong> to confirm what
              price is doing.
            </div>

            <div style={{ opacity: 0.9 }}>
              Avoid cluttering your chart with too many signals.
            </div>
          </div>
        </div>

        {/* Indicator Sections */}

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>1. Moving Averages (MA50 / MA200)</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Moving averages are one of the easiest ways to understand trend.
            The 50-day and 200-day moving averages are widely used by traders
            to see whether a stock is in a long-term uptrend or downtrend.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            If price stays above the moving average, the trend is generally
            considered strong. If price falls below it, momentum may be
            weakening.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>2. RSI (Relative Strength Index)</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            RSI is one of the most popular indicators for beginners. It measures
            momentum and shows whether a stock may be overbought or oversold.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            When RSI rises above 70, price may be becoming stretched upward.
            When RSI drops below 30, price may be becoming stretched downward.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>3. MACD</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MACD is a momentum indicator that helps traders see when momentum is
            strengthening or weakening. It can also show when trend shifts may
            be starting.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MACD is useful when combined with trend analysis. It should confirm
            what price is already suggesting rather than replace chart reading.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>4. VWAP</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            VWAP (Volume Weighted Average Price) helps traders understand where
            price sits relative to its average value during the day.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            When price moves far above VWAP it can signal that a stock is
            becoming stretched. When price returns toward VWAP it can indicate a
            move back toward equilibrium.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>5. Bollinger Bands</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Bollinger Bands show how far price is moving away from its normal
            range. The outer bands expand when volatility increases and
            contract when volatility slows down.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Traders often use Bollinger Bands to identify when price may be
            reaching extremes.
          </p>
        </section>

        {/* Beginner Combo */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Best indicator combination for beginners</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A simple and effective setup for beginners is:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Moving Average (MA50) for trend</li>
            <li style={{ marginBottom: 6 }}>RSI for stretch</li>
            <li style={{ marginBottom: 6 }}>MACD for momentum confirmation</li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            This combination gives you trend, momentum, and stretch signals
            without overcrowding the chart.
          </p>
        </section>

        {/* CTA */}
        <div
          style={{
            marginTop: 30,
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20 }}>
            Try these indicators on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            The MyStockHarbor dashboard helps you quickly check trend,
            divergence, momentum, and stretch across multiple indicators in one
            place.
          </p>

          <div style={{ marginTop: 14 }}>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "13px 18px",
                borderRadius: 14,
                border: "1px solid rgba(34,197,94,0.45)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 900,
                minHeight: 48,
                whiteSpace: "nowrap",
              }}
            >
              Open the Dashboard →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
