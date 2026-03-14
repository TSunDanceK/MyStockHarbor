import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Find Buy the Dip Stocks | MyStockHarbor",
  description:
    "Learn how traders find buy-the-dip stocks, what signals they look for in pullbacks, and how to explore stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/how-to-find-buy-the-dip-stocks",
  },
  openGraph: {
    title: "How to Find Buy the Dip Stocks | MyStockHarbor",
    description:
      "Learn how traders identify buy-the-dip opportunities and review pullback setups.",
    url: "https://mystockharbor.com/how-to-find-buy-the-dip-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "How to Find Buy the Dip Stocks | MyStockHarbor",
    description:
      "Learn how traders search for buy-the-dip opportunities in the stock market.",
  },
};

export default function HowToFindBuyTheDipStocksPage() {
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
          BUY THE DIP GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
          }}
        >
          How to Find Buy the Dip Stocks
        </h1>

        <p style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.86 }}>
          “Buy the dip” is one of the most common phrases in the stock market. 
          The idea sounds simple: find strong stocks that temporarily fall and 
          then look for an opportunity to enter during the pullback.
        </p>

        <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
          But not every falling stock represents a dip. Some are simply breaking 
          down. The real challenge is identifying pullbacks that occur within a 
          healthy trend rather than weakness that signals deeper problems.
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
            The best dip opportunities usually happen in strong trends, not weak ones.
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2>1. Look for strong existing trends</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Traders usually prefer buying dips in stocks that have already shown 
            strong upward movement. When a stock has been trending higher for 
            months, pullbacks can sometimes represent temporary pauses rather than 
            trend reversals.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>2. Identify meaningful pullbacks</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            A pullback becomes interesting when price returns toward areas where 
            buyers previously stepped in. This might be a previous support level 
            or a consolidation zone.
          </p>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Traders often combine this with indicators such as{" "}
            <Link
              href="/what-is-rsi-indicator"
              style={{ color: "#93c5fd", textDecoration: "underline" }}
            >
              RSI
            </Link>{" "}
            to judge whether momentum has become temporarily stretched.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>3. Watch how the stock behaves after the dip</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            A healthy dip often stabilises and begins to form a new base. If price 
            continues falling without support, the setup may not be attractive.
          </p>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            This is why traders rarely rely on the size of the drop alone. They 
            study how price behaves after the pullback.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2>4. Use screening tools to find candidates</h2>

          <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.86 }}>
            Searching the entire market manually can be slow. Many traders use 
            stock screeners or idea platforms to surface stocks that may be 
            showing pullbacks inside stronger trends.
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
              Explore buy-the-dip ideas
            </div>

            <p style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.86 }}>
              Use the MyStockHarbor stock pickers to explore stocks that may 
              represent pullback opportunities and review their charts in detail.
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
            <Link href="/buy-the-dip-stocks">Buy the Dip Stocks</Link>
            <Link href="/oversold-stocks">Oversold Stocks</Link>
            <Link href="/stocks-down-from-highs">Stocks Down From Highs</Link>
            <Link href="/stock-market-setups">Stock Market Setups</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
