import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Best Free Stock Screener: What Traders Should Look For | MyStockHarbor",
  description:
    "Learn what makes the best free stock screener, which features traders look for, and how MyStockHarbor helps you explore stock ideas.",
  alternates: {
    canonical: "/best-free-stock-screener",
  },
  openGraph: {
    title: "Best Free Stock Screener | MyStockHarbor",
    description:
      "Learn what traders look for in the best free stock screener and how to explore stock ideas with MyStockHarbor.",
    url: "https://mystockharbor.com/best-free-stock-screener",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Free Stock Screener | MyStockHarbor",
    description:
      "Learn what makes a free stock screener useful and how traders compare screening tools.",
  },
};

export default function BestFreeStockScreenerPage() {
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
          STOCK SCREENER GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Best Free Stock Screener: What Traders Should Look For
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          The best free stock screener is not just the one with the most filters.
          It is the one that helps you narrow the market down quickly, understand
          what you are looking at, and move from screening into proper chart
          review without adding too much friction.
        </p>

        <p
          style={{
            marginTop: 12,
            opacity: 0.86,
            lineHeight: 1.7,
          }}
        >
          Different traders want different things. Some want breakout scans. Some
          want oversold names. Some want a quick way to surface stock ideas and
          then study the chart. That is why the best free stock screener depends
          less on hype and more on how well the tool fits your process.
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
            A good free stock screener should help you find ideas fast and judge them clearly.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Bad tool:</strong> too much clutter, too many steps, weak
              chart context.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Good tool:</strong> helps you find setups quickly and move
              straight into review.
            </div>
            <div style={{ opacity: 0.88, lineHeight: 1.6 }}>
              <strong>Best fit:</strong> works with the kind of trading setups you
              actually care about.
            </div>
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            1. What makes a free stock screener useful?
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            A useful free stock screener helps traders reduce a huge universe of
            stocks into a smaller list of names worth investigating. That sounds
            simple, but in practice the best screeners do this in a way that feels
            fast, clear and connected to actual decision-making.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The main point is not to generate endless lists. The point is to
            surface relevant candidates and make it easier to decide which charts
            deserve more attention.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            2. Features traders often want in the best free stock screener
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
              <div style={{ fontWeight: 900 }}>Easy setup filtering</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Traders often want a simple way to explore themes like breakouts,
                oversold stocks, pullbacks or momentum names without building
                overly complex scans from scratch.
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
              <div style={{ fontWeight: 900 }}>Clean chart follow-up</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                Screening only gets you part of the way. A good screener should
                make it easy to follow up with chart review and not leave you with
                a disconnected list of ticker symbols.
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
              <div style={{ fontWeight: 900 }}>Clear signal, less clutter</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                The best tools help you focus on what matters. Too many columns,
                menus and settings can actually slow traders down rather than help
                them.
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
              <div style={{ fontWeight: 900 }}>Useful educational context</div>
              <div style={{ marginTop: 6, opacity: 0.86, lineHeight: 1.6 }}>
                A strong screener experience is even better when it helps users
                understand what a setup means, not just where to click.
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            3. Why “best” depends on your strategy
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            The best free stock screener for a breakout trader may not be the best
            one for someone looking for oversold rebounds or longer-term trend
            continuation setups. A tool feels useful when it helps you find the
            kinds of ideas you actually want to trade.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            This is why many traders end up preferring setup-led tools. Instead of
            starting with a giant list of raw filters, they start with the type of
            opportunity they want to research.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            4. Common mistakes when judging free stock screeners
          </h2>

          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              Choosing based only on how many filters exist
            </li>
            <li style={{ marginBottom: 6 }}>
              Ignoring whether the tool helps with chart review
            </li>
            <li style={{ marginBottom: 6 }}>
              Using a screener without understanding the setup being scanned
            </li>
            <li style={{ marginBottom: 6 }}>
              Assuming more data automatically means better decisions
            </li>
          </ul>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            In reality, many traders benefit more from a focused tool and a clear
            workflow than from endless configuration options.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>
            5. Using MyStockHarbor as a free stock screener
          </h2>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            MyStockHarbor helps you explore stock ideas through setup-based stock
            pickers and chart review tools. Instead of forcing you to build every
            search from scratch, it helps you start from the kind of setup you are
            interested in and then review candidates more closely.
          </p>

          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            That can make the research process simpler for traders who want to
            move quickly from idea discovery into chart analysis.
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
              Explore stock ideas with MyStockHarbor
            </div>

            <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
              Use the MyStockHarbor stock pickers to explore live market ideas,
              review charts and research common setup types in one place.
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
                href="/platforms"
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
                Compare Platforms →
              </Link>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Related guides</h2>

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
                href: "/stock-screener-for-breakouts",
                title: "Stock Screener for Breakouts",
                text: "Learn how traders use screening tools to look for breakout candidates.",
              },
              {
                href: "/stock-screener-for-oversold-stocks",
                title: "Stock Screener for Oversold Stocks",
                text: "Learn how traders scan for pullbacks, oversold names and rebound setups.",
              },
              {
                href: "/stock-market-setups",
                title: "Stock Market Setups",
                text: "Explore the full hub of common stock market setups and ideas.",
              },
              {
                href: "/best-stock-indicators-for-beginners",
                title: "Best Stock Indicators for Beginners",
                text: "Learn about common indicators traders use to review setup quality.",
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
