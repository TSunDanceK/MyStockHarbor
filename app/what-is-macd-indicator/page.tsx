import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "What Is MACD Indicator? | MyStockHarbor",
  description:
    "Learn what the MACD indicator is, how it works, what the MACD line, signal line, and histogram mean, and how beginners can use MACD to read stock charts more clearly.",
};

export default function WhatIsMacdIndicatorPage() {
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
          What Is MACD Indicator?
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          MACD stands for <strong>Moving Average Convergence Divergence</strong>.
          It is a momentum indicator that helps traders understand whether price
          momentum is strengthening, weakening, or starting to shift.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          MACD is popular because it can help confirm trend direction and show
          whether momentum is building behind a move, or fading even while price
          is still pushing.
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
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Simple MACD idea</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ opacity: 0.9 }}>
              <strong>MACD above zero</strong> can suggest bullish momentum
            </div>
            <div style={{ opacity: 0.9 }}>
              <strong>MACD below zero</strong> can suggest bearish momentum
            </div>
            <div style={{ opacity: 0.9 }}>
              <strong>MACD crossing its signal line</strong> can show momentum changing
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>How MACD works</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MACD is built from moving averages. It compares a faster moving
            average with a slower one to show whether short-term momentum is
            pulling away from long-term momentum or moving back toward it.
          </p>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            That makes MACD useful for spotting momentum shifts that may not be
            obvious from price alone.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>The three parts of MACD</h2>

          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>1. MACD line</div>
              <p style={{ margin: "8px 0 0", opacity: 0.86, lineHeight: 1.6 }}>
                This is the main momentum line. It shows the relationship
                between the faster and slower moving averages.
              </p>
            </div>

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>2. Signal line</div>
              <p style={{ margin: "8px 0 0", opacity: 0.86, lineHeight: 1.6 }}>
                This is a smoother line that follows the MACD line. When the
                MACD line crosses above or below it, traders often read that as
                a momentum shift.
              </p>
            </div>

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>3. Histogram</div>
              <p style={{ margin: "8px 0 0", opacity: 0.86, lineHeight: 1.6 }}>
                The histogram shows the gap between the MACD line and the signal
                line. It helps traders see whether momentum is expanding or shrinking.
              </p>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>What MACD tells you</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MACD helps answer questions like:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Is momentum getting stronger?</li>
            <li style={{ marginBottom: 6 }}>Is momentum fading?</li>
            <li style={{ marginBottom: 6 }}>Could a trend be starting to turn?</li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            That makes MACD especially useful when you already understand the
            chart trend and want an extra confirmation tool.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>How beginners should use MACD</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The best way to use MACD is not as a standalone buy or sell signal,
            but as a way to confirm what price is already doing.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A simple beginner approach is:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Check whether the stock is trending up or down</li>
            <li style={{ marginBottom: 6 }}>Use MACD to see whether momentum supports that trend</li>
            <li style={{ marginBottom: 6 }}>Be cautious when price rises but MACD weakens</li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>What MACD crossover means</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A MACD crossover happens when the MACD line crosses above or below
            the signal line.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Traders often interpret:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              <strong>MACD crossing above signal:</strong> momentum may be improving
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>MACD crossing below signal:</strong> momentum may be weakening
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            But crossovers work best when they happen in the context of trend and
            structure, not in isolation.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>What MACD divergence means</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MACD divergence happens when price and MACD stop moving together.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            For example, price may make a higher high while MACD fails to do the
            same. That can suggest momentum is weakening even though price is
            still rising.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Divergence can be useful as an early warning sign, but it is not a
            guaranteed reversal signal.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Common MACD mistake</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A common beginner mistake is treating every MACD crossover as a trade
            signal. In choppy or sideways markets, MACD can produce noisy signals.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            It works much better when combined with trend, support and resistance,
            and other tools like moving averages or RSI.
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
            Try MACD on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            MyStockHarbor helps you quickly check MACD, RSI, divergence, trend,
            and stretch in one place so you can read momentum more clearly.
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
              href="/what-is-rsi-indicator"
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
              Read RSI Guide →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
