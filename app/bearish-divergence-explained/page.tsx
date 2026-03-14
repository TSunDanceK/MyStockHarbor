import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Bearish Divergence Explained: What Traders Look For | MyStockHarbor",
  description:
    "Learn what bearish divergence means in trading, how traders identify divergence signals, and how to explore divergence setups using MyStockHarbor.",
  alternates: {
    canonical: "/bearish-divergence-explained",
  },
  openGraph: {
    title: "Bearish Divergence Explained | MyStockHarbor",
    description:
      "Learn what bearish divergence means and how traders interpret divergence signals.",
    url: "https://mystockharbor.com/bearish-divergence-explained",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bearish Divergence Explained | MyStockHarbor",
    description:
      "Learn how bearish divergence works and how traders review divergence signals.",
  },
};

export default function BearishDivergenceExplainedPage() {
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
          DIVERGENCE GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
          }}
        >
          Bearish Divergence Explained
        </h1>

        <p style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.86 }}>
          Bearish divergence is a technical signal traders sometimes watch for
          when evaluating whether upside momentum may be weakening. It occurs
          when price continues to rise but a momentum indicator begins to move
          lower instead.
        </p>

        <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
          This difference between price and momentum can sometimes suggest that
          buying pressure is fading, which may create conditions where a pullback
          or reversal becomes possible.
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
            SIMPLE EXPLANATION
          </div>

          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>
            Price makes higher highs, but momentum makes lower highs.
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2>1. What causes bearish divergence?</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Divergence can appear when buying pressure starts to slow down even
            though price has not yet turned lower. Momentum indicators measure
            the strength of price movement, so when they begin to weaken while
            price still rises, traders sometimes interpret that as a shift in
            momentum.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>2. Indicators commonly used to spot divergence</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Traders often use oscillators and momentum indicators when studying
            divergence patterns.
          </p>

          <ul style={{ marginTop: 10 }}>
            <li>
              <Link
                href="/what-is-rsi-indicator"
                style={{ color: "#93c5fd", textDecoration: "underline" }}
              >
                RSI
              </Link>
            </li>
            <li>
              <Link
                href="/what-is-macd-indicator"
                style={{ color: "#93c5fd", textDecoration: "underline" }}
              >
                MACD
              </Link>
            </li>
          </ul>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            These indicators can help traders compare price action with momentum
            behaviour, which is the key concept behind divergence analysis.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>3. Why traders watch bearish divergence</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Divergence signals are not guarantees of a reversal. Instead, they are
            clues that the strength of the current move may be weakening.
          </p>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Many traders combine bearish divergence signals with resistance levels,
            trend structure, and price patterns to judge whether a setup looks
            vulnerable.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>4. Using tools to research divergence setups</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Instead of manually scanning every chart, traders often use screening
            tools or idea platforms to surface potential setups worth reviewing.
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
              Explore divergence ideas
            </div>

            <p style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.86 }}>
              Use the MyStockHarbor stock pickers to explore stocks that may be
              showing divergence behaviour and review their charts more closely.
            </p>

            <div style={{ marginTop: 14 }}>
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
            </div>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h2>Related guides</h2>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <Link href="/bearish-divergence-stocks">Bearish Divergence Stocks</Link>
            <Link href="/bullish-divergence-stocks">Bullish Divergence Stocks</Link>
            <Link href="/stock-market-setups">Stock Market Setups</Link>
            <Link href="/best-stock-indicators-for-beginners">
              Best Stock Indicators for Beginners
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
