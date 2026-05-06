"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type PlayTone = "green" | "yellow" | "orange" | "red";

type PlayChartPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type PlayItem = {
  symbol: string;
  play: "ascendingTriangle"; 
  timeframe: "D" | "W";
  score: number;
  tone: PlayTone;
  note: string;

  resistance: number;
  latestClose: number;
  distanceToResistancePct: number;

  resistanceTouches: number;
  risingLowTouches: number;
  patternBars: number;

  resistanceZonePct: number;
  lowSlopePct: number;

  supportStartDate: string;
  supportStartPrice: number;
  supportEndDate: string;
  supportEndPrice: number;

  startDate: string;
  endDate: string;

  chartPoints: PlayChartPoint[];

  dashboardHref: string;
};

type PlaySection = {
  title: string;
  description: string;
  foundCount: number;
  shownCount: number;
  items: PlayItem[];
};

type PlaysPayload = {
  updatedAt?: string;
  universeSize?: number;
  dynamicUniverseCount?: number;
  dynamicUniversePreview?: string[];
  estimatedApiCalls?: number;
  sections?: PlaySection[];
  error?: string;
};

function toneColour(tone?: PlayTone) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  return "rgba(255,255,255,0.35)";
}

function toneBackground(tone?: PlayTone) {
  if (tone === "green") return "rgba(34,197,94,0.12)";
  if (tone === "yellow") return "rgba(234,179,8,0.12)";
  if (tone === "orange") return "rgba(251,146,60,0.12)";
  if (tone === "red") return "rgba(239,68,68,0.12)";
  return "rgba(255,255,255,0.05)";
}

function setupLabel(score: number) {
  if (score >= 80) return "A+ setup";
  if (score >= 70) return "Strong setup";
  if (score >= 60) return "Developing setup";
  return "Loose setup";
}

function timeframeLabel(timeframe: "D" | "W") {
  return timeframe === "W" ? "Weekly" : "Daily";
}

function formatDate(value?: string | null) {
  if (!value) return "—";

  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

const topNavIconWrapStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
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
      background:
        "linear-gradient(135deg, rgba(250,204,21,0.20), rgba(202,138,4,0.10))",
      color: "#fefce8",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
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
      border: "1px solid rgba(248,113,113,0.45)",
      background:
        "linear-gradient(135deg, rgba(248,113,113,0.20), rgba(185,28,28,0.10))",
      color: "#fef2f2",
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 14,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
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
  };
}

function topNavIcon(type: "dashboard" | "platforms" | "pickers" | "calculators") {
  if (type === "dashboard") return "📈";
  if (type === "platforms") return "🏦";
  if (type === "pickers") return "📊";
  return "🧮";
}

function toChartHref(href: string) {
  if (!href) return "/#chart";
  if (href.includes("#chart")) return href;
  return `${href}#chart`;
}

export default function PlaysClient() {
  const [sections, setSections] = useState<PlaySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [universeSize, setUniverseSize] = useState<number | null>(null);
  const [dynamicUniverseCount, setDynamicUniverseCount] = useState<number | null>(null);
  const [estimatedApiCalls, setEstimatedApiCalls] = useState<number | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<"ALL" | "W" | "D">("ALL");

  async function loadPlays(force = false) {
    const setBusy = force ? setForceRefreshing : setLoading;

    setBusy(true);
    setErr(null);

    try {
const url = force
  ? `/api/plays?force=1&t=${Date.now()}`
  : `/api/plays?t=${Date.now()}`;

      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) throw new Error("Plays API failed");

      const data = (await res.json()) as PlaysPayload;

      if (data?.error) throw new Error(data.error);

      setSections(Array.isArray(data?.sections) ? data.sections : []);
      setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
      setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
      setDynamicUniverseCount(
        typeof data?.dynamicUniverseCount === "number"
          ? data.dynamicUniverseCount
          : null
      );
      setEstimatedApiCalls(
        typeof data?.estimatedApiCalls === "number" ? data.estimatedApiCalls : null
      );
    } catch {
      setErr(force ? "Force refresh failed." : "Failed to load chart plays.");

      if (!force) {
        setSections([]);
        setUpdatedAt(null);
        setUniverseSize(null);
        setDynamicUniverseCount(null);
        setEstimatedApiCalls(null);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadPlays(false);
  }, []);

  const safeSections = useMemo(() => {
    return Array.isArray(sections) ? sections : [];
  }, [sections]);

  const filteredSections = useMemo(() => {
    if (selectedTimeframe === "ALL") return safeSections;

    return safeSections
      .map((section) => {
        const items = section.items.filter((item) => item.timeframe === selectedTimeframe);

        return {
          ...section,
          shownCount: items.length,
          items,
        };
      })
      .filter((section) => section.items.length > 0);
  }, [safeSections, selectedTimeframe]);

  const allItems = useMemo(() => {
    const seen = new Set<string>();
    const out: PlayItem[] = [];

    for (const section of safeSections) {
      for (const item of section.items) {
        const key = `${item.symbol}-${item.timeframe}`;
        if (seen.has(key)) continue;

        seen.add(key);
        out.push(item);
      }
    }

    return out;
  }, [safeSections]);

  const weeklyCount = allItems.filter((item) => item.timeframe === "W").length;
  const dailyCount = allItems.filter((item) => item.timeframe === "D").length;
  const topScore = allItems.length ? Math.max(...allItems.map((item) => item.score)) : null;

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 34%), radial-gradient(circle at top right, rgba(34,197,94,0.12), transparent 32%), #020617",
        color: "#e5e7eb",
        padding: "34px 18px 56px",
      }}
    >
      <section
        style={{
          maxWidth: 1180,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 11px",
              borderRadius: 999,
              border: "1px solid rgba(96,165,250,0.35)",
              background: "rgba(15,23,42,0.76)",
              color: "#bfdbfe",
              fontSize: 12,
              fontWeight: 900,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Chart Pattern Plays
          </div>

          <nav
            aria-label="Primary navigation"
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
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

            <Link href="/pickers" style={topNavBtnStyle("pickers")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("pickers")}
              </span>
              <span>Pickers</span>
            </Link>

            <Link href="/utilities" style={topNavBtnStyle("calculators")}>
              <span aria-hidden="true" style={topNavIconWrapStyle}>
                {topNavIcon("calculators")}
              </span>
              <span>Calculators</span>
            </Link>
          </nav>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.35fr) minmax(260px, 0.65fr)",
            gap: 18,
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 26,
              padding: 24,
              background:
                "linear-gradient(180deg, rgba(15,23,42,0.88), rgba(2,6,23,0.94))",
              boxShadow: "0 20px 55px rgba(0,0,0,0.32)",
            }}
          >
            <h1
              style={{
                margin: 0,
                maxWidth: 860,
                color: "#f8fafc",
                fontSize: "clamp(34px, 6vw, 64px)",
                lineHeight: 0.98,
                letterSpacing: "-0.06em",
              }}
            >
              Find active ascending triangle stock setups.
            </h1>

            <p
              style={{
                margin: "18px 0 0",
                maxWidth: 760,
                color: "#cbd5e1",
                fontSize: 16,
                lineHeight: 1.75,
                fontWeight: 650,
              }}
            >
              MyStockHarbor scans the current market universe for ascending triangle
              candidates using daily and weekly price structure. These are chart-pattern
              candidates to review, not trade recommendations.
            </p>

            <div
              style={{
                marginTop: 20,
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {(["ALL", "W", "D"] as const).map((key) => {
                const active = selectedTimeframe === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedTimeframe(key)}
                    style={{
                      border: active
                        ? "1px solid rgba(96,165,250,0.72)"
                        : "1px solid rgba(255,255,255,0.10)",
                      background: active
                        ? "rgba(37,99,235,0.28)"
                        : "rgba(255,255,255,0.04)",
                      color: active ? "#dbeafe" : "#cbd5e1",
                      borderRadius: 999,
                      padding: "9px 13px",
                      fontSize: 13,
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    {key === "ALL" ? "All plays" : key === "W" ? "Weekly only" : "Daily only"}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => loadPlays(true)}
                disabled={forceRefreshing || loading}
                style={{
                  border: "1px solid rgba(34,197,94,0.42)",
                  background: "rgba(34,197,94,0.11)",
                  color: "#bbf7d0",
                  borderRadius: 999,
                  padding: "9px 13px",
                  fontSize: 13,
                  fontWeight: 900,
                  cursor: forceRefreshing || loading ? "not-allowed" : "pointer",
                  opacity: forceRefreshing || loading ? 0.6 : 1,
                }}
              >
                {forceRefreshing ? "Refreshing..." : "Refresh plays"}
              </button>
            </div>
          </div>

          <aside
            style={{
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 26,
              padding: 20,
              background:
                "linear-gradient(180deg, rgba(8,13,24,0.92), rgba(2,6,23,0.96))",
              boxShadow: "0 20px 55px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                color: "#94a3b8",
                fontSize: 12,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Current scan
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gap: 10,
              }}
            >
              <StatRow label="Universe" value={universeSize == null ? "—" : String(universeSize)} />
              <StatRow label="Dynamic names" value={dynamicUniverseCount == null ? "—" : String(dynamicUniverseCount)} />
              <StatRow label="Weekly shown" value={String(weeklyCount)} />
              <StatRow label="Daily shown" value={String(dailyCount)} />
              <StatRow label="Top score" value={topScore == null ? "—" : String(topScore)} />
              <StatRow label="Updated" value={formatDate(updatedAt)} />
            </div>
<div
  style={{
    marginTop: 14,
    color: "#64748b",
    fontSize: 12,
    lineHeight: 1.45,
    fontWeight: 700,
    textAlign: "right",
  }}
>
  <div>{updatedAt ? formatDate(updatedAt) : "—"}</div>
  <div>Universe: {universeSize == null ? "—" : universeSize}</div>
  <div>Dynamic: {dynamicUniverseCount == null ? "—" : dynamicUniverseCount}</div>
  <div>Estimated: {estimatedApiCalls == null ? "—" : estimatedApiCalls}</div>
</div>
            {estimatedApiCalls == null ? null : (
              <p
                style={{
                  margin: "14px 0 0",
                  color: "#64748b",
                  fontSize: 12,
                  lineHeight: 1.5,
                  fontWeight: 700,
                }}
              >
Estimated scan calls: {estimatedApiCalls}. Normal loads use cache; Refresh plays forces a fresh scan.
              </p>
            )}
          </aside>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 18,
              border: "1px solid rgba(239,68,68,0.28)",
              borderRadius: 18,
              padding: 16,
              background: "rgba(127,29,29,0.24)",
              color: "#fecaca",
              fontWeight: 800,
            }}
          >
            {err}
          </div>
        ) : null}

        {loading ? (
          <div
            style={{
              marginTop: 22,
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 22,
              padding: 22,
              background: "rgba(15,23,42,0.72)",
              color: "#cbd5e1",
              fontWeight: 800,
            }}
          >
            Loading chart-pattern plays...
          </div>
        ) : null}

        {!loading && !filteredSections.length ? (
          <div
            style={{
              marginTop: 22,
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 22,
              padding: 22,
              background: "rgba(15,23,42,0.72)",
              color: "#cbd5e1",
              fontWeight: 800,
            }}
          >
            No ascending triangle plays matched this view.
          </div>
        ) : null}

        {!loading
          ? filteredSections.map((section) => (
              <section key={section.title} style={{ marginTop: 26 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 14,
                    alignItems: "end",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h2
                      style={{
                        margin: 0,
                        color: "#f8fafc",
                        fontSize: 28,
                        letterSpacing: "-0.04em",
                      }}
                    >
                      {section.title}
                    </h2>
                    <p
                      style={{
                        margin: "8px 0 0",
                        maxWidth: 760,
                        color: "#94a3b8",
                        fontSize: 14,
                        lineHeight: 1.6,
                        fontWeight: 650,
                      }}
                    >
                      {section.description}
                    </p>
                  </div>

                  <div
                    style={{
                      color: "#cbd5e1",
                      fontSize: 13,
                      fontWeight: 900,
                      padding: "8px 11px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.04)",
                    }}
                  >
                    Showing {section.shownCount} of {section.foundCount}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 14,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
                    gap: 14,
                  }}
                >
                  {section.items.map((item) => (
                    <article
                      key={`${section.title}-${item.symbol}-${item.timeframe}`}
                      style={{
                        border: "1px solid rgba(255,255,255,0.09)",
                        borderRadius: 22,
                        padding: 16,
                        background:
                          "linear-gradient(180deg, rgba(15,23,42,0.86), rgba(2,6,23,0.94))",
                        boxShadow: "0 16px 36px rgba(0,0,0,0.22)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "start",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <span
                              style={{
                                width: 9,
                                height: 9,
                                borderRadius: "50%",
                                background: toneColour(item.tone),
                                boxShadow: `0 0 18px ${toneColour(item.tone)}`,
                              }}
                            />
                            <h3
                              style={{
                                margin: 0,
                                color: "#f8fafc",
                                fontSize: 24,
                                letterSpacing: "-0.04em",
                              }}
                            >
                              {item.symbol}
                            </h3>
                          </div>

                          <div
                            style={{
                              marginTop: 6,
                              color: "#93c5fd",
                              fontSize: 13,
                              fontWeight: 900,
                            }}
                          >
                            {timeframeLabel(item.timeframe)} ascending triangle
                          </div>
                        </div>

                        <div
                          style={{
                            textAlign: "right",
                            padding: "8px 10px",
                            borderRadius: 14,
                            background: toneBackground(item.tone),
                            border: `1px solid ${toneColour(item.tone)}55`,
                          }}
                        >
                          <div
                            style={{
                              color: "#f8fafc",
                              fontSize: 20,
                              fontWeight: 950,
                              lineHeight: 1,
                            }}
                          >
                            {item.score}
                          </div>
                          <div
                            style={{
                              marginTop: 3,
                              color: "#cbd5e1",
                              fontSize: 11,
                              fontWeight: 900,
                            }}
                          >
                            {setupLabel(item.score)}
                          </div>
                        </div>
                      </div>

                      <MiniPlayChart item={item} />

                      <p
                        style={{
                          margin: "12px 0 0",
                          color: "#cbd5e1",
                          fontSize: 13,
                          lineHeight: 1.55,
                          fontWeight: 650,
                        }}
                      >
                        {item.note}
                      </p>

                      <a
                        href={toChartHref(item.dashboardHref)}
                        style={{
                          marginTop: 14,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          textDecoration: "none",
                          borderRadius: 14,
                          padding: "11px 12px",
                          background: "rgba(37,99,235,0.24)",
                          border: "1px solid rgba(96,165,250,0.42)",
                          color: "#dbeafe",
                          fontSize: 13,
                          fontWeight: 950,
                        }}
                      >
                        Open full chart
                      </a>
                    </article>
                  ))}
                </div>
              </section>
            ))
          : null}
      </section>
    </main>
  );
}

function MiniPlayChart({ item }: { item: PlayItem }) {
  const points = Array.isArray(item.chartPoints) ? item.chartPoints : [];

  if (points.length < 4) {
    return (
      <div
        style={{
          marginTop: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          height: 150,
          background: "rgba(2,6,23,0.54)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#64748b",
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        Chart preview unavailable
      </div>
    );
  }

  const width = 420;
  const height = 170;
  const paddingX = 18;
  const paddingTop = 18;
  const paddingBottom = 24;

  const lows = points.map((point) =>
    typeof point.low === "number" ? point.low : point.close
  );

  const highs = points.map((point) =>
    typeof point.high === "number" ? point.high : point.close
  );

  const values = [...lows, ...highs, item.resistance, item.latestClose].filter((value) =>
    Number.isFinite(value)
  );

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const buffer = range * 0.12;

  const yMin = minValue - buffer;
  const yMax = maxValue + buffer;
  const yRange = yMax - yMin || 1;

  function xAt(index: number) {
    if (points.length <= 1) return paddingX;
    return paddingX + (index / (points.length - 1)) * (width - paddingX * 2);
  }

  function yAt(value: number) {
    return paddingTop + ((yMax - value) / yRange) * (height - paddingTop - paddingBottom);
  }

  const closePath = points
    .map((point, index) => {
      const x = xAt(index);
      const y = yAt(point.close);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const resistanceY = yAt(item.resistance);

  const volumeValues = points
    .map((point) => (typeof point.volume === "number" ? point.volume : 0))
    .filter((value) => Number.isFinite(value));

  const maxVolume = volumeValues.length ? Math.max(...volumeValues) : 0;
  const volumeBaseY = height - paddingBottom;
  const maxVolumeBarHeight = 34;
  const volumeBarWidth = Math.max(1.5, (width - paddingX * 2) / points.length - 1);

  const detectedSupportStartIndex = points.findIndex(
    (point) => point.date === item.supportStartDate
  );

  const supportStartIndex =
    detectedSupportStartIndex >= 0
      ? detectedSupportStartIndex
      : Math.max(0, Math.floor(points.length * 0.12));

  const supportEndIndex = points.length - 1;

  const supportStartPrice =
    Number.isFinite(item.supportStartPrice)
      ? item.supportStartPrice
      : item.latestClose;

  const supportEndPrice =
    item.latestClose > supportStartPrice
      ? item.latestClose
      : Math.max(item.latestClose, item.supportEndPrice, supportStartPrice);

const supportStartY = yAt(supportStartPrice);
const supportEndY = yAt(supportEndPrice);

const latestX = xAt(points.length - 1);
const latestY = yAt(item.latestClose);

const gradientId = `fill-${item.symbol}-${item.timeframe}`.replace(/[^a-zA-Z0-9-_]/g, "");

  return (
    <div
      style={{
        marginTop: 14,
        border: "1px solid rgba(96,165,250,0.18)",
        borderRadius: 18,
        background:
          "radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 34%), rgba(2,6,23,0.58)",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${item.symbol} ${timeframeLabel(item.timeframe)} ascending triangle preview`}
        style={{
          display: "block",
          width: "100%",
          height: 170,
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(96,165,250,0.22)" />
            <stop offset="100%" stopColor="rgba(96,165,250,0)" />
          </linearGradient>
        </defs>

        {maxVolume > 0
          ? points.map((point, index) => {
              const volume =
                typeof point.volume === "number" && Number.isFinite(point.volume)
                  ? point.volume
                  : 0;

              const barHeight = (volume / maxVolume) * maxVolumeBarHeight;
              const x = xAt(index) - volumeBarWidth / 2;
              const y = volumeBaseY - barHeight;

              return (
                <rect
                  key={`${point.date}-volume`}
                  x={x}
                  y={y}
                  width={volumeBarWidth}
                  height={barHeight}
                  rx="1"
                  fill="rgba(96,165,250,0.22)"
                />
              );
            })
          : null}

        <line
          x1={paddingX}
          x2={width - paddingX}
          y1={resistanceY}
          y2={resistanceY}
          stroke="rgba(34,197,94,0.88)"
          strokeWidth="2"
          strokeDasharray="6 5"
        />

        <text
          x={width - paddingX}
          y={Math.max(12, resistanceY - 7)}
          textAnchor="end"
          fill="rgba(187,247,208,0.92)"
          fontSize="10"
          fontWeight="800"
        >
          Resistance ${formatNumber(item.resistance)}
        </text>

        <line
          x1={xAt(supportStartIndex)}
          x2={xAt(supportEndIndex)}
          y1={supportStartY}
          y2={supportEndY}
          stroke="rgba(96,165,250,0.88)"
          strokeWidth="2.2"
        />

        <path
          d={`${closePath} L ${xAt(points.length - 1).toFixed(2)} ${(height - paddingBottom).toFixed(2)} L ${paddingX.toFixed(2)} ${(height - paddingBottom).toFixed(2)} Z`}
          fill={`url(#${gradientId})`}
        />

        <path
          d={closePath}
          fill="none"
          stroke="rgba(226,232,240,0.92)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <circle
          cx={latestX}
          cy={latestY}
          r="4.5"
          fill={toneColour(item.tone)}
          stroke="rgba(2,6,23,0.95)"
          strokeWidth="2"
        />

        <text
          x={paddingX}
          y={height - 8}
          fill="rgba(148,163,184,0.88)"
          fontSize="10"
          fontWeight="800"
        >
          {formatDate(points[0]?.date)}
        </text>

        <text
          x={width - paddingX}
          y={height - 8}
          textAnchor="end"
          fill="rgba(148,163,184,0.88)"
          fontSize="10"
          fontWeight="800"
        >
          {formatDate(points[points.length - 1]?.date)}
        </text>
      </svg>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          borderTop: "1px solid rgba(255,255,255,0.07)",
          padding: "9px 11px",
          color: "#94a3b8",
          fontSize: 11,
          fontWeight: 900,
        }}
      >
        <span>{item.resistanceTouches} resistance touches</span>
        <span>{item.risingLowTouches} rising lows</span>
        <span>{formatNumber(item.distanceToResistancePct)}% to level</span>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "center",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        paddingBottom: 9,
      }}
    >
      <span
        style={{
          color: "#94a3b8",
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "#f8fafc",
          fontSize: 13,
          fontWeight: 950,
        }}
      >
        {value}
      </span>
    </div>
  );
}
