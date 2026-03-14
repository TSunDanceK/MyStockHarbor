import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Oversold Stocks: How to Find Potential Rebound Setups | MyStockHarbor",
  description:
    "Learn what oversold stocks are, how traders use RSI and other indicators to spot stretched conditions, and how to explore live oversold stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/oversold-stocks",
  },
  openGraph: {
    title: "Oversold Stocks | MyStockHarbor",
    description:
      "A beginner-friendly guide to oversold stocks, rebound setups and how to explore live stock ideas.",
    url: "https://mystockharbor.com/oversold-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Oversold Stocks | MyStockHarbor",
    description:
      "Learn how traders identify oversold stocks and potential rebound setups.",
  },
};

export default function OversoldStocksPage() {
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
          OVERSOLD STOCK GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Oversold Stocks: How to Find Potential Rebound Setups
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          Oversold stocks are stocks that may have fallen hard enough in the short
          term to become stretched to the downside. Traders watch for these setups
          because oversold conditions can sometimes lead to rebounds, relief rallies
          or better risk-reward entries.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          But oversold does not automatically mean cheap, safe or ready to bounce.
          A stock can stay oversold for longer than people expect, especially when
          trend, earnings sentiment or the wider market are still weak. The key is
          to treat oversold as a reason to investigate, not a reason to buy blindly.
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
            Oversold means stretched, not guaranteed to reverse.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Useful idea:</strong> a stock may have fallen far enough to
              attract dip buyers or short-covering.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Main risk:</strong> weak stocks often stay weak when trend is
              still breaking down.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Best use:</strong> build a shortlist, then confirm trend,
              support and momentum on the chart.
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            1. What does oversold mean in stocks?
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In simple terms, oversold means price has dropped enough that the move
            may be becoming stretched. Traders often use momentum indicators like
            RSI, Stochastic, Bollinger Bands or distance from VWAP and moving
            averages to judge whether selling has become extreme.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Oversold is usually a short-term condition rather than a full long-term
            judgment on the company. A good business can become oversold during a
            normal pullback, and a weak stock can become oversold during a deeper
            breakdown.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            2. Indicators traders use to spot oversold stocks
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
              <div style={{ fontWeight: 900 }}>RSI</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                RSI below common thresholds such as 30 can suggest price is becoming
                stretched downward.
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
              <div style={{ fontWeight: 900 }}>Stochastic</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Stochastic can help show when short-term price movement has become
                unusually weak within its recent range.
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
              <div style={{ fontWeight: 900 }}>Bollinger Bands</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Price pushing hard outside the lower band can indicate downside
                stretch or volatility extremes.
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
              <div style={{ fontWeight: 900 }}>VWAP and moving averages</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                When price moves too far below common value or trend reference
                levels, it can signal a stretched move.
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            3. Why oversold stocks can be interesting
          </h2>

          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              They may offer better entries than chasing price after a rally
            </li>
            <li style={{ marginBottom: 6 }}>
              They can create rebound setups when selling pressure starts easing
            </li>
            <li style={{ marginBottom: 6 }}>
              They help investors spot pullbacks in stocks they already wanted to own
            </li>
            <li style={{ marginBottom: 6 }}>
              They can reveal divergence or loss of downside momentum
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The strongest setups often happen when oversold conditions appear near
            support, during a larger uptrend, or alongside improving momentum.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            4. Why oversold stocks can stay dangerous
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Oversold is not a timing signal by itself. A stock can continue falling
            if the trend is weak, news is negative, or the broader market is under
            pressure. Many beginners get trapped by buying too early simply because
            an indicator looks low.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            That is why it helps to ask:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Is the stock near support?</li>
            <li style={{ marginBottom: 6 }}>Is the larger trend still intact?</li>
            <li style={{ marginBottom: 6 }}>Is momentum stabilising?</li>
            <li style={{ marginBottom: 6 }}>Is the market environment improving or worsening?</li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            5. How MyStockHarbor helps you find oversold stocks
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MyStockHarbor helps you scan for stock ideas without checking dozens of
            charts manually. Instead of building a complex screener, you can review
            grouped setups and then inspect the chart in more detail.
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
            page is useful here because it highlights categories like Green Overall
            Signal, divergence setups, buy-the-dip candidates and breakouts. That
            makes it easier to find oversold-leaning stocks worth reviewing.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            6. A simple beginner approach
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Start by treating oversold as a filter, not a conclusion. Build a
            shortlist, then check trend, support, stretch and momentum before
            deciding whether the setup looks constructive.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In practice, that means using oversold conditions to find ideas rather
            than forcing trades just because a number looks low.
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
            Explore live oversold stock ideas on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            Use MyStockHarbor to review trend, momentum, stretch, divergence and
            chart structure in one place. Start with live stock ideas, then open
            the chart and decide whether the setup deserves a closer look.
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
