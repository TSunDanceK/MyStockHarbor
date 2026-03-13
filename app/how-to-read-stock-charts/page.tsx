import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Read Stock Charts | MyStockHarbor",
  description:
    "Learn how to read stock charts as a beginner, including trend, support and resistance, indicators, and how to understand price action more clearly.",
};

export default function HowToReadStockChartsPage() {
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

        <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800, letterSpacing: "0.3px" }}>
          BEGINNER CHART GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          How to Read Stock Charts
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          Learning how to read stock charts is one of the most useful skills for any trader or
          investor. A stock chart helps you see trend, momentum, support and resistance, and whether
          price is becoming stretched or weak.
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
          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.78 }}>SIMPLE WAY TO THINK ABOUT IT</div>
          <div style={{ marginTop: 6, fontSize: 24, fontWeight: 900 }}>
            A chart tells you three things:
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Direction:</strong> is price moving up, down, or sideways?
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Strength:</strong> is momentum improving or weakening?
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Location:</strong> is price near support, resistance, or stretched away from value?
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>1. Start with trend</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The first thing to read on any stock chart is trend. Ask whether price is making higher
            highs and higher lows, lower highs and lower lows, or moving sideways in a range.
          </p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Beginners often make charts too complicated too early. In most cases, trend should come
            first before you look at any indicator.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>2. Find support and resistance</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Support is an area where price has previously held up. Resistance is an area where price
            has previously struggled to move higher. These areas help traders judge whether a stock
            is near a level where buyers or sellers may react again.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>3. Use indicators to confirm, not to lead</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Indicators are most useful when they support what price is already showing. For example,
            RSI can help identify whether momentum is stretched, MACD can help show whether momentum
            is strengthening or fading, and moving averages can help define the bigger trend.
          </p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The mistake many beginners make is trying to let indicators replace chart reading. A
            better approach is to read price first, then use indicators as confirmation.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>4. Learn to recognise stretch</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A stock can be trending well and still become stretched in the short term. This is where
            tools like RSI, Stochastic, Bollinger Bands, VWAP, and moving-average distance can help.
            They show whether price is becoming overbought, oversold, or extended away from a more
            normal range.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>5. Read market context, not just the stock</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A stock chart does not exist in isolation. It helps to know whether the wider market is
            strong or weak, whether volatility is rising, and whether the move is happening with real
            participation. That is why market context and benchmark tracking matter.
          </p>
        </section>

        <div
          style={{
            marginTop: 28,
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20 }}>Use MyStockHarbor to practise</div>
          <p style={{ margin: "10px 0 0", opacity: 0.86, lineHeight: 1.65 }}>
            MyStockHarbor was built to make chart reading easier for beginner and intermediate users.
            You can quickly check trend, stretch, momentum, divergence, and market context in one place.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
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
                boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
                whiteSpace: "nowrap",
              }}
            >
              Open the Dashboard →
            </Link>

            <Link
              href="/learn"
              style={{
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
              }}
            >
              Explore Learn Page →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
