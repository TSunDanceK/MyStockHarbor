import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stocks Down From Recent Highs: Finding Potential Dip Opportunities | MyStockHarbor",
  description:
    "Learn how to find stocks down from recent highs, why investors watch pullbacks, the risks of buying dips too early, and how to explore live stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/stocks-down-from-highs",
  },
  openGraph: {
    title: "Stocks Down From Recent Highs | MyStockHarbor",
    description:
      "A beginner-friendly guide to spotting stocks down from highs and finding potential dip opportunities.",
    url: "https://mystockharbor.com/stocks-down-from-highs",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Down From Recent Highs | MyStockHarbor",
    description:
      "Learn how to spot stocks down from highs and explore potential dip opportunities.",
  },
};

export default function StocksDownFromHighsPage() {
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
          DIP BUYING GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Stocks Down From Recent Highs: Finding Potential Dip Opportunities
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          Many investors look for stocks that have pulled back from recent highs.
          The idea is simple: if a strong stock drops meaningfully but the bigger
          trend still looks healthy, the pullback may create a better entry than
          chasing the price near the top.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          That does not mean every falling stock is a buying opportunity. Some
          stocks are down from highs because momentum is fading, trend is
          breaking, or the wider market is weakening. The real skill is learning
          how to tell the difference between a normal dip and a genuine
          deterioration.
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
            A dip is only interesting if the stock is still worth owning.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Good dip:</strong> price has pulled back, but structure and
              trend still look constructive.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Bad dip:</strong> price is falling because momentum,
              support, or the broader trend is breaking down.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Goal:</strong> find pullbacks worth reviewing, then confirm
              them on the chart before acting.
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            1. What does “down from highs” actually mean?
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            When traders say a stock is down from highs, they usually mean price
            has fallen a noticeable distance from a recent peak. That might be a
            drop of 10%, 15%, 20% or more depending on the stock and the trading
            style.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            For long-term investors, these pullbacks can be interesting because
            they may offer better value than buying after a big run. For traders,
            they can highlight oversold conditions, support tests, or possible
            bounce setups.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            2. Why investors look for stocks off their highs
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Buying after a pullback can improve risk-reward. Instead of chasing a
            stock after a strong move, investors can wait for weakness and assess
            whether the dip looks temporary or structural.
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              Strong stocks often experience normal pullbacks during larger uptrends
            </li>
            <li style={{ marginBottom: 6 }}>
              Oversold conditions can sometimes create better entries
            </li>
            <li style={{ marginBottom: 6 }}>
              Pullbacks near support or major moving averages can be worth reviewing
            </li>
            <li style={{ marginBottom: 6 }}>
              A stock down from highs may attract investors who already wanted to own it
            </li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            3. The danger of buying dips too early
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            One of the biggest mistakes beginners make is assuming every drop is a
            bargain. A stock can be down 20% and still have plenty of room to
            fall if the trend is breaking, earnings expectations are changing, or
            the broader market is turning weak.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            That is why chart context matters. A dip is much more interesting if
            price is pulling back into support, holding key structure, or showing
            signs that selling pressure is easing.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            4. What to check before buying a dip
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
              <div style={{ fontWeight: 900 }}>Trend</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Is the larger trend still intact, or has price started breaking
                lower highs and lower lows?
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
              <div style={{ fontWeight: 900 }}>Support</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Is the stock near a level where buyers have stepped in before?
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
              <div style={{ fontWeight: 900 }}>Stretch</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Does RSI, Stochastic, Bollinger Bands or distance from VWAP show
                that price may be oversold or extended?
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
              <div style={{ fontWeight: 900 }}>Momentum</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Is momentum stabilising, or is it still getting worse?
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            5. How MyStockHarbor helps you find dip opportunities
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MyStockHarbor is designed to help you scan for stocks that may be
            worth a closer look. Instead of manually checking chart after chart,
            you can browse live stock ideas grouped by setup.
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
            page is especially useful here because it groups stocks into
            categories like oversold-leaning signals, divergence setups,
            buy-the-dip candidates and breakouts. From there, you can open any
            symbol in the dashboard and review the chart in more detail.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            6. A simple mindset for beginners
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            You do not need to predict the exact bottom. A better approach is to
            build a shortlist of interesting pullbacks, then use trend, support,
            stretch and momentum to decide whether the setup deserves more
            attention.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In other words: use dips to find ideas, not to force trades.
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
            Explore live dip candidates on MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            Use MyStockHarbor to review trend, momentum, stretch, divergence and
            chart structure in one place. Start with live stock ideas, then open
            the chart and decide whether the pullback looks constructive.
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
