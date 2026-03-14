import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stock Screener for Oversold Stocks: How to Scan for Pullback Setups | MyStockHarbor",
  description:
    "Learn how a stock screener for oversold stocks works, what traders look for in pullback scans, and how to explore live oversold stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/stock-screener-for-oversold-stocks",
  },
  openGraph: {
    title: "Stock Screener for Oversold Stocks | MyStockHarbor",
    description:
      "Learn how traders scan for oversold stocks and explore pullback-style stock ideas.",
    url: "https://mystockharbor.com/stock-screener-for-oversold-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Screener for Oversold Stocks | MyStockHarbor",
    description:
      "Learn how traders use a stock screener for oversold stocks and pullback setups.",
  },
};

export default function StockScreenerForOversoldStocksPage() {
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
          OVERSOLD SCREENER GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Stock Screener for Oversold Stocks: How to Scan for Pullback Setups
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          A stock screener for oversold stocks helps traders narrow the market down
          to names that may have fallen sharply, pulled back into support, or
          stretched too far to the downside in the short term. Instead of manually
          reviewing hundreds of weak charts, a screener helps you focus on stocks
          that may be worth a closer look.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          The goal is not to assume every oversold stock will bounce. The goal is
          to use an oversold stock screener to build a shortlist, then review chart
          structure, trend quality and momentum before making any decision.
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
            An oversold screener finds possible rebound candidates. The chart tells you if the pullback is usable.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Screener job:</strong> surface stocks that have sold off,
              pulled back or become stretched lower.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Your job:</strong> decide whether the weakness is a normal
              pullback or a sign of a broken chart.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Best use:</strong> turn a large stock universe into a focused
              list of possible dip or rebound setups to review.
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            1. What is a stock screener for oversold stocks?
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A stock screener for oversold stocks is a tool that filters stocks
            based on price behaviour linked to pullbacks or downside stretches.
            This might include stocks down sharply over a short period, names
            trading near support, or stocks where momentum indicators suggest price
            has become stretched lower.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Traders use these screens to cut through noise. Instead of checking the
            full market manually, they focus first on charts where price action
            suggests a possible rebound, recovery or buy-the-dip opportunity.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            2. Why traders use oversold stock screeners
          </h2>

          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              They help traders find pullback candidates faster
            </li>
            <li style={{ marginBottom: 6 }}>
              They reduce time spent reviewing random weak charts
            </li>
            <li style={{ marginBottom: 6 }}>
              They help build a focused watchlist of possible rebound setups
            </li>
            <li style={{ marginBottom: 6 }}>
              They make it easier to compare multiple oversold candidates
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In simple terms, the screener finds possible opportunities. The trader
            still has to judge the quality of the setup.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            3. What traders often look for in an oversold scan
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
              <div style={{ fontWeight: 900 }}>Sharp short-term weakness</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Traders often start by looking for stocks that have dropped enough
                to stand out, but not necessarily enough to be permanently damaged.
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
              <div style={{ fontWeight: 900 }}>Support or key price area</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                A pullback into a meaningful support level is often more useful
                than a stock that is simply falling with no clear structure.
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
              <div style={{ fontWeight: 900 }}>Momentum stretch</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Traders often use tools like{" "}
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
                to judge whether a move looks stretched or momentum may be starting
                to stabilise.
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
              <div style={{ fontWeight: 900 }}>Trend context</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                A pullback in a stronger uptrend is usually viewed differently from
                a stock that has been in a long, weak downtrend for months.
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            4. What an oversold screener cannot do
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A screener cannot tell you whether the stock is finding real support,
            whether the trend is still healthy, or whether the weakness is likely
            to continue. It only highlights candidates based on the rules you are
            using.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            This is why chart review still matters. A stock can appear in an
            oversold scan and still be breaking down badly, losing trend structure
            or showing no sign of stabilising.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            5. How to review oversold candidates properly
          </h2>

          <ol style={{ marginTop: 12, paddingLeft: 18 }}>
            <li style={{ marginBottom: 8 }}>
              Check whether the stock is pulling back into a meaningful level
            </li>
            <li style={{ marginBottom: 8 }}>
              Decide whether the chart still has a healthy bigger-picture trend
            </li>
            <li style={{ marginBottom: 8 }}>
              Review whether momentum looks stretched or is beginning to improve
            </li>
            <li style={{ marginBottom: 8 }}>
              Compare the stock with the wider market environment
            </li>
            <li style={{ marginBottom: 8 }}>
              Avoid assuming every falling stock is a bargain
            </li>
          </ol>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            If you are new to chart reading, this guide on{" "}
            <Link
              href="/how-to-read-stock-charts"
              style={{ color: "#93c5fd", textDecoration: "underline" }}
            >
              how to read stock charts
            </Link>{" "}
            will help you judge pullback and rebound setups more clearly.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            6. Using MyStockHarbor as an oversold stock screener
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MyStockHarbor helps you explore stock ideas using setup-based pickers
            and chart review tools. You can use it to look for names that may fit
            oversold-style conditions, then review the chart in more detail before
            making any decision.
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
            <div style={{ fontWeight: 900, fontSize: 21 }}>
              Explore oversold-style stock ideas
            </div>

            <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
              Use the MyStockHarbor stock picker to explore live market ideas and
              review charts showing pullbacks, weakness and rebound setup
              potential.
            </p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
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
                Open Stock Pickers →
              </Link>

              <Link
                href="/oversold-stocks"
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
                Read Oversold Guide →
              </Link>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Related stock setup guides</h2>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {[
              {
                href: "/oversold-stocks",
                title: "Oversold Stocks",
                text: "Learn what traders look for in oversold charts and rebound-style setups.",
              },
              {
                href: "/buy-the-dip-stocks",
                title: "Buy The Dip Stocks",
                text: "Understand how traders review pullbacks inside stronger trends.",
              },
              {
                href: "/stocks-down-from-highs",
                title: "Stocks Down From Highs",
                text: "Learn how traders think about stocks that have pulled back from previous highs.",
              },
              {
                href: "/stock-market-setups",
                title: "Stock Market Setups",
                text: "Explore the full hub of common stock market setups and ideas.",
              },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  padding: 16,
                  textDecoration: "none",
                  color: "#f1f5f9",
                  display: "block",
                }}
              >
                <div style={{ fontWeight: 900 }}>{item.title}</div>
                <div style={{ marginTop: 8, opacity: 0.8, lineHeight: 1.55, fontSize: 14 }}>
                  {item.text}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
