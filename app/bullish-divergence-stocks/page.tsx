import type { Metadata } from "next";
import Link from "next/link";
import MiniPickerCandleChart, { type MiniCandlePoint } from "@/app/components/MiniPickerCandleChart";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type PickerItem = {
  symbol?: string;
  note?: string;
  tone?: "green" | "yellow" | "orange" | "red";
  dashboardHref?: string;
  chartPoints?: MiniCandlePoint[];
};

type PickerSection = {
  title?: string;
  description?: string;
  foundCount?: number;
  shownCount?: number;
  items?: PickerItem[];
};

type PickersPayload = {
  updatedAt?: string;
  sections?: PickerSection[];
};

type DivergenceEntry = {
  symbol: string;
  label: string;
  stockHref: string;
  chartHref: string;
  chartPoints: MiniCandlePoint[];
  tone: "green" | "red" | "yellow" | "orange";
  badge: string;
};

export const metadata: Metadata = {
  title:
    "Bullish & Bearish Divergence Stocks | RSI & MACD Signals | MyStockHarbor",
  description:
    "Browse bullish and bearish divergence stocks using live MyStockHarbor picker data. Review RSI and MACD divergence signals, open each stock page, and jump straight to the chart for deeper analysis.",
  alternates: {
    canonical: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
  },
  openGraph: {
    title: "Bullish & Bearish Divergence Stocks | MyStockHarbor",
    description:
      "Explore bullish and bearish divergence stocks with RSI and MACD signals using live MyStockHarbor picker data.",
    url: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bullish & Bearish Divergence Stocks | MyStockHarbor",
    description:
      "Explore bullish and bearish divergence stocks with RSI and MACD signals using live MyStockHarbor picker data.",
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

function getToneColor(tone: DivergenceEntry["tone"]) {
  if (tone === "green") return "#22c55e";
  if (tone === "red") return "#ef4444";
  if (tone === "orange") return "#fb923c";
  return "#eab308";
}

function getToneBorder(tone: DivergenceEntry["tone"]) {
  if (tone === "green") return "rgba(34,197,94,0.28)";
  if (tone === "red") return "rgba(239,68,68,0.28)";
  if (tone === "orange") return "rgba(251,146,60,0.28)";
  return "rgba(234,179,8,0.28)";
}

function getToneBackground(tone: DivergenceEntry["tone"]) {
  if (tone === "green") {
    return "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(22,163,74,0.08))";
  }
  if (tone === "red") {
    return "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(185,28,28,0.08))";
  }
  if (tone === "orange") {
    return "linear-gradient(135deg, rgba(251,146,60,0.14), rgba(249,115,22,0.08))";
  }
  return "linear-gradient(135deg, rgba(234,179,8,0.14), rgba(202,138,4,0.08))";
}

async function getDivergenceEntries(): Promise<{
  updatedAt: string | null;
  entries: DivergenceEntry[];
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
    const sections = Array.isArray(data?.sections) ? data.sections : [];

    const divergenceSection = sections.find((section) =>
      String(section?.title || "").toLowerCase().includes("divergence")
    );

    const items = Array.isArray(divergenceSection?.items)
      ? divergenceSection.items
      : [];

    const entries: DivergenceEntry[] = items
      .map((item) => {
        const symbol = String(item?.symbol || "").trim().toUpperCase();
        if (!symbol) return null;

        const note = String(item?.note || "Divergence setup").trim() || "Divergence setup";
        const noteLower = note.toLowerCase();

        const tone =
          item?.tone === "green" ||
          item?.tone === "red" ||
          item?.tone === "yellow" ||
          item?.tone === "orange"
            ? item.tone
            : noteLower.includes("bullish")
              ? "green"
              : noteLower.includes("bearish")
                ? "red"
                : "yellow";

        const badge = noteLower.includes("bullish")
          ? "Bullish Divergence"
          : noteLower.includes("bearish")
            ? "Bearish Divergence"
            : "Divergence";

        const stockHref = `/stock/${encodeURIComponent(symbol)}`;
        const chartBase =
          typeof item?.dashboardHref === "string" && item.dashboardHref.trim()
            ? item.dashboardHref
            : `/stock/${encodeURIComponent(symbol)}`;

        return {
          symbol,
          label: note,
          stockHref,
          chartHref: chartBase.includes("#chart")
            ? chartBase
            : `${chartBase}#chart`,
          chartPoints: Array.isArray(item?.chartPoints) ? item.chartPoints : [],
          tone,
          badge,
        };
      })
      .filter((entry): entry is DivergenceEntry => Boolean(entry));

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

export default async function BullishBearishDivergenceStocksPage() {
  const { updatedAt, entries } = await getDivergenceEntries();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Bullish & Bearish Divergence Stocks",
    url: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
    description:
      "Live page showing bullish and bearish divergence stocks from the MyStockHarbor picker feed.",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: entries.slice(0, 24).map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Thing",
          name: `${entry.symbol} divergence stock setup`,
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
          name: "Bullish & Bearish Divergence Stocks",
          item: "https://www.mystockharbor.com/bullish-bearish-divergence-stocks",
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

            .divergence-grid {
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


          <section
            style={{
              border: "1px solid rgba(168,85,247,0.22)",
              borderRadius: 22,
              padding: 18,
              background:
                "linear-gradient(135deg, rgba(18,12,28,0.98), rgba(10,12,18,0.98))",
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
                border: "1px solid rgba(168,85,247,0.32)",
                background:
                  "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(139,92,246,0.08))",
                fontSize: 12,
                fontWeight: 950,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#f3e8ff",
              }}
            >
              DIVERGENCE STOCK SCREENER PAGE
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
              Bullish & Bearish Divergence Stocks
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
              This page shows stocks currently screening for bullish and bearish
              divergence setups using live MyStockHarbor picker data. It is built
              for traders who want to review RSI and MACD divergence signals, spot
              potential reversals, and quickly inspect whether momentum is starting
              to disagree with price.
            </p>

            <p
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                opacity: 0.78,
                maxWidth: 820,
              }}
            >
              Divergence can be useful, but it is not enough on its own. Some
              signals lead to strong reversals, while others fail or take time to
              develop. Use this page as a live shortlist, then inspect structure,
              support and resistance, timeframe context, and follow-through before
              making any decision.
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
                  border: "1px solid rgba(168,85,247,0.24)",
                  background:
                    "linear-gradient(135deg, rgba(168,85,247,0.10), rgba(15,23,42,0.08))",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    color: "#e9d5ff",
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
                    color: "#faf5ff",
                  }}
                >
                  {entries.length} divergence setups
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
            Divergence setups appear when price and momentum stop moving in sync,
            which can sometimes signal early signs of a potential shift in
            direction. Traders often watch for these conditions when looking for
            reversal or exhaustion setups.
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li>Price and momentum beginning to move out of alignment</li>
            <li>Can signal potential reversal or trend exhaustion</li>
            <li>Includes both bullish and bearish divergence setups</li>
            <li>Still requires confirmation from price structure</li>
          </ul>

          <p style={{ marginTop: 10 }}>
            The stocks listed below are currently showing divergence signals and
            may be worth reviewing for potential reversal or continuation shift
            setups.
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
                "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(139,92,246,0.08))",
              border: "1px solid rgba(168,85,247,0.26)",
              color: "#f3e8ff",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            LIVE DIVERGENCE RESULTS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 28,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
            }}
          >
            Stocks currently showing bullish or bearish divergence
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.8,
              maxWidth: 860,
            }}
          >
            Review the current divergence setups below, then open any stock page
            for more detail or jump straight to the chart.
          </p>

          <div className="divergence-grid" style={{ marginTop: 18 }}>
            {entries.length > 0 ? (
              entries.map((entry) => (
                <article
                  key={`${entry.symbol}-${entry.label}`}
                  style={{
                    border: "1px solid rgba(168,85,247,0.16)",
                    borderRadius: 18,
                    padding: 16,
                    background:
                      "linear-gradient(180deg, rgba(14,10,24,0.96), rgba(6,10,18,0.96))",
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
                          background: getToneColor(entry.tone),
                          boxShadow: `0 0 12px ${getToneBorder(entry.tone)}`,
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
                        border: `1px solid ${getToneBorder(entry.tone)}`,
                        background: getToneBackground(entry.tone),
                        color:
                          entry.tone === "green"
                            ? "#dcfce7"
                            : entry.tone === "red"
                              ? "#fecaca"
                              : entry.tone === "orange"
                                ? "#fed7aa"
                                : "#fef3c7",
                        fontWeight: 900,
                        fontSize: 12,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {entry.badge}
                    </div>
                  </div>

                  <MiniPickerCandleChart points={entry.chartPoints} tone={entry.tone} />

                  <ul
                    style={{
                      marginTop: 12,
                      paddingLeft: 18,
                      fontSize: 14,
                      lineHeight: 1.6,
                      opacity: 0.8,
                    }}
                  >
                    <li>{entry.label}</li>
                    <li>Review price structure and confirmation before acting</li>
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
                        border: "1px solid rgba(168,85,247,0.35)",
                        background:
                          "linear-gradient(135deg, rgba(107,33,168,0.22), rgba(126,34,206,0.12))",
                        color: "#f3e8ff",
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
                No divergence results are currently available from the live picker feed.
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
                "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(139,92,246,0.08))",
              border: "1px solid rgba(168,85,247,0.26)",
              color: "#f3e8ff",
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
            What it means when a stock is showing divergence
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            Divergence appears when price and momentum stop moving in sync. In
            bullish divergence, price may keep weakening while momentum starts to
            improve. In bearish divergence, price may keep pushing higher while
            momentum begins to fade. That is why traders often watch divergence
            for early signs of reversal or trend exhaustion.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            That does not mean every divergence leads to an immediate turn. Some
            signals resolve well, while others fail or need more time. Traders
            still need to assess support, resistance, structure, timeframe, and
            whether price action is actually confirming the setup.
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
            inspect the chart, and decide whether the RSI or MACD divergence fits
            your own process and risk approach.
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
              Compare divergence setups with stocks currently showing broader
              bullish technical signal alignment.
            </div>
          </Link>
        </section>
      </div>
    </main>
  );
}
