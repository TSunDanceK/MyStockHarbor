import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Buy the Dip Stocks: How to Find Pullbacks Worth Reviewing | MyStockHarbor",
  description:
    "Learn what buy-the-dip stocks are, how traders and investors review pullbacks, the risks of buying too early, and how to explore live stock ideas with MyStockHarbor.",
  alternates: {
    canonical: "/buy-the-dip-stocks",
  },
  openGraph: {
    title: "Buy the Dip Stocks | MyStockHarbor",
    description:
      "A beginner-friendly guide to buy-the-dip stocks, pullback setups and how to explore live stock ideas.",
    url: "https://mystockharbor.com/buy-the-dip-stocks",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Buy the Dip Stocks | MyStockHarbor",
    description:
      "Learn how traders and investors review buy-the-dip setups and pullback opportunities.",
  },
};

export default function BuyTheDipStocksPage() {
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
                  "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))",
                border: "1px solid rgba(34,197,94,0.34)",
                color: "#dcfce7",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              BUY THE DIP GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Buy the Dip Stocks: How to Find Pullbacks Worth Reviewing
            </h1>

            <p
              style={{
                margin: "12px 0 0 0",
                fontSize: 17,
                lineHeight: 1.65,
                opacity: 0.84,
              }}
            >
              “Buy the dip” means looking for stocks that have pulled back after a prior
              move higher and deciding whether the weakness may create a better entry.
              Traders and investors like this idea because strong stocks often do not
              move up in a straight line. Pullbacks are normal.
            </p>

            <p
              style={{
                margin: "12px 0 0 0",
                opacity: 0.8,
                lineHeight: 1.65,
              }}
            >
              The problem is that not every dip is a buying opportunity. Some dips are
              healthy pullbacks inside a larger trend. Others are the early stage of a
              genuine breakdown. The goal is to identify pullbacks worth reviewing, then
              confirm them with chart structure, momentum and market context.
            </p>
          </div>
        </div>

        <section
          style={{
            marginTop: 24,
            padding: 20,
            borderRadius: 18,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(59,130,246,0.08))",
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
              border: "1px solid rgba(34,197,94,0.32)",
              color: "#dcfce7",
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
            A dip is more interesting when the trend still looks alive.
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
              title="Healthier dip"
              text="Price pulls back, but support, trend structure or momentum still look constructive."
              tint="green"
            />
            <HighlightCard
              title="Riskier dip"
              text="Price is falling because the chart is actually breaking down."
              tint="red"
            />
            <HighlightCard
              title="Goal"
              text="Use pullbacks to build a shortlist, then review the chart before acting."
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
            title="What is a buy-the-dip stock?"
            tint="green"
          >
            <p style={paragraphStyle}>
              A buy-the-dip stock is usually a stock that has pulled back from a recent
              move higher and may be approaching an area where buyers could become
              interested again. This could happen near support, moving averages,
              oversold conditions or other areas where price looks stretched.
            </p>

            <p style={paragraphStyle}>
              The idea is not to buy every stock that is red. The real question is
              whether the weakness looks temporary or whether the stock is losing its
              larger trend.
            </p>
          </ContentSection>

          <ContentSection
            number="2"
            title="Why investors and traders like buy-the-dip setups"
            tint="blue"
          >
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gap: 10,
              }}
            >
              <BulletRow text="Pullbacks can offer better entries than chasing price after a rally." />
              <BulletRow text="Strong stocks often experience normal retracements during uptrends." />
              <BulletRow text="Oversold conditions can create rebound potential." />
              <BulletRow text="Support zones can help traders judge whether buyers are returning." />
            </div>

            <p style={paragraphStyle}>
              For investors, dip buying can be a way to enter names they already wanted
              to own. For traders, it can highlight bounce setups and mean-reversion
              opportunities.
            </p>
          </ContentSection>

          <ContentSection
            number="3"
            title="The biggest risk: buying too early"
            tint="red"
          >
            <p style={paragraphStyle}>
              The classic mistake is assuming a falling stock must be a bargain. A
              stock can look tempting after a big drop and still continue lower if
              trend, earnings expectations or the broader market are deteriorating.
            </p>

            <p style={paragraphStyle}>
              This is why many traders wait for signs that selling pressure is easing,
              support is holding, or momentum is stabilising rather than buying
              immediately just because price is down.
            </p>
          </ContentSection>

          <ContentSection
            number="4"
            title="What to check before buying a dip"
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
                title="Trend structure"
                text="Is the stock still making constructive higher lows, or has the chart started breaking down?"
              />
              <IndicatorCard
                title="Support area"
                text="Is price pulling back into a level where buyers previously reacted?"
              />
              <IndicatorCard
                title="Stretch"
                text="Do RSI, Stochastic, Bollinger Bands or VWAP suggest that price may be becoming stretched to the downside?"
              />
              <IndicatorCard
                title="Momentum and market context"
                text="Is momentum starting to stabilise, and is the wider market helping or hurting the setup?"
              />
            </div>
          </ContentSection>

          <ContentSection
            number="5"
            title="How MyStockHarbor helps you find buy-the-dip stocks"
            tint="amber"
          >
            <p style={paragraphStyle}>
              MyStockHarbor helps you scan for stock ideas without building a complex
              screener or checking charts one by one. Instead, you can browse grouped
              setups and then inspect the chart more closely.
            </p>

            <p style={paragraphStyle}>
              The{" "}
              <Link href="/pickers" style={inlineLinkStyle}>
                Find Your Next Stock
              </Link>{" "}
              page is especially useful here because it includes categories like
              buy-the-dip candidates, oversold-leaning stocks, divergence setups and
              breakouts. That makes it easier to build a shortlist of pullbacks worth
              reviewing.
            </p>
          </ContentSection>

          <ContentSection
            number="6"
            title="A simple beginner mindset"
            tint="green"
          >
            <p style={paragraphStyle}>
              The goal is not to catch the exact bottom. A better approach is to use
              pullbacks to generate ideas, then check whether the chart still looks
              constructive.
            </p>

            <p style={paragraphStyle}>
              In other words: buy-the-dip works best when the dip is happening in a
              stock that still deserves attention.
            </p>
          </ContentSection>
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
            Explore live buy-the-dip stock ideas on MyStockHarbor
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
            the chart and decide whether the pullback deserves a closer look.
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
