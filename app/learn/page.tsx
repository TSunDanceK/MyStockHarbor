// app/learn/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { lessonsByCategory } from "./lessons";

export const metadata: Metadata = {
  title: "Learn Stock Charts & Trading Basics",
  description:
    "Beginner lessons on stock charts, indicators, trading basics and risk management.",
  alternates: {
    canonical: "https://www.mystockharbor.com/learn",
  },
  openGraph: {
    title: "Learn Stock Charts & Trading Basics",
    description:
      "Beginner lessons on stock charts, indicators, trading basics and risk management.",
    url: "https://www.mystockharbor.com/learn",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Learn Stock Charts & Trading Basics",
    description:
      "Beginner lessons on stock charts, indicators, trading basics and risk management.",
  },
};


function siteNavCss(wrapMaxWidth: number) {
  return `
    .wrap {
      max-width: ${wrapMaxWidth}px;
      margin: 0 auto;
      padding: 24px;
    }

    a:hover {
      filter: brightness(1.05);
    }

    @media (max-width: 760px) {
      .wrap {
        padding: 16px !important;
      }
    }
  `;
}

export default function LearnPage() {
  const basics = lessonsByCategory("Basics");
  const indicators = lessonsByCategory("Indicators");
  const divergencies = lessonsByCategory("Divergencies");

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
      <div className="wrap">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                border: "1px solid rgba(59,130,246,0.34)",
                color: "#dbeafe",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              LEARN
            </div>

<h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.4px" }}>
  Learn Stock Charts & Trading Basics
</h1>

<p
  style={{
    margin: "10px 0 0 0",
    opacity: 0.75,
    lineHeight: 1.5,
    maxWidth: 760,
  }}
>
  Beginner-friendly lessons on stock charts, technical indicators, trading
  basics and risk management to help you understand the tools used across
  MyStockHarbor.
</p>
          </div>
        </div>

        <div
          style={{
            marginTop: 22,
            borderRadius: 16,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
            padding: 18,
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 6 }}>New to trading?</div>

          <div style={{ opacity: 0.85, lineHeight: 1.55 }}>
            Before learning indicators and chart patterns, it&apos;s helpful to choose a
            trading platform. Most people analyse charts using <strong>TradingView</strong>{" "}
            and place trades using a broker like Trading 212 or Interactive Brokers.
          </div>

          <div style={{ marginTop: 12 }}>
            <Link
              href="/platforms"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(34,197,94,0.45)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Choose Your Trading Platform →
            </Link>
          </div>
        </div>

        {/* ============================================================
            EDUCATION — lessons and guides (everything below teaches).
            ============================================================ */}
        <div style={{ marginTop: 28, marginBottom: 4 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 950,
              letterSpacing: "0.14em",
              color: "rgba(148,163,184,0.85)",
            }}
          >
            EDUCATION
          </div>
          <div style={{ marginTop: 4, fontSize: 13, opacity: 0.6, lineHeight: 1.5 }}>
            Lessons and written guides. These explain concepts — they don&apos;t open live
            stock lists.
          </div>
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 18 }}>
          <Section title="BASICS" items={basics} />
          <Section title="INDICATORS" items={indicators} />
          <Section title="DIVERGENCIES" items={divergencies} />

          {/* ---- In-depth guides (standalone education routes) ---- */}
          <section
            style={{
              border: "1px solid rgba(34,197,94,0.22)",
              borderRadius: 18,
              padding: 18,
              background: "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div style={eduLabel()}>IN-DEPTH GUIDES</div>

            <div style={eduGrid()}>
              <Link href="/how-to-read-stock-charts" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>How to Read Stock Charts</div>
                <div style={guideSub()}>
                  A beginner-friendly guide to trend, support, resistance, and chart context.
                </div>
              </Link>

              <Link href="/best-stock-indicators-for-beginners" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  Best Stock Indicators for Beginners
                </div>
                <div style={guideSub()}>
                  Learn which indicators matter most when you are just starting out.
                </div>
              </Link>

              <Link href="/learn/how-to-identify-stock-trends" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>How to Identify Stock Trends</div>
                <div style={guideSub()}>
                  Learn how to recognise uptrends, downtrends, and sideways markets.
                </div>
              </Link>

              <Link href="/trading-setups" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Trading Setups Hub</div>
                <div style={guideSub()}>
                  An overview of common setups — breakouts, oversold moves, dips and
                  divergence — and how traders think about each.
                </div>
              </Link>

              <Link href="/stock-market-setups" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Stock Market Setups</div>
                <div style={guideSub()}>
                  Overview of common trading setups including dips, breakouts and divergences.
                </div>
              </Link>
            </div>
          </section>

          {/* ---- Risk management (standalone education routes) ---- */}
          <section
            style={{
              border: "1px solid rgba(34,197,94,0.22)",
              borderRadius: 18,
              padding: 18,
              background: "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div style={eduLabel()}>RISK MANAGEMENT</div>

            <div style={eduGrid()}>
              <Link href="/position-sizing-guide" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Position Sizing Guide</div>
                <div style={guideSub()}>
                  Learn how traders size positions based on stop loss distance and account risk.
                </div>
              </Link>

              <Link href="/stop-loss-strategy" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Stop Loss Strategy</div>
                <div style={guideSub()}>
                  Understand how stop losses help limit downside and improve trade discipline.
                </div>
              </Link>

              <Link href="/trading-risk-management" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Trading Risk Management</div>
                <div style={guideSub()}>
                  Explore the core principles traders use to protect capital and manage losses.
                </div>
              </Link>

              <Link href="/risk-reward-ratio" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Risk Reward Ratio</div>
                <div style={guideSub()}>
                  Learn how traders compare potential reward against possible downside before entering.
                </div>
              </Link>

              <Link href="/margin-trading-explained" style={learnGuideCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Margin Trading Explained</div>
                <div style={guideSub()}>
                  Understand leverage, liquidation risk and why margin needs careful control.
                </div>
              </Link>
            </div>
          </section>
        </div>

        {/* ============================================================
            LIVE SCREENERS — these open live stock lists, not lessons.
            ============================================================ */}
        <div style={{ marginTop: 30, marginBottom: 4 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 950,
              letterSpacing: "0.14em",
              color: "rgba(94,212,199,0.95)",
            }}
          >
            LIVE SCREENERS
          </div>
          <div style={{ marginTop: 4, fontSize: 13, opacity: 0.6, lineHeight: 1.5 }}>
            These open a live list of stocks matching the setup — a tool, not a lesson.
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <section
            style={{
              border: "1px solid rgba(94,212,199,0.26)",
              borderRadius: 18,
              padding: 18,
              background: "linear-gradient(180deg, rgba(8,20,19,0.96), rgba(6,13,12,0.98))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div style={screenerSectionLabel()}>SCREENERS</div>

            <div style={eduGrid()}>
              <ScreenerCard
                href="/oversold-stocks-today"
                title="Oversold Stocks"
                desc="Live list of stocks showing stretched downside moves."
              />
              <ScreenerCard
                href="/overbought-stocks-today"
                title="Overbought Stocks"
                desc="Live list of stocks that may be stretched to the upside."
              />
              <ScreenerCard
                href="/all-time-high-breakout-stocks"
                title="Breakout Stocks"
                desc="Live list of stocks breaking to new highs on momentum."
              />
              <ScreenerCard
                href="/bullish-bearish-divergence-stocks"
                title="Bullish & Bearish Divergence"
                desc="Live list of stocks where momentum is diverging from price."
              />
              <ScreenerCard
                href="/best-trend-score-stocks"
                title="Best Trend Score Stocks"
                desc="Live list of stocks with stronger trend structure and leadership."
              />
              <ScreenerCard
                href="/stocks-near-200-day-moving-average"
                title="Stocks Near 200-Day MA"
                desc="Live list of stocks testing a widely watched long-term level."
              />
            </div>
          </section>
        </div>
      </div>

      <style>{siteNavCss(980)}</style>
    </main>
  );
}

function learnCardHref(slug: string) {
  if (slug === "macd-divergence") return "/learn/macd";
  if (slug === "rsi-divergence") return "/learn/rsi";
  if (slug === "how-to-identify-stock-trends")
    return "/learn/how-to-identify-stock-trends";
  return `/learn/${encodeURIComponent(slug)}`;
}

function Section(props: {
  title: string;
  items: { slug: string; title: string; summary: string }[];
}) {
  const { title, items } = props;

  const sectionTint =
    title === "BASICS"
      ? {
          border: "1px solid rgba(59,130,246,0.22)",
          background: "linear-gradient(180deg, rgba(10,18,34,0.96), rgba(7,12,24,0.98))",
          labelBg: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
          labelBorder: "1px solid rgba(59,130,246,0.34)",
          labelColor: "#dbeafe",
        }
      : title === "INDICATORS"
      ? {
          border: "1px solid rgba(168,85,247,0.22)",
          background: "linear-gradient(180deg, rgba(12,16,34,0.96), rgba(8,11,24,0.98))",
          labelBg: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(139,92,246,0.10))",
          labelBorder: "1px solid rgba(168,85,247,0.34)",
          labelColor: "#f3e8ff",
        }
      : {
          border: "1px solid rgba(234,179,8,0.22)",
          background: "linear-gradient(180deg, rgba(18,16,10,0.96), rgba(12,10,7,0.98))",
          labelBg: "linear-gradient(135deg, rgba(234,179,8,0.18), rgba(202,138,4,0.10))",
          labelBorder: "1px solid rgba(234,179,8,0.34)",
          labelColor: "#fef3c7",
        };

  return (
    <section
      style={{
        border: sectionTint.border,
        borderRadius: 18,
        padding: 18,
        background: sectionTint.background,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "7px 12px",
          borderRadius: 999,
          background: sectionTint.labelBg,
          border: sectionTint.labelBorder,
          color: sectionTint.labelColor,
          fontWeight: 950,
          letterSpacing: "0.08em",
          fontSize: 12,
        }}
      >
        {title}
      </div>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {items.map((it) => (
          <Link
            key={it.slug}
            href={learnCardHref(it.slug)}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 14,
              padding: 14,
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              display: "block",
              transition: "transform 120ms ease, background 120ms ease, border-color 120ms ease",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16 }}>{it.title}</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
              {it.summary}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ScreenerCard(props: { href: string; title: string; desc: string }) {
  const { href, title, desc } = props;
  return (
    <Link
      href={href}
      style={{
        border: "1px solid rgba(94,212,199,0.30)",
        borderRadius: 14,
        padding: 14,
        background:
          "linear-gradient(135deg, rgba(94,212,199,0.10), rgba(59,130,246,0.06))",
        color: "#f1f5f9",
        textDecoration: "none",
        display: "flex",
        flexDirection: "column",
        minHeight: 132,
        transition: "transform 120ms ease, background 120ms ease, border-color 120ms ease",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          alignItems: "center",
          padding: "3px 8px",
          borderRadius: 999,
          background: "rgba(94,212,199,0.16)",
          border: "1px solid rgba(94,212,199,0.40)",
          color: "#bdf3ec",
          fontWeight: 900,
          letterSpacing: "0.08em",
          fontSize: 10,
          marginBottom: 10,
        }}
      >
        SCREENER
      </div>

      <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
        {desc}
      </div>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 10,
          fontSize: 13,
          fontWeight: 800,
          color: "#7fe3d8",
        }}
      >
        Open live list →
      </div>
    </Link>
  );
}

function learnGuideCard(): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(255,255,255,0.06)",
    color: "#f1f5f9",
    textDecoration: "none",
    display: "block",
    transition: "transform 120ms ease, background 120ms ease",
  };
}

function eduLabel(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 12px",
    borderRadius: 999,
    background: "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
    border: "1px solid rgba(34,197,94,0.34)",
    color: "#dcfce7",
    fontWeight: 950,
    letterSpacing: "0.08em",
    fontSize: 12,
  };
}

function screenerSectionLabel(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 12px",
    borderRadius: 999,
    background: "linear-gradient(135deg, rgba(94,212,199,0.18), rgba(59,130,246,0.10))",
    border: "1px solid rgba(94,212,199,0.36)",
    color: "#cdf5ef",
    fontWeight: 950,
    letterSpacing: "0.08em",
    fontSize: 12,
  };
}

function eduGrid(): React.CSSProperties {
  return {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
  };
}

function guideSub(): React.CSSProperties {
  return { marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 };
}
