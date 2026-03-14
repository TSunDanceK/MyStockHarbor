import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Overbought Stocks: How to Spot Stretched Price Moves | MyStockHarbor",
  description:
    "Learn what overbought stocks are, how traders identify stretched price moves using RSI and other indicators, and how to explore live stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/overbought-stocks",
  },
  openGraph: {
    title: "Overbought Stocks | MyStockHarbor",
    description:
      "A beginner-friendly guide to overbought stocks, stretched price conditions and how to explore live stock ideas.",
    url: "https://mystockharbor.com/overbought-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Overbought Stocks | MyStockHarbor",
    description:
      "Learn how traders identify overbought stocks and stretched price conditions.",
  },
};

export default function OverboughtStocksPage() {
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
          OVERBOUGHT STOCK GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
          }}
        >
          Overbought Stocks: How to Spot Stretched Price Moves
        </h1>

        <p style={{ marginTop: 14, fontSize: 17, lineHeight: 1.7, opacity: 0.86 }}>
          Overbought stocks are stocks that may have risen so quickly that price
          becomes stretched in the short term. Traders often watch for these
          conditions because strong moves sometimes pause, consolidate or pull
          back before continuing.
        </p>

        <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
          But overbought does not automatically mean a stock must fall. In strong
          trends, stocks can remain overbought for extended periods while momentum
          continues driving price higher.
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
          <div style={{ fontWeight: 900 }}>Simple idea</div>

          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <div>Price has moved unusually far upward.</div>
            <div>Momentum may be stretched.</div>
            <div>The chart may be approaching resistance.</div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2>1. What does overbought mean?</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Overbought usually refers to momentum indicators reaching high levels.
            For example, RSI above 70 is commonly interpreted as overbought.
            However, this does not mean price must reverse. It simply means the
            move has become extended relative to recent history.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>2. Indicators used to identify overbought stocks</h2>

          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            <li>RSI above typical overbought thresholds</li>
            <li>Stochastic near upper extremes</li>
            <li>Bollinger Band expansion</li>
            <li>Large distance from moving averages</li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            These signals highlight stocks that may deserve closer chart review.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>3. Why traders track overbought stocks</h2>

          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            <li>Potential short-term pullbacks</li>
            <li>Momentum exhaustion signals</li>
            <li>Possible divergence setups</li>
            <li>Opportunities to manage risk</li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>4. When overbought signals are strongest</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Overbought signals tend to matter more when price is near resistance,
            when momentum indicators show divergence, or when the wider market
            begins losing strength.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>5. How MyStockHarbor helps you review overbought stocks</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MyStockHarbor helps highlight stocks that may be stretched so traders
            can review charts more efficiently instead of scanning manually.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The{" "}
            <Link
              href="/pickers"
              style={{ color: "#60a5fa", fontWeight: 800, textDecoration: "none" }}
            >
              Find Your Next Stock
            </Link>{" "}
            page groups stocks into categories including overbought signals,
            divergence setups, buy-the-dip candidates and breakouts.
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
            Explore live stock ideas on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            Use MyStockHarbor to review trend, momentum, divergence and stretch
            conditions in one place.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <Link
              href="/pickers"
              style={{
                padding: "13px 18px",
                borderRadius: 14,
                border: "1px solid rgba(34,197,94,0.45)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Browse Stock Ideas →
            </Link>

            <Link
              href="/"
              style={{
                padding: "13px 18px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.06)",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Open Dashboard →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
