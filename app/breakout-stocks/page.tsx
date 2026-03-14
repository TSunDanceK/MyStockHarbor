import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Breakout Stocks: How to Spot Momentum and Price Expansion | MyStockHarbor",
  description:
    "Learn what breakout stocks are, how traders identify breakout setups, the risks of false breakouts, and how to explore live stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/breakout-stocks",
  },
  openGraph: {
    title: "Breakout Stocks | MyStockHarbor",
    description:
      "A beginner-friendly guide to breakout stocks, momentum setups and how to explore live stock ideas.",
    url: "https://mystockharbor.com/breakout-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Breakout Stocks | MyStockHarbor",
    description:
      "Learn how traders identify breakout stocks and momentum setups.",
  },
};

export default function BreakoutStocksPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div className="wrap">
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "flex-start",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Link href="/" style={topNavBtnStyle("dashboard")}>
              <span
                aria-hidden="true"
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {topNavIcon("dashboard")}
              </span>
              <span>Dashboard</span>
            </Link>

            <Link href="/platforms" style={topNavBtnStyle("platforms")}>
              <span
                aria-hidden="true"
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {topNavIcon("platforms")}
              </span>
              <span>Platforms</span>
            </Link>

            <Link href="/pickers" style={topNavBtnStyle("pickers")}>
              <span
                aria-hidden="true"
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {topNavIcon("pickers")}
              </span>
              <span>Stock Pickers</span>
            </Link>

            <Link href="/utilities" style={topNavBtnStyle("calculators")}>
              <span
                aria-hidden="true"
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {topNavIcon("calculators")}
              </span>
              <span>Calculators</span>
            </Link>
          </div>

          <div style={{ maxWidth: 780 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.12))",
                border: "1px solid rgba(239,68,68,0.34)",
                color: "#fee2e2",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              BREAKOUT GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Breakout Stocks: How to Spot Momentum and Price Expansion
            </h1>

            <p
              style={{
                margin: "12px 0 0 0",
                fontSize: 17,
                lineHeight: 1.65,
                opacity: 0.84,
              }}
            >
              Breakout stocks are stocks pushing above key levels such as recent highs,
              resistance zones or tight trading ranges. Traders watch these setups
              because a clean breakout can signal fresh momentum, stronger demand and
              the start of a more powerful move.
            </p>

            <p
              style={{
                margin: "12px 0 0 0",
                opacity: 0.8,
                lineHeight: 1.65,
              }}
            >
              But not every breakout works. Some breakouts fail quickly, trap late
              buyers and fall back into the range. That is why it helps to understand
              what makes a breakout stronger, what warning signs to watch for, and how
              to use chart context instead of chasing every move.
            </p>
          </div>
        </div>

        <section
          style={{
            marginTop: 24,
            padding: 20,
            borderRadius: 18,
            border: "1px solid rgba(239,68,68,0.28)",
            background:
              "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(168,85,247,0.08))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))",
              border: "1px solid rgba(239,68,68,0.32)",
              color: "#fee2e2",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            SIMPLE WAY TO THINK ABOUT IT
          </div>

          <div
            style={{
              marginTop: 12,
              fontSize: 28,
              fontWeight: 950,
              lineHeight: 1.15,
              letterSpacing: "-0.5px",
            }}
          >
            A breakout is strongest when price escapes a level that mattered.
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <HighlightCard
              title="Good breakout"
              text="Price clears resistance with intent and holds above the level."
              tint="green"
            />
            <HighlightCard
              title="Weak breakout"
              text="Price briefly pops above resistance, then slips back into the range."
              tint="red"
            />
            <HighlightCard
              title="Goal"
              text="Find strong setups worth reviewing, then confirm them with structure, momentum and market context."
              tint="blue"
            />
          </div>
        </section>

        <section
          style={{
            marginTop: 24,
            display: "grid",
            gap: 18,
          }}
        >
          <ContentSection
            number="1"
            title="What is a breakout stock?"
            tint="red"
          >
            <p style={paragraphStyle}>
              A breakout stock is a stock moving above a price area that had
              previously limited upside. This could be a prior swing high, a flat
              resistance level, a consolidation range or another area where sellers
              had been active before.
            </p>

            <p style={paragraphStyle}>
              When price finally moves through that area, traders often read it as a
              sign that buyers are gaining control. That does not guarantee
              continuation, but it does make the stock more interesting for momentum
              traders and trend followers.
            </p>
          </ContentSection>

          <ContentSection
            number="2"
            title="Why traders look for breakout stocks"
            tint="green"
          >
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gap: 10,
              }}
            >
              <BulletRow text="Breakouts can signal fresh momentum and stronger participation." />
              <BulletRow text="They can help traders focus on stocks already showing strength." />
              <BulletRow text="Clear breakout levels make chart structure easier to judge." />
              <BulletRow text="Strong breakouts can sometimes lead to trend continuation." />
            </div>

            <p style={paragraphStyle}>
              In practice, breakout traders are often looking for the market to show
              strength first rather than trying to predict it too early.
            </p>
          </ContentSection>

          <ContentSection
            number="3"
            title="What makes a breakout stronger?"
            tint="purple"
          >
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <IndicatorCard
                title="Clear resistance"
                text="Breakouts are easier to trust when price is clearing a level that obviously mattered on the chart."
              />
              <IndicatorCard
                title="Momentum confirmation"
                text="RSI, MACD or general price behaviour can help confirm that momentum is supporting the move rather than fading."
              />
              <IndicatorCard
                title="Healthy structure"
                text="Breakouts tend to look stronger when the stock is already building constructive higher lows or tightening before the move."
              />
              <IndicatorCard
                title="Market support"
                text="A breakout often has a better chance when the wider market is stable or strong rather than under heavy pressure."
              />
            </div>
          </ContentSection>

          <ContentSection
            number="4"
            title="The danger of false breakouts"
            tint="amber"
          >
            <p style={paragraphStyle}>
              False breakouts happen when price moves above resistance but fails to
              hold there. Instead of continuing higher, the stock drops back into
              the range and traps traders who chased too aggressively.
            </p>

            <p style={paragraphStyle}>
              This is one reason patience matters. Many traders prefer to see whether
              price can hold above the breakout area or retest it constructively
              before becoming too confident.
            </p>

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <QuestionCard text="Did price actually hold above resistance?" />
              <QuestionCard text="Was there real momentum behind the move?" />
              <QuestionCard text="Did volume and structure support the breakout?" />
              <QuestionCard text="Is the stock already slipping back into the range?" />
            </div>
          </ContentSection>

          <ContentSection
            number="5"
            title="How MyStockHarbor helps you find breakout stocks"
            tint="blue"
          >
            <p style={paragraphStyle}>
              MyStockHarbor helps you scan for stock ideas without manually digging
              through chart after chart. Instead of building a complicated screener,
              you can browse grouped setups and then inspect the chart in more detail.
            </p>

            <p style={paragraphStyle}>
              The{" "}
              <Link href="/pickers" style={inlineLinkStyle}>
                Find Your Next Stock
              </Link>{" "}
              page is useful here because it includes categories like breakouts,
              divergence setups, buy-the-dip candidates and oversold-leaning stocks.
              That makes it easier to build a shortlist of charts worth reviewing.
            </p>
          </ContentSection>

          <ContentSection
            number="6"
            title="A simple beginner approach"
            tint="red"
          >
            <p style={paragraphStyle}>
              Start by looking for clear levels and strong price structure. Then use
              momentum and market context to judge whether the move looks supported.
              The aim is not to chase every stock moving up, but to focus on setups
              where the breakout actually means something.
            </p>

            <p style={paragraphStyle}>
              In other words: use breakouts to find strong ideas, then confirm them
              on the chart before acting.
            </p>
          </ContentSection>
        </section>

        <section
          style={{
            marginTop: 28,
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 18,
            padding: 22,
            background: "linear-gradient(180deg, rgba(11,18,32,0.96), rgba(8,12,20,0.98))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
              border: "1px solid rgba(59,130,246,0.32)",
              color: "#dbeafe",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            RELATED SETUPS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 26,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Compare breakouts with other stock setups
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 760,
            }}
          >
            Breakouts are easier to understand when you compare them with other common
            setups like oversold conditions, dip-buy pullbacks and divergence signals.
          </p>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <RelatedCard
              href="/stock-market-setups"
              title="Stock Market Setups"
              desc="Explore the main setup hub covering dips, breakouts and divergence."
            />
            <RelatedCard
              href="/oversold-stocks"
              title="Oversold Stocks"
              desc="Learn how traders review stretched downside conditions and rebound setups."
            />
            <RelatedCard
              href="/buy-the-dip-stocks"
              title="Buy The Dip Stocks"
              desc="Review pullback setups that may still fit a constructive trend."
            />
            <RelatedCard
              href="/bullish-divergence-stocks"
              title="Bullish Divergence"
              desc="Understand how fading downside momentum can hint at a reversal setup."
            />
            <RelatedCard
              href="/pickers"
              title="Find Your Next Stock"
              desc="Browse live stock ideas by setup and open charts directly in the dashboard."
            />
          </div>
        </section>

        <section
          style={{
            marginTop: 28,
            padding: 20,
            borderRadius: 18,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
              border: "1px solid rgba(34,197,94,0.34)",
              color: "#dcfce7",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            NEXT STEP
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontWeight: 900,
              fontSize: 26,
              letterSpacing: "-0.4px",
            }}
          >
            Explore live breakout stock ideas on MyStockHarbor
          </h2>

          <p
            style={{
              marginTop: 10,
              opacity: 0.86,
              lineHeight: 1.6,
              maxWidth: 820,
            }}
          >
            Use MyStockHarbor to review trend, momentum, stretch, divergence and
            chart structure in one place. Start with live stock ideas, then open
            the chart and decide whether the breakout looks constructive.
          </p>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/pickers"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "13px 18px",
                borderRadius: 14,
                border: "1px solid rgba(239,68,68,0.42)",
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
                color: "#fef2f2",
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
                border: "1px solid rgba(250,204,21,0.42)",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.22), rgba(202,138,4,0.12))",
                color: "#fefce8",
                textDecoration: "none",
                fontWeight: 900,
                minHeight: 48,
                whiteSpace: "nowrap",
              }}
            >
              Open the Dashboard →
            </Link>
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 900px;
          margin: 0 auto;
          padding: 28px 20px 40px;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        @media (max-width: 760px) {
          .wrap {
            padding: 18px 16px 34px !important;
          }
        }
      `}</style>
    </main>
  );
}

function ContentSection({
  number,
  title,
  tint,
  children,
}: {
  number: string;
  title: string;
  tint: "blue" | "green" | "red" | "amber" | "purple";
  children: React.ReactNode;
}) {
  const styles =
    tint === "blue"
      ? {
          border: "1px solid rgba(59,130,246,0.22)",
          background:
            "linear-gradient(180deg, rgba(10,18,34,0.96), rgba(7,12,24,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
          badgeBorder: "1px solid rgba(59,130,246,0.34)",
          badgeColor: "#dbeafe",
        }
      : tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.22)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
          badgeBorder: "1px solid rgba(34,197,94,0.34)",
          badgeColor: "#dcfce7",
        }
      : tint === "red"
      ? {
          border: "1px solid rgba(239,68,68,0.22)",
          background:
            "linear-gradient(180deg, rgba(24,12,12,0.96), rgba(14,7,7,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))",
          badgeBorder: "1px solid rgba(239,68,68,0.34)",
          badgeColor: "#fee2e2",
        }
      : tint === "amber"
      ? {
          border: "1px solid rgba(234,179,8,0.22)",
          background:
            "linear-gradient(180deg, rgba(18,16,10,0.96), rgba(12,10,7,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(234,179,8,0.18), rgba(202,138,4,0.10))",
          badgeBorder: "1px solid rgba(234,179,8,0.34)",
          badgeColor: "#fef3c7",
        }
      : {
          border: "1px solid rgba(168,85,247,0.22)",
          background:
            "linear-gradient(180deg, rgba(12,16,34,0.96), rgba(8,11,24,0.98))",
          badgeBg:
            "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(139,92,246,0.10))",
          badgeBorder: "1px solid rgba(168,85,247,0.34)",
          badgeColor: "#f3e8ff",
        };

  return (
    <section
      style={{
        border: styles.border,
        borderRadius: 18,
        padding: 20,
        background: styles.background,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "7px 12px",
          borderRadius: 999,
          background: styles.badgeBg,
          border: styles.badgeBorder,
          color: styles.badgeColor,
          fontWeight: 950,
          letterSpacing: "0.08em",
          fontSize: 12,
        }}
      >
        SECTION {number}
      </div>

      <h2
        style={{
          margin: "14px 0 0 0",
          fontSize: 26,
          lineHeight: 1.2,
          letterSpacing: "-0.4px",
        }}
      >
        {title}
      </h2>

      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

function HighlightCard({
  title,
  text,
  tint,
}: {
  title: string;
  text: string;
  tint: "blue" | "green" | "red";
}) {
  const styles =
    tint === "blue"
      ? {
          border: "1px solid rgba(59,130,246,0.24)",
          background:
            "linear-gradient(180deg, rgba(10,18,34,0.94), rgba(7,12,24,0.98))",
        }
      : tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.24)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.94), rgba(7,12,11,0.98))",
        }
      : {
          border: "1px solid rgba(239,68,68,0.24)",
          background:
            "linear-gradient(180deg, rgba(24,12,12,0.94), rgba(14,7,7,0.98))",
        };

  return (
    <div
      style={{
        ...styles,
        borderRadius: 16,
        padding: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 15 }}>{title}</div>
      <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.55 }}>{text}</div>
    </div>
  );
}

function IndicatorCard({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.05)",
        padding: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
      <div style={{ marginTop: 6, opacity: 0.84, lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

function BulletRow({ text }: { text: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.04)",
        padding: "12px 14px",
        lineHeight: 1.55,
        opacity: 0.9,
      }}
    >
      {text}
    </div>
  );
}

function QuestionCard({ text }: { text: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.05)",
        padding: 16,
        fontWeight: 700,
        lineHeight: 1.55,
      }}
    >
      {text}
    </div>
  );
}

function RelatedCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      style={{
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 16,
        padding: 16,
        background: "rgba(255,255,255,0.04)",
        textDecoration: "none",
        color: "#f1f5f9",
        display: "block",
        transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 950 }}>{title}</div>
      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.78, lineHeight: 1.6 }}>
        {desc}
      </div>
    </Link>
  );
}

const paragraphStyle: React.CSSProperties = {
  marginTop: 12,
  opacity: 0.86,
  lineHeight: 1.7,
};

const inlineLinkStyle: React.CSSProperties = {
  color: "#60a5fa",
  fontWeight: 800,
  textDecoration: "none",
};

function topNavBtnStyle(
  type: "dashboard" | "platforms" | "pickers" | "calculators"
): React.CSSProperties {
  if (type === "dashboard") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(250,204,21,0.45)",
      background: "linear-gradient(135deg, rgba(250,204,21,0.20), rgba(202,138,4,0.10))",
      color: "#fefce8",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  if (type === "platforms") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(34,197,94,0.45)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))",
      color: "#f0fdf4",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  if (type === "pickers") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(239,68,68,0.45)",
      background: "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
      color: "#fef2f2",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
      transition:
        "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 42,
    padding: "9px 13px",
    borderRadius: 14,
    border: "1px solid rgba(168,85,247,0.45)",
    background: "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))",
    color: "#faf5ff",
    textDecoration: "none",
    fontWeight: 900,
    fontSize: 14,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
    transition:
      "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
  };
}

function topNavIcon(type: "dashboard" | "platforms" | "pickers" | "calculators") {
  if (type === "dashboard") return "📈";
  if (type === "platforms") return "🏦";
  if (type === "pickers") return "📊";
  return "🧮";
}
