import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Breakout Stocks: How to Spot Momentum and Price Expansion | MyStockHarbor",
  description:
    "Learn what breakout stocks are, how traders identify breakout setups, the risks of false breakouts, and how to explore live stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/breakout-stocks",
  },
  openGraph: {
    title: "Breakout Stocks | MyStockHarbor",
    description:
      "A beginner-friendly guide to breakout stocks, momentum setups and how to explore live stock ideas.",
    url: "https://mystockharbor.com/breakout-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Breakout Stocks | MyStockHarbor",
    description:
      "Learn how traders identify breakout stocks and momentum setups.",
  },
};

export default function BreakoutStocksPage() {
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

        <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800, letterSpacing: "0.3px" }}>
          BREAKOUT GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Breakout Stocks: How to Spot Momentum and Price Expansion
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          Breakout stocks are stocks pushing above key levels such as recent highs,
          resistance zones or tight trading ranges. Traders watch these setups
          because a clean breakout can signal fresh momentum, stronger demand and
          the start of a more powerful move.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          But not every breakout works. Some breakouts fail quickly, trap late
          buyers and fall back into the range. That is why it helps to understand
          what makes a breakout stronger, what warning signs to watch for, and how
          to use chart context instead of chasing every move.
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
            SIMPLE WAY TO THINK ABOUT IT
          </div>

          <div style={{ marginTop: 6, fontSize: 24, fontWeight: 900 }}>
            A breakout is strongest when price escapes a level that mattered.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Good breakout:</strong> price clears resistance with intent and
              holds above the level.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Weak breakout:</strong> price briefly pops above resistance, then
              slips back into the range.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Goal:</strong> find strong setups worth reviewing, then confirm
              them with structure, momentum and market context.
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            1. What is a breakout stock?
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A breakout stock is a stock moving above a price area that had
            previously limited upside. This could be a prior swing high, a flat
            resistance level, a consolidation range or another area where sellers
            had been active before.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            When price finally moves through that area, traders often read it as a
            sign that buyers are gaining control. That does not guarantee
            continuation, but it does make the stock more interesting for momentum
            traders and trend followers.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            2. Why traders look for breakout stocks
          </h2>

          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              Breakouts can signal fresh momentum and stronger participation
            </li>
            <li style={{ marginBottom: 6 }}>
              They can help traders focus on stocks already showing strength
            </li>
            <li style={{ marginBottom: 6 }}>
              Clear breakout levels make chart structure easier to judge
            </li>
            <li style={{ marginBottom: 6 }}>
              Strong breakouts can sometimes lead to trend continuation
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In practice, breakout traders are often looking for the market to show
            strength first rather than trying to predict it too early.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            3. What makes a breakout stronger?
          </h2>

          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900 }}>Clear resistance</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Breakouts are easier to trust when price is clearing a level that
                obviously mattered on the chart.
              </div>
            </div>

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900 }}>Momentum confirmation</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                RSI, MACD or general price behaviour can help confirm that momentum
                is supporting the move rather than fading.
              </div>
            </div>

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900 }}>Healthy structure</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Breakouts tend to look stronger when the stock is already building
                constructive higher lows or tightening before the move.
              </div>
            </div>

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900 }}>Market support</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                A breakout often has a better chance when the wider market is
                stable or strong rather than under heavy pressure.
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            4. The danger of false breakouts
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            False breakouts happen when price moves above resistance but fails to
            hold there. Instead of continuing higher, the stock drops back into
            the range and traps traders who chased too aggressively.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            This is one reason patience matters. Many traders prefer to see whether
            price can hold above the breakout area or retest it constructively
            before becoming too confident.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            5. How MyStockHarbor helps you find breakout stocks
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MyStockHarbor helps you scan for stock ideas without manually digging
            through chart after chart. Instead of building a complicated screener,
            you can browse grouped setups and then inspect the chart in more detail.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The{" "}
            <Link
              href="/pickers"
              style={{
                color: "#60a5fa",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Find Your Next Stock
            </Link>{" "}
            page is useful here because it includes categories like breakouts,
            divergence setups, buy-the-dip candidates and oversold-leaning stocks.
            That makes it easier to build a shortlist of charts worth reviewing.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            6. A simple beginner approach
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Start by looking for clear levels and strong price structure. Then use
            momentum and market context to judge whether the move looks supported.
            The aim is not to chase every stock moving up, but to focus on setups
            where the breakout actually means something.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In other words: use breakouts to find strong ideas, then confirm them
            on the chart before acting.
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
            Explore live breakout stock ideas on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            Use MyStockHarbor to review trend, momentum, stretch, divergence and
            chart structure in one place. Start with live stock ideas, then open
            the chart and decide whether the breakout looks constructive.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              href="/pickers"
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
              Browse Stock Ideas →
            </Link>

            <Link
              href="/"
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
              Open the Dashboard →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
