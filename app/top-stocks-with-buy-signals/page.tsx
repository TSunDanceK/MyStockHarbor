import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type SignalRecord = {
  symbol: string;
  note?: string;
  oversold?: boolean;
  buyTheDip?: boolean;
  breakout?: boolean;
  volumeSpike?: boolean;
  atrSpike?: boolean;
  aboveMA50?: boolean;
  aboveMA200?: boolean;
  bullishRsiDivergence?: boolean;
  bullishMacdDivergence?: boolean;
  dashboardHref?: string;
};

type PickersPayload = {
  updatedAt?: string;
  signalRecords?: SignalRecord[];
};

type BuySignalEntry = {
  symbol: string;
  label: string;
  stockHref: string;
  chartHref: string;
  buyCount: number;
};

export const metadata: Metadata = {
  title:
    "Top Stocks With Buy Signals | Live Scan Results | MyStockHarbor",
  description:
    "Browse top stocks with buy signals using live MyStockHarbor picker data. Review current bullish stock setups, open the stock page, and jump straight into the chart for deeper analysis.",
  alternates: {
    canonical: "https://www.mystockharbor.com/top-stocks-with-buy-signals",
  },
  openGraph: {
    title: "Top Stocks With Buy Signals | MyStockHarbor",
    description:
      "Explore top stocks with buy signals using live MyStockHarbor picker data.",
    url: "https://www.mystockharbor.com/top-stocks-with-buy-signals",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Top Stocks With Buy Signals | MyStockHarbor",
    description:
      "Explore top stocks with buy signals using live MyStockHarbor picker data.",
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

function getBuySignalCount(record: SignalRecord) {
  if (!record.aboveMA200) return 0;

  let count = 0;

  if (record.oversold) count += 1;
  if (record.buyTheDip) count += 1;
  if (record.breakout) count += 1;
  if (record.volumeSpike) count += 1;
  if (record.atrSpike) count += 1;
  if (record.aboveMA50) count += 1;
  if (record.aboveMA200) count += 1;
  if (record.bullishRsiDivergence) count += 1;
  if (record.bullishMacdDivergence) count += 1;

  return count;
}

async function getBuySignalEntries(): Promise<{
  updatedAt: string | null;
  entries: BuySignalEntry[];
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

    const entries: BuySignalEntry[] = signalRecords
      .map((record) => {
        const symbol = String(record?.symbol || "").trim().toUpperCase();
        if (!symbol) return null;

        const buyCount = getBuySignalCount(record);
        if (buyCount <= 0) return null;

        const stockHref = `/stock/${encodeURIComponent(symbol)}`;
        const chartBase =
          typeof record?.dashboardHref === "string" && record.dashboardHref.trim()
            ? record.dashboardHref
            : `/?symbol=${encodeURIComponent(symbol)}`;

        return {
          symbol,
          label: `${buyCount} Buy Signal${buyCount === 1 ? "" : "s"}`,
          stockHref,
          chartHref: chartBase.includes("#chart")
            ? chartBase
            : `${chartBase}#chart`,
          buyCount,
        };
      })
      .filter((entry): entry is BuySignalEntry => Boolean(entry))
      .sort((a, b) => {
        if (b.buyCount !== a.buyCount) return b.buyCount - a.buyCount;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 10);

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

export default async function TopStocksWithBuySignalsPage() {
  const { updatedAt, entries } = await getBuySignalEntries();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Top Stocks With Buy Signals",
    url: "https://www.mystockharbor.com/top-stocks-with-buy-signals",
    description:
      "Live page showing top stocks with buy signals from the MyStockHarbor picker feed.",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: entries.slice(0, 24).map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Thing",
          name: `${entry.symbol} buy signal stock`,
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
          name: "Top Stocks With Buy Signals",
          item: "https://www.mystockharbor.com/top-stocks-with-buy-signals",
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

            .signals-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
              gap: 14px;
            }

            .topNavRow a:hover {
              filter: brightness(1.04);
            }

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
              border: "1px solid rgba(34,197,94,0.20)",
              borderRadius: 22,
              padding: 18,
              background:
                "linear-gradient(135deg, rgba(8,22,18,0.98), rgba(7,14,16,0.98))",
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
                border: "1px solid rgba(34,197,94,0.32)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(22,163,74,0.08))",
                fontSize: 12,
                fontWeight: 950,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#dcfce7",
              }}
            >
              BUY SIGNAL STOCK SCREENER PAGE
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
              Top Stocks With Buy Signals
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
              This page shows stocks currently appearing in the live buy signal
              scan using MyStockHarbor picker data. It is designed as a fast
              shortlist for traders who want to review bullish setups, inspect
              structure, and move quickly into the chart.
            </p>

            <p
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                opacity: 0.78,
                maxWidth: 820,
              }}
            >
              A buy signal is not a guarantee. It is simply a starting point for
              chart review. Use this page to find candidates, then check trend,
              momentum, support, resistance, and overall structure before making
              any decision.
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
                  {entries.length} buy signals
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
            Stocks appearing in a buy signal scan are often showing multiple
            bullish conditions at the same time. That can make them useful
            starting points for traders looking for strength, trend continuation,
            or improving momentum.
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li>Multiple bullish technical conditions lining up</li>
            <li>Can highlight strength, momentum or cleaner trend structure</li>
            <li>Useful for building a shortlist faster</li>
            <li>Still needs chart review before acting</li>
          </ul>

          <p style={{ marginTop: 10 }}>
            The live stocks listed below are currently appearing in the buy
            signal scan, making them worth checking for possible bullish setups.
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
                "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(22,163,74,0.08))",
              border: "1px solid rgba(34,197,94,0.26)",
              color: "#dcfce7",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            LIVE BUY SIGNAL RESULTS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 28,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
            }}
          >
            Stocks currently appearing in the live buy signal scan
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.8,
              maxWidth: 860,
            }}
          >
            Review the current buy signal results below, then open any stock page
            for more detail or jump straight to the chart.
          </p>

          <div className="signals-grid" style={{ marginTop: 18 }}>
            {entries.length > 0 ? (
              entries.map((entry) => (
                <article
                  key={`${entry.symbol}-${entry.label}`}
                  style={{
                    border: "1px solid rgba(34,197,94,0.16)",
                    borderRadius: 18,
                    padding: 16,
                    background:
                      "linear-gradient(180deg, rgba(8,18,16,0.96), rgba(6,10,18,0.96))",
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
                          background: "#22c55e",
                          boxShadow: "0 0 12px rgba(34,197,94,0.35)",
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
                        border: "1px solid rgba(34,197,94,0.28)",
                        background:
                          "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(22,163,74,0.08))",
                        color: "#dcfce7",
                        fontWeight: 900,
                        fontSize: 12,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {entry.label}
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
  <li>{entry.buyCount} bullish technical signals active</li>
  <li>Review chart structure before acting</li>
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
                      href={entry.chartHref}
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
                No buy signal results are currently available from the live picker
                feed.
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
                "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(22,163,74,0.08))",
              border: "1px solid rgba(34,197,94,0.26)",
              color: "#dcfce7",
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
            What it means when a stock appears in the buy signal scan
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            A buy signal scan is designed to narrow the market into a smaller set
            of charts worth reviewing. Instead of searching manually, traders can
            start with a shortlist of names already showing technical conditions
            that may support a bullish setup.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            That does not mean every stock on the page is actionable. The scan is
            a filter, not a final decision. Stronger setups usually still need
            support from trend, momentum, clean levels, and broader market context.
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
            inspect the chart, and decide whether the signal fits your own
            process, timeframe, and risk approach.
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
            href="/stocks-near-200-day-moving-average"
            style={{
              border: "1px solid rgba(59,130,246,0.22)",
              borderRadius: 16,
              padding: 16,
              background:
                "linear-gradient(180deg, rgba(8,16,30,0.92), rgba(6,10,20,0.96))",
              textDecoration: "none",
              color: "#f1f5f9",
              display: "block",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Explore MA200 setups
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.65,
                opacity: 0.74,
              }}
            >
              Review stocks near the 200 day moving average and compare another
              popular technical scan.
            </div>
          </Link>
        </section>
      </div>
    </main>
  );
}
