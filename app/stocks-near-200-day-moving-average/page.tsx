import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type SignalRecord = {
  symbol: string;
  dailyMa200Proximity?: boolean;
  weeklyMa200Proximity?: boolean;
};

type PickersPayload = {
  updatedAt?: string;
  signalRecords?: SignalRecord[];
};

type Ma200Entry = {
  symbol: string;
  timeframe: "Daily" | "Weekly";
  stockHref: string;
};

export const metadata: Metadata = {
  title:
    "Stocks Near 200 Day Moving Average | Live MA200 Stock List | MyStockHarbor",
  description:
    "Browse stocks screening near the 200 day moving average using live MyStockHarbor picker data. Review daily and weekly MA200 proximity setups and open each stock page for deeper chart analysis.",
  alternates: {
    canonical: "https://www.mystockharbor.com/stocks-near-200-day-moving-average",
  },
  openGraph: {
    title: "Stocks Near 200 Day Moving Average | MyStockHarbor",
    description:
      "Explore stocks screening near their daily or weekly 200 day moving average using live MyStockHarbor picker data.",
    url: "https://www.mystockharbor.com/stocks-near-200-day-moving-average",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks Near 200 Day Moving Average | MyStockHarbor",
    description:
      "Explore stocks screening near their daily or weekly 200 day moving average using live MyStockHarbor picker data.",
  },
};

async function getOriginFromHeaders() {
  const headerStore = await headers();
  const host =
    headerStore.get("x-forwarded-host") ||
    headerStore.get("host") ||
    "www.mystockharbor.com";

  const proto =
    headerStore.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

async function getMa200Entries(): Promise<{
  updatedAt: string | null;
  entries: Ma200Entry[];
}> {
  try {
    const origin = await getOriginFromHeaders();
    const res = await fetch(`${origin}/api/pickers`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return { updatedAt: null, entries: [] };
    }

    const data = (await res.json()) as PickersPayload;
    const signalRecords = Array.isArray(data?.signalRecords)
      ? data.signalRecords
      : [];

    const entries: Ma200Entry[] = [];

    for (const record of signalRecords) {
      const symbol = String(record?.symbol || "").trim().toUpperCase();
      if (!symbol) continue;

      if (record.weeklyMa200Proximity) {
        entries.push({
          symbol,
          timeframe: "Weekly",
          stockHref: `/stock/${encodeURIComponent(symbol)}`,
        });
      }

      if (record.dailyMa200Proximity) {
        entries.push({
          symbol,
          timeframe: "Daily",
          stockHref: `/stock/${encodeURIComponent(symbol)}`,
        });
      }
    }

    entries.sort((a, b) => {
      if (a.timeframe !== b.timeframe) {
        return a.timeframe === "Weekly" ? -1 : 1;
      }

      return a.symbol.localeCompare(b.symbol);
    });

    return {
      updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null,
      entries,
    };
  } catch {
    return { updatedAt: null, entries: [] };
  }
}

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

export default async function StocksNear200DayMovingAveragePage() {
  const { updatedAt, entries } = await getMa200Entries();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Stocks Near 200 Day Moving Average",
    url: "https://www.mystockharbor.com/stocks-near-200-day-moving-average",
    description:
      "Live page showing stocks screening near their daily or weekly 200 day moving average.",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: entries.slice(0, 24).map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Thing",
          name: `${entry.symbol} stock near ${entry.timeframe.toLowerCase()} 200 day moving average`,
          url: `https://www.mystockharbor.com${entry.stockHref}`,
        },
      })),
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
        {
          "@type": "ListItem",
          position: 3,
          name: "Stocks Near 200 Day Moving Average",
          item: "https://www.mystockharbor.com/stocks-near-200-day-moving-average",
        },
      ],
    },
  };

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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

<style
  dangerouslySetInnerHTML={{
    __html: `
      .wrap {
        max-width: 1100px;
        margin: 0 auto;
        padding: 28px 16px 72px;
        box-sizing: border-box;
      }

      .ma200-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 14px;
      }

      .topNavRow a:hover {
        filter: brightness(1.04);
      }

      /* ✅ CTA ANIMATIONS START */

      .ctaPulse {
        animation: ctaPulseGlow 2.8s ease-in-out infinite;
      }

      @keyframes ctaPulseGlow {
        0% {
          box-shadow: 0 0 0 rgba(239,68,68,0.0);
        }
        50% {
          box-shadow: 0 0 18px rgba(239,68,68,0.25);
        }
        100% {
          box-shadow: 0 0 0 rgba(239,68,68,0.0);
        }
      }

      .ctaHover {
        transition: transform 140ms ease, box-shadow 140ms ease;
      }

      .ctaHover:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 28px rgba(239,68,68,0.25);
      }

      .ctaShimmer {
        position: relative;
        overflow: hidden;
      }

      .ctaShimmer::after {
        content: "";
        position: absolute;
        top: 0;
        left: -120%;
        width: 60%;
        height: 100%;
        background: linear-gradient(
          120deg,
          transparent,
          rgba(255,255,255,0.12),
          transparent
        );
        transform: skewX(-20deg);
        animation: shimmerMove 3.5s infinite;
      }

      @keyframes shimmerMove {
        0% {
          left: -120%;
        }
        100% {
          left: 140%;
        }
      }

      /* ✅ CTA ANIMATIONS END */

      @media (max-width: 760px) {
        .topNavRow {
          justify-content: center !important;
        }

        .heroTitle {
          font-size: 34px !important;
        }

        .heroText {
          font-size: 15px !important;
        }
      }
    `,
  }}
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
              <span>Dashboard</span>
            </Link>

            <Link href="/platforms" style={topNavBtnStyle("platforms")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("platforms")}
              </span>
              <span>Platforms</span>
            </Link>

            <Link href="/learn" style={topNavBtnStyle("learn")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("learn")}
              </span>
              <span>Learn</span>
            </Link>

            <Link href="/utilities" style={topNavBtnStyle("calculators")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("calculators")}
              </span>
              <span>Calculators</span>
            </Link>
          </div>

          <section
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
              maxWidth: 980,
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
              }}
            >
              MA200 STOCK SCREENER PAGE
            </div>

            <h1
              className="heroTitle"
              style={{
                margin: "14px 0 0 0",
                fontSize: 44,
                lineHeight: 1.04,
                letterSpacing: "-0.05em",
              }}
            >
              Stocks Near 200 Day Moving Average
            </h1>

            <p
              className="heroText"
              style={{
                marginTop: 12,
                fontSize: 17,
                lineHeight: 1.65,
                opacity: 0.84,
                maxWidth: 760,
              }}
            >
              This page shows stocks currently screening near the 200 day moving
              average using live MyStockHarbor picker data. Traders often watch
              these setups because the 200-day average can act as a major trend
              line, support level or resistance zone depending on the chart
              context.
            </p>

            <p
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                opacity: 0.78,
                maxWidth: 820,
              }}
            >
              Some names are screening near the daily 200 day moving average,
              while others are screening near the weekly 200 day moving average.
              Weekly MA200 tests are usually slower, bigger-picture levels.
              Daily MA200 tests are often more active for short- to medium-term
              chart review.
            </p>

            <div
              style={{
                marginTop: 18,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 10,
                maxWidth: 560,
              }}
            >
              <div
                style={{
                  borderRadius: 16,
                  padding: 14,
                  border: "1px solid rgba(34,197,94,0.24)",
                  background:
                    "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(15,23,42,0.08))",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    color: "#bbf7d0",
                    textTransform: "uppercase",
                  }}
                >
                  Live Results
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 18,
                    fontWeight: 950,
                    color: "#f0fdf4",
                  }}
                >
                  {entries.length} MA200 setups
                </div>
              </div>

              <div
                style={{
                  borderRadius: 16,
                  padding: 14,
                  border: "1px solid rgba(59,130,246,0.24)",
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(15,23,42,0.08))",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    color: "#dbeafe",
                    textTransform: "uppercase",
                  }}
                >
                  Last Updated
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 16,
                    fontWeight: 900,
                    color: "#eff6ff",
                  }}
                >
                  {updatedAt ? new Date(updatedAt).toLocaleString() : "Live data"}
                </div>
              </div>
            </div>
          </section>
        <section
          style={{
            marginTop: 22,
            maxWidth: 860,
            lineHeight: 1.7,
            opacity: 0.82,
          }}
        >
          <p>
            Stocks near the 200 day moving average often sit at key decision
            points. This level is widely watched as a long-term trend reference,
            so reactions here can matter.
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li>Price testing long-term support or resistance</li>
            <li>Potential trend continuation or breakdown zone</li>
            <li>Higher timeframe level many traders monitor closely</li>
            <li>Can lead to strong reactions, reclaim attempts or reversals</li>
          </ul>

          <p style={{ marginTop: 10 }}>
            The live stocks listed below are currently screening near the daily
            or weekly 200 day moving average, making them worth reviewing for
            possible setups.
          </p>
        </section>
        </div>

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
            }}
          >
            LIVE SCREENED RESULTS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 28,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
            }}
          >
            Stocks currently screening near the daily or weekly MA200
          </h2>

<p
  style={{
    margin: "10px 0 0",
    lineHeight: 1.7,
    opacity: 0.8,
    maxWidth: 860,
  }}
>
  Review the current MA200 setups below, then open any result to inspect the full stock page or jump straight to the chart.
</p>

          <div className="ma200-grid" style={{ marginTop: 18 }}>
            {entries.length > 0 ? (
              entries.map((entry) => (
                <article
                  key={`${entry.symbol}-${entry.timeframe}`}
                  style={{
                    border: "1px solid rgba(59,130,246,0.16)",
                    borderRadius: 18,
                    padding: 16,
                    background:
                      "linear-gradient(180deg, rgba(8,14,28,0.96), rgba(6,10,18,0.96))",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: "#facc15",
                          boxShadow: "0 0 12px rgba(250,204,21,0.35)",
                          flex: "0 0 auto",
                        }}
                      />
                      <div
                        style={{
                          fontSize: 22,
                          fontWeight: 950,
                          letterSpacing: "-0.03em",
                        }}
                      >
                        {entry.symbol}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(59,130,246,0.28)",
                        background:
                          "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.08))",
                        color: "#dbeafe",
                        fontWeight: 900,
                        fontSize: 12,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {entry.timeframe} MA200
                    </div>
                  </div>

<ul
  style={{
    marginTop: 12,
    paddingLeft: 18,
    fontSize: 14,
    lineHeight: 1.6,
    opacity: 0.8,
  }}
>
  {entry.timeframe === "Weekly" ? (
    <>
      <li>Higher timeframe MA200 level</li>
      <li>Slower, bigger-picture reaction zone</li>
    </>
  ) : (
    <>
      <li>Active MA200 test on daily chart</li>
      <li>Watch for support or rejection</li>
    </>
  )}
</ul>

                  <div
                    style={{
                      marginTop: 14,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                    }}
                  >
                    <Link
                      href={entry.stockHref}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 42,
                        padding: "10px 14px",
                        borderRadius: 12,
                        textDecoration: "none",
                        fontWeight: 900,
                        border: "1px solid rgba(59,130,246,0.35)",
                        background:
                          "linear-gradient(135deg, rgba(30,64,175,0.22), rgba(29,78,216,0.12))",
                        color: "#eff6ff",
                      }}
                    >
                      Stock Page →
                    </Link>

                    <Link
                      href={`/?symbol=${encodeURIComponent(entry.symbol)}#chart`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 42,
                        padding: "10px 14px",
                        borderRadius: 12,
                        textDecoration: "none",
                        fontWeight: 900,
                        border: "1px solid rgba(34,197,94,0.35)",
                        background:
                          "linear-gradient(135deg, rgba(21,128,61,0.22), rgba(22,163,74,0.12))",
                        color: "#dcfce7",
                      }}
                    >
                      Chart →
                    </Link>
                  </div>
                </article>
              ))
            ) : (
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 18,
                  padding: 18,
                  background: "rgba(255,255,255,0.03)",
                  lineHeight: 1.7,
                  opacity: 0.82,
                }}
              >
                No MA200 proximity results are currently available from the live
                picker feed.
              </div>
            )}
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
            }}
          >
            HOW TRADERS USE THIS PAGE
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            What it means when a stock is near the 200 day moving average
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            The 200 day moving average is one of the most widely watched long-term
            chart references in technical analysis. When price moves close to it,
            traders often pay attention because the level can attract reactions,
            trend tests and larger decision points.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            A stock near the daily MA200 can be useful for finding medium-term
            setups, while a stock near the weekly MA200 often points to a bigger
            long-term chart level. Neither is a signal by itself. Traders still
            need to review structure, momentum, support and resistance before
            acting.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            This page is best used as a starting point. Open the stock page,
            inspect the chart, and decide whether the MA200 is acting as support,
            resistance or simply a nearby level with no clear reaction yet.
          </p>
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
  href="/pickers"
  className="ctaPulse ctaHover ctaShimmer"
  style={{
    border: "1px solid rgba(239,68,68,0.35)",
    borderRadius: 16,
    padding: 16,
    background:
      "linear-gradient(180deg, rgba(60,10,10,0.92), rgba(30,6,6,0.96))",
    textDecoration: "none",
    color: "#fee2e2",
    display: "block",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  }}
>
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Open the full Stock Pickers page
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.65,
                opacity: 0.74,
              }}
            >
              Explore oversold setups, breakouts, divergence ideas, buy-the-dip
              names and other screened stock results.
            </div>
          </Link>

          <Link
            href="/stocks-above-200-day-moving-average"
            style={{
              border: "1px solid rgba(34,197,94,0.22)",
              borderRadius: 16,
              padding: 16,
              background:
                "linear-gradient(180deg, rgba(8,24,18,0.92), rgba(6,18,12,0.96))",
              textDecoration: "none",
              color: "#f1f5f9",
              display: "block",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Read the MA200 guide
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.65,
                opacity: 0.74,
              }}
            >
              Learn how traders use the 200 day moving average as a long-term
              trend filter and chart reference.
            </div>
          </Link>
        </section>
      </div>
    </main>
  );
}
