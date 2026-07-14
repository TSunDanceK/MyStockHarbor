"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import ScreenerShell from "@/app/components/ScreenerShell";
import TimeframeFilterDropdown from "@/app/components/TimeframeFilterDropdown";

type PlayTone = "green" | "yellow" | "orange" | "red";

type PlayChartPoint = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type PlayItem = {
  symbol: string;
  play: "descendingTriangle";
  timeframe: "M" | "ST" | "D" | "W";
  score: number;
  tone: PlayTone;
  note: string;

  support: number;
  latestClose: number;
  distanceToSupportPct: number;

  supportTouches: number;
  fallingHighTouches: number;
  patternBars: number;

  supportZonePct: number;
  highSlopePct: number;

  resistanceStartDate: string;
  resistanceStartPrice: number;
  resistanceEndDate: string;
  resistanceEndPrice: number;

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

function timeframeLabel(timeframe: "M" | "ST" | "D" | "W") {
  if (timeframe === "M") return "Macro";
  if (timeframe === "W") return "Weekly";
  if (timeframe === "ST") return "Short-term";
  return "Daily";
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

// Fixed, non-interactive brand watermark right at the top edge of each
// mini play chart. Positioned with CSS against the chart's own fixed-size
// wrapper -- never against the SVG's data-derived coordinates -- so it
// stays put regardless of pattern shape or candle count.
function PlayChartWatermark() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 2,
        pointerEvents: "none",
        userSelect: "none",
        overflow: "hidden",
        zIndex: 2,
      }}
    >
      <span
        style={{
          fontSize: "clamp(9px, 3vw, 13px)",
          fontWeight: 800,
          color: "rgba(148,163,184,0.24)",
          letterSpacing: "0.03em",
          whiteSpace: "nowrap",
        }}
      >
        MyStockHarbor.com
      </span>
    </div>
  );
}

function toChartHref(href: string) {
  if (!href) return "/#chart";
  if (href.includes("#chart")) return href;
  return `${href}#chart`;
}

function useIsNarrowScreen() {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");

    const update = () => {
      setIsNarrow(query.matches);
    };

    update();
    query.addEventListener("change", update);

    return () => {
      query.removeEventListener("change", update);
    };
  }, []);

  return isNarrow;
}

export default function DescendingTrianglesClient() {
  const [sections, setSections] = useState<PlaySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [universeSize, setUniverseSize] = useState<number | null>(null);
  const [dynamicUniverseCount, setDynamicUniverseCount] = useState<number | null>(
    null
  );
  const [estimatedApiCalls, setEstimatedApiCalls] = useState<number | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<
    "ALL" | "M" | "W" | "D" | "ST"
  >("ALL");
  const isNarrow = useIsNarrowScreen();

  async function loadPlays(force = false) {
    const setBusy = force ? setForceRefreshing : setLoading;

    setBusy(true);
    setErr(null);

    try {
      const url = force
        ? `/api/descending-triangles?force=1&t=${Date.now()}`
        : `/api/descending-triangles?t=${Date.now()}`;

      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) throw new Error("Descending triangles API failed");

      const data = (await res.json()) as PlaysPayload;

      if (data?.error) throw new Error(data.error);

      setSections(Array.isArray(data?.sections) ? data.sections : []);
      setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
      setUniverseSize(
        typeof data?.universeSize === "number" ? data.universeSize : null
      );
      setDynamicUniverseCount(
        typeof data?.dynamicUniverseCount === "number"
          ? data.dynamicUniverseCount
          : null
      );
      setEstimatedApiCalls(
        typeof data?.estimatedApiCalls === "number"
          ? data.estimatedApiCalls
          : null
      );
    } catch {
      setErr(
        force
          ? "Force refresh failed."
          : "Failed to load descending triangle plays."
      );

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
    const params = new URLSearchParams(window.location.search);
    const forceInitialLoad = params.get("force") === "1";

    async function runInitialLoad() {
      setLoading(true);
      setForceRefreshing(false);
      setErr(null);

      try {
        const url = forceInitialLoad
          ? `/api/descending-triangles?force=1&t=${Date.now()}`
          : `/api/descending-triangles?t=${Date.now()}`;

        const res = await fetch(url, { cache: "no-store" });

        if (!res.ok) throw new Error("Descending triangles API failed");

        const data = (await res.json()) as PlaysPayload;

        if (data?.error) throw new Error(data.error);

        setSections(Array.isArray(data?.sections) ? data.sections : []);
        setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
        setUniverseSize(
          typeof data?.universeSize === "number" ? data.universeSize : null
        );
        setDynamicUniverseCount(
          typeof data?.dynamicUniverseCount === "number"
            ? data.dynamicUniverseCount
            : null
        );
        setEstimatedApiCalls(
          typeof data?.estimatedApiCalls === "number"
            ? data.estimatedApiCalls
            : null
        );
      } catch {
        setErr("Failed to load descending triangle plays.");
        setSections([]);
        setUpdatedAt(null);
        setUniverseSize(null);
        setDynamicUniverseCount(null);
        setEstimatedApiCalls(null);
      } finally {
        setLoading(false);
      }
    }

    runInitialLoad();
  }, []);

  const safeSections = useMemo(() => {
    return Array.isArray(sections) ? sections : [];
  }, [sections]);

  const filteredSections = useMemo(() => {
    if (selectedTimeframe === "ALL") return safeSections;

    return safeSections
      .map((section) => {
        const items = section.items.filter(
          (item) => item.timeframe === selectedTimeframe
        );

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

  const macroCount = allItems.filter((item) => item.timeframe === "M").length;
  const weeklyCount = allItems.filter((item) => item.timeframe === "W").length;
  const dailyCount = allItems.filter((item) => item.timeframe === "D").length;
  const shortTermCount = allItems.filter(
    (item) => item.timeframe === "ST"
  ).length;
  const topScore = allItems.length
    ? Math.max(...allItems.map((item) => item.score))
    : null;

  return (
    <ScreenerShell
      currentHref="/plays/descending-triangles"
      tone="red"
      eyebrow="Descending triangle screener"
      title="Descending Triangle Stocks"
      description="Stocks holding a flat support while their highs keep falling — daily and weekly descending-triangle candidates from the chart-pattern scanner."
      explainerTitle="How to use descending triangle plays"
      explainerBody="Descending triangles form when price keeps holding a flat support while the highs step lower into it. They often resolve downward, but can also base and reverse — use this as a watchlist of setups to review on the chart yourself, not a signal to act."
      footer={
        <>
          Current scan · Universe {universeSize == null ? "Live" : universeSize}
          {dynamicUniverseCount == null ? "" : ` (+${dynamicUniverseCount} dynamic)`} · Macro {macroCount} · Weekly {weeklyCount} · Daily {dailyCount} · Short-term {shortTermCount} · Top score {topScore == null ? "—" : topScore} · Updated {formatDate(updatedAt)}
        </>
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <TimeframeFilterDropdown
          value={selectedTimeframe}
          onChange={setSelectedTimeframe}
          options={[
            { key: "ALL", label: "All plays" },
            { key: "M", label: "Macro only" },
            { key: "W", label: "Weekly only" },
            { key: "D", label: "Daily only" },
            { key: "ST", label: "Short-term only" },
          ]}
        />

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

      {err ? (
        <div
          style={{
            marginBottom: 14,
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
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 22,
            padding: 22,
            background: "rgba(15,23,42,0.72)",
            color: "#cbd5e1",
            fontWeight: 800,
          }}
        >
          Loading descending triangle plays...
        </div>
      ) : null}

      {!loading && !filteredSections.length ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 22,
            padding: 22,
            background: "rgba(15,23,42,0.72)",
            color: "#cbd5e1",
            fontWeight: 800,
          }}
        >
          No descending triangle plays matched this view.
        </div>
      ) : null}

      {!loading
        ? filteredSections.map((section) => (
            <section key={section.title} style={{ marginTop: 14 }}>
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
                      fontSize: isNarrow ? 23 : 28,
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
                  gridTemplateColumns: isNarrow
                    ? "1fr"
                    : "repeat(auto-fit, minmax(310px, 1fr))",
                  gap: isNarrow ? 12 : 14,
                }}
              >
                {section.items.map((item) => (
                  <article
                    key={`${section.title}-${item.symbol}-${item.timeframe}`}
                    style={{
                      border: "1px solid rgba(255,255,255,0.09)",
                      borderRadius: isNarrow ? 18 : 22,
                      padding: isNarrow ? 13 : 16,
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
                        flexWrap: "wrap",
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
                            color: "#fecaca",
                            fontSize: 13,
                            fontWeight: 900,
                          }}
                        >
                          {timeframeLabel(item.timeframe)} descending triangle
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
                        background: "rgba(185,28,28,0.22)",
                        border: "1px solid rgba(248,113,113,0.42)",
                        color: "#fee2e2",
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
    </ScreenerShell>
  );
}

function MiniPlayChart({ item }: { item: PlayItem }) {
  const isNarrow = useIsNarrowScreen();
  const points = Array.isArray(item.chartPoints) ? item.chartPoints : [];

  if (points.length < 4) {
    return (
      <div
        style={{
          marginTop: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          height: isNarrow ? 132 : 150,
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

  const values = [...lows, ...highs, item.support, item.latestClose].filter(
    (value) => Number.isFinite(value)
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
    return (
      paddingTop + ((yMax - value) / yRange) * (height - paddingTop - paddingBottom)
    );
  }

  const closePath = points
    .map((point, index) => {
      const x = xAt(index);
      const y = yAt(point.close);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const candleSlotWidth = (width - paddingX * 2) / Math.max(1, points.length);
  const candleBodyWidth = Math.max(2.5, Math.min(8, candleSlotWidth * 0.58));

  const supportY = yAt(item.support);

  const volumeValues = points
    .map((point) => (typeof point.volume === "number" ? point.volume : 0))
    .filter((value) => Number.isFinite(value));

  const maxVolume = volumeValues.length ? Math.max(...volumeValues) : 0;
  const volumeBaseY = height - paddingBottom;
  const maxVolumeBarHeight = 34;
  const volumeBarWidth = Math.max(
    1.5,
    (width - paddingX * 2) / points.length - 1
  );

  function highAt(index: number) {
    const point = points[index];
    return typeof point.high === "number" ? point.high : point.close;
  }

  const detectedResistanceStartIndex = points.findIndex(
    (point) => point.date === item.resistanceStartDate
  );

  const detectedResistanceEndIndex = points.findIndex(
    (point) => point.date === item.resistanceEndDate
  );

  const resistanceStartIndex =
    detectedResistanceStartIndex >= 0
      ? detectedResistanceStartIndex
      : Math.max(0, Math.floor(points.length * 0.18));

  const resistancePivotEndIndex =
    detectedResistanceEndIndex > resistanceStartIndex
      ? detectedResistanceEndIndex
      : Math.max(resistanceStartIndex + 1, points.length - 1);

  const resistanceDrawEndIndex = points.length - 1;

  const resistanceStartPrice =
    Number.isFinite(item.resistanceStartPrice)
      ? item.resistanceStartPrice
      : highAt(resistanceStartIndex);

  const resistancePivotEndPrice =
    Number.isFinite(item.resistanceEndPrice)
      ? item.resistanceEndPrice
      : highAt(resistancePivotEndIndex);

  const rawResistanceSlopePerBar =
    (resistancePivotEndPrice - resistanceStartPrice) /
    Math.max(1, resistancePivotEndIndex - resistanceStartIndex);

  const resistanceSlopePerBar =
    rawResistanceSlopePerBar < 0
      ? rawResistanceSlopePerBar
      : -Math.abs(resistanceStartPrice * 0.0015);

  const rawProjectedResistanceEndPrice =
    resistanceStartPrice +
    resistanceSlopePerBar * (resistanceDrawEndIndex - resistanceStartIndex);

  const projectedResistanceEndPrice = Math.max(
    rawProjectedResistanceEndPrice,
    item.support * 1.006
  );

  const resistanceStartY = yAt(resistanceStartPrice);
  const resistanceEndY = yAt(projectedResistanceEndPrice);

  const gradientId = `fill-desc-${item.symbol}-${item.timeframe}`.replace(
    /[^a-zA-Z0-9-_]/g,
    ""
  );

  return (
    <div
      style={{
        marginTop: 14,
        position: "relative",
        border: "1px solid rgba(248,113,113,0.18)",
        borderRadius: 18,
        background:
          "radial-gradient(circle at top right, rgba(248,113,113,0.10), transparent 34%), rgba(2,6,23,0.58)",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${item.symbol} ${timeframeLabel(
          item.timeframe
        )} descending triangle preview`}
        style={{
          display: "block",
          width: "100%",
          height: isNarrow ? 148 : 170,
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(248,113,113,0.22)" />
            <stop offset="100%" stopColor="rgba(248,113,113,0)" />
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
                  fill="rgba(248,113,113,0.20)"
                />
              );
            })
          : null}

        <line
          x1={paddingX}
          x2={width - paddingX}
          y1={supportY}
          y2={supportY}
          stroke="rgba(248,113,113,0.88)"
          strokeWidth="2"
          strokeDasharray="6 5"
        />

        <text
          x={width - paddingX}
          y={Math.min(height - paddingBottom - 8, supportY + 15)}
          textAnchor="end"
          fill="rgba(254,202,202,0.92)"
          fontSize="10"
          fontWeight="800"
        >
          Support ${formatNumber(item.support)}
        </text>

        <line
          x1={xAt(resistanceStartIndex)}
          x2={xAt(resistanceDrawEndIndex)}
          y1={resistanceStartY}
          y2={resistanceEndY}
          stroke="rgba(96,165,250,0.88)"
          strokeWidth="2.2"
        />

        <path
          d={`${closePath} L ${xAt(points.length - 1).toFixed(2)} ${(
            height - paddingBottom
          ).toFixed(2)} L ${paddingX.toFixed(2)} ${(
            height - paddingBottom
          ).toFixed(2)} Z`}
          fill={`url(#${gradientId})`}
        />

        {points.map((point, index) => {
          const previousClose = index > 0 ? points[index - 1].close : point.close;

          const open =
            typeof point.open === "number" && Number.isFinite(point.open)
              ? point.open
              : previousClose;

          const close = point.close;

          const high =
            typeof point.high === "number" && Number.isFinite(point.high)
              ? Math.max(point.high, open, close)
              : Math.max(open, close);

          const low =
            typeof point.low === "number" && Number.isFinite(point.low)
              ? Math.min(point.low, open, close)
              : Math.min(open, close);

          const x = xAt(index);
          const openY = yAt(open);
          const closeY = yAt(close);
          const highY = yAt(high);
          const lowY = yAt(low);

          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(closeY - openY));
          const isUp = close >= open;

          return (
            <g key={`${point.date}-candle`}>
              <line
                x1={x}
                x2={x}
                y1={highY}
                y2={lowY}
                stroke={
                  isUp
                    ? "rgba(226,232,240,0.92)"
                    : "rgba(37,99,235,0.95)"
                }
                strokeWidth="1.1"
                strokeLinecap="round"
              />

              <rect
                x={x - candleBodyWidth / 2}
                y={bodyTop}
                width={candleBodyWidth}
                height={bodyHeight}
                rx="1.5"
                fill={
                  isUp
                    ? "rgba(226,232,240,0.88)"
                    : "rgba(37,99,235,0.92)"
                }
                stroke={
                  isUp
                    ? "rgba(248,250,252,0.95)"
                    : "rgba(96,165,250,0.95)"
                }
                strokeWidth="0.8"
              />
            </g>
          );
        })}

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

      <PlayChartWatermark />

      <div
        style={{
          display: "flex",
          flexDirection: isNarrow ? "column" : "row",
          justifyContent: "space-between",
          gap: isNarrow ? 6 : 10,
          borderTop: "1px solid rgba(255,255,255,0.07)",
          padding: "9px 11px",
          color: "#94a3b8",
          fontSize: 11,
          fontWeight: 900,
        }}
      >
        <span>{item.supportTouches} support touches</span>
        <span>{item.fallingHighTouches} falling highs</span>
        <span>{formatNumber(item.distanceToSupportPct)}% above support</span>
      </div>
    </div>
  );
}
