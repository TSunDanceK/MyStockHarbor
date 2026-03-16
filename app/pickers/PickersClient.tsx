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

function chooseCardTone(
  record: SignalRecord,
  matchedFilters: FilterKey[]
): PickerTone | undefined {
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

function getBuySignalCount(record: SignalRecord) {
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

function getSellSignalCount(record: SignalRecord) {
  let count = 0;

  if (record.overbought) count += 1;
  if (record.belowMA50) count += 1;
  if (record.belowMA200) count += 1;
  if (record.bearishRsiDivergence) count += 1;
  if (record.bearishMacdDivergence) count += 1;

  return count;
}

export default function PickersClient() {
  const [sections, setSections] = useState<PickerSection[]>([]);
  const [signalRecords, setSignalRecords] = useState<SignalRecord[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<FilterKey[]>([]);
  const [screenerOpen, setScreenerOpen] = useState(false);

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
        const safeSignalRecords = Array.isArray(data?.signalRecords)
          ? data.signalRecords
          : [];

        if (!cancelled) {
          setSections(safeSections);
          setSignalRecords(safeSignalRecords);
          setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
          setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
          setDynamicUniverseCount(
            typeof data?.dynamicUniverseCount === "number"
              ? data.dynamicUniverseCount
              : null
          );
          setDynamicUniversePreview(
            Array.isArray(data?.dynamicUniversePreview)
              ? data.dynamicUniversePreview
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

  const topBuySection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((record) => ({
        symbol: record.symbol,
        buyCount: getBuySignalCount(record),
      }))
      .filter((item) => item.buyCount > 0)
      .sort((a, b) => {
        if (b.buyCount !== a.buyCount) return b.buyCount - a.buyCount;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 3)
      .map((item) => ({
        symbol: item.symbol,
        note: `${item.buyCount} buy signal${item.buyCount === 1 ? "" : "s"}`,
        tone: "green" as PickerTone,
      }));

    if (!items.length) return null;

    return {
      title: "Stocks with the MOST BUY signals",
      description:
        "The strongest bullish-leaning setups right now, ranked by how many buy signals they currently show.",
      items,
    };
  }, [safeSignalRecords]);

  const topSellSection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((record) => ({
        symbol: record.symbol,
        sellCount: getSellSignalCount(record),
      }))
      .filter((item) => item.sellCount > 0)
      .sort((a, b) => {
        if (b.sellCount !== a.sellCount) return b.sellCount - a.sellCount;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 3)
      .map((item) => ({
        symbol: item.symbol,
        note: `${item.sellCount} sell signal${item.sellCount === 1 ? "" : "s"}`,
        tone: "red" as PickerTone,
      }));

    if (!items.length) return null;

    return {
      title: "Stocks with the most Sell signals",
      description:
        "The strongest bearish-leaning setups right now, ranked by how many sell signals they currently show.",
      items,
    };
  }, [safeSignalRecords]);

  const displaySections = useMemo(() => {
    const out: PickerSection[] = [];

    const buyTheDipSection = safeSections.find(
      (section) => section.title === "Buy-the-Dip Setups"
    );

    const otherSections = safeSections.filter(
      (section) => section.title !== "Buy-the-Dip Setups"
    );

    if (topBuySection) out.push(topBuySection);
    if (topSellSection) out.push(topSellSection);
    if (buyTheDipSection) out.push(buyTheDipSection);

    return [...out, ...otherSections];
  }, [safeSections, topBuySection, topSellSection]);

  const customMode = selectedFilters.length > 0;

  const customMatches = useMemo(() => {
    if (!customMode) return [];

    return safeSignalRecords
      .filter((record) => selectedFilters.every((filter) => record[filter] === true))
      .map((record) => {
        const matchedSignals = matchedSignalsForRecord(record).filter((key) =>
          selectedFilters.includes(key)
        );

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

  function handleScreenerButton() {
    setScreenerOpen((prev) => !prev);
  }

  const actionButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    padding: "10px 16px",
    borderRadius: 12,
    fontWeight: 900,
    fontSize: 14,
    cursor: "pointer",
    transition: "all 0.2s ease",
    whiteSpace: "nowrap",
  };

  return (
    <section
      aria-label="Live stock idea results"
      style={{
        width: "100%",
        minWidth: 0,
      }}
    >
      <style>{`
        @keyframes pickersBar {
          0% { transform: translateX(-60%); opacity: 0.55; }
          50% { transform: translateX(140%); opacity: 0.95; }
          100% { transform: translateX(320%); opacity: 0.55; }
        }

        .pickers-shell {
          width: 100%;
          max-width: 980px;
          min-width: 0;
        }

        .pickers-filter-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 10px;
        }

        .pickers-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 12px;
        }

        @media (max-width: 820px) {
          .pickers-filter-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .pickers-card-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 640px) {
          .pickers-filter-grid,
          .pickers-card-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>

      {loading ? (
        <div
          className="pickers-shell"
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 18,
            padding: 18,
            background: "#0b1220",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 950, letterSpacing: "-0.2px" }}>
            We are gathering stocks for you, please wait…
          </div>
          <div style={{ marginTop: 8, opacity: 0.75 }}>
            First load can take around 10–15 seconds. Cached loads are usually much
            faster.
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
        </div>
      ) : null}

      {err ? (
        <div
          className="pickers-shell"
          style={{
            border: "1px solid rgba(239,68,68,0.18)",
            borderRadius: 16,
            padding: 16,
            background: "rgba(239,68,68,0.08)",
            color: "#fecaca",
            boxSizing: "border-box",
          }}
        >
          {err}
        </div>
      ) : null}

      {!loading && !err ? (
        <section
          className="pickers-shell"
          style={{
            border: "1px solid rgba(34,197,94,0.26)",
            borderRadius: 18,
            padding: 16,
            background: "linear-gradient(180deg, rgba(8,18,12,0.96), rgba(8,12,22,1))",
            marginBottom: 18,
            boxSizing: "border-box",
            overflow: "hidden",
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
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  margin: 0,
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
                Choose multiple technical conditions and we will only show stocks
                matching all selected filters.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={handleScreenerButton}
                style={{
                  ...actionButtonStyle,
                  border: "1px solid rgba(34,197,94,0.34)",
                  background:
                    "linear-gradient(180deg, rgba(20,83,45,0.98), rgba(21,128,61,0.88))",
                  color: "#dcfce7",
                  boxShadow: screenerOpen
                    ? "0 0 0 1px rgba(34,197,94,0.16), 0 10px 24px rgba(22,101,52,0.18)"
                    : "none",
                }}
              >
                {screenerOpen ? "Hide Custom Screener" : "Custom Screener"}
              </button>

              {customMode ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  style={{
                    ...actionButtonStyle,
                    border: "1px solid rgba(239,68,68,0.34)",
                    background:
                      "linear-gradient(180deg, rgba(127,29,29,0.98), rgba(185,28,28,0.88))",
                    color: "#fee2e2",
                    boxShadow: "0 10px 24px rgba(127,29,29,0.16)",
                  }}
                >
                  Clear Filters
                </button>
              ) : null}
            </div>
          </div>

          <div
            style={{
              marginTop: screenerOpen ? 16 : 0,
              maxHeight: screenerOpen ? 1200 : 0,
              opacity: screenerOpen ? 1 : 0,
              overflow: "hidden",
              transform: screenerOpen ? "translateY(0)" : "translateY(-8px)",
              transition:
                "max-height 0.38s ease, opacity 0.24s ease, transform 0.28s ease, margin-top 0.28s ease",
            }}
          >
            <div className="pickers-filter-grid">
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
                      minWidth: 0,
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
                      boxSizing: "border-box",
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
                    <span style={{ minWidth: 0 }}>{filter.label}</span>
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
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.72,
                    fontWeight: 900,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
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
          </div>
        </section>
      ) : null}

      <div
        className="pickers-shell"
        style={{
          marginTop: loading || err ? 20 : 0,
          display: "grid",
          gap: 16,
          boxSizing: "border-box",
        }}
      >
        {customMode ? (
          <section
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 16,
              padding: 16,
              background: "#0b1220",
              boxSizing: "border-box",
              overflow: "hidden",
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
              <div style={{ minWidth: 0 }}>
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
                className="pickers-card-grid"
                style={{
                  marginTop: 14,
                }}
              >
                {customMatches.map((item) => (
                  <a
                    key={item.symbol}
                    href={`/?symbol=${encodeURIComponent(item.symbol)}`}
                    style={{
                      display: "block",
                      minWidth: 0,
                      textDecoration: "none",
                      color: "#f1f5f9",
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 16,
                      padding: 14,
                      background: "rgba(255,255,255,0.04)",
                      boxSizing: "border-box",
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
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
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
                          <div style={{ fontSize: 20, fontWeight: 950, minWidth: 0 }}>
                            {item.symbol}
                          </div>
                        </div>

                        {item.note ? (
                          <div
                            style={{
                              marginTop: 8,
                              fontSize: 13,
                              lineHeight: 1.55,
                              opacity: 0.72,
                              wordBreak: "break-word",
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
                          flex: "0 0 auto",
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
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 999,
                                background: toneDot(def?.tone),
                                flex: "0 0 auto",
                              }}
                            />
                            <span style={{ minWidth: 0 }}>{getFilterLabel(signal)}</span>
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
                  boxSizing: "border-box",
                }}
              >
                No stocks currently match all selected filters. Try removing one
                condition or using a broader setup.
              </div>
            )}
          </section>
        ) : (
displaySections.map((sec) => {
  const items = Array.isArray(sec.items) ? sec.items.slice(0, 10) : [];

  return ((
              <section
                key={sec.title}
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 16,
                  padding: 16,
                  background: "#0b1220",
                  boxSizing: "border-box",
                  overflow: "hidden",
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
                  <div style={{ minWidth: 0 }}>
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
                        maxWidth: "100%",
                        minWidth: 0,
                        padding: "10px 12px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(255,255,255,0.06)",
                        color: "#f1f5f9",
                        textDecoration: "none",
                        fontWeight: 900,
                        boxSizing: "border-box",
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
                      <span style={{ minWidth: 0 }}>{it.symbol}</span>
                      {it.note ? (
                        <span
                          style={{
                            fontSize: 12,
                            opacity: 0.65,
                            fontWeight: 700,
                            minWidth: 0,
                            wordBreak: "break-word",
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
        (updatedAt ||
          universeSize ||
          dynamicUniverseCount ||
          dynamicUniversePreview ||
          estimatedApiCalls) ? (
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
              <div>Last picker refresh: {new Date(updatedAt).toLocaleString()}</div>
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
