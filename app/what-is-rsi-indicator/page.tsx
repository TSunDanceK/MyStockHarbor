import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "What Is RSI Indicator? | MyStockHarbor",
  description:
    "Learn what the RSI indicator is, how it works, what overbought and oversold mean, and how beginners can use RSI to read stock charts more clearly.",
};

export default function WhatIsRsiIndicatorPage() {
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
          What Is RSI Indicator?
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          RSI stands for <strong>Relative Strength Index</strong>. It is one of
          the most popular stock indicators because it helps traders understand
          whether momentum is strong, weak, overbought, or oversold.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          RSI does not predict the future on its own, but it is very useful for
          showing when price may be getting stretched too far in one direction.
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
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Simple RSI idea</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ opacity: 0.9 }}>
              <strong>High RSI</strong> = price may be getting overbought
            </div>
            <div style={{ opacity: 0.9 }}>
              <strong>Low RSI</strong> = price may be getting oversold
            </div>
            <div style={{ opacity: 0.9 }}>
              <strong>Middle RSI</strong> = momentum is more neutral
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>How RSI works</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            RSI measures the speed and size of recent price moves and turns that
            into a value between 0 and 100.
          </p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            When recent upward moves have been stronger than downward moves, RSI
            rises. When recent downward moves have been stronger, RSI falls.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>What overbought and oversold mean</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Traders often use these basic RSI levels:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              <strong>Above 70:</strong> often called overbought
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Below 30:</strong> often called oversold
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Around 50:</strong> usually treated as neutral
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Important: overbought does <strong>not</strong> automatically mean a
            stock must fall, and oversold does <strong>not</strong> automatically
            mean it must rise. Strong trends can stay stretched for longer than
            beginners expect.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Why beginners like RSI</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            RSI is beginner-friendly because it is easy to read. You do not need
            to master complex chart theory to understand that high RSI often
            means strong momentum and low RSI often means weak momentum.
          </p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            It is especially useful for asking:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Is this move getting stretched?</li>
            <li style={{ marginBottom: 6 }}>Is momentum improving or weakening?</li>
            <li style={{ marginBottom: 6 }}>Should I be more cautious here?</li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Best way to use RSI</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            RSI works best when combined with price structure, trend, and support
            or resistance.
          </p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A simple beginner approach is:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Check the trend first</li>
            <li style={{ marginBottom: 6 }}>Use RSI to judge whether price looks stretched</li>
            <li style={{ marginBottom: 6 }}>Use other clues like moving averages or support levels for confirmation</li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>What RSI divergence means</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            RSI divergence happens when price and RSI stop agreeing.
          </p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            For example, if price makes a new high but RSI does not, that can
            suggest momentum is fading. If price makes a new low but RSI does not,
            that can suggest selling pressure is weakening.
          </p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Divergence is useful, but it should be treated as a warning sign, not
            a guaranteed reversal signal.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Common RSI mistake</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The most common beginner mistake is assuming RSI alone is enough to
            buy or sell. It is better to think of RSI as a tool for context, not
            a complete trading system.
          </p>
        </section>

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
            Try RSI on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            MyStockHarbor lets you quickly view RSI, divergence, trend, stretch,
            and market context in one place so you can understand what the chart
            is really saying.
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
              More Indicator Guides →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
