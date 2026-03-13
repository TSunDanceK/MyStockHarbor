import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "What Is VWAP Indicator? | MyStockHarbor",
  description:
    "Learn what the VWAP indicator is, how traders use it to judge fair value, and how beginners can use VWAP to understand whether price is stretched.",
};

export default function WhatIsVwapIndicatorPage() {
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
        {/* Navigation */}
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
          INDICATOR GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          What Is VWAP Indicator?
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          VWAP stands for <strong>Volume Weighted Average Price</strong>. It is
          an indicator that shows the average price a stock has traded at during
          the day, weighted by trading volume.
        </p>

        <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
          Traders use VWAP to understand whether price is trading above or
          below its average value. It helps reveal whether a stock may be
          stretched away from where most trading activity has taken place.
        </p>

        {/* Simple Idea Box */}
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
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Simple VWAP idea</div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ opacity: 0.9 }}>
              <strong>Price above VWAP</strong> → buyers are in control
            </div>

            <div style={{ opacity: 0.9 }}>
              <strong>Price below VWAP</strong> → sellers are stronger
            </div>

            <div style={{ opacity: 0.9 }}>
              <strong>Price far from VWAP</strong> → the move may be stretched
            </div>
          </div>
        </div>

        {/* How VWAP Works */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>How VWAP works</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            VWAP calculates the average price of a stock throughout the day,
            but it gives more importance to prices where more shares traded.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            This means VWAP reflects where most trading activity actually
            occurred, which can make it a useful reference point for value.
          </p>
        </section>

        {/* Why Traders Use VWAP */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Why traders use VWAP</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            VWAP helps answer important questions like:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Is price extended?</li>
            <li style={{ marginBottom: 6 }}>Is price trading at fair value?</li>
            <li style={{ marginBottom: 6 }}>Is momentum strong enough to stay above VWAP?</li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Because of this, VWAP is often used by day traders and short-term
            traders to judge whether price has moved too far from its average.
          </p>
        </section>

        {/* Beginner Usage */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>How beginners should use VWAP</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            VWAP works best when used as a context tool rather than a
            standalone signal.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A simple approach is:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Look at the trend first</li>
            <li style={{ marginBottom: 6 }}>Check whether price is far above or below VWAP</li>
            <li style={{ marginBottom: 6 }}>Use other signals like RSI or support levels for confirmation</li>
          </ul>
        </section>

        {/* Common Mistake */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Common VWAP mistake</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A common beginner mistake is assuming that price must return to
            VWAP immediately. In strong trends, price can stay far above or
            below VWAP for long periods.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            VWAP should be treated as a reference point for context, not a
            guaranteed reversal level.
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
            Try VWAP on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            The MyStockHarbor dashboard helps you quickly check VWAP, trend,
            RSI, MACD, divergence, and stretch signals so you can understand
            the bigger picture behind a stock move.
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
                whiteSpace: "nowrap",
              }}
            >
              Open the Dashboard →
            </Link>

            <Link
              href="/best-stock-indicators-for-beginners"
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
              Indicator Guide →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
