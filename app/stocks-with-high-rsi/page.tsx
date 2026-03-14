import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stocks With High RSI: What They Mean and How Traders Review Them | MyStockHarbor",
  description:
    "Learn what stocks with high RSI mean, why a high RSI can signal strong momentum or overbought conditions, and how traders review these setups using MyStockHarbor.",
  alternates: {
    canonical: "/stocks-with-high-rsi",
  },
  openGraph: {
    title: "Stocks With High RSI | MyStockHarbor",
    description:
      "Understand what high RSI stocks are, how traders interpret them, and how to review them using stock pickers and chart tools.",
    url: "/stocks-with-high-rsi",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks With High RSI | MyStockHarbor",
    description:
      "Understand what high RSI stocks are, how traders interpret them, and how to review them using stock pickers and chart tools.",
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

export default function StocksWithHighRsiPage() {
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
              RSI Screener Guide
            </div>

            <h1
              style={{
                margin: "16px 0 0",
                fontSize: 40,
                lineHeight: 1.05,
                letterSpacing: "-0.04em",
              }}
            >
              Stocks With High RSI
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
              Stocks with high RSI are often showing strong recent momentum, but
              that does not automatically mean they should be sold. Traders use
              high RSI readings to spot overextended conditions, strong trends
              and possible reversal risk depending on the wider chart context.
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
            What does high RSI mean?
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            RSI stands for Relative Strength Index. It is a momentum indicator
            that helps traders judge whether a stock has been moving strongly in
            one direction. A high RSI often means price has risen quickly over a
            recent period, which can suggest strong bullish momentum or a stock
            that may be becoming overbought.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            Many traders treat RSI above 70 as a high reading, but that should
            always be interpreted in context. In a strong trend, RSI can stay
            elevated for much longer than beginners expect.
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
            Does high RSI mean a stock will fall?
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            Not necessarily. A high RSI can mean a stock is overextended, but it
            can also simply mean momentum is strong. Some of the strongest
            breakout stocks and trend leaders spend long periods with elevated
            RSI readings.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            That is why traders usually combine RSI with chart structure,
            support and resistance, volume, trend direction and sometimes
            divergence before making decisions.
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
            How traders review stocks with high RSI
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
                Check the trend
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.78,
                  lineHeight: 1.6,
                }}
              >
                A high RSI inside a strong uptrend can be very different from a
                high RSI after a sudden short-lived spike.
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Look at resistance
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.78,
                  lineHeight: 1.6,
                }}
              >
                Traders often check whether price is running into old highs,
                resistance zones or breakout levels.
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Compare momentum
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.78,
                  lineHeight: 1.6,
                }}
              >
                If price keeps rising but momentum starts fading, traders may
                look for bearish divergence or weakening strength.
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Use the full chart
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.78,
                  lineHeight: 1.6,
                }}
              >
                RSI is only one indicator. Most traders review the full chart
                before deciding whether a setup still looks healthy.
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
          <Link href="/what-is-rsi-indicator" style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Understand RSI
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                opacity: 0.78,
                lineHeight: 1.6,
              }}
            >
              Learn how RSI works and why traders use it to assess momentum and
              overbought or oversold conditions.
            </div>
          </Link>

          <Link href="/overbought-stocks" style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Read about overbought stocks
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                opacity: 0.78,
                lineHeight: 1.6,
              }}
            >
              See how traders interpret overbought conditions and why context
              matters.
            </div>
          </Link>

          <Link href="/bearish-divergence-stocks" style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Explore bearish divergence
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                opacity: 0.78,
                lineHeight: 1.6,
              }}
            >
              Learn how fading upside momentum can show up even while price is
              still rising.
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
                What is considered a high RSI?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Many traders consider RSI above 70 to be high, although some
                adjust that depending on the market, timeframe and trading
                strategy.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Is high RSI bearish?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Not always. High RSI can signal overextended conditions, but it
                can also appear during strong bullish momentum.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What should I do after finding a stock with high RSI?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                Review the full chart, check the trend, look for resistance or
                divergence, and then decide whether the setup still supports the
                move.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
