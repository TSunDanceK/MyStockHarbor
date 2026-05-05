"use client";

import React, { useEffect, useMemo, useState } from "react";

type PlayTone = "green" | "yellow" | "orange" | "red";

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

  startDate: string;
  endDate: string;

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

function toChartHref(href: string) {
  if (!href) return "/#chart";
  if (href.includes("#chart")) return href;
  return `${href}#chart`;
}

function timeframeLabel(timeframe: "D" | "W") {
  return timeframe === "W" ? "Weekly" : "Daily";
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

      if (data?.error) {
        throw new Error(data.error);
      }

      setSections(Array.isArray(data?.sections) ? data.sections : []);
      setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
      setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
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
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch(`/api/plays?t=${Date.now()}`, {
          cache: "no-store",
        });

        if (!res.ok) throw new Error("Plays API failed");

        const data = (await res.json()) as PlaysPayload;

        if (data?.error) {
          throw new Error(data.error);
        }

        if (!cancelled) {
          setSections(Array.isArray(data?.sections) ? data.sections : []);
          setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
          setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
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
        }
      } catch {
        if (!cancelled) {
          setErr("Failed to load chart plays.");
          setSections([]);
          setUpdatedAt(null);
          setUniverseSize(null);
          setDynamicUniverseCount(null);
          setEstimatedApiCalls(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
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
                maxWidth: 820,
                color: "#f8fafc",
                fontSize: "clamp(34px, 6vw, 64px)",
                lineHeight: 0.98,
                letterSpacing: "-0.06em",
              }}
            >
              Find stock plays from chart structure.
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
                Estimated scan calls: {estimatedApiCalls}. Results are cached briefly to keep
                the page responsive.
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
              <section
                key={section.title}
                style={{
                  marginTop: 26,
                }}
              >
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
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
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

                      <div
                        style={{
                          marginTop: 14,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 9,
                        }}
                      >
                        <Metric label="Resistance" value={`$${formatNumber(item.resistance)}`} />
                        <Metric label="Latest close" value={`$${formatNumber(item.latestClose)}`} />
                        <Metric label="Distance" value={`${formatNumber(item.distanceToResistancePct)}%`} />
                        <Metric label="Pattern bars" value={String(item.patternBars)} />
                        <Metric label="Resistance touches" value={String(item.resistanceTouches)} />
                        <Metric label="Rising lows" value={String(item.risingLowTouches)} />
                      </div>

                      <div
                        style={{
                          marginTop: 12,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          color: "#64748b",
                          fontSize: 12,
                          fontWeight: 800,
                        }}
                      >
                        <span>{formatDate(item.startDate)}</span>
                        <span>to</span>
                        <span>{formatDate(item.endDate)}</span>
                      </div>

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
                        Open chart
                      </a>
                    </article>
                  ))}
                </div>
              </section>
            ))
          : null}

        <section
          style={{
            marginTop: 34,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 24,
            padding: 22,
            background: "rgba(15,23,42,0.58)",
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "#f8fafc",
              fontSize: 24,
              letterSpacing: "-0.03em",
            }}
          >
            How these plays are detected
          </h2>

          <p
            style={{
              margin: "10px 0 0",
              color: "#cbd5e1",
              fontSize: 14,
              lineHeight: 1.75,
              fontWeight: 650,
              maxWidth: 900,
            }}
          >
            Ascending triangle candidates are ranked by repeated resistance touches,
            rising lows, distance to the resistance area, structure age and basic volume
            behaviour. Weekly patterns are treated as higher-quality structures because
            they represent a longer consolidation period.
          </p>
        </section>
      </section>
    </main>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        padding: "9px 10px",
        background: "rgba(255,255,255,0.035)",
      }}
    >
      <div
        style={{
          color: "#64748b",
          fontSize: 11,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          color: "#f8fafc",
          fontSize: 14,
          fontWeight: 950,
        }}
      >
        {value}
      </div>
    </div>
  );
}
