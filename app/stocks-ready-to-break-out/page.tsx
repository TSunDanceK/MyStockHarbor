import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stocks Ready to Break Out: How Traders Identify Breakout Setups | MyStockHarbor",
  description:
    "Learn how traders look for stocks that may be ready to break out, what signals they watch for, and how to explore stock ideas using MyStockHarbor.",
  alternates: {
    canonical: "/stocks-ready-to-break-out",
  },
  openGraph: {
    title: "Stocks Ready to Break Out | MyStockHarbor",
    description:
      "Learn how traders identify stocks that may be approaching breakout setups.",
    url: "https://mystockharbor.com/stocks-ready-to-break-out",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Ready to Break Out | MyStockHarbor",
    description:
      "Learn how traders identify potential breakout candidates in the stock market.",
  },
};

export default function StocksReadyToBreakOutPage() {
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
          BREAKOUT SETUP GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
          }}
        >
          Stocks Ready to Break Out
        </h1>

        <p style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.86 }}>
          Breakout traders look for stocks that are approaching key price levels
          where a strong move could begin. These levels often form after a period
          of consolidation, where price moves sideways before potentially
          continuing higher.
        </p>

        <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
          When a breakout occurs, it can sometimes lead to strong momentum if
          buyers step in quickly. Because of this, traders often watch for signs
          that a stock may be approaching a breakout zone.
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
            Breakouts often begin after periods of consolidation or tight price action.
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2>1. Consolidation patterns</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Many breakout setups start with consolidation. During this phase,
            price trades within a relatively narrow range while traders wait for
            new information or market momentum.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>2. Resistance levels</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Resistance levels are areas where price previously struggled to move
            higher. When price approaches resistance again, traders watch closely
            to see whether buyers can push through that level.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>3. Momentum confirmation</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Momentum indicators such as{" "}
            <Link
              href="/what-is-rsi-indicator"
              style={{ color: "#93c5fd", textDecoration: "underline" }}
            >
              RSI
            </Link>{" "}
            or{" "}
            <Link
              href="/what-is-macd-indicator"
              style={{ color: "#93c5fd", textDecoration: "underline" }}
            >
              MACD
            </Link>{" "}
            are sometimes used to confirm whether buying pressure is increasing
            near a breakout level.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>4. How traders search for breakout candidates</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Searching the entire market manually can be slow. Many traders use
            scanners or idea platforms to surface stocks that may be approaching
            important breakout levels.
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
              Explore breakout ideas
            </div>

            <p style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.86 }}>
              Use the MyStockHarbor stock pickers to explore stocks that may be
              approaching breakout levels and review their charts in detail.
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
            <Link href="/breakout-stocks">Breakout Stocks</Link>
            <Link href="/stock-screener-for-breakouts">
              Stock Screener for Breakouts
            </Link>
            <Link href="/stock-market-setups">Stock Market Setups</Link>
            <Link href="/how-to-scan-stocks">How to Scan Stocks</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
