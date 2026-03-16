"use client";

import React, { useEffect, useMemo, useState } from "react";

type PickerTone = "green" | "yellow" | "orange" | "red";

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
};

type PickerSection = {
  title: string;
  description?: string;
  items: PickerItem[];
};

type SignalRecord = {
  symbol: string;
  note?: string;
  tone?: PickerTone;

  oversold: boolean;
  overbought: boolean;
  buyTheDip: boolean;
  breakout: boolean;
  volumeSpike: boolean;
  atrSpike: boolean;
  aboveMA50: boolean;
  belowMA50: boolean;
  aboveMA200: boolean;
  belowMA200: boolean;

  bullishRsiDivergence: boolean;
  bearishRsiDivergence: boolean;
  bullishMacdDivergence: boolean;
  bearishMacdDivergence: boolean;
};

type PickersPayload = {
  updatedAt?: string;
  universeSize?: number;
  dynamicUniverseCount?: number;
  dynamicUniversePreview?: string[];
  estimatedApiCalls?: number;
  sections?: PickerSection[];
  signalRecords?: SignalRecord[];
};

type FilterKey =
  | "oversold"
  | "overbought"
  | "buyTheDip"
  | "breakout"
  | "volumeSpike"
  | "atrSpike"
  | "aboveMA50"
  | "belowMA50"
  | "aboveMA200"
  | "belowMA200"
  | "bullishRsiDivergence"
  | "bearishRsiDivergence"
  | "bullishMacdDivergence"
  | "bearishMacdDivergence";

type FilterDef = {
  key: FilterKey;
  label: string;
  tone: PickerTone;
};

const FILTER_DEFS: FilterDef[] = [
  { key: "oversold", label: "Oversold", tone: "green" },
  { key: "overbought", label: "Overbought", tone: "red" },
  { key: "buyTheDip", label: "20%+ From Recent ATH", tone: "yellow" },
  { key: "breakout", label: "Breakout", tone: "orange" },
  { key: "volumeSpike", label: "Volume Spike", tone: "orange" },
  { key: "atrSpike", label: "ATR Spike", tone: "orange" },
  { key: "aboveMA50", label: "Above MA50", tone: "yellow" },
  { key: "belowMA50", label: "Below MA50", tone: "yellow" },
  { key: "aboveMA200", label: "Above MA200", tone: "yellow" },
  { key: "belowMA200", label: "Below MA200", tone: "yellow" },
  { key: "bullishRsiDivergence", label: "Bullish RSI Divergence", tone: "green" },
  { key: "bearishRsiDivergence", label: "Bearish RSI Divergence", tone: "red" },
  { key: "bullishMacdDivergence", label: "Bullish MACD Divergence", tone: "green" },
  { key: "bearishMacdDivergence", label: "Bearish MACD Divergence", tone: "red" },
];

function toneDot(tone?: string) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  return "rgba(255,255,255,0.35)";
}

function getFilterLabel(key: FilterKey) {
  return FILTER_DEFS.find((f) => f.key === key)?.label ?? key;
}

function matchedSignalsForRecord(record: SignalRecord): FilterKey[] {
  const out: FilterKey[] = [];

  if (record.oversold) out.push("oversold");
  if (record.overbought) out.push("overbought");
  if (record.buyTheDip) out.push("buyTheDip");
  if (record.breakout) out.push("breakout");
  if (record.volumeSpike) out.push("volumeSpike");
  if (record.atrSpike) out.push("atrSpike");
  if (record.aboveMA50) out.push("aboveMA50");
  if (record.belowMA50) out.push("belowMA50");
  if (record.aboveMA200) out.push("aboveMA200");
  if (record.belowMA200) out.push("belowMA200");
  if (record.bullishRsiDivergence) out.push("bullishRsiDivergence");
  if (record.bearishRsiDivergence) out.push("bearishRsiDivergence");
  if (record.bullishMacdDivergence) out.push("bullishMacdDivergence");
  if (record.bearishMacdDivergence) out.push("bearishMacdDivergence");

  return out;
}

function chooseCardTone(record: SignalRecord, matchedFilters: FilterKey[]): PickerTone | undefined {
  for (const key of matchedFilters) {
    const def = FILTER_DEFS.find((f) => f.key === key);
    if (!def) continue;
    if (def.tone === "green") return "green";
  }

  for (const key of matchedFilters) {
    const def = FILTER_DEFS.find((f) => f.key === key);
    if (!def) continue;
    if (def.tone === "red") return "red";
  }

  for (const key of matchedFilters) {
    const def = FILTER_DEFS.find((f) => f.key === key);
    if (!def) continue;
    if (def.tone === "orange") return "orange";
  }

  return record.tone;
}

export default function PickersClient() {
  const [sections, setSections] = useState<PickerSection[]>([]);
  const [signalRecords, setSignalRecords] = useState<SignalRecord[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<FilterKey[]>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [universeSize, setUniverseSize] = useState<number | null>(null);
  const [dynamicUniverseCount, setDynamicUniverseCount] = useState<number | null>(null);
  const [dynamicUniversePreview, setDynamicUniversePreview] = useState<string[] | null>(null);
  const [estimatedApiCalls, setEstimatedApiCalls] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch("/api/pickers", { cache: "no-store" });
        if (!res.ok) throw new Error("Pickers API failed");

        const data = (await res.json()) as PickersPayload;
        const safeSections = Array.isArray(data?.sections) ? data.sections : [];
        const safeSignalRecords = Array.isArray(data?.signalRecords) ? data.signalRecords : [];

        if (!cancelled) {
          setSections(safeSections);
          setSignalRecords(safeSignalRecords);
          setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
          setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
          setDynamicUniverseCount(
            typeof data?.dynamicUniverseCount === "number" ? data.dynamicUniverseCount : null
          );
          setDynamicUniversePreview(
            Array.isArray(data?.dynamicUniversePreview) ? data.dynamicUniversePreview : null
          );
          setEstimatedApiCalls(
            typeof data?.estimatedApiCalls === "number" ? data.estimatedApiCalls : null
          );
        }
      } catch {
        if (!cancelled) {
          setErr("Failed to load stock ideas.");
          setSections([]);
          setSignalRecords([]);
          setUpdatedAt(null);
          setUniverseSize(null);
          setDynamicUniverseCount(null);
          setDynamicUniversePreview(null);
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

  const safeSignalRecords = useMemo(() => {
    return Array.isArray(signalRecords) ? signalRecords : [];
  }, [signalRecords]);

  const customMode = selectedFilters.length > 0;

  const customMatches = useMemo(() => {
    if (!customMode) return [];

    return safeSignalRecords
      .filter((record) => selectedFilters.every((filter) => record[filter] === true))
      .map((record) => {
        const matchedSignals = matchedSignalsForRecord(record).filter((key) => selectedFilters.includes(key));

        return {
          ...record,
          matchedSignals,
          displayTone: chooseCardTone(record, matchedSignals),
        };
      })
      .sort((a, b) => {
        const aCount = a.matchedSignals.length;
        const bCount = b.matchedSignals.length;
        if (bCount !== aCount) return bCount - aCount;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [customMode, safeSignalRecords, selectedFilters]);

  function toggleFilter(key: FilterKey) {
    setSelectedFilters((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  }

  function clearFilters() {
    setSelectedFilters([]);
  }

  return (
    <section aria-label="Live stock idea results">
      {loading ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 18,
            padding: 18,
            background: "#0b1220",
            maxWidth: 980,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 950, letterSpacing: "-0.2px" }}>
            We are gathering stocks for you, please wait…
          </div>
          <div style={{ marginTop: 8, opacity: 0.75 }}>
            First load can take around 10–15 seconds. Cached loads are usually much faster.
          </div>

          <div
            style={{
              marginTop: 14,
              width: 420,
              maxWidth: "100%",
              height: 10,
              borderRadius: 999,
              overflow: "hidden",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.16)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: "35%",
                borderRadius: 999,
                background: "rgba(59,130,246,0.95)",
                animation: "pickersBar 1.1s linear infinite",
              }}
            />
          </div>

          <style>{`
            @keyframes pickersBar {
              0% { transform: translateX(-60%); opacity: 0.55; }
              50% { transform: translateX(140%); opacity: 0.95; }
              100% { transform: translateX(320%); opacity: 0.55; }
            }
          `}</style>
        </div>
      ) : null}

      {err ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.18)",
            borderRadius: 16,
            padding: 16,
            background: "rgba(239,68,68,0.08)",
            color: "#fecaca",
            maxWidth: 980,
          }}
        >
          {err}
        </div>
      ) : null}

      {!loading && !err ? (
        <section
          style={{
            border: "1px solid rgba(59,130,246,0.24)",
            borderRadius: 18,
            padding: 16,
            background: "linear-gradient(180deg, rgba(11,18,32,1), rgba(8,12,22,1))",
            maxWidth: 980,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "7px 12px",
                  borderRadius: 999,
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                  border: "1px solid rgba(59,130,246,0.28)",
                  color: "#dbeafe",
                  fontWeight: 950,
                  letterSpacing: "0.08em",
                  fontSize: 12,
                  textTransform: "uppercase",
                }}
              >
                Custom Screener
              </div>

              <h3
                style={{
                  margin: "12px 0 0 0",
                  fontSize: 24,
                  lineHeight: 1.1,
                  letterSpacing: "-0.03em",
                }}
              >
                Build your own stock setup
              </h3>

              <p
                style={{
                  margin: "8px 0 0 0",
                  fontSize: 14,
                  lineHeight: 1.65,
                  opacity: 0.76,
                  maxWidth: 760,
                }}
              >
                Choose multiple technical conditions and we will only show stocks matching all
                selected filters.
              </p>
            </div>

            {customMode ? (
              <button
                type="button"
                onClick={clearFilters}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#f1f5f9",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Clear Custom Filters
              </button>
            ) : null}
          </div>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 10,
            }}
          >
            {FILTER_DEFS.map((filter) => {
              const active = selectedFilters.includes(filter.key);

              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => toggleFilter(filter.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: active
                      ? `1px solid ${toneDot(filter.tone)}`
                      : "1px solid rgba(255,255,255,0.14)",
                    background: active
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(255,255,255,0.04)",
                    color: "#f1f5f9",
                    textAlign: "left",
                    fontWeight: 850,
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: toneDot(filter.tone),
                      flex: "0 0 auto",
                    }}
                  />
                  <span>{filter.label}</span>
                </button>
              );
            })}
          </div>

          {customMode ? (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Active Custom Setup
              </div>

              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {selectedFilters.map((filter) => {
                  const def = FILTER_DEFS.find((f) => f.key === filter);

                  return (
                    <span
                      key={filter}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(255,255,255,0.06)",
                        fontSize: 12,
                        fontWeight: 900,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: toneDot(def?.tone),
                        }}
                      />
                      {getFilterLabel(filter)}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div
        style={{
          marginTop: loading || err ? 20 : 0,
          display: "grid",
          gap: 16,
          maxWidth: 980,
        }}
      >
        {customMode ? (
          <section
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 16,
              padding: 16,
              background: "#0b1220",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 950,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Custom Screener Results
                </h2>
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 14,
                    opacity: 0.72,
                    lineHeight: 1.6,
                  }}
                >
                  Showing only stocks matching all selected filters.
                </p>
              </div>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {customMatches.length} {customMatches.length === 1 ? "match" : "matches"}
              </div>
            </div>

            {customMatches.length ? (
              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 12,
                }}
              >
                {customMatches.map((item) => (
                  <a
                    key={item.symbol}
                    href={`/?symbol=${encodeURIComponent(item.symbol)}`}
                    style={{
                      display: "block",
                      textDecoration: "none",
                      color: "#f1f5f9",
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 16,
                      padding: 14,
                      background: "rgba(255,255,255,0.04)",
                    }}
                    title={item.note ?? "Open in dashboard"}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        alignItems: "flex-start",
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
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: toneDot(item.displayTone),
                              boxShadow: "0 0 0 3px rgba(255,255,255,0.04)",
                              flex: "0 0 auto",
                            }}
                          />
                          <div style={{ fontSize: 20, fontWeight: 950 }}>{item.symbol}</div>
                        </div>

                        {item.note ? (
                          <div
                            style={{
                              marginTop: 8,
                              fontSize: 13,
                              lineHeight: 1.55,
                              opacity: 0.72,
                            }}
                          >
                            {item.note}
                          </div>
                        ) : null}
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          opacity: 0.72,
                          fontWeight: 800,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Open chart →
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {item.matchedSignals.map((signal) => {
                        const def = FILTER_DEFS.find((f) => f.key === signal);

                        return (
                          <span
                            key={`${item.symbol}-${signal}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "7px 9px",
                              borderRadius: 999,
                              border: "1px solid rgba(255,255,255,0.12)",
                              background: "rgba(255,255,255,0.05)",
                              fontSize: 11,
                              fontWeight: 900,
                            }}
                          >
                            <span
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 999,
                                background: toneDot(def?.tone),
                              }}
                            />
                            {getFilterLabel(signal)}
                          </span>
                        );
                      })}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div
                style={{
                  marginTop: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 14,
                  padding: 16,
                  background: "rgba(255,255,255,0.04)",
                  lineHeight: 1.6,
                  opacity: 0.82,
                }}
              >
                No stocks currently match all selected filters. Try removing one condition or using a broader setup.
              </div>
            )}
          </section>
        ) : (
          safeSections.map((sec) => {
            const items = Array.isArray(sec.items) ? sec.items : [];

            return (
              <section
                key={sec.title}
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 16,
                  padding: 16,
                  background: "#0b1220",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 22,
                        fontWeight: 950,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {sec.title}
                    </h2>
                    {sec.description ? (
                      <p
                        style={{
                          margin: "8px 0 0",
                          fontSize: 14,
                          opacity: 0.72,
                          lineHeight: 1.6,
                        }}
                      >
                        {sec.description}
                      </p>
                    ) : null}
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {items.length ? `${items.length} stocks` : "No matches yet"}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  {items.map((it) => (
                    <a
                      key={it.symbol}
                      href={`/?symbol=${encodeURIComponent(it.symbol)}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 12px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(255,255,255,0.06)",
                        color: "#f1f5f9",
                        textDecoration: "none",
                        fontWeight: 900,
                      }}
                      title={it.note ?? "Open in dashboard"}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: toneDot(it.tone),
                          boxShadow: "0 0 0 3px rgba(255,255,255,0.04)",
                          flex: "0 0 auto",
                        }}
                      />
                      <span>{it.symbol}</span>
                      {it.note ? (
                        <span
                          style={{
                            fontSize: 12,
                            opacity: 0.65,
                            fontWeight: 700,
                          }}
                        >
                          {it.note}
                        </span>
                      ) : null}
                    </a>
                  ))}
                </div>
              </section>
            );
          })
        )}

        {!loading &&
        !err &&
        (updatedAt || universeSize || dynamicUniverseCount || dynamicUniversePreview || estimatedApiCalls) ? (
          <div
            style={{
              marginTop: 4,
              paddingTop: 6,
              fontSize: 11,
              lineHeight: 1.6,
              opacity: 0.48,
              textAlign: "right",
            }}
          >
            {updatedAt ? (
              <div>
                Last picker refresh: {new Date(updatedAt).toLocaleString()}
              </div>
            ) : null}
            {universeSize != null ? <div>Universe scanned: {universeSize} stocks</div> : null}
            {dynamicUniverseCount != null ? (
              <div>Dynamic symbols detected: {dynamicUniverseCount}</div>
            ) : null}
            {dynamicUniversePreview ? (
              <div style={{ opacity: 0.7 }}>
                Dynamic preview: {dynamicUniversePreview.join(", ")}
              </div>
            ) : null}
            {estimatedApiCalls != null ? (
              <div>Estimated calls used on refresh: {estimatedApiCalls}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
