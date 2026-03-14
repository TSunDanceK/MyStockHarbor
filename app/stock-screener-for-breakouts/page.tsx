import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stock Screener for Breakouts: How to Scan for Breakout Stocks | MyStockHarbor",
  description:
    "Learn how a stock screener for breakouts works, what traders look for in breakout scans, and how to explore live breakout ideas with MyStockHarbor.",
  alternates: {
    canonical: "/stock-screener-for-breakouts",
  },
  openGraph: {
    title: "Stock Screener for Breakouts | MyStockHarbor",
    description:
      "Learn how traders scan for breakout stocks and explore live breakout ideas.",
    url: "https://mystockharbor.com/stock-screener-for-breakouts",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Screener for Breakouts | MyStockHarbor",
    description:
      "Learn how traders use a stock screener for breakouts and momentum setups.",
  },
};

export default function StockScreenerForBreakoutsPage() {
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
          BREAKOUT SCREENER GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Stock Screener for Breakouts: How to Scan for Breakout Stocks
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          A stock screener for breakouts helps traders narrow the market down to
          stocks that may be pushing through resistance, making new highs, or
          showing strong price expansion. Instead of manually checking hundreds of
          charts, a screener helps you focus on names already showing momentum.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          The goal is not to buy every stock that looks strong. The goal is to use
          a breakout stock screener to build a shortlist, then review chart
          structure, momentum and market context before making any decision.
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
            A breakout screener finds candidates. The chart tells you whether the setup is good.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Screener job:</strong> surface stocks showing strength,
              momentum or fresh highs.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Your job:</strong> check if price is breaking a level that
              actually matters.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Best use:</strong> turn a huge stock universe into a smaller,
              better list to review.
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            1. What is a stock screener for breakouts?
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A stock screener for breakouts is a tool that filters stocks based on
            price behaviour linked to breakout setups. This might include stocks
            trading near 52-week highs, stocks making fresh short-term highs, or
            names already showing strong relative momentum.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Traders use these screens to reduce noise. Instead of searching the
            whole market manually, they focus first on stocks where price action
            suggests possible breakout conditions.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            2. Why traders use breakout stock screeners
          </h2>

          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              They help traders find strong stocks faster
            </li>
            <li style={{ marginBottom: 6 }}>
              They reduce time spent checking weak or irrelevant charts
            </li>
            <li style={{ marginBottom: 6 }}>
              They help build a focused watchlist for momentum setups
            </li>
            <li style={{ marginBottom: 6 }}>
              They make it easier to compare multiple breakout candidates
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In other words, a screener does not replace chart reading. It improves
            the starting point.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            3. What traders often look for in a breakout scan
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
              <div style={{ fontWeight: 900 }}>Price near highs</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Stocks trading near recent highs or 52-week highs often attract
                breakout traders because they are already showing strength.
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
              <div style={{ fontWeight: 900 }}>Tight price structure</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                A tighter range below resistance can be more interesting than a
                random spike because it suggests controlled pressure building.
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
                Traders often confirm breakouts with momentum tools like{" "}
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
                </Link>
                .
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
              <div style={{ fontWeight: 900 }}>Trend alignment</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Breakouts can carry more weight when they happen in stocks already
                trending well rather than in weak, choppy charts.
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            4. What a breakout screener cannot do
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A screener cannot tell you whether the breakout level is meaningful,
            whether the stock is extended, or whether the move is likely to fail.
            It only highlights candidates based on the rules you are using.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            This is why traders still check the chart manually. A stock can appear
            in a breakout scan and still be badly timed, overextended or sitting
            just below obvious resistance.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            5. How to review breakout candidates properly
          </h2>

          <ol style={{ marginTop: 12, paddingLeft: 18 }}>
            <li style={{ marginBottom: 8 }}>
              Check whether price is actually near a meaningful breakout level
            </li>
            <li style={{ marginBottom: 8 }}>
              Look for clean structure rather than messy price action
            </li>
            <li style={{ marginBottom: 8 }}>
              Review whether momentum supports the move
            </li>
            <li style={{ marginBottom: 8 }}>
              Compare the stock with the wider market trend
            </li>
            <li style={{ marginBottom: 8 }}>
              Avoid assuming every strong chart will keep running
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
            will help you interpret breakout candidates with more confidence.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            6. Using MyStockHarbor as a breakout stock screener
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MyStockHarbor helps you explore stock ideas using setup-based pickers
            and chart review tools. You can use it to look for names that may fit
            breakout-style conditions, then study the chart in more detail before
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
              Explore breakout-style stock ideas
            </div>

            <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
              Use the MyStockHarbor stock picker to explore live market ideas and
              review charts showing strength, momentum and setup potential.
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
                href="/breakout-stocks"
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
                Read Breakout Guide →
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
                href: "/breakout-stocks",
                title: "Breakout Stocks",
                text: "Learn what traders look for in breakout charts and price expansion setups.",
              },
              {
                href: "/stock-market-setups",
                title: "Stock Market Setups",
                text: "Explore the full hub of common stock market setups and ideas.",
              },
              {
                href: "/oversold-stocks",
                title: "Oversold Stocks",
                text: "Understand how traders review stretched downside moves and rebound setups.",
              },
              {
                href: "/buy-the-dip-stocks",
                title: "Buy The Dip Stocks",
                text: "Learn how traders think about pullbacks in strong stocks.",
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
