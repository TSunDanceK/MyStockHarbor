import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Position Sizing in Trading: How to Control Risk | MyStockHarbor",
  description:
    "Learn how position sizing works in trading, how to calculate trade size based on stop loss and risk, and why proper position sizing protects your capital.",
  alternates: {
    canonical: "/position-sizing-guide",
  },
  openGraph: {
    title: "Position Sizing in Trading | MyStockHarbor",
    description:
      "Understand how to size trades properly using risk management and stop losses.",
    url: "https://mystockharbor.com/position-sizing-guide",
    siteName: "MyStockHarbor",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Position Sizing in Trading | MyStockHarbor",
    description:
      "Learn how to calculate position size and protect your capital when trading.",
  },
};

export default function PositionSizingGuidePage() {
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

          {/* NAV BUTTONS */}

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
              {topNavIcon("dashboard")} Dashboard
            </Link>

            <Link href="/learn" style={topNavBtnStyle("learn")}>
              {topNavIcon("learn")} Learn
            </Link>

            <Link href="/pickers" style={topNavBtnStyle("pickers")}>
              {topNavIcon("pickers")} Stock Pickers
            </Link>

            <Link href="/utilities" style={topNavBtnStyle("calculators")}>
              {topNavIcon("calculators")} Calculators
            </Link>
          </div>

          {/* HEADER */}

          <div style={{ maxWidth: 780 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))",
                border: "1px solid rgba(168,85,247,0.34)",
                color: "#f3e8ff",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              POSITION SIZING GUIDE
            </div>

            <h1
              style={{
                margin: "14px 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Position Sizing in Trading: How to Control Risk
            </h1>

            <p style={paragraphStyle}>
              Position sizing is one of the most important ideas in trading
              risk management. It determines how much capital you commit to a
              trade based on the amount you are prepared to lose if the trade
              goes wrong.
            </p>

            <p style={paragraphStyle}>
              Many beginners focus only on finding the right stock, but
              experienced traders focus just as much on controlling risk.
              Position sizing ensures that one bad trade cannot damage your
              account.
            </p>
          </div>
        </div>

        {/* SIMPLE IDEA SECTION */}

        <section style={highlightBoxStyle()}>
          <div style={highlightLabelStyle()}>SIMPLE WAY TO THINK ABOUT IT</div>

          <div style={highlightTitleStyle()}>
            Position size should be based on risk, not confidence.
          </div>

          <div style={highlightGridStyle()}>
            <HighlightCard
              title="Good practice"
              text="Decide how much money you are willing to lose before entering a trade."
              tint="green"
            />

            <HighlightCard
              title="Common mistake"
              text="Buying too many shares simply because the trade looks attractive."
              tint="red"
            />

            <HighlightCard
              title="Better approach"
              text="Let your stop loss distance determine the number of shares you buy."
              tint="blue"
            />
          </div>
        </section>

        {/* CONTENT SECTIONS */}

        <ContentSection
          number="1"
          title="What is position sizing?"
          tint="blue"
        >
          <p style={paragraphStyle}>
            Position sizing means deciding how large a trade should be based on
            your risk tolerance and stop loss distance. Instead of randomly
            choosing a number of shares, traders calculate trade size so that
            losses stay within a controlled limit.
          </p>

          <p style={paragraphStyle}>
            For example, if you are willing to risk $100 on a trade and your
            stop loss is $2 away from your entry price, you would buy about
            50 shares.
          </p>
        </ContentSection>

        <ContentSection
          number="2"
          title="Why position sizing matters"
          tint="green"
        >
          <div style={bulletGridStyle()}>
            <BulletRow text="Protects your account from large losses." />
            <BulletRow text="Keeps risk consistent across different trades." />
            <BulletRow text="Prevents emotional decision making." />
            <BulletRow text="Helps traders survive losing streaks." />
          </div>
        </ContentSection>

        <ContentSection
          number="3"
          title="How traders calculate position size"
          tint="purple"
        >
          <p style={paragraphStyle}>
            Most traders start with a maximum dollar risk per trade. For
            example, some traders risk 1% of their account on each trade.
          </p>

          <p style={paragraphStyle}>
            They then divide that risk amount by the distance between their
            entry price and stop loss. The result determines how many shares
            they can buy.
          </p>
        </ContentSection>

        <ContentSection
          number="4"
          title="Position sizing and stop losses"
          tint="amber"
        >
          <p style={paragraphStyle}>
            Position sizing only works properly when combined with a clear stop
            loss. Without a stop loss, traders cannot control their downside
            risk effectively.
          </p>

          <p style={paragraphStyle}>
            This is why many traders plan their exit level before deciding how
            large the trade should be.
          </p>
        </ContentSection>

        {/* CTA */}

        <section style={ctaBoxStyle()}>
          <div style={{ fontWeight: 900, fontSize: 22 }}>
            Calculate your trade size with MyStockHarbor
          </div>

          <p style={{ marginTop: 10, opacity: 0.86, lineHeight: 1.6 }}>
            Use the MyStockHarbor risk calculator to estimate position size,
            stop loss risk and risk-reward before entering a trade.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/utilities" style={ctaPrimaryStyle()}>
              Open the Risk Calculators →
            </Link>

            <Link href="/" style={ctaSecondaryStyle()}>
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
      `}</style>
    </main>
  );
}
