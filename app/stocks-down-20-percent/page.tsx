import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stocks Down 20 Percent: How Traders Review Big Pullbacks | MyStockHarbor",
  description:
    "Learn what it means when stocks are down 20 percent, how traders review major pullbacks, and how to explore live stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/stocks-down-20-percent",
  },
  openGraph: {
    title: "Stocks Down 20 Percent | MyStockHarbor",
    description:
      "Learn how traders review stocks down 20 percent and bigger pullback setups.",
    url: "https://mystockharbor.com/stocks-down-20-percent",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Down 20 Percent | MyStockHarbor",
    description:
      "Learn how traders think about stocks that are down 20 percent from previous levels.",
  },
};

export default function StocksDown20PercentPage() {
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
          PULLBACK GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Stocks Down 20 Percent: How Traders Review Big Pullbacks
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          When a stock is down 20 percent, it usually gets attention fast. Some
          traders see opportunity. Others see risk. The important thing is that a
          stock being down 20 percent does not automatically make it cheap, broken
          or ready to bounce.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          Traders usually want more context. Is the stock pulling back inside a
          healthy bigger trend, or is it losing structure and momentum? Is it
          falling into support, or simply continuing lower with no clear base?
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
            Down 20 percent is a starting signal to investigate, not a reason to buy by itself.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Could be opportunity:</strong> a strong stock may simply be
              having a deeper pullback.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Could be risk:</strong> a weak stock may still be in the
              middle of a larger breakdown.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Best approach:</strong> study chart structure, trend and
              momentum before making any decision.
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            1. What does it mean when a stock is down 20 percent?
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Usually it means the stock has dropped 20 percent from a previous
            reference point, often a recent high, swing high or 52-week high.
            That is a large enough move to matter because it often changes how
            traders think about trend strength, risk and possible rebound setups.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            But the number alone is not enough. A stock down 20 percent after a
            huge multi-month run can be very different from a stock down 20 percent
            after already showing months of weakness.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            2. Why traders pay attention to 20 percent pullbacks
          </h2>

          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              The move is large enough to stand out on a chart
            </li>
            <li style={{ marginBottom: 6 }}>
              It can create possible oversold or rebound conditions
            </li>
            <li style={{ marginBottom: 6 }}>
              It can test whether a bigger uptrend is still healthy
            </li>
            <li style={{ marginBottom: 6 }}>
              It can reveal whether momentum is stabilising or still deteriorating
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In practice, many traders use a move like this as a reason to look
            closer, not as proof that the setup is attractive.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            3. What traders check next
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
              <div style={{ fontWeight: 900 }}>Support levels</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Traders often ask whether price is approaching a meaningful support
                area or whether it is falling through previous levels too easily.
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
              <div style={{ fontWeight: 900 }}>Trend quality</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                A stock in a broad uptrend may still be healthy after a 20 percent
                drop. A stock already in a downtrend may simply be continuing lower.
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
              <div style={{ fontWeight: 900 }}>Momentum behaviour</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Tools like{" "}
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
                can help traders judge whether the move looks stretched or whether
                downside momentum is still dominant.
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
              <div style={{ fontWeight: 900 }}>Market context</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Traders often compare the stock with the broader market. A 20
                percent drop during widespread weakness may be read differently
                from a stock falling alone while the market is steady.
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            4. Why a stock down 20 percent is not automatically a bargain
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            One of the easiest mistakes is assuming that a big drop equals value.
            Price alone does not tell you whether the chart is becoming attractive.
            Some stocks pull back and recover well. Others keep falling because the
            trend has already turned weak.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            That is why many traders focus on price behaviour after the drop. They
            want to see whether the stock is stabilising, finding support or
            starting to rebuild strength.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            5. How MyStockHarbor can help
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MyStockHarbor helps you explore stock ideas using setup-based pickers
            and chart review tools. If you are researching stocks that have pulled
            back heavily, you can use MyStockHarbor to find candidates, compare
            charts and review whether a setup looks constructive or risky.
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
              Explore pullback-style stock ideas
            </div>

            <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
              Use the MyStockHarbor stock picker to explore live market ideas and
              review charts showing pullbacks, setup potential and price behaviour
              after larger declines.
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
                href="/stocks-down-from-highs"
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
                Read Pullback Guide →
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
                href: "/stocks-down-from-highs",
                title: "Stocks Down From Highs",
                text: "Learn how traders think about stocks that have pulled back from previous highs.",
              },
              {
                href: "/oversold-stocks",
                title: "Oversold Stocks",
                text: "Understand how traders review stretched downside moves and rebound setups.",
              },
              {
                href: "/buy-the-dip-stocks",
                title: "Buy The Dip Stocks",
                text: "Learn how traders think about pullbacks inside stronger trends.",
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
