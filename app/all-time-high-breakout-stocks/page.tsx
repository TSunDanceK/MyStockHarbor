import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type PickerItem = {
  symbol?: string;
  note?: string;
  tone?: "green" | "yellow" | "orange" | "red";
  dashboardHref?: string;
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

type AthBreakoutEntry = {
  symbol: string;
  label: string;
  stockHref: string;
  chartHref: string;
};

export const metadata: Metadata = {
  title:
    "All-Time High Breakout Stocks | Live ATH Breakout List | MyStockHarbor",
  description:
    "Browse all-time high breakout stocks using live MyStockHarbor picker data. Review stocks breaking into new highs, open each stock page, and jump straight to the chart for deeper analysis.",
  alternates: {
    canonical: "https://www.mystockharbor.com/all-time-high-breakout-stocks",
  },
  openGraph: {
    title: "All-Time High Breakout Stocks | MyStockHarbor",
    description:
      "Explore all-time high breakout stocks using live MyStockHarbor picker data.",
    url: "https://www.mystockharbor.com/all-time-high-breakout-stocks",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "All-Time High Breakout Stocks | MyStockHarbor",
    description:
      "Explore all-time high breakout stocks using live MyStockHarbor picker data.",
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

async function getAthBreakoutEntries(): Promise<{
  updatedAt: string | null;
  entries: AthBreakoutEntry[];
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

    const athBreakoutSection = sections.find((section) =>
      String(section?.title || "").includes("All-Time High Breakout")
    );

    const items = Array.isArray(athBreakoutSection?.items)
      ? athBreakoutSection.items
      : [];

    const entries: AthBreakoutEntry[] = items
      .map((item) => {
        const symbol = String(item?.symbol || "").trim().toUpperCase();
        if (!symbol) return null;

        const stockHref = `/stock/${encodeURIComponent(symbol)}`;
        const chartBase =
          typeof item?.dashboardHref === "string" && item.dashboardHref.trim()
            ? item.dashboardHref
            : `/?symbol=${encodeURIComponent(symbol)}`;

        return {
          symbol,
          label:
            String(item?.note || "New highs breakout setup").trim() ||
            "New highs breakout setup",
          stockHref,
          chartHref: chartBase.includes("#chart")
            ? chartBase
            : `${chartBase}#chart`,
        };
      })
      .filter((entry): entry is AthBreakoutEntry => Boolean(entry));

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

export default async function AllTimeHighBreakoutStocksPage() {
  const { updatedAt, entries } = await getAthBreakoutEntries();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "All-Time High Breakout Stocks",
    url: "https://www.mystockharbor.com/all-time-high-breakout-stocks",
    description:
      "Live page showing all-time high breakout stocks from the MyStockHarbor picker feed.",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: entries.slice(0, 24).map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Thing",
          name: `${entry.symbol} all-time high breakout stock`,
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
          name: "All-Time High Breakout Stocks",
          item: "https://www.mystockharbor.com/all-time-high-breakout-stocks",
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

            .ath-breakout-grid {
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
              border: "1px solid rgba(251,146,60,0.22)",
              borderRadius: 22,
              padding: 18,
              background:
                "linear-gradient(135deg, rgba(22,14,8,0.98), rgba(10,12,18,0.98))",
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
                border: "1px solid rgba(251,146,60,0.32)",
                background:
                  "linear-gradient(135deg, rgba(251,146,60,0.16), rgba(249,115,22,0.08))",
                fontSize: 12,
                fontWeight: 950,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#fed7aa",
              }}
            >
              BREAKOUT STOCK SCREENER PAGE
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
              All-Time High Breakout Stocks
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
              This page shows stocks currently screening for all-time high
              breakout setups using live MyStockHarbor picker data. It is built
              for traders who want to review names pushing into fresh highs,
              where strength, momentum, and trend continuation can become more
              important than traditional support-based entries.
            </p>

            <p
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                opacity: 0.78,
                maxWidth: 820,
              }}
            >
              Breakouts to new highs can be powerful, but not every breakout is
              clean or sustainable. Some become strong trend continuation moves,
              while others fail quickly and trap late buyers. Use this page as a
              live shortlist, then inspect price structure, volume, extension,
              and follow-through before making any decision.
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
                  {entries.length} breakout setups
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
            Stocks breaking into all-time highs are often showing strong trend
            conditions, where demand is outweighing supply. With no prior price
            history above, these moves can develop into powerful continuation
            trends if momentum holds.
          </p>

          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            <li>No overhead resistance from previous price levels</li>
            <li>Often driven by strong momentum and trend strength</li>
            <li>Can lead to continuation moves if buyers stay in control</li>
            <li>Still requires confirmation and follow-through</li>
          </ul>

          <p style={{ marginTop: 10 }}>
            The stocks listed below are currently pushing into all-time high
            breakout territory and may be worth reviewing for momentum-based
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
                "linear-gradient(135deg, rgba(251,146,60,0.16), rgba(249,115,22,0.08))",
              border: "1px solid rgba(251,146,60,0.26)",
              color: "#fed7aa",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            LIVE BREAKOUT RESULTS
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 28,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
            }}
          >
            Stocks currently pushing into all-time high breakout territory
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.8,
              maxWidth: 860,
            }}
          >
            Review the current all-time high breakout setups below, then open any
            stock page for more detail or jump straight to the chart.
          </p>

          <div className="ath-breakout-grid" style={{ marginTop: 18 }}>
            {entries.length > 0 ? (
              entries.map((entry) => (
                <article
                  key={`${entry.symbol}-${entry.label}`}
                  style={{
                    border: "1px solid rgba(251,146,60,0.16)",
                    borderRadius: 18,
                    padding: 16,
                    background:
                      "linear-gradient(180deg, rgba(20,12,8,0.96), rgba(6,10,18,0.96))",
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
                          background: "#fb923c",
                          boxShadow: "0 0 12px rgba(251,146,60,0.35)",
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
                        border: "1px solid rgba(251,146,60,0.28)",
                        background:
                          "linear-gradient(135deg, rgba(251,146,60,0.14), rgba(249,115,22,0.08))",
                        color: "#fed7aa",
                        fontWeight: 900,
                        fontSize: 12,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      ATH Breakout
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
                    <li>{entry.label}</li>
                    <li>Review momentum and follow-through before acting</li>
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
                No all-time high breakout results are currently available from the
                live picker feed.
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
                "linear-gradient(135deg, rgba(251,146,60,0.16), rgba(249,115,22,0.08))",
              border: "1px solid rgba(251,146,60,0.26)",
              color: "#fed7aa",
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
            What it means when a stock is breaking to all-time highs
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            Breakouts into all-time highs often attract attention because there is
            no overhead resistance from prior price history. In strong trends,
            that can create room for momentum continuation if buyers keep control.
          </p>

          <p
            style={{
              margin: "10px 0 0",
              lineHeight: 1.7,
              opacity: 0.82,
              maxWidth: 860,
            }}
          >
            That does not mean every breakout is high quality. Some are extended,
            low-conviction, or prone to fast reversals. Traders still need to
            judge structure, volume, acceleration, and whether the breakout is
            clean or already overcrowded.
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
            inspect the chart, and decide whether the breakout has enough quality
            and follow-through to fit your own process.
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
            href="/stocks-down-20-from-all-time-highs"
            style={{
              border: "1px solid rgba(234,179,8,0.22)",
              borderRadius: 16,
              padding: 16,
              background:
                "linear-gradient(180deg, rgba(24,18,8,0.92), rgba(14,10,8,0.96))",
              textDecoration: "none",
              color: "#f1f5f9",
              display: "block",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 950 }}>
              Explore pullback setups
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.65,
                opacity: 0.74,
              }}
            >
              Compare fresh breakout names with stocks trading further below their
              prior all-time highs.
            </div>
          </Link>
        </section>
      </div>
    </main>
  );
}
