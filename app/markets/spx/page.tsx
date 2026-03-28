import type { Metadata } from "next";
import Link from "next/link";
import AffiliateLink from "../../components/AffiliateLink";
import SPXChartClient from "./SPXChartClient";

export const metadata: Metadata = {
  title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
  description:
    "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
  alternates: {
    canonical: "https://www.mystockharbor.com/markets/spx",
  },
  openGraph: {
    title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
    description:
      "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
    url: "https://www.mystockharbor.com/markets/spx",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
    description:
      "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
  },
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

const SPX_STOOQ_SYMBOL = "^spx";

async function getSpxChartPoints(): Promise<Point[]> {
  try {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(SPX_STOOQ_SYMBOL)}&i=d`;

    const response = await fetch(url, {
      next: { revalidate: 60 * 60 },
    });

    if (!response.ok) {
      return [];
    }

    const csv = await response.text();
    const lines = csv.trim().split("\n");

    if (lines.length <= 1) {
      return [];
    }

    const rows = lines.slice(1);
    const points: Point[] = [];

    for (const row of rows) {
      const cols = row.split(",");

      if (cols.length < 5) continue;

      const [date, open, high, low, close, volume] = cols;

      if (!date || !close) continue;
      if (close.toLowerCase() === "null") continue;

      const closeNum = Number(close);
      const highNum = Number(high);
      const lowNum = Number(low);
      const volumeNum = Number(volume);

      if (!Number.isFinite(closeNum)) continue;

      points.push({
        date,
        close: closeNum,
        high: Number.isFinite(highNum) ? highNum : undefined,
        low: Number.isFinite(lowNum) ? lowNum : undefined,
        volume: Number.isFinite(volumeNum) ? volumeNum : undefined,
      });
    }

    return points;
  } catch {
    return [];
  }
}

function primaryBtn(): React.CSSProperties {
  return {
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
    letterSpacing: "0.2px",
    minHeight: 48,
    boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
    whiteSpace: "nowrap",
  };
}

function secondaryBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "13px 18px",
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.35)",
    background: "rgba(59,130,246,0.12)",
    color: "#dbeafe",
    textDecoration: "none",
    fontWeight: 900,
    letterSpacing: "0.2px",
    minHeight: 48,
    whiteSpace: "nowrap",
  };
}

function infoCardStyle(): React.CSSProperties {
  return {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 18,
  };
}

function sectionCardStyle(): React.CSSProperties {
  return {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: 18,
  };
}

const topNavIconWrapStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function topNavBtnStyle(
  type: "dashboard" | "learn" | "pickers" | "platforms"
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

  if (type === "learn") {
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
      background:
        "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))",
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

function topNavIcon(type: "dashboard" | "learn" | "pickers" | "platforms") {
  if (type === "dashboard") return "📈";
  if (type === "learn") return "📘";
  if (type === "pickers") return "📊";
  return "🏦";
}
export default async function SPXPage() {
  const spxChartPoints = await getSpxChartPoints();

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
          maxWidth: 1080,
          margin: "0 auto",
          padding: 24,
        }}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <div
              className="topNavRow"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "flex-start",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <Link href="/" style={topNavBtnStyle("dashboard")}>
                <span aria-hidden="true" style={topNavIconWrapStyle}>
                  {topNavIcon("dashboard")}
                </span>
                <span className="topNavText">Dashboard</span>
              </Link>

              <Link href="/pickers" style={topNavBtnStyle("pickers")}>
                <span aria-hidden="true" style={topNavIconWrapStyle}>
                  {topNavIcon("pickers")}
                </span>
                <span className="topNavText">
                  <span className="topNavShowDesktop">Stock Pickers</span>
                  <span className="topNavShowMobile">Pickers</span>
                </span>
              </Link>

              <Link
                href="/learn"
                style={topNavBtnStyle("learn")}
                className="topNavIconOnlyMobile"
              >
                <span aria-hidden="true" style={topNavIconWrapStyle}>
                  {topNavIcon("learn")}
                </span>
                <span className="topNavText topNavHideOnMobile">Learn</span>
              </Link>

              <Link
                href="/platforms"
                style={topNavBtnStyle("platforms")}
                className="topNavIconOnlyMobile"
              >
                <span aria-hidden="true" style={topNavIconWrapStyle}>
                  {topNavIcon("platforms")}
                </span>
                <span className="topNavText topNavHideOnMobile">Platforms</span>
              </Link>
            </div>

            <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
              MARKET ANALYSIS
            </div>
          </div>

          <section
            style={{
              borderRadius: 22,
              border: "1px solid rgba(59,130,246,0.22)",
              background:
                "linear-gradient(135deg, rgba(37,99,235,0.16), rgba(15,23,42,0.92))",
              padding: 22,
              boxShadow: "0 18px 40px rgba(0,0,0,0.24)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(250,204,21,0.28)",
                background: "rgba(250,204,21,0.12)",
                color: "#fde68a",
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: "0.35px",
              }}
            >
              SPX GUIDE
            </div>

            <h1
              style={{
                margin: "12px 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.9px",
                maxWidth: 920,
              }}
            >
              S&amp;P 500 (SPX) Analysis (2026) – What the Market Is Actually Doing Right Now
            </h1>

            <div
              style={{
                marginTop: 14,
                maxWidth: 880,
                fontSize: 19,
                lineHeight: 1.7,
                opacity: 0.92,
              }}
            >
              The S&amp;P 500 has started to worry investors as short-term price action weakens.
              On the daily chart, fear rises quickly when key moving averages start getting tested.
              But when you zoom out to the weekly chart, the structure can look very different.
            </div>

            <div
              style={{
                marginTop: 16,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <AffiliateLink
                href="/api/go/tradingview"
                eventLabel="SPX Page Hero CTA TradingView"
                style={primaryBtn()}
              >
                Use TradingView for SPX Charts →
              </AffiliateLink>

              <AffiliateLink
                href="/api/go/etoro"
                eventLabel="SPX Page Hero CTA eToro"
                style={secondaryBtn()}
              >
                Visit eToro →
              </AffiliateLink>
            </div>

            <div
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 16,
                border: "1px solid rgba(34,197,94,0.18)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(59,130,246,0.08))",
                fontSize: 14,
                lineHeight: 1.6,
                color: "#dbeafe",
                maxWidth: 900,
              }}
            >
              <strong>Simple view:</strong> short-term fear is rising, but the bigger question is
              whether the higher-timeframe structure has actually broken down. That is why the weekly chart matters here.
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 14,
            }}
            className="spxTopGrid"
          >
            <div style={infoCardStyle()}>
              <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                DAILY CHART
              </div>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>
                Fear rises faster
              </div>
              <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.6 }}>
                On lower timeframes, weakness feels more dramatic. That is why many investors become nervous when the SPX starts losing short-term support.
              </div>
            </div>

            <div style={infoCardStyle()}>
              <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                WEEKLY CHART
              </div>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>
                Structure still matters more
              </div>
              <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.6 }}>
                When you zoom out, the market can still look like it is going through a normal correction rather than a confirmed long-term breakdown.
              </div>
            </div>

            <div style={infoCardStyle()}>
              <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>
                BIG PICTURE
              </div>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>
                This market was stretched
              </div>
              <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.6 }}>
                After a strong run led by major technology names and AI enthusiasm, a cooling phase was always a realistic possibility.
              </div>
            </div>
          </section>

          <section style={sectionCardStyle()}>
            <h2
              style={{
                margin: 0,
                fontSize: 30,
                letterSpacing: "-0.4px",
              }}
            >
              What’s actually happening in the market right now?
            </h2>

            <div
              style={{
                marginTop: 12,
                opacity: 0.86,
                lineHeight: 1.75,
                fontSize: 16,
                maxWidth: 920,
                display: "grid",
                gap: 14,
              }}
            >
              <p style={{ margin: 0 }}>
                Right now, markets are getting more fearful because the S&amp;P 500 is starting to look weaker on the <strong>daily timeframe</strong>.
                When price loses momentum and approaches major moving averages on lower timeframes, sentiment usually deteriorates quickly.
              </p>

              <p style={{ margin: 0 }}>
                However, the <strong>weekly chart</strong> paints a calmer picture. If this were a standard stock rather than the main US index,
                many traders would likely describe this as a <strong>healthy correction</strong> rather than a reason to panic.
              </p>

              <p style={{ margin: 0 }}>
                The reason is simple: the SPX had become very extended after a long run higher. Much of that strength was concentrated in major companies,
                especially those lifted by the recent <strong>AI-driven rally</strong>. When markets get stretched too far above long-term averages,
                pullbacks become more likely because price needs room to reset.
              </p>

              <p style={{ margin: 0 }}>
                In other words, this is not just about fear. It is also about the market cooling after a period where price had moved too far, too fast.
              </p>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1.15fr 0.85fr",
              gap: 16,
            }}
            className="spxContextGrid"
          >
            <div style={sectionCardStyle()}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 30,
                  letterSpacing: "-0.4px",
                }}
              >
                Why the weekly chart matters more here
              </h2>

              <div
                style={{
                  marginTop: 12,
                  opacity: 0.86,
                  lineHeight: 1.75,
                  fontSize: 16,
                  display: "grid",
                  gap: 14,
                }}
              >
                <p style={{ margin: 0 }}>
                  The weekly timeframe helps remove some of the noise that causes investors to overreact.
                  A move that looks aggressive on the daily chart can appear much more controlled on the weekly chart.
                </p>

                <p style={{ margin: 0 }}>
                  Historically, the S&amp;P 500 has often respected major higher-timeframe moving averages.
                  That does not mean support must always hold, but it does mean context matters.
                </p>

                <p style={{ margin: 0 }}>
                  If price is simply correcting back toward a long-term moving average after an overstretched rally,
                  that is very different from a true structural collapse.
                </p>

                <p style={{ margin: 0 }}>
                  That is why many investors are asking the real question now:
                  <strong> is this a normal correction and potential opportunity, or the start of something worse?</strong>
                </p>
              </div>
            </div>

            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(250,204,21,0.20)",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.12), rgba(249,115,22,0.08))",
                padding: 18,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: "0.3px",
                  color: "#fde68a",
                }}
              >
                CURRENT TAKE
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <div style={{ lineHeight: 1.6 }}>
                  <strong>Short-term:</strong> fear is rising
                </div>
                <div style={{ lineHeight: 1.6 }}>
                  <strong>Bigger picture:</strong> weekly structure matters more
                </div>
                <div style={{ lineHeight: 1.6 }}>
                  <strong>Main idea:</strong> stretched markets often need to reset
                </div>
                <div style={{ lineHeight: 1.6 }}>
                  <strong>Current stance:</strong> on the weekly timeframe, we are not scared yet
                </div>
              </div>
            </div>
          </section>

          <section style={sectionCardStyle()}>
            <h2
              style={{
                margin: 0,
                fontSize: 30,
                letterSpacing: "-0.4px",
              }}
            >
              Weekly SPX chart snapshot
            </h2>

            <div
              style={{
                marginTop: 12,
                opacity: 0.86,
                lineHeight: 1.7,
                fontSize: 16,
                maxWidth: 920,
              }}
            >
              This weekly chart helps show why the bigger picture matters more than short-term fear.
              If the SPX is simply pulling back into higher-timeframe support after an overstretched rally,
              that is a very different setup from a full structural breakdown.
            </div>

            <SPXChartClient chartPoints={spxChartPoints} />
          </section>

          <section style={sectionCardStyle()}>
            <h2
              style={{
                margin: 0,
                fontSize: 30,
                letterSpacing: "-0.4px",
              }}
            >
              What should investors watch next?
            </h2>

            <div
              style={{
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
              className="spxTwoCol"
            >
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(239,68,68,0.22)",
                  background: "rgba(239,68,68,0.06)",
                  padding: 16,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 10 }}>
                  Signs that risk is increasing
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Clear loss of major higher-timeframe support
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Weak reactions around long-term moving averages
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    A broader breakdown in weekly structure
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Momentum continuing to deteriorate rather than stabilising
                  </li>
                </ul>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(34,197,94,0.22)",
                  background: "rgba(34,197,94,0.06)",
                  padding: 16,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 10 }}>
                  Signs this is still a normal correction
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Higher-timeframe support still attracting buyers
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Price holding key weekly moving averages
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Weekly trend structure remaining broadly intact
                  </li>
                  <li style={{ lineHeight: 1.5, opacity: 0.88 }}>
                    Fear easing as price starts stabilising
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section style={sectionCardStyle()}>
            <h2
              style={{
                margin: 0,
                fontSize: 30,
                letterSpacing: "-0.4px",
              }}
            >
              So is this a buying opportunity or the start of a bigger downfall?
            </h2>

            <div
              style={{
                marginTop: 12,
                opacity: 0.86,
                lineHeight: 1.75,
                fontSize: 16,
                maxWidth: 920,
                display: "grid",
                gap: 14,
              }}
            >
              <p style={{ margin: 0 }}>
                That is the question everyone is asking. As Warren Buffett’s famous line reminds people,
                periods of fear often create interest in adding to positions.
              </p>

              <p style={{ margin: 0 }}>
                But the answer does not come from emotion. It comes from structure.
                If the weekly chart continues to look like a standard pullback into support,
                many investors will see that as a healthier reset than the headlines suggest.
              </p>

              <p style={{ margin: 0 }}>
                If the higher-timeframe structure starts failing more decisively, then the risk of a deeper move increases.
                For now, the more balanced view is that the market is <strong>correcting after becoming overstretched</strong>,
                not automatically collapsing.
              </p>
            </div>
          </section>

          <section
            style={{
              borderRadius: 20,
              border: "1px solid rgba(34,197,94,0.22)",
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(59,130,246,0.08))",
              padding: 20,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 30,
                letterSpacing: "-0.4px",
              }}
            >
              Best next step
            </h2>

            <div
              style={{
                marginTop: 12,
                maxWidth: 900,
                lineHeight: 1.7,
                opacity: 0.9,
                fontSize: 16,
              }}
            >
              Use <strong>TradingView</strong> if you want to study the SPX properly and judge the weekly structure for yourself.
              Use <strong>eToro</strong> if you want a simpler route into investing after you have done your research.
            </div>

            <div
              style={{
                marginTop: 16,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <AffiliateLink
                href="/api/go/tradingview"
                eventLabel="SPX Bottom CTA TradingView"
                style={primaryBtn()}
              >
                Visit TradingView →
              </AffiliateLink>

              <AffiliateLink
                href="/api/go/etoro"
                eventLabel="SPX Bottom CTA eToro"
                style={secondaryBtn()}
              >
                Visit eToro →
              </AffiliateLink>
            </div>
          </section>
        </div>
      </div>

      <style>{`
        .topNavShowDesktop {
          display: inline;
        }

        .topNavShowMobile {
          display: none;
        }

        @media (max-width: 900px) {
          .spxTopGrid {
            grid-template-columns: 1fr !important;
          }

          .spxTwoCol {
            grid-template-columns: 1fr !important;
          }

          .spxContextGrid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 760px) {
          .topNavRow {
            display: grid !important;
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.05fr) 60px 60px !important;
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

          .topNavShowDesktop {
            display: none !important;
          }

          .topNavShowMobile {
            display: inline !important;
          }
        }
      `}</style>
    </main>
  );
}
