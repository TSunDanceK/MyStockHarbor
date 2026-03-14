import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Identify Stock Trends | MyStockHarbor",
  description:
    "Learn how to identify stock trends using price structure, moving averages, momentum, and market context. A beginner-friendly guide to spotting uptrends, downtrends, and sideways markets.",
};

export default function HowToIdentifyStockTrendsPage() {
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
            href="/learn"
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
            Learn →
          </Link>
        </div>

        <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800 }}>
          TREND GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          How to Identify Stock Trends
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          Identifying trend is one of the most important skills in chart reading.
          Before using indicators, traders should first understand whether price
          is moving up, moving down, or simply drifting sideways.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          A clear trend gives context to everything else on the chart. It helps
          you judge whether momentum is healthy, whether pullbacks are normal,
          and whether signals should be treated as continuation or reversal risk.
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
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Simple trend idea</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ opacity: 0.9 }}>
              <strong>Uptrend</strong> = price keeps making higher highs and higher lows
            </div>
            <div style={{ opacity: 0.9 }}>
              <strong>Downtrend</strong> = price keeps making lower highs and lower lows
            </div>
            <div style={{ opacity: 0.9 }}>
              <strong>Sideways</strong> = price moves in a range without clear direction
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>1. Start with price structure</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The simplest way to identify trend is by looking at structure.
            Ask whether price is making:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              <strong>Higher highs and higher lows</strong> → usually an uptrend
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Lower highs and lower lows</strong> → usually a downtrend
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Repeated failed breakouts in both directions</strong> → often a range
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            This should always come before indicators. Trend begins with price.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>2. Use moving averages to simplify the chart</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            Moving averages are one of the easiest ways for beginners to confirm
            trend direction. The 50-day and 200-day moving averages are
            especially useful.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In general:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              Price above MA50 and MA200 often suggests strength
            </li>
            <li style={{ marginBottom: 6 }}>
              MA50 above MA200 often suggests stronger long-term structure
            </li>
            <li style={{ marginBottom: 6 }}>
              Price below those averages often suggests a weaker trend
            </li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>3. Check whether momentum agrees</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A healthy trend usually has momentum behind it. This is where
            indicators like RSI and MACD can help.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            For example:
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              Strong bullish trends often keep RSI firm and MACD positive
            </li>
            <li style={{ marginBottom: 6 }}>
              Weakening trends often show fading MACD or bearish divergence
            </li>
            <li style={{ marginBottom: 6 }}>
              Choppy trends often produce mixed and unreliable momentum signals
            </li>
          </ul>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>4. Recognise pullbacks versus reversals</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            One of the hardest parts of trend reading is knowing whether price is
            simply pulling back or actually reversing.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In a healthy uptrend, price often pulls back without breaking the
            larger structure. In a real reversal, price starts breaking key lows,
            losing moving-average support, and showing weaker momentum.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>5. Use market context</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A stock trend is easier to trust when the wider market supports it.
            That is why market benchmarks and volatility context matter.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A stock trying to trend higher in a weak market often faces more
            resistance than one moving with a strong broader market.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Common beginner mistake</h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A common mistake is looking for reversal signals too early and
            fighting an obvious trend. Many beginners try to call the top or
            bottom before the chart structure has actually changed.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A better approach is to respect the existing trend until price,
            structure, and momentum clearly suggest otherwise.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Simple beginner checklist</h2>

          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900 }}>Step 1</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Look at price structure first.
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
              <div style={{ fontWeight: 900 }}>Step 2</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Check where price is relative to MA50 and MA200.
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
              <div style={{ fontWeight: 900 }}>Step 3</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Use RSI or MACD to confirm momentum.
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
              <div style={{ fontWeight: 900 }}>Step 4</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Check whether the wider market supports the move.
              </div>
            </div>
          </div>
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
            Use MyStockHarbor to check trend faster
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            MyStockHarbor helps you quickly assess trend, stretch, momentum,
            divergence, and market context so you can understand whether a stock
            is moving strongly or simply drifting.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              href="/"
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
              Open the Dashboard →
            </Link>

            <Link
              href="/how-to-read-stock-charts"
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
              Read Chart Guide →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
