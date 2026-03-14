import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Scan Stocks: Finding Stock Ideas Efficiently | MyStockHarbor",
  description:
    "Learn how traders scan stocks for trading ideas, what criteria they look for, and how to explore stock opportunities using MyStockHarbor.",
  alternates: {
    canonical: "/how-to-scan-stocks",
  },
  openGraph: {
    title: "How to Scan Stocks | MyStockHarbor",
    description:
      "Learn how traders scan the market to find stock opportunities and setups.",
    url: "https://mystockharbor.com/how-to-scan-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "How to Scan Stocks | MyStockHarbor",
    description:
      "Learn how traders scan the stock market for potential setups.",
  },
};

export default function HowToScanStocksPage() {
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
          STOCK SCANNING GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
          }}
        >
          How to Scan Stocks
        </h1>

        <p style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.86 }}>
          Stock scanning is the process of searching the market for stocks that
          meet specific criteria. Instead of manually reviewing thousands of
          charts, traders use scanners or idea platforms to narrow the market
          down to stocks that may be showing interesting behaviour.
        </p>

        <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
          These criteria might include price movement, momentum signals,
          pullbacks, breakouts, or unusual activity. Once a shortlist of
          candidates is created, traders review the charts more closely.
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
            Stock scanning helps traders find ideas — charts confirm them.
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2>1. Decide what type of setup you want</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            The first step in scanning stocks is deciding what type of opportunity
            you are looking for. Some traders search for breakout setups, while
            others focus on pullbacks or oversold conditions.
          </p>

          <ul style={{ marginTop: 10 }}>
            <li>
              <Link
                href="/breakout-stocks"
                style={{ color: "#93c5fd", textDecoration: "underline" }}
              >
                Breakout stocks
              </Link>
            </li>

            <li>
              <Link
                href="/oversold-stocks"
                style={{ color: "#93c5fd", textDecoration: "underline" }}
              >
                Oversold stocks
              </Link>
            </li>

            <li>
              <Link
                href="/buy-the-dip-stocks"
                style={{ color: "#93c5fd", textDecoration: "underline" }}
              >
                Buy-the-dip setups
              </Link>
            </li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>2. Use screening tools to narrow the market</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            A scanner applies filters to a large universe of stocks and returns
            a smaller list that meets your criteria. This helps traders avoid
            wasting time on charts that are unlikely to fit their strategy.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>3. Review the charts carefully</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Once you have a shortlist of candidates, the next step is chart
            analysis. Traders evaluate price structure, support and resistance,
            and indicators to judge whether a setup looks promising.
          </p>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            If you are new to chart reading, this guide on{" "}
            <Link
              href="/how-to-read-stock-charts"
              style={{ color: "#93c5fd", textDecoration: "underline" }}
            >
              how to read stock charts
            </Link>{" "}
            can help.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>4. Tools that help scan stocks</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Many traders rely on idea platforms and stock scanners to surface
            potential setups quickly. These tools help convert a huge market
            universe into a manageable watchlist.
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
              Explore stock ideas
            </div>

            <p style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.86 }}>
              Use the MyStockHarbor stock pickers to explore potential stock
              setups and review charts across multiple strategies.
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
            <Link href="/stock-market-setups">Stock Market Setups</Link>
            <Link href="/stock-screener-for-breakouts">
              Stock Screener for Breakouts
            </Link>
            <Link href="/stock-screener-for-oversold-stocks">
              Stock Screener for Oversold Stocks
            </Link>
            <Link href="/best-free-stock-screener">
              Best Free Stock Screener
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
