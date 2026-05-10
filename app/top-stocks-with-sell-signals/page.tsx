import type { Metadata } from "next";
import Link from "next/link";
import MiniPickerCandleChart, { type MiniCandlePoint } from "@/app/components/MiniPickerCandleChart";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type SignalRecord = {
  symbol: string;
  overbought?: boolean;
  belowMA50?: boolean;
  belowMA200?: boolean;
  bearishRsiDivergence?: boolean;
  bearishMacdDivergence?: boolean;
  dashboardHref?: string;
  chartPoints?: MiniCandlePoint[];
};

type PickersPayload = {
  updatedAt?: string;
  signalRecords?: SignalRecord[];
};

type SellSignalEntry = {
  symbol: string;
  label: string;
  stockHref: string;
  chartHref: string;
  chartPoints: MiniCandlePoint[];
  sellCount: number;
};

export const metadata: Metadata = {
  title:
    "Top Stocks With Sell Signals | Bearish Setups List | MyStockHarbor",
  description:
    "Browse top stocks with sell signals using live MyStockHarbor picker data. Review bearish stock setups, open each stock page, and jump straight to the chart for deeper analysis.",
  alternates: {
    canonical: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
  },
  openGraph: {
    title: "Top Stocks With Sell Signals | MyStockHarbor",
    description:
      "Explore top stocks with sell signals and bearish setups using live MyStockHarbor picker data.",
    url: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Top Stocks With Sell Signals | MyStockHarbor",
    description:
      "Explore top stocks with sell signals and bearish setups using live MyStockHarbor picker data.",
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

function getSellSignalCount(record: SignalRecord) {
  let count = 0;

  if (record.overbought) count += 1;
  if (record.belowMA50) count += 1;
  if (record.belowMA200) count += 1;
  if (record.bearishRsiDivergence) count += 1;
  if (record.bearishMacdDivergence) count += 1;

  return count;
}

async function getSellSignalEntries(): Promise<{
  updatedAt: string | null;
  entries: SellSignalEntry[];
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

    const entries: SellSignalEntry[] = signalRecords
      .map((record) => {
        const symbol = String(record?.symbol || "").trim().toUpperCase();
        if (!symbol) return null;

        const sellCount = getSellSignalCount(record);
        if (sellCount <= 0) return null;

        const stockHref = `/stock/${encodeURIComponent(symbol)}`;
        const chartBase =
          typeof record?.dashboardHref === "string" && record.dashboardHref.trim()
            ? record.dashboardHref
            : `/?symbol=${encodeURIComponent(symbol)}`;

        return {
          symbol,
          label: `${sellCount} Sell Signal${sellCount === 1 ? "" : "s"}`,
          stockHref,
          chartHref: chartBase.includes("#chart")
            ? chartBase
            : `${chartBase}#chart`,
          chartPoints: Array.isArray(record?.chartPoints) ? record.chartPoints : [],
          sellCount,
        };
      })
      .filter((entry): entry is SellSignalEntry => Boolean(entry))
      .sort((a, b) => {
        if (b.sellCount !== a.sellCount) return b.sellCount - a.sellCount;
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

export default async function TopStocksWithSellSignalsPage() {
  const { updatedAt, entries } = await getSellSignalEntries();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Top Stocks With Sell Signals",
    url: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
    description:
      "Live page showing top stocks with sell signals from the MyStockHarbor picker feed.",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: entries.slice(0, 24).map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Thing",
          name: `${entry.symbol} sell signal stock`,
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
          name: "Top Stocks With Sell Signals",
          item: "https://www.mystockharbor.com/top-stocks-with-sell-signals",
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
              border: "1px solid rgba(239,68,68,0.22)",
              borderRadius: 22,
              padding: 18,
              background:
                "linear-gradient(135deg, rgba(24,10,10,0.98), rgba(10,12,18,0.98))",
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
                border: "1px solid rgba(239,68,68,0.32)",
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.16), rgba(185,28,28,0.08))",
                fontSize: 12,
                fontWeight: 950,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#fecaca",
              }}
            >
              BEARISH STOCK SCREENER PAGE
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
              Top Stocks With Sell Signals
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
              This page shows stocks currently appearing in the live sell signal
              scan using MyStockHarbor picker data. It is designed as a fast
              shortlist for traders who want to review bearish setups, inspect
              weakening structure, and move quickly into the chart.
            </p>

            <p
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                opacity: 0.78,
                maxWidth: 820,
              }}
            >
              A sell signal is not a guarantee. It is simply a starting point for
              chart review. Use this page to find candidates, then check trend,
              momentum, support, resistance, and overall weakness before making
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
                  border: "1px solid rgba(239,68,68,0.24)",
                  background:
                    "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(15,23,42,0.08))",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    color: "#fecaca",
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
                    color: "#fef2f2",
                  }}
                >
                  {entries.length} sell signals
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
            Stocks appearing in a sell signal scan are often showing multiple
            signs of weakness at the same time. This can include overbought
            conditions, breakdowns below key levels, or bearish momentum
            divergence.
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li>Multiple bearish technical signals aligning</li>
            <li>Can highlight weakening trends or breakdown setups</li>
            <li>Useful for spotting potential short or exit opportunities</li>
            <li>Still requires full chart confirmation before acting</li>
          </ul>

          <p style={{ marginTop: 10 }}>
            The stocks listed below are currently appearing in the sell signal
            scan and may be worth reviewing for potential bearish setups.
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
                "linear-gradient(135deg, rgba(239,68,68,0.16), rgba(185,28,28,0.08))",
              border: "1px solid rgba(239,68,68,0.26)",
              color: "#fecaca",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            LIVE SELL SIGNAL RESULTS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 28,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
            }}
          >
            Stocks currently appearing in the live sell signal scan
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.8,
              maxWidth: 860,
            }}
          >
            Review the current sell signal results below, then open any stock page
            for more detail or jump straight to the chart.
          </p>

          <div className="signals-grid" style={{ marginTop: 18 }}>
            {entries.length > 0 ? (
              entries.map((entry) => (
                <article
                  key={`${entry.symbol}-${entry.label}`}
                  style={{
                    border: "1px solid rgba(239,68,68,0.16)",
                    borderRadius: 18,
                    padding: 16,
                    background:
                      "linear-gradient(180deg, rgba(18,8,8,0.96), rgba(6,10,18,0.96))",
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
                          background: "#ef4444",
                          boxShadow: "0 0 12px rgba(239,68,68,0.35)",
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
                        border: "1px solid rgba(239,68,68,0.28)",
                        background:
                          "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(185,28,28,0.08))",
                        color: "#fecaca",
                        fontWeight: 900,
                        fontSize: 12,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {entry.label}
                    </div>
                  </div>

                  <MiniPickerCandleChart points={entry.chartPoints} tone="red" />

                  <ul
                    style={{
                      marginTop: 12,
                      paddingLeft: 18,
                      fontSize: 14,
                      lineHeight: 1.6,
                      opacity: 0.8,
                    }}
                  >
                    <li>{entry.sellCount} bearish technical signals active</li>
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
                        border: "1px solid rgba(239,68,68,0.35)",
                        background:
                          "linear-gradient(135deg, rgba(127,29,29,0.22), rgba(185,28,28,0.12))",
                        color: "#fecaca",
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
                No sell signal results are currently available from the live picker
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
                "linear-gradient(135deg, rgba(239,68,68,0.16), rgba(185,28,28,0.08))",
              border: "1px solid rgba(239,68,68,0.26)",
              color: "#fecaca",
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
            What it means when a stock appears in the sell signal scan
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            A sell signal scan is designed to narrow the market into a smaller set
            of charts worth reviewing for weakness. Instead of searching manually,
            traders can start with a shortlist of names already showing technical
            conditions that may support a bearish setup.
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
            a filter, not a final decision. Stronger bearish setups usually still
            need support from trend weakness, poor structure, resistance, and
            broader market context.
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
            href="/top-stocks-with-buy-signals"
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
              Explore buy signals
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.65,
                opacity: 0.74,
              }}
            >
              Compare bearish setups with stocks currently showing stronger bullish
              technical conditions.
            </div>
          </Link>
        </section>
      </div>
    </main>
  );
}
