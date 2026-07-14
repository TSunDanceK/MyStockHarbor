"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * InteractiveChart
 * ----------------
 * A fully interactive, TradingView / stockanalysis.com-style chart powered by
 * KLineChart (klinecharts, Apache-2.0). This is the "Interactive" mode of the
 * dashboard chart toggle and is completely separate from the Basic SVG chart
 * (PriceChart.tsx). It deliberately does NOT know anything about picker
 * deep-link drawings (support/resistance zones, ATH reference lines) -- those
 * belong to the Basic chart only.
 *
 * Behaviour:
 *  - Mouse: drag to pan, wheel to zoom, drag an axis to compress/expand it.
 *  - Touch: one-finger pan, two-finger pinch zoom, tap an overlay to select
 *    then drag to move it (KLineChart handles these natively).
 *  - Chart types: Candle / Hollow / Bar (OHLC) / Line / Heikin-Ashi.
 *  - Indicators: MA, EMA, BOLL (price overlays) + Volume, MACD, RSI, KDJ
 *    (lower panes). Multi-select via a dropdown.
 *  - Drawing tools: Trend line, Ray, Horizontal, Vertical, Price line,
 *    Fibonacci (measurement %), Note. Undo + Clear.
 *  - Safety: cannot scroll into empty space past the first/last data point,
 *    and always keeps a minimum number of bars visible so the chart can never
 *    be "lost" by an accidental drag or over-zoom.
 *
 * The component fetches its own history from /api/history so it is fully
 * decoupled from the Basic chart's windowing state.
 */

// ---- Types ----------------------------------------------------------------

type SeedPoint = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type KLineData = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

// Minimal structural type for the KLineChart instance -- we only declare the
// methods we actually call. Assigned via an `as unknown as` cast so we get
// typo-safety on our own calls without depending on the package's exported
// type names (which differ between minor versions).
interface ChartApi {
  applyNewData(list: KLineData[], more?: boolean): void;
  setStyles(styles: unknown): void;
  createIndicator(value: string, isStack?: boolean, paneOptions?: { id: string } | null): string | null;
  removeIndicator(paneId: string, name?: string): void;
  createOverlay(value: string | Record<string, unknown>): string | null;
  removeOverlay(remove: string | { id?: string; groupId?: string; name?: string }): void;
  resize(): void;
  setZoomEnabled(enabled: boolean): void;
  setScrollEnabled(enabled: boolean): void;
  setMaxOffsetLeftDistance(distance: number): void;
  setMaxOffsetRightDistance(distance: number): void;
  setLeftMinVisibleBarCount(barCount: number): void;
  setRightMinVisibleBarCount(barCount: number): void;
  setOffsetRightDistance(distance: number): void;
}

type Interval = "d" | "w" | "m";
type ChartTypeKey = "candle_solid" | "candle_stroke" | "ohlc" | "area" | "heikin_ashi";

type Props = {
  symbol: string;
  seed?: SeedPoint[];
  isMobile?: boolean;
  /** Fill the parent (used in fullscreen). When false, uses `height`. */
  fill?: boolean;
  height?: number;
};

// ---- Static config --------------------------------------------------------

const INTERVALS: { key: Interval; label: string }[] = [
  { key: "d", label: "D" },
  { key: "w", label: "W" },
  { key: "m", label: "M" },
];

const CHART_TYPES: { key: ChartTypeKey; label: string }[] = [
  { key: "candle_solid", label: "Candle" },
  { key: "candle_stroke", label: "Hollow" },
  { key: "ohlc", label: "Bar" },
  { key: "area", label: "Line" },
  { key: "heikin_ashi", label: "Heikin-Ashi" },
];

// Price overlays stack on the main candle pane; lower indicators get their
// own pane. These names are all KLineChart v9 built-ins.
const PRICE_INDICATORS = ["MA", "EMA", "BOLL"] as const;
const LOWER_INDICATORS = ["VOL", "MACD", "RSI", "KDJ"] as const;
type IndicatorName = (typeof PRICE_INDICATORS)[number] | (typeof LOWER_INDICATORS)[number];

const INDICATOR_LABELS: Record<IndicatorName, string> = {
  MA: "MA (Moving Averages)",
  EMA: "EMA",
  BOLL: "Bollinger Bands",
  VOL: "Volume",
  MACD: "MACD",
  RSI: "RSI",
  KDJ: "KDJ / Stochastic",
};

// Drawing / measurement tools -> KLineChart built-in overlay template names.
const DRAW_TOOLS: { key: string; overlay: string; label: string }[] = [
  { key: "trend", overlay: "segment", label: "Trend line" },
  { key: "ray", overlay: "rayLine", label: "Ray" },
  { key: "extended", overlay: "straightLine", label: "Extended line" },
  { key: "horizontal", overlay: "horizontalStraightLine", label: "Horizontal" },
  { key: "vertical", overlay: "verticalStraightLine", label: "Vertical" },
  { key: "priceline", overlay: "priceLine", label: "Price line" },
  { key: "fib", overlay: "fibonacciLine", label: "Fib / Measure %" },
  { key: "note", overlay: "simpleAnnotation", label: "Note" },
];

const CANDLE_UP = "#22c55e";
const CANDLE_DOWN = "#ef4444";

// KLineChart dark style tuned to the MyStockHarbor UI.
const CHART_STYLES = {
  grid: {
    horizontal: { color: "rgba(148,163,184,0.10)" },
    vertical: { color: "rgba(148,163,184,0.10)" },
  },
  candle: {
    bar: {
      upColor: CANDLE_UP,
      downColor: CANDLE_DOWN,
      noChangeColor: "#94a3b8",
      upBorderColor: CANDLE_UP,
      downBorderColor: CANDLE_DOWN,
      noChangeBorderColor: "#94a3b8",
      upWickColor: CANDLE_UP,
      downWickColor: CANDLE_DOWN,
      noChangeWickColor: "#94a3b8",
    },
    priceMark: {
      last: {
        line: { color: "rgba(148,163,184,0.55)" },
        text: { color: "#0b1220", backgroundColor: "#cbd5e1" },
      },
    },
    tooltip: {
      text: { color: "#cbd5e1" },
    },
    area: {
      lineColor: "#60a5fa",
      lineSize: 2,
      backgroundColor: [
        { offset: 0, color: "rgba(96,165,250,0.28)" },
        { offset: 1, color: "rgba(96,165,250,0.01)" },
      ],
    },
  },
  xAxis: {
    axisLine: { color: "rgba(148,163,184,0.25)" },
    tickText: { color: "#8a97ad" },
    tickLine: { color: "rgba(148,163,184,0.25)" },
  },
  yAxis: {
    axisLine: { color: "rgba(148,163,184,0.25)" },
    tickText: { color: "#8a97ad" },
    tickLine: { color: "rgba(148,163,184,0.25)" },
  },
  crosshair: {
    horizontal: {
      line: { color: "rgba(203,213,225,0.55)" },
      text: { color: "#e2e8f0", backgroundColor: "rgba(30,41,59,0.95)" },
    },
    vertical: {
      line: { color: "rgba(203,213,225,0.55)" },
      text: { color: "#e2e8f0", backgroundColor: "rgba(30,41,59,0.95)" },
    },
  },
  indicator: {
    tooltip: { text: { color: "#cbd5e1" } },
  },
};

// ---- Helpers --------------------------------------------------------------

function toTimestamp(dateStr: string): number {
  // Daily bars come as "YYYY-MM-DD"; parse as UTC midnight for stable spacing.
  const t = Date.parse(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00Z`);
  return Number.isFinite(t) ? t : Date.parse(dateStr);
}

function mapToKLine(points: SeedPoint[]): KLineData[] {
  const out: KLineData[] = [];
  for (const p of points) {
    const close = p.close;
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    const open = typeof p.open === "number" && Number.isFinite(p.open) ? p.open : close;
    const high = typeof p.high === "number" && Number.isFinite(p.high) ? Math.max(p.high, open, close) : Math.max(open, close);
    const low = typeof p.low === "number" && Number.isFinite(p.low) ? Math.min(p.low, open, close) : Math.min(open, close);
    const volume = typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : undefined;
    out.push({ timestamp: toTimestamp(p.date), open, high, low, close, volume });
  }
  return out;
}

// Heikin-Ashi transform of an already-mapped KLine series.
function toHeikinAshi(data: KLineData[]): KLineData[] {
  const out: KLineData[] = [];
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const haClose = (d.open + d.high + d.low + d.close) / 4;
    const prev = out[i - 1];
    const haOpen = prev ? (prev.open + prev.close) / 2 : (d.open + d.close) / 2;
    const haHigh = Math.max(d.high, haOpen, haClose);
    const haLow = Math.min(d.low, haOpen, haClose);
    out.push({ timestamp: d.timestamp, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: d.volume });
  }
  return out;
}

// ---- Component ------------------------------------------------------------

export default function InteractiveChart({ symbol, seed, isMobile = false, fill = false, height = 460 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const disposeRef = useRef<((el: HTMLElement) => void) | null>(null);
  const rawDataRef = useRef<KLineData[]>(seed ? mapToKLine(seed) : []);
  const overlayIdsRef = useRef<string[]>([]);
  // indicator name -> pane id (for removal). Price overlays share "candle_pane".
  const indicatorPanesRef = useRef<Record<string, string>>({});
  const readyRef = useRef(false);

  const [interval, setIntervalKey] = useState<Interval>("d");
  const [chartType, setChartType] = useState<ChartTypeKey>("candle_solid");
  const [activeIndicators, setActiveIndicators] = useState<IndicatorName[]>(["VOL"]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const indicatorMenuRef = useRef<HTMLDivElement | null>(null);
  const typeMenuRef = useRef<HTMLDivElement | null>(null);

  // Apply safety limits so the chart can never be scrolled into the void or
  // zoomed/dragged completely off screen.
  const applySafetyLimits = useCallback((chart: ChartApi) => {
    try { chart.setScrollEnabled(true); } catch { /* noop */ }
    try { chart.setZoomEnabled(true); } catch { /* noop */ }
    // End movement at the last / first data point (no endless empty scroll).
    try { chart.setMaxOffsetRightDistance(isMobile ? 40 : 80); } catch { /* noop */ }
    try { chart.setMaxOffsetLeftDistance(isMobile ? 40 : 80); } catch { /* noop */ }
    // Never let the whole series leave the viewport.
    try { chart.setLeftMinVisibleBarCount(3); } catch { /* noop */ }
    try { chart.setRightMinVisibleBarCount(3); } catch { /* noop */ }
  }, [isMobile]);

  // Push the current raw data to the chart, applying the Heikin-Ashi transform
  // when that chart type is selected.
  const pushData = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const base = rawDataRef.current;
    const data = chartType === "heikin_ashi" ? toHeikinAshi(base) : base;
    chart.applyNewData(data);
    applySafetyLimits(chart);
  }, [chartType, applySafetyLimits]);

  // ---- Chart type application ----
  const applyChartType = useCallback((type: ChartTypeKey) => {
    const chart = chartRef.current;
    if (!chart) return;
    const klType = type === "heikin_ashi" ? "candle_solid" : type;
    try { chart.setStyles({ candle: { type: klType } }); } catch { /* noop */ }
    pushData();
  }, [pushData]);

  // ---- Indicator application ----
  const applyIndicators = useCallback((prev: IndicatorName[], next: IndicatorName[]) => {
    const chart = chartRef.current;
    if (!chart) return;
    const prevSet = new Set(prev);
    const nextSet = new Set(next);

    // Remove ones that were switched off.
    for (const name of prev) {
      if (nextSet.has(name)) continue;
      const isPrice = (PRICE_INDICATORS as readonly string[]).includes(name);
      const paneId = indicatorPanesRef.current[name] ?? (isPrice ? "candle_pane" : undefined);
      if (paneId) {
        try { chart.removeIndicator(paneId, name); } catch { /* noop */ }
      }
      delete indicatorPanesRef.current[name];
    }

    // Add ones that were switched on.
    for (const name of next) {
      if (prevSet.has(name)) continue;
      const isPrice = (PRICE_INDICATORS as readonly string[]).includes(name);
      try {
        const paneId = isPrice
          ? chart.createIndicator(name, true, { id: "candle_pane" })
          : chart.createIndicator(name);
        if (paneId) indicatorPanesRef.current[name] = paneId;
        else if (isPrice) indicatorPanesRef.current[name] = "candle_pane";
      } catch { /* noop */ }
    }
  }, []);

  // ---- Init chart (client only) ----
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    (async () => {
      const el = containerRef.current;
      if (!el) return;
      const kl = await import("klinecharts");
      if (cancelled) return;
      disposeRef.current = kl.dispose as unknown as (element: HTMLElement) => void;

      const chart = (kl.init(el) as unknown) as ChartApi | null;
      if (!chart) return;
      chartRef.current = chart;
      readyRef.current = true;

      chart.setStyles(CHART_STYLES);

      // Seed immediately for an instant first paint.
      if (rawDataRef.current.length) pushData();

      // Default indicators.
      applyIndicators([], activeIndicators);
      applyChartType(chartType);
      applySafetyLimits(chart);

      // Keep the canvas sized to its container (fullscreen, rotation, resize).
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          try { chartRef.current?.resize(); } catch { /* noop */ }
        });
        ro.observe(el);
      }
    })();

    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      const el = containerRef.current;
      readyRef.current = false;
      chartRef.current = null;
      overlayIdsRef.current = [];
      indicatorPanesRef.current = {};
      if (el && disposeRef.current) {
        try { disposeRef.current(el); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Data fetching (per symbol / interval) ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const url = `/api/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&days=2000`;
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("history fetch failed");
        return r.json();
      })
      .then((json: { points?: SeedPoint[] }) => {
        if (cancelled) return;
        const pts = Array.isArray(json?.points) ? json.points : [];
        rawDataRef.current = mapToKLine(pts);
        pushData();
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErr("Couldn't load chart data.");
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  useEffect(() => {
    if (!readyRef.current) return;
    applyChartType(chartType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType]);

  function toggleIndicator(name: IndicatorName) {
    setActiveIndicators((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
      applyIndicators(prev, next);
      return next;
    });
  }

  // ---- Drawing tools ----
  function startTool(overlay: string, key: string) {
    const chart = chartRef.current;
    if (!chart) return;
    setActiveTool(key);
    try {
      const value = overlay === "simpleAnnotation"
        ? { name: overlay, extendData: "Note" }
        : overlay;
      const id = chart.createOverlay(value);
      if (id) overlayIdsRef.current.push(id);
    } catch { /* noop */ }
    // The overlay stays in "drawing" mode until the user places its points;
    // reset the visual active state shortly after so the button doesn't stay lit.
    window.setTimeout(() => setActiveTool(null), 400);
  }

  function undoLastDrawing() {
    const chart = chartRef.current;
    if (!chart) return;
    const id = overlayIdsRef.current.pop();
    if (id) {
      try { chart.removeOverlay({ id }); } catch { /* noop */ }
    }
  }

  function clearDrawings() {
    const chart = chartRef.current;
    if (!chart) return;
    for (const id of overlayIdsRef.current) {
      try { chart.removeOverlay({ id }); } catch { /* noop */ }
    }
    overlayIdsRef.current = [];
  }

  // ---- Close menus on outside click ----
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (indicatorMenuRef.current && !indicatorMenuRef.current.contains(t)) setIndicatorMenuOpen(false);
      if (typeMenuRef.current && !typeMenuRef.current.contains(t)) setTypeMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const activeTypeLabel = useMemo(
    () => CHART_TYPES.find((t) => t.key === chartType)?.label ?? "Candle",
    [chartType]
  );

  // ---- Styles ----
  const btn = (active: boolean): React.CSSProperties => ({
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 8,
    padding: isMobile ? "8px 10px" : "6px 10px",
    background: active ? "rgba(96,165,250,0.24)" : "rgba(255,255,255,0.04)",
    color: active ? "#dbeafe" : "#9fb0c7",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1.1,
    minHeight: isMobile ? 36 : undefined,
  });

  const groupWrap: React.CSSProperties = {
    display: "inline-flex",
    gap: 3,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: 3,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: fill ? "100%" : undefined, minHeight: 0 }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: isMobile ? "nowrap" : "wrap",
          overflowX: isMobile ? "auto" : "visible",
          padding: "2px 2px 10px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Interval */}
        <div style={groupWrap} role="group" aria-label="Timeframe">
          {INTERVALS.map((iv) => (
            <button key={iv.key} type="button" onClick={() => setIntervalKey(iv.key)} style={btn(interval === iv.key)} aria-pressed={interval === iv.key}>
              {iv.label}
            </button>
          ))}
        </div>

        {/* Chart type dropdown */}
        <div style={{ position: "relative" }} ref={typeMenuRef}>
          <button type="button" onClick={() => { setTypeMenuOpen((v) => !v); setIndicatorMenuOpen(false); }} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>{activeTypeLabel}</span><span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {typeMenuOpen ? (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, minWidth: 168, background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)", overflow: "hidden" }}>
              {CHART_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setChartType(t.key); setTypeMenuOpen(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 13px", border: "none", background: chartType === t.key ? "rgba(96,165,250,0.18)" : "transparent", color: chartType === t.key ? "#dbeafe" : "#cbd5e1", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Indicators dropdown */}
        <div style={{ position: "relative" }} ref={indicatorMenuRef}>
          <button type="button" onClick={() => { setIndicatorMenuOpen((v) => !v); setTypeMenuOpen(false); }} style={{ ...btn(activeIndicators.length > 0), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>Indicators{activeIndicators.length ? ` · ${activeIndicators.length}` : ""}</span><span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {indicatorMenuOpen ? (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, width: 250, maxHeight: 340, overflowY: "auto", background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)" }}>
              <div style={{ padding: "8px 12px 6px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7c8aa3" }}>Price overlays</div>
              {PRICE_INDICATORS.map((name) => (
                <label key={name} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderTop: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#cbd5e1" }}>
                  <input type="checkbox" checked={activeIndicators.includes(name)} onChange={() => toggleIndicator(name)} />
                  <span>{INDICATOR_LABELS[name]}</span>
                </label>
              ))}
              <div style={{ padding: "8px 12px 6px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7c8aa3", borderTop: "1px solid rgba(255,255,255,0.08)" }}>Lower panels</div>
              {LOWER_INDICATORS.map((name) => (
                <label key={name} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderTop: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#cbd5e1" }}>
                  <input type="checkbox" checked={activeIndicators.includes(name)} onChange={() => toggleIndicator(name)} />
                  <span>{INDICATOR_LABELS[name]}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        {/* Drawing tools */}
        <div style={groupWrap} role="group" aria-label="Drawing tools">
          {DRAW_TOOLS.map((tool) => (
            <button key={tool.key} type="button" title={tool.label} onClick={() => startTool(tool.overlay, tool.key)} style={btn(activeTool === tool.key)}>
              {tool.label}
            </button>
          ))}
        </div>

        {/* Undo / clear */}
        <div style={groupWrap} role="group" aria-label="Drawing actions">
          <button type="button" onClick={undoLastDrawing} style={btn(false)} title="Undo last drawing">Undo</button>
          <button type="button" onClick={clearDrawings} style={btn(false)} title="Remove all drawings">Clear</button>
        </div>
      </div>

      {/* Chart canvas */}
      <div style={{ position: "relative", width: "100%", flex: fill ? 1 : undefined, minHeight: 0 }}>
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height: fill ? "100%" : height,
            minHeight: fill ? 0 : height,
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(2,6,23,0.35)",
            touchAction: "none",
          }}
        />
        {loading ? (
          <div style={{ position: "absolute", top: 10, left: 12, fontSize: 12, fontWeight: 700, color: "#9fb0c7", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 10px" }}>
            Loading…
          </div>
        ) : null}
        {err ? (
          <div style={{ position: "absolute", top: 10, left: 12, fontSize: 12, fontWeight: 700, color: "#fca5a5", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 8, padding: "5px 10px" }}>
            {err}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 6, fontSize: 11, color: "rgba(148,163,184,0.6)", lineHeight: 1.4 }}>
        Interactive chart · drag to pan, scroll / pinch to zoom, drag an axis to stretch it. Tap a drawing to select, then drag to move.
      </div>
    </div>
  );
}
