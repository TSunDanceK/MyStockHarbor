import type { Metadata } from "next";
import Link from "next/link";
import PickersClient from "./PickersClient";
import BookmarkPromptButton from "./BookmarkPromptButton";

const pickersJsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Stock Pickers",
  url: "https://www.mystockharbor.com/pickers",
  description:
    "Browse screened stock ideas including oversold stocks, overbought stocks, breakouts, stocks near MA200, divergence setups, unusual volume, and pullback ideas.",
  mainEntity: {
    "@type": "ItemList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        item: {
          "@type": "Thing",
          name: "Oversold Stocks",
          url: "https://www.mystockharbor.com/oversold-stocks",
        },
      },
      {
        "@type": "ListItem",
        position: 2,
        item: {
          "@type": "Thing",
          name: "Overbought Stocks",
          url: "https://www.mystockharbor.com/overbought-stocks",
        },
      },
      {
        "@type": "ListItem",
        position: 3,
        item: {
          "@type": "Thing",
          name: "Breakout Stocks",
          url: "https://www.mystockharbor.com/breakout-stocks",
        },
      },
      {
        "@type": "ListItem",
        position: 4,
        item: {
          "@type": "Thing",
          name: "Buy The Dip Stocks",
          url: "https://www.mystockharbor.com/buy-the-dip-stocks",
        },
      },
      {
        "@type": "ListItem",
        position: 5,
        item: {
          "@type": "Thing",
          name: "Stocks Above 200 Day Moving Average",
          url: "https://www.mystockharbor.com/stocks-above-200-day-moving-average",
        },
      },
      {
        "@type": "ListItem",
        position: 6,
        item: {
          "@type": "Thing",
          name: "Stocks Down From Highs",
          url: "https://www.mystockharbor.com/stocks-down-from-highs",
        },
      },
      {
        "@type": "ListItem",
        position: 7,
        item: {
          "@type": "Thing",
          name: "Bullish Divergence Stocks",
          url: "https://www.mystockharbor.com/bullish-divergence-stocks",
        },
      },
      {
        "@type": "ListItem",
        position: 8,
        item: {
          "@type": "Thing",
          name: "Bearish Divergence Stocks",
          url: "https://www.mystockharbor.com/bearish-divergence-stocks",
        },
      },
    ],
  },
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://www.mystockharbor.com/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Stock Pickers",
        item: "https://www.mystockharbor.com/pickers",
      },
    ],
  },
};

export const metadata: Metadata = {
  title: "Stock Pickers, Breakouts & Oversold Setups | MyStockHarbor (My Stock Harbor)",
  description:
    "Find screened stock ideas using breakout, oversold, divergence and dip-buy setup filters. Open any stock in the MyStockHarbor dashboard for deeper chart analysis.",
  alternates: {
    canonical: "https://www.mystockharbor.com/pickers",
  },
  openGraph: {
    title: "Stock Pickers, Breakouts & Oversold Setups | MyStockHarbor",
    description:
      "Explore screened stock ideas using breakout, oversold, divergence and dip-buy setup filters.",
    url: "https://www.mystockharbor.com/pickers",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Pickers, Breakouts & Oversold Setups | MyStockHarbor",
    description:
      "Explore screened stock ideas using breakout, oversold, divergence and dip-buy setup filters.",
  },
};

const panelStyle: React.CSSProperties = {
  marginTop: 22,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 20,
  background: "linear-gradient(180deg, rgba(9,13,20,0.92), rgba(7,10,16,0.96))",
  maxWidth: 980,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  boxSizing: "border-box",
  width: "100%",
};

const bundleGridStyle: React.CSSProperties = {
  marginTop: 16,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const compactLinkStyle: React.CSSProperties = {
  display: "block",
  textDecoration: "none",
  color: "#f1f5f9",
  borderRadius: 14,
  padding: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
  minWidth: 0,
  boxSizing: "border-box",
};

const supportCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
  textDecoration: "none",
  color: "#f1f5f9",
  display: "block",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
  minWidth: 0,
  boxSizing: "border-box",
};

export default function PickersPage() {
  return (
    <main
      style={{
        padding: 0,
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pickersJsonLd) }}
      />

      <div className="wrap">
        <div style={{ display: "grid", gap: 14 }}>
          <div
            className="topNavRow"
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "flex-start",
              gap: 10,
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            <Link href="/" style={topNavBtnStyle("dashboard")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("dashboard")}
              </span>
              <span className="topNavText">Dashboard</span>
            </Link>

            <Link href="/platforms" style={topNavBtnStyle("platforms")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("platforms")}
              </span>
              <span className="topNavText">Platforms</span>
            </Link>

            <Link href="/learn" style={topNavBtnStyle("learn")} className="topNavIconOnlyMobile">
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("learn")}
              </span>
              <span className="topNavText topNavHideOnMobile">Learn</span>
            </Link>

            <Link
              href="/utilities"
              style={topNavBtnStyle("calculators")}
              className="topNavIconOnlyMobile"
            >
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("calculators")}
              </span>
              <span className="topNavText topNavHideOnMobile">Calculators</span>
            </Link>
          </div>

          <div
            className="heroGrid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.35fr) minmax(280px, 0.95fr)",
              gap: 16,
              alignItems: "stretch",
              maxWidth: 980,
              minWidth: 0,
              width: "100%",
            }}
          >
            <section
              className="heroPanel"
              style={{
                border: "1px solid rgba(59,130,246,0.20)",
                borderRadius: 22,
                padding: 18,
                background:
                  "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(7,11,22,0.98))",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.30)",
                minWidth: 0,
                width: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              <div
                className="pickersHeroPills"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(59,130,246,0.32)",
                    background:
                      "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
                    fontSize: 12,
                    fontWeight: 950,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#dbeafe",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  STOCK PICKERS
                </div>

                <BookmarkPromptButton compact />
              </div>

              <h1
                className="pickersHeroTitle"
                style={{
                  margin: "14px 0 0 0",
                  fontSize: 44,
                  lineHeight: 1.04,
                  letterSpacing: "-0.05em",
                }}
              >
                Stock Pickers & Technical Setup Ideas
              </h1>

              <p
                className="pickersHeroText"
                style={{
                  marginTop: 12,
                  fontSize: 17,
                  lineHeight: 1.65,
                  opacity: 0.84,
                  maxWidth: 700,
                }}
              >
                Browse screened stock ideas across oversold conditions, breakouts,
                divergence signals, MA200 tests, pullback setups and other
                chart-based themes. These lists are filtered to surface cleaner,
                more relevant setups to review, then ranked to help the strongest
                opportunities rise higher.
              </p>

              <div
                className="heroMiniStats"
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 10,
                  maxWidth: 560,
                  minWidth: 0,
                }}
              >
                <MiniStat
                  label="Results"
                  value="Screened Market Setups"
                  tint="green"
                />
                <MiniStat
                  label="Use Case"
                  value="Find Trade Ideas Faster"
                  tint="amber"
                />
              </div>

              <div
                className="scrollCueBox"
                style={{
                  marginTop: 16,
                  borderRadius: 18,
                  border: "1px dashed rgba(96,165,250,0.40)",
                  background:
                    "linear-gradient(180deg, rgba(30,64,175,0.14), rgba(15,23,42,0.12))",
                  padding: "16px 18px",
                  display: "grid",
                  placeItems: "center",
                  textAlign: "center",
                  minHeight: 90,
                  minWidth: 0,
                  boxSizing: "border-box",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(59,130,246,0.06), 0 0 28px rgba(37,99,235,0.16)",
                }}
              >
                <div
                  className="scrollCueText"
                  style={{
                    fontSize: 14,
                    fontWeight: 950,
                    letterSpacing: "0.08em",
                    color: "#dbeafe",
                    textTransform: "uppercase",
                    textShadow: "0 0 18px rgba(96,165,250,0.20)",
                  }}
                >
                  Scroll down for today’s screened stock setups
                </div>

                <div
                  className="scrollCueArrows"
                  style={{
                    marginTop: 8,
                    fontSize: 24,
                    lineHeight: 1,
                    color: "#60a5fa",
                    letterSpacing: "0.28em",
                    fontWeight: 900,
                  }}
                >
                  ↓ ↓ ↓
                </div>
              </div>
            </section>

            <section
              className="heroPanel mobile-hide-screened-setups"
              style={{
                border: "1px solid rgba(59,130,246,0.20)",
                borderRadius: 22,
                padding: 18,
                background:
                  "linear-gradient(180deg, rgba(8,14,28,0.98), rgba(6,10,18,0.98))",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.28)",
                minWidth: 0,
                width: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
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
                  maxWidth: "100%",
                  boxSizing: "border-box",
                }}
              >
                REAL SCREENED SETUPS
              </div>

              <div
                className="heroSignalStack"
                style={{
                  marginTop: 14,
                  display: "grid",
                  gap: 10,
                  minWidth: 0,
                }}
              >
                <SignalCard
                  title="Oversold Rebound Signals"
                  text="Screened for stretched downside conditions that may be worth reviewing for rebound potential."
                  tint="green"
                />
                <SignalCard
                  title="MA200 Proximity Signals"
                  text="Filtered to highlight stocks trading close to a major long-term moving average."
                  tint="red"
                />
                <SignalCard
                  title="Divergence Signals"
                  text="Filtered to surface charts where price and momentum may be starting to disagree."
                  tint="amber"
                />
                <SignalCard
                  title="Pullback Setups"
                  text="Screened for controlled weakness or retracements that may still fit a stronger chart."
                  tint="teal"
                />
                <SignalCard
                  title="Breakout Setups"
                  text="Filtered to highlight strength, resistance pressure or momentum expansion worth checking."
                  tint="blue"
                />
              </div>
            </section>
          </div>
        </div>

        <section
          style={{
            marginTop: 24,
            maxWidth: 980,
            width: "100%",
            borderRadius: 22,
            border: "1px solid rgba(59,130,246,0.35)",
            background:
              "linear-gradient(180deg, rgba(6,12,24,1), rgba(4,8,16,1))",
            boxShadow:
              "0 0 0 1px rgba(59,130,246,0.15), 0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
            overflow: "hidden",
            position: "relative",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              borderRadius: 22,
              boxShadow: "0 0 40px rgba(59,130,246,0.18)",
            }}
          />

          <div
            style={{
              padding: 18,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.28))",
              boxSizing: "border-box",
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
                maxWidth: "100%",
                boxSizing: "border-box",
              }}
            >
              DATA-DRIVEN SCREENED RESULTS
            </div>

            <h2
              style={{
                margin: "14px 0 0 0",
                fontSize: 28,
                lineHeight: 1.12,
                letterSpacing: "-0.03em",
              }}
            >
              Screened setups across the market
            </h2>

            <p
              style={{
                margin: "10px 0 0 0",
                lineHeight: 1.65,
                opacity: 0.82,
                maxWidth: 820,
                fontSize: 15,
              }}
            >
              These screened results are designed to help you find charts worth
              reviewing faster. The lists are filtered to reduce weaker,
              messier or less relevant setups, then ranked to bring stronger
              candidates closer to the top. They are starting points for
              analysis, not buy or sell recommendations.
            </p>

            <p
              style={{
                margin: "10px 0 0 0",
                lineHeight: 1.65,
                opacity: 0.68,
                maxWidth: 820,
                fontSize: 13,
              }}
            >
              The latest update time appears beneath the live results.
            </p>
          </div>

          <div style={{ padding: 18, boxSizing: "border-box" }}>
            <PickersClient />
          </div>
        </section>

        <section style={panelStyle}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
              border: "1px solid rgba(59,130,246,0.26)",
              color: "#dbeafe",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
              maxWidth: "100%",
              boxSizing: "border-box",
            }}
          >
            LEARN MORE
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Learn the setups, indicators and scanning methods behind these ideas
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.74,
              maxWidth: 860,
            }}
          >
            Start with the Trading Setups Hub, Indicators Hub or Stock
            Scanners Hub. These pages explain the patterns, momentum shifts,
            chart signals and screening concepts traders review when analysing
            stock charts.
          </p>

          <div style={bundleGridStyle}>
            <Link
              href="/trading-setups"
              style={{
                ...compactLinkStyle,
                border: "1px solid rgba(239,68,68,0.20)",
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(127,29,29,0.04))",
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Trading Setups Hub
              </div>
              <div style={smallLinkTextStyle}>
                Explore the main hub for breakouts, oversold setups, pullbacks
                and divergence ideas.
              </div>
            </Link>

            <Link
              href="/stock-indicators"
              style={{
                ...compactLinkStyle,
                border: "1px solid rgba(34,197,94,0.20)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(16,185,129,0.04))",
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Indicators Hub
              </div>
              <div style={smallLinkTextStyle}>
                Understand RSI, MACD, unusual volume and moving average signals
                used when reviewing stock charts.
              </div>
            </Link>

            <Link
              href="/stock-scanners"
              style={{
                ...compactLinkStyle,
                border: "1px solid rgba(168,85,247,0.20)",
                background:
                  "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(139,92,246,0.04))",
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 950 }}>
                Stock Scanners Hub
              </div>
              <div style={smallLinkTextStyle}>
                Learn how traders scan for stock ideas, compare tools and turn
                market noise into clearer charts to review.
              </div>
            </Link>
          </div>
        </section>

        <section
          style={{
            marginTop: 22,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            maxWidth: 980,
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <Link
            href="/"
            style={{
              ...supportCardStyle,
              border: "1px solid rgba(250,204,21,0.22)",
              background:
                "linear-gradient(180deg, rgba(24,20,8,0.92), rgba(14,11,5,0.96))",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 10,
                  border: "1px solid rgba(250,204,21,0.30)",
                  background:
                    "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(202,138,4,0.08))",
                  fontSize: 14,
                  flex: "0 0 auto",
                }}
              >
                📈
              </span>

              <div
                style={{
                  fontSize: 18,
                  fontWeight: 950,
                  color: "#fefce8",
                }}
              >
                Open the full dashboard
              </div>
            </div>

            <div style={midCardTextStyle}>
              Review price structure, overlays and indicators for any symbol you
              find on this page.
            </div>
          </Link>

          <Link
            href="/learn"
            style={{
              ...supportCardStyle,
              border: "1px solid rgba(59,130,246,0.22)",
              background:
                "linear-gradient(180deg, rgba(8,16,30,0.92), rgba(6,10,20,0.96))",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 10,
                  border: "1px solid rgba(59,130,246,0.30)",
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.08))",
                  fontSize: 14,
                  flex: "0 0 auto",
                }}
              >
                📘
              </span>

              <div
                style={{
                  fontSize: 18,
                  fontWeight: 950,
                  color: "#eff6ff",
                }}
              >
                Visit the Learn hub
              </div>
            </div>

            <div style={midCardTextStyle}>
              Explore the main education hub for chart concepts, setups and
              beginner-friendly guides.
            </div>
          </Link>

          <Link
            href="/platforms"
            style={{
              ...supportCardStyle,
              border: "1px solid rgba(34,197,94,0.22)",
              background:
                "linear-gradient(180deg, rgba(8,20,16,0.92), rgba(6,12,10,0.96))",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 10,
                  border: "1px solid rgba(34,197,94,0.30)",
                  background:
                    "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.08))",
                  fontSize: 14,
                  flex: "0 0 auto",
                }}
              >
                🏦
              </span>

              <div
                style={{
                  fontSize: 18,
                  fontWeight: 950,
                  color: "#f0fdf4",
                }}
              >
                Compare trading platforms
              </div>
            </div>

            <div style={midCardTextStyle}>
              Review charting and broker platform options after narrowing down
              your ideas.
            </div>
          </Link>
        </section>

        <section style={panelStyle}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(250,204,21,0.16), rgba(202,138,4,0.08))",
              border: "1px solid rgba(250,204,21,0.26)",
              color: "#fef3c7",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
              maxWidth: "100%",
              boxSizing: "border-box",
            }}
          >
            FAQ
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            Frequently asked questions
          </h2>

          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Is this a stock screener?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                Yes. It works like a stock idea screener built around technical
                setups such as oversold conditions, divergence, pullback setups
                and breakouts.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Are these buy or sell recommendations?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                No. These are idea filters only. They help you narrow down
                charts to review, but they are not personal financial advice.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                Why are some stocks ranked higher than others?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                The lists are filtered and ranked to surface cleaner, more
                relevant setups first. A stock appearing lower down does not
                automatically make it unusable, but higher-ranked results are
                usually the first charts worth reviewing.
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                What should I do after clicking a stock?
              </h3>
              <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.76 }}>
                Open it in the dashboard, review the chart structure, check key
                indicators and confirm whether the setup still makes sense.
              </p>
            </div>
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 28px 20px 40px;
          box-sizing: border-box;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        .scrollCueBox {
          animation: scrollCueGlow 1.9s ease-in-out infinite;
        }

        .scrollCueText {
          animation: scrollCueTextPulse 1.9s ease-in-out infinite;
        }

        .scrollCueArrows {
          animation: scrollCueBounce 1.2s ease-in-out infinite;
        }

        @keyframes scrollCueGlow {
          0%,
          100% {
            transform: translateY(0);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.05),
              0 0 0 1px rgba(59,130,246,0.06),
              0 0 18px rgba(37,99,235,0.12);
          }
          50% {
            transform: translateY(-2px);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.05),
              0 0 0 1px rgba(96,165,250,0.10),
              0 0 34px rgba(59,130,246,0.22);
          }
        }

        @keyframes scrollCueTextPulse {
          0%,
          100% {
            opacity: 0.9;
            letter-spacing: 0.08em;
          }
          50% {
            opacity: 1;
            letter-spacing: 0.11em;
          }
        }

        @keyframes scrollCueBounce {
          0%,
          100% {
            transform: translateY(0);
            opacity: 0.75;
          }
          50% {
            transform: translateY(6px);
            opacity: 1;
          }
        }

        @media (max-width: 900px) {
          .wrap {
            padding: 18px 16px 34px !important;
          }
        }

        @media (max-width: 860px) {
          .heroGrid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 640px) {
          .wrap {
            padding-left: 12px !important;
            padding-right: 12px !important;
          }

          .topNavRow {
            display: grid !important;
            grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.2fr) 64px 64px !important;
            gap: 8px !important;
            align-items: stretch !important;
          }

          .topNavRow a {
            width: 100% !important;
            min-width: 0 !important;
            min-height: 40px !important;
            padding: 8px 10px !important;
            font-size: 12px !important;
            border-radius: 12px !important;
            gap: 6px !important;
            justify-content: center !important;
          }

          .topNavIconOnlyMobile {
            padding-left: 0 !important;
            padding-right: 0 !important;
          }

          .topNavHideOnMobile {
            display: none !important;
          }

          .heroPanel {
            padding: 14px !important;
            border-radius: 18px !important;
            min-width: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
          }

          .mobile-hide-screened-setups {
            display: none !important;
          }

          .heroMiniStats {
            grid-template-columns: minmax(0, 1fr) !important;
            max-width: 100% !important;
          }

          .pickersHeroPills {
            align-items: stretch !important;
          }

          .heroSignalStack {
            gap: 8px !important;
          }

          .pickersHeroTitle {
            font-size: 34px !important;
            line-height: 1.06 !important;
            letter-spacing: -0.04em !important;
          }

          .pickersHeroText {
            font-size: 15px !important;
            line-height: 1.65 !important;
          }
        }

        @media (max-width: 420px) {
          .wrap {
            padding-left: 10px !important;
            padding-right: 10px !important;
          }

          .pickersHeroTitle {
            font-size: 30px !important;
          }

          .heroPanel {
            padding: 12px !important;
          }
        }
      `}</style>
    </main>
  );
}

function MiniStat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint: "green" | "amber";
}) {
  const styles =
    tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.24)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.94), rgba(7,12,11,0.98))",
          labelColor: "#bbf7d0",
        }
      : {
          border: "1px solid rgba(234,179,8,0.24)",
          background:
            "linear-gradient(180deg, rgba(18,16,10,0.94), rgba(12,10,7,0.98))",
          labelColor: "#fde68a",
        };

  return (
    <div
      style={{
        border: styles.border,
        background: styles.background,
        borderRadius: 16,
        padding: 14,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 900,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: styles.labelColor,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 16,
          fontWeight: 900,
          lineHeight: 1.35,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SignalCard({
  title,
  text,
  tint,
}: {
  title: string;
  text: string;
  tint: "green" | "red" | "amber" | "teal" | "blue";
}) {
  const styles =
    tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.35)",
          background:
            "linear-gradient(180deg, rgba(6,78,59,0.30), rgba(6,46,33,0.48))",
          titleColor: "#ecfdf5",
          textColor: "rgba(236,253,245,0.84)",
        }
      : tint === "red"
      ? {
          border: "1px solid rgba(239,68,68,0.35)",
          background:
            "linear-gradient(180deg, rgba(127,29,29,0.28), rgba(69,10,10,0.48))",
          titleColor: "#fef2f2",
          textColor: "rgba(254,242,242,0.84)",
        }
      : tint === "amber"
      ? {
          border: "1px solid rgba(234,179,8,0.34)",
          background:
            "linear-gradient(180deg, rgba(113,63,18,0.28), rgba(66,32,6,0.46))",
          titleColor: "#fefce8",
          textColor: "rgba(254,252,232,0.84)",
        }
      : tint === "teal"
      ? {
          border: "1px solid rgba(20,184,166,0.34)",
          background:
            "linear-gradient(180deg, rgba(17,94,89,0.28), rgba(4,47,46,0.46))",
          titleColor: "#ecfeff",
          textColor: "rgba(236,254,255,0.84)",
        }
      : {
          border: "1px solid rgba(59,130,246,0.35)",
          background:
            "linear-gradient(180deg, rgba(30,64,175,0.28), rgba(17,37,84,0.48))",
          titleColor: "#eff6ff",
          textColor: "rgba(239,246,255,0.84)",
        };

  return (
    <div
      style={{
        border: styles.border,
        background: styles.background,
        borderRadius: 16,
        padding: "14px 16px",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontWeight: 900,
          fontSize: 15,
          color: styles.titleColor,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          lineHeight: 1.55,
          color: styles.textColor,
        }}
      >
        {text}
      </div>
    </div>
  );
}

const smallLinkTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  opacity: 0.72,
  lineHeight: 1.6,
};

const midCardTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 14,
  opacity: 0.74,
  lineHeight: 1.6,
};

const topNavIconWrapStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function topNavBtnStyle(
  type: "dashboard" | "platforms" | "learn" | "calculators"
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
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.20), rgba(202,138,4,0.10))",
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
      background:
        "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))",
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

  if (type === "calculators") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 42,
      padding: "9px 13px",
      borderRadius: 14,
      border: "1px solid rgba(168,85,247,0.45)",
      background:
        "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))",
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

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 42,
    padding: "9px 13px",
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.45)",
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))",
    color: "#eff6ff",
    textDecoration: "none",
    fontWeight: 900,
    fontSize: 14,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
    transition:
      "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
  };
}

function topNavIcon(type: "dashboard" | "platforms" | "learn" | "calculators") {
  if (type === "dashboard") return "📈";
  if (type === "platforms") return "🏦";
  if (type === "calculators") return "🧮";
  return "📘";
}
