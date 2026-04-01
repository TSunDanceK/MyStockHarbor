"use client";

import React, { useEffect, useMemo, useState } from "react";

type PickerTone = "green" | "yellow" | "orange" | "red";

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
  timeframe?: "D" | "W" | "M";
  indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
};

type PickerSection = {
  title: string;
  description?: string;
  foundCount?: number;
  shownCount?: number;
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
  dailyMa200Proximity: boolean;
  weeklyMa200Proximity: boolean;

  bullishRsiDivergence: boolean;
  bearishRsiDivergence: boolean;
  bullishMacdDivergence: boolean;
  bearishMacdDivergence: boolean;

  preferredTimeframe?: "D" | "W" | "M";
  preferredIndicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
  isDynamicUniverse?: boolean;
};

type PickersPayload = {
  updatedAt?: string;
  universeSize?: number;
  dynamicUniverseCount?: number;
  dynamicUniversePreview?: string[];
  dynamicSymbols?: string[];
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
  | "dailyMa200Proximity"
  | "weeklyMa200Proximity"
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
  { key: "buyTheDip", label: "20%+ From ATH", tone: "yellow" },
  { key: "breakout", label: "Breakout", tone: "orange" },
  { key: "volumeSpike", label: "Volume Spike", tone: "orange" },
  { key: "atrSpike", label: "ATR Spike", tone: "orange" },
  { key: "aboveMA50", label: "Above MA50", tone: "yellow" },
  { key: "belowMA50", label: "Below MA50", tone: "yellow" },
  { key: "aboveMA200", label: "Above MA200", tone: "yellow" },
  { key: "belowMA200", label: "Below MA200", tone: "yellow" },
  { key: "dailyMa200Proximity", label: "D-MA200 Proximity", tone: "yellow" },
  { key: "weeklyMa200Proximity", label: "W-MA200 Proximity", tone: "yellow" },
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
  if (record.dailyMa200Proximity) out.push("dailyMa200Proximity");
  if (record.weeklyMa200Proximity) out.push("weeklyMa200Proximity");
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
    if (def?.tone === "green") return "green";
  }

  for (const key of matchedFilters) {
    const def = FILTER_DEFS.find((f) => f.key === key);
    if (def?.tone === "red") return "red";
  }

  for (const key of matchedFilters) {
    const def = FILTER_DEFS.find((f) => f.key === key);
    if (def?.tone === "orange") return "orange";
  }

  return record.tone;
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

function getSellSignalCount(record: SignalRecord) {
  let count = 0;

  if (record.overbought) count += 1;
  if (record.belowMA50) count += 1;
  if (record.belowMA200) count += 1;
  if (record.bearishRsiDivergence) count += 1;
  if (record.bearishMacdDivergence) count += 1;

  return count;
}

function getHeaderHelp(title: string) {
  if (title.includes("Buy Signals")) {
    return "These highlight stocks showing multiple bullish technical conditions at the same time. Some may already be strong movers, so always review the chart before entering.";
  }

  if (title.includes("Sell Signals")) {
    return "These highlight stocks showing multiple bearish technical conditions. Traders often review these for pullback risk, weaker trends, or possible short-side weakness.";
  }

  if (title.includes("Oversold")) {
    return "These are ranked oversold setups, not just raw matches. The list leans toward stronger oversold readings, better liquidity, sharper exhaustion moves and cleaner rebound potential.";
  }

  if (title.includes("Best Trend Score")) {
    return "These stocks have the strongest current trend structure based on price relative to MA50 and MA200, moving average alignment, and positive MACD momentum.";
  }

  if (title.includes("Overbought")) {
    return "These are ranked overbought setups, not just raw matches. The list leans toward stronger extension, better liquidity and cleaner pullback-risk profiles.";
  }

  if (title.includes("Divergence")) {
    return "Divergence is ranked by timeframe, duration, structure quality, magnitude and context. Weekly divergences usually carry more weight than daily ones.";
  }

  if (title.includes("All-Time Highs")) {
    return "These are pullback setups from all-time highs, ranked to favour liquid, tradable names over weak broken charts. A stock being down more does not automatically make it better.";
  }

  if (title.includes("MA200 Proximity")) {
    return "These stocks are close to their Daily or Weekly MA200, but the ranking also considers how constructively the stock has behaved around the MA200 rather than just raw proximity.";
  }

  if (title.includes("Breakout")) {
    return "Breakouts are ranked to favour newer, cleaner and more liquid breakouts over older or more stretched moves.";
  }

  if (title.includes("Hot Market Names")) {
    return "These names come from the current dynamic universe and are also triggering meaningful technical conditions right now.";
  }

  return "These stocks match multiple technical conditions worth reviewing on the chart.";
}

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="pickers-help-tip"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.15)",
        color: "#fff",
        fontSize: 11,
        fontWeight: 900,
        cursor: "pointer",
        marginLeft: 2,
        flex: "0 0 auto",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      ?
      {open ? (
        <span
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 50,
            width: 260,
            maxWidth: "min(260px, 78vw)",
            padding: "10px 12px",
            borderRadius: 12,
            background: "#0f172a",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "#e5e7eb",
            fontSize: 12,
            lineHeight: 1.5,
            fontWeight: 700,
            boxShadow: "0 14px 30px rgba(0,0,0,0.35)",
            textAlign: "left",
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

export default function PickersClient() {
  const SHOW_FORCE_FETCH_BUTTON = false;

  const [sections, setSections] = useState<PickerSection[]>([]);
  const [signalRecords, setSignalRecords] = useState<SignalRecord[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<FilterKey[]>([]);
  const [screenerOpen, setScreenerOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [universeSize, setUniverseSize] = useState<number | null>(null);
  const [dynamicUniverseCount, setDynamicUniverseCount] = useState<number | null>(null);
  const [dynamicUniversePreview, setDynamicUniversePreview] = useState<string[] | null>(null);
  const [dynamicSymbols, setDynamicSymbols] = useState<string[]>([]);
  const [estimatedApiCalls, setEstimatedApiCalls] = useState<number | null>(null);

  async function loadPickers(force = false) {
    const setBusy = force ? setForceRefreshing : setLoading;

    setBusy(true);
    setErr(null);

    try {
      const res = await fetch(force ? "/api/pickers?force=1" : "/api/pickers");

      if (!res.ok) throw new Error("Pickers API failed");

      const data = (await res.json()) as PickersPayload;
      const safeSections = Array.isArray(data?.sections) ? data.sections : [];
      const safeSignalRecords = Array.isArray(data?.signalRecords)
        ? data.signalRecords
        : [];

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
      setDynamicSymbols(
        Array.isArray(data?.dynamicSymbols)
          ? data.dynamicSymbols
              .map((x) => String(x).trim().toUpperCase())
              .filter(Boolean)
          : []
      );
      setEstimatedApiCalls(
        typeof data?.estimatedApiCalls === "number"
          ? data.estimatedApiCalls
          : null
      );
    } catch {
      setErr(force ? "Force refresh failed." : "Failed to load stock ideas.");

      if (!force) {
        setSections([]);
        setSignalRecords([]);
        setUpdatedAt(null);
        setUniverseSize(null);
        setDynamicUniverseCount(null);
        setDynamicUniversePreview(null);
        setDynamicSymbols([]);
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
        const res = await fetch("/api/pickers");
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
          setDynamicSymbols(
            Array.isArray(data?.dynamicSymbols)
              ? data.dynamicSymbols
                  .map((x) => String(x).trim().toUpperCase())
                  .filter(Boolean)
              : []
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
          setDynamicSymbols([]);
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

  const signalRecordMap = useMemo(() => {
    const map = new Map<string, SignalRecord>();

    for (const record of safeSignalRecords) {
      const symbol = String(record.symbol ?? "").trim().toUpperCase();
      if (!symbol) continue;
      map.set(symbol, record);
    }

    return map;
  }, [safeSignalRecords]);

  const dynamicSymbolSet = useMemo(() => {
    return new Set(
      dynamicSymbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean)
    );
  }, [dynamicSymbols]);

  const topBuySection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((record) => ({
        symbol: record.symbol,
        buyCount: getBuySignalCount(record),
        dashboardHref:
          record.dashboardHref ?? `/?symbol=${encodeURIComponent(record.symbol)}`,
      }))
      .filter((item) => item.buyCount > 0)
      .sort((a, b) => {
        if (b.buyCount !== a.buyCount) return b.buyCount - a.buyCount;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 4)
      .map((item) => ({
        symbol: item.symbol,
        note: `${item.buyCount} buy signal${item.buyCount === 1 ? "" : "s"}`,
        tone: "green" as PickerTone,
        dashboardHref: item.dashboardHref,
      }));

    if (!items.length) return null;

    return {
      title: "Top Stocks With Buy Signals (Live Scan)",
      description:
        "Stocks showing multiple bullish technical conditions right now, ranked by how many buy signals are currently active.",
      items,
    };
  }, [safeSignalRecords]);

  const topSellSection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((record) => ({
        symbol: record.symbol,
        sellCount: getSellSignalCount(record),
        dashboardHref:
          record.dashboardHref ?? `/?symbol=${encodeURIComponent(record.symbol)}`,
      }))
      .filter((item) => item.sellCount > 0)
      .sort((a, b) => {
        if (b.sellCount !== a.sellCount) return b.sellCount - a.sellCount;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 4)
      .map((item) => ({
        symbol: item.symbol,
        note: `${item.sellCount} sell signal${item.sellCount === 1 ? "" : "s"}`,
        tone: "red" as PickerTone,
        dashboardHref: item.dashboardHref,
      }));

    if (!items.length) return null;

    return {
      title: "Top Stocks With Sell Signals (Bearish Setups)",
      description:
        "Stocks showing multiple bearish technical signals right now, ranked by how many sell signals are currently active.",
      items,
    };
  }, [safeSignalRecords]);

  const displaySections = useMemo(() => {
    const out: PickerSection[] = [];

    const ma200Section = safeSections.find((section) =>
      section.title.includes("MA200 Proximity")
    );

    const buyTheDipSection = safeSections.find((section) =>
      section.title.includes("All-Time Highs")
    );

    const athBreakoutSection = safeSections.find((section) =>
      section.title.includes("All-Time High Breakout")
    );

    const threeMonthBreakoutSection = safeSections.find((section) =>
      section.title.includes("3-Month High Breakout")
    );

    const oversoldSection = safeSections.find((section) =>
      section.title.toLowerCase().includes("oversold")
    );

    const otherSections = safeSections.filter(
      (section) =>
        section !== ma200Section &&
        section !== buyTheDipSection &&
        section !== athBreakoutSection &&
        section !== threeMonthBreakoutSection &&
        section !== oversoldSection
    );

    if (ma200Section) out.push(ma200Section);
    if (topBuySection) out.push(topBuySection);
    if (buyTheDipSection) out.push(buyTheDipSection);
    if (athBreakoutSection) out.push(athBreakoutSection);
    if (threeMonthBreakoutSection) out.push(threeMonthBreakoutSection);
    if (topSellSection) out.push(topSellSection);
    if (oversoldSection) out.push(oversoldSection);

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

        @keyframes pickersPulseCard {
          0%, 100% {
            box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset,
                        0 10px 30px rgba(59,130,246,0.10);
            filter: brightness(1);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(255,255,255,0.14) inset,
                        0 14px 40px rgba(59,130,246,0.22);
            filter: brightness(1.08);
          }
        }

        @keyframes pickersShimmer {
          0% {
            transform: translateX(-120%);
          }
          70%, 100% {
            transform: translateX(140%);
          }
        }

        .pickers-loading-card {
          position: relative;
          overflow: hidden;
          animation: pickersPulseCard 2.6s ease-in-out infinite;
        }

        .pickers-loading-card::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(
            120deg,
            rgba(255,255,255,0) 0%,
            rgba(255,255,255,0.18) 50%,
            rgba(255,255,255,0) 100%
          );
          transform: translateX(-120%);
          animation: pickersShimmer 3.2s ease-in-out infinite;
          pointer-events: none;
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

        .pickers-section-results-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        @media (max-width: 820px) {
          .pickers-filter-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .pickers-card-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        .pickers-desktop-only {
          display: block;
        }

        @media (max-width: 640px) {
          .pickers-filter-grid,
          .pickers-card-grid,
          .pickers-section-results-grid {
            grid-template-columns: minmax(0, 1fr);
          }

          .pickers-desktop-only {
            display: none;
          }

          .pickers-item-note {
            display: none !important;
          }

          .pickers-item-note.pickers-item-note-show-mobile {
            display: inline !important;
          }

          .pickers-note-mobile {
            display: none;
          }

          .pickers-note-desktop {
            display: inline;
          }

          .pickers-section-title {
            flex-wrap: nowrap !important;
            align-items: center !important;
            gap: 8px !important;
          }

          .pickers-help-tip {
            width: 22px !important;
            height: 22px !important;
            font-size: 13px !important;
            margin-left: 0 !important;
            flex: 0 0 22px !important;
          }
        }

        @media (max-width: 640px) {
          .pickers-note-desktop {
            display: none;
          }

          .pickers-note-mobile {
            display: inline;
          }
        }
      `}</style>

      {loading ? (
        <div
          className="pickers-shell pickers-loading-card"
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
          className="pickers-shell pickers-desktop-only"
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
                    href={item.dashboardHref ?? `/?symbol=${encodeURIComponent(item.symbol)}`}
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
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 950,
                              minWidth: 0,
                            }}
                          >
                            {item.symbol}
                          </div>
                        </div>

                        {item.preferredTimeframe || item.preferredIndicator ? (
                          <div
                            style={{
                              marginTop: 8,
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            {item.preferredTimeframe ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "5px 8px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.12)",
                                  background: "rgba(255,255,255,0.05)",
                                  fontSize: 10,
                                  fontWeight: 900,
                                  letterSpacing: "0.04em",
                                }}
                              >
                                {item.preferredTimeframe}
                              </span>
                            ) : null}

                            {item.preferredIndicator ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "5px 8px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(96,165,250,0.22)",
                                  background: "rgba(59,130,246,0.08)",
                                  color: "#dbeafe",
                                  fontSize: 10,
                                  fontWeight: 900,
                                  letterSpacing: "0.04em",
                                }}
                              >
                                {item.preferredIndicator}
                              </span>
                            ) : null}
                          </div>
                        ) : null}

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
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 8,
                          flex: "0 0 auto",
                        }}
                      >
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

                        <a
                          href={`/stock/${encodeURIComponent(item.symbol)}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "7px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(59,130,246,0.24)",
                            background: "rgba(59,130,246,0.08)",
                            color: "#dbeafe",
                            textDecoration: "none",
                            fontSize: 11,
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Stock page ↗
                        </a>
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
          <>
            {displaySections.map((sec) => {
              const items = Array.isArray(sec.items)
                ? sec.items
                    .map((it) => {
                      const symbol = String(it.symbol ?? "").trim().toUpperCase();
                      const record = signalRecordMap.get(symbol);
                      const checkCount = record ? matchedSignalsForRecord(record).length : 0;
                      const isDynamic = dynamicSymbolSet.has(symbol);

                      return {
                        ...it,
                        symbol,
                        checkCount,
                        isDynamic,
                      };
                    })
                    .slice(0, 10)
                : [];

              return (
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
                        className="pickers-section-title"
                        style={{
                          margin: 0,
                          fontSize: 22,
                          fontWeight: 950,
                          letterSpacing: "-0.02em",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        {sec.title}
                        <HelpTip text={getHeaderHelp(sec.title)} />
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
                      {typeof sec.foundCount === "number"
                        ? `F${sec.foundCount} / S${items.length}`
                        : items.length
                          ? `${items.length} stocks`
                          : "No matches yet"}
                    </div>
                  </div>

                  <div
                    className="pickers-section-results-grid"
                    style={{
                      marginTop: 14,
                    }}
                  >
                    {items.map((it) => (
                      <div
                        key={it.symbol}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "nowrap",
                          border: "1px solid rgba(255,255,255,0.14)",
                          borderRadius: 16,
                          padding: 12,
                          background: "rgba(255,255,255,0.04)",
                          boxSizing: "border-box",
                        }}
                      >
                        <a
                          href={it.dashboardHref ?? `/?symbol=${encodeURIComponent(it.symbol)}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                            maxWidth: "100%",
                            flex: "1 1 auto",
                            color: "#f1f5f9",
                            textDecoration: "none",
                            fontWeight: 900,
                            overflow: "hidden",
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
                              className={`pickers-item-note${
                                /MA200/i.test(it.note) ? " pickers-item-note-show-mobile" : ""
                              }`}
                              style={{
                                fontSize: 12,
                                opacity: 0.65,
                                fontWeight: 700,
                                minWidth: 0,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              <span className="pickers-note-desktop">{it.note}</span>
                              <span className="pickers-note-mobile">
                                {/Weekly/i.test(it.note)
                                  ? "Weekly"
                                  : /Daily/i.test(it.note)
                                    ? "Daily"
                                    : ""}
                              </span>
                            </span>
                          ) : null}
                        </a>

                        <a
                          href={it.dashboardHref ?? `/?symbol=${encodeURIComponent(it.symbol)}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "8px 11px",
                            borderRadius: 10,
                            border: "1px solid rgba(59,130,246,0.24)",
                            background: "rgba(59,130,246,0.08)",
                            color: "#dbeafe",
                            textDecoration: "none",
                            fontSize: 12,
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                            flex: "0 0 auto",
                          }}
                          title={`Open ${it.symbol} chart`}
                        >
                          Open chart ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}

        {!loading && !err && SHOW_FORCE_FETCH_BUTTON ? (
          <div
            style={{
              marginTop: 18,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={() => {
                void loadPickers(true);
              }}
              disabled={forceRefreshing}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                padding: "10px 16px",
                borderRadius: 12,
                fontWeight: 900,
                fontSize: 14,
                cursor: forceRefreshing ? "wait" : "pointer",
                transition: "all 0.2s ease",
                whiteSpace: "nowrap",
                border: "1px solid rgba(59,130,246,0.28)",
                background: forceRefreshing
                  ? "rgba(59,130,246,0.12)"
                  : "rgba(59,130,246,0.08)",
                color: "#dbeafe",
                opacity: forceRefreshing ? 0.78 : 1,
              }}
            >
              {forceRefreshing ? "Force refreshing…" : "Force Refresh Pickers"}
            </button>
          </div>
        ) : null}

        {!loading &&
        !err &&
        (updatedAt || universeSize || dynamicUniverseCount || estimatedApiCalls) ? (
          <div
            style={{
              marginTop: 6,
              paddingTop: 4,
              fontSize: 10,
              lineHeight: 1.55,
              opacity: 0.34,
              textAlign: "right",
              letterSpacing: "0.01em",
              userSelect: "none",
            }}
          >
            {updatedAt ? (
              <div>{new Date(updatedAt).toLocaleString()}</div>
            ) : null}
            {universeSize != null ? <div>Universe: {universeSize}</div> : null}
            {dynamicUniverseCount != null ? (
              <div>Dynamic: {dynamicUniverseCount}</div>
            ) : null}
            {estimatedApiCalls != null ? (
              <div>Estimated: {estimatedApiCalls}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
