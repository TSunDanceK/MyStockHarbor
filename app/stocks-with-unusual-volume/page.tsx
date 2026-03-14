import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title:
    "Stocks With Unusual Volume: What They Mean and How Traders Review Them | MyStockHarbor",
  description:
    "Learn what stocks with unusual volume mean, why volume spikes matter, and how traders review breakout, momentum and reversal setups using MyStockHarbor.",
  alternates: {
    canonical: "/stocks-with-unusual-volume",
  },
  openGraph: {
    title: "Stocks With Unusual Volume | MyStockHarbor",
    description:
      "Understand what unusual volume means, why it matters, and how traders use it when reviewing stocks.",
    url: "/stocks-with-unusual-volume",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With Unusual Volume | MyStockHarbor",
    description:
      "Understand what unusual volume means, why it matters, and how traders use it when reviewing stocks.",
  },
};

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.04)",
  textDecoration: "none",
  color: "#f1f5f9",
  display: "block",
};

const sectionStyle: React.CSSProperties = {
  marginTop: 24,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 18,
  padding: 22,
  background: "rgba(255,255,255,0.03)",
  maxWidth: 980,
};

export default function StocksWithUnusualVolumePage() {
  return (
    <main
      style={{
        padding: "40px 20px 72px",
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ maxWidth: 760 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.05)",
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                opacity: 0.9,
              }}
            >
              Volume Screener Guide
            </div>

            <h1
              style={{
                margin: "16px 0 0",
                fontSize: 40,
                lineHeight: 1.05,
                letterSpacing: "-0.04em",
              }}
            >
              Stocks With Unusual Volume
            </h1>

            <p
              style={{
                marginTop: 14,
                fontSize: 17,
                lineHeight: 1.7,
                opacity: 0.86,
                maxWidth: 760,
              }}
            >
              Stocks with unusual volume are often attracting more attention than
              normal. Traders watch volume spikes because they can help confirm
              breakouts, warn of reversals, or highlight moments when price
              action is backed by stronger participation.
            </p>
          </div>

          <Link
            href="/pickers"
            style={{
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(239,68,68,0.35)",
              textDecoration: "none",
              color: "#fef2f2",
              fontWeight: 900,
              background:
                "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            📊 Open Stock Pickers
          </Link>
        </div>

        <section style={sectionStyle}>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            What does unusual volume mean?
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            Volume shows how much trading activity took place during a given
            period. When a stock has unusual volume, it means the amount traded
            is noticeably higher than its recent average. This can suggest that
            more traders and investors are paying attention to the stock than
            usual.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            Unusual volume does not automatically tell you whether a move is
            bullish or bearish. It simply tells you participation has increased,
            which is why traders always compare volume with the chart itself.
          </p>
        </section>

        <section style={sectionStyle}>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Why traders care about volume spikes
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            A price move with stronger-than-normal volume can be more meaningful
            than the same move on light activity. That is why traders often use
            volume to help judge whether a breakout looks stronger, whether a
            trend is attracting support, or whether a sudden reversal has real
            conviction behind it.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            Even so, high volume is not a guarantee of follow-through. Some
            spikes happen because of news, earnings or panic, and price can
            still reverse quickly afterwards.
          </p>
        </section>

        <section style={sectionStyle}>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            How traders review stocks with unusual volume
          </h2>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <div style={cardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Compare price and volume
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.78,
                  lineHeight: 1.6,
                }}
              >
                Traders want to see whether the volume spike is supporting a
                breakout, breakdown, reversal or strong momentum move.
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Check key levels
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.78,
                  lineHeight: 1.6,
                }}
              >
                Unusual volume near support, resistance or previous highs can
                make those moments more important.
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Look for context
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.78,
                  lineHeight: 1.6,
                }}
              >
                Traders often ask whether the spike came from earnings, news,
                sector strength or a broader market move.
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Avoid reading volume alone
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.78,
                  lineHeight: 1.6,
                }}
              >
                Volume is most useful when combined with trend, structure,
                momentum and chart levels rather than used on its own.
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            maxWidth: 980,
          }}
        >
          <Link href="/stocks-ready-to-break-out" style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Read about breakout stocks
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                opacity: 0.78,
                lineHeight: 1.6,
              }}
            >
              See how traders combine price structure and volume when looking
              for breakout setups.
            </div>
          </Link>

          <Link href="/breakout-stocks" style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Explore breakout setups
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                opacity: 0.78,
                lineHeight: 1.6,
              }}
            >
              Learn why price pushing into resistance can matter more when
              volume is rising too.
            </div>
          </Link>

          <Link href="/how-to-read-stock-charts" style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Learn chart basics
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                opacity: 0.78,
                lineHeight: 1.6,
              }}
            >
              Build the chart-reading foundation needed to interpret volume in
              context.
            </div>
          </Link>

          <Link href="/pickers" style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Use the stock pickers
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                opacity: 0.78,
                lineHeight: 1.6,
              }}
            >
              Browse stock ideas by setup and then inspect any symbol inside the
              MyStockHarbor dashboard.
            </div>
          </Link>
        </section>

        <section style={sectionStyle}>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            FAQ
          </h2>

          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What is unusual volume in stocks?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                It usually means the stock is trading far more heavily than its
                recent average, which can signal increased attention or stronger
                participation.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Is unusual volume bullish?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Not by itself. High volume can support bullish or bearish moves,
                so traders look at price direction and chart structure as well.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What should I do after finding a stock with unusual volume?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Review the chart, check whether price is near important levels,
                and decide whether the volume spike strengthens or weakens the
                setup you are seeing.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
