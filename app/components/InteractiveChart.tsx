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
  createIndicator(value: string | { name: string; calcParams?: number[] }, isStack?: boolean, paneOptions?: { id: string } | null): string | null;
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
  scrollToRealTime(animationDuration?: number): void;
  setBarSpace(space: number): void;
  getBarSpace(): number;
  setPaneOptions(options: { id: string; height?: number; minHeight?: number }): void;
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
  /**
   * Compact single-row toolbar: worded dropdowns collapse to icon-only and the
   * lower indicator panes are shortened to free vertical space. Used for the
   * fullscreen chart on a phone in landscape.
   */
  compact?: boolean;
  /** Extra controls pinned to the right of the toolbar row (e.g. the mode
   * switch + close button, injected by the fullscreen overlay in landscape). */
  trailing?: React.ReactNode;
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

// KLineChart's built-in indicators ship with their own default periods that
// do NOT match the rest of MyStockHarbor (and TradingView-standard settings):
// RSI [6,12,24], EMA [6,12,20], MA [5,10,30,60], KDJ [9,3,3]. That's why the
// Interactive chart's indicators looked different from the Basic chart, the
// summary panel and TradingView. Override the periods here so they line up.
// BOLL [20,2] and MACD [12,26,9] already match KLineChart's defaults, so they
// are intentionally omitted (left at their built-in values). RSI additionally
// gets a custom Wilder-smoothed calc registered below -- KLineChart's built-in
// RSI uses a simple (Cutler) average, which drifts from TradingView's Wilder
// RSI even at the same period.
const INDICATOR_CALC_PARAMS: Partial<Record<IndicatorName, number[]>> = {
  MA: [50, 200],
  EMA: [20],
  RSI: [14],
  KDJ: [14, 3, 3],
};

// Custom-draw factory: paints a TradingView-style shaded band + dashed
// threshold lines in the neutral zone of a bounded oscillator, then returns
// false so KLineChart still renders the indicator's own lines on top. Fully
// guarded so a drawing hiccup can never break the pane (worst case: no band,
// lines still show). Coordinates are pane-relative: x spans 0..bounding.width
// and yAxis.convertToPixel maps an oscillator value to its pane y.
type BandDrawParams = {
  ctx: CanvasRenderingContext2D;
  bounding: { width: number };
  yAxis: { convertToPixel: (value: number) => number };
};
function thresholdBandDraw(lower: number, upper: number, fill: string) {
  return (params: BandDrawParams): boolean => {
    try {
      const { ctx, bounding, yAxis } = params;
      const yUpper = yAxis.convertToPixel(upper);
      const yLower = yAxis.convertToPixel(lower);
      const top = Math.min(yUpper, yLower);
      const h = Math.abs(yLower - yUpper);
      const w = bounding.width;
      ctx.save();
      ctx.fillStyle = fill;
      ctx.fillRect(0, top, w, h);
      ctx.strokeStyle = "rgba(148,163,184,0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, yUpper); ctx.lineTo(w, yUpper); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, yLower); ctx.lineTo(w, yLower); ctx.stroke();
      ctx.restore();
    } catch { /* noop */ }
    return false;
  };
}

// Register custom versions of KLineChart's built-in "RSI" and "KDJ" so the
// Interactive chart's oscillators match the Basic chart / summary panel /
// TradingView (correct math) AND get TradingView's shaded neutral-zone band.
// Runs once per page (idempotent). Typed loosely because klinecharts template
// / DataList shapes vary between minor versions; we only touch OHLC fields and
// return figure maps.
//  - RSI: Wilder smoothing (built-in uses a simple/Cutler average), period 14 --
//    verified bit-identical to lib/indicators.ts rsiWilder. Band 30-70.
//  - KDJ: standard slow-stochastic K/D/J at 14,3,3 (built-in defaults to 9,3,3),
//    the same slow %K/%D TradingView's default Stochastic shows, plus J. Band
//    20-80.
let customIndicatorsRegistered = false;
function registerCustomIndicators(kl: unknown) {
  if (customIndicatorsRegistered) return;
  const register = (kl as { registerIndicator?: (t: unknown) => void }).registerIndicator;
  if (typeof register !== "function") return;

  register({
    name: "RSI",
    shortName: "RSI",
    calcParams: [14],
    figures: [{ key: "rsi", title: "RSI: ", type: "line" }],
    draw: thresholdBandDraw(30, 70, "rgba(167,139,250,0.09)"),
    calc: (dataList: Array<{ close: number }>, indicator: { calcParams?: number[] }) => {
      const period = indicator?.calcParams?.[0] ?? 14;
      const out: Array<{ rsi?: number }> = dataList.map(() => ({}));
      if (dataList.length < period + 1) return out;
      let gain = 0, loss = 0;
      for (let i = 1; i <= period; i++) {
        const d = dataList[i].close - dataList[i - 1].close;
        if (d >= 0) gain += d; else loss -= d;
      }
      let avgGain = gain / period, avgLoss = loss / period;
      out[period] = { rsi: 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss)) };
      for (let i = period + 1; i < dataList.length; i++) {
        const d = dataList[i].close - dataList[i - 1].close;
        avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
        out[i] = { rsi: 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss)) };
      }
      return out;
    },
  });

  register({
    name: "KDJ",
    shortName: "KDJ",
    calcParams: [14, 3, 3],
    figures: [
      { key: "k", title: "K: ", type: "line" },
      { key: "d", title: "D: ", type: "line" },
      { key: "j", title: "J: ", type: "line" },
    ],
    draw: thresholdBandDraw(20, 80, "rgba(56,189,248,0.08)"),
    calc: (dataList: Array<{ high: number; low: number; close: number }>, indicator: { calcParams?: number[] }) => {
      const ps = indicator?.calcParams ?? [14, 3, 3];
      const n = ps[0] ?? 14, m1 = ps[1] ?? 3, m2 = ps[2] ?? 3;
      let prevK = 50, prevD = 50;
      return dataList.map((_d, i) => {
        let hh = -Infinity, ll = Infinity;
        const start = Math.max(0, i - n + 1);
        for (let j = start; j <= i; j++) {
          const h = dataList[j].high, l = dataList[j].low;
          if (typeof h === "number" && h > hh) hh = h;
          if (typeof l === "number" && l < ll) ll = l;
        }
        const close = dataList[i].close;
        const rsv = hh === ll || !Number.isFinite(hh) || !Number.isFinite(ll) ? 0 : ((close - ll) / (hh - ll)) * 100;
        const k = ((m1 - 1) * prevK + rsv) / m1;
        const d = ((m2 - 1) * prevD + k) / m2;
        prevK = k; prevD = d;
        return { k, d, j: 3 * k - 2 * d };
      });
    },
  });

  customIndicatorsRegistered = true;
}

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

// ---- Icons (small inline SVGs, inherit currentColor) ----------------------
function IconWrap({ children, size = 15 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }} aria-hidden="true">
      {children}
    </svg>
  );
}

// Candlestick display-type icons.
const TYPE_ICONS: Record<ChartTypeKey, React.ReactNode> = {
  candle_solid: (
    <IconWrap><line x1="8" y1="2" x2="8" y2="14" /><rect x="5.3" y="5" width="5.4" height="6" rx="0.6" fill="currentColor" stroke="none" /></IconWrap>
  ),
  candle_stroke: (
    <IconWrap><line x1="8" y1="2" x2="8" y2="14" /><rect x="5.3" y="5" width="5.4" height="6" rx="0.6" /></IconWrap>
  ),
  ohlc: (
    <IconWrap><line x1="8" y1="2.5" x2="8" y2="13.5" /><line x1="4.5" y1="5" x2="8" y2="5" /><line x1="8" y1="10" x2="11.5" y2="10" /></IconWrap>
  ),
  area: (
    <IconWrap><polyline points="2,11 6,6 9.5,9 14,3" /></IconWrap>
  ),
  heikin_ashi: (
    <IconWrap><line x1="5" y1="3" x2="5" y2="12" /><rect x="3" y="6" width="4" height="4.5" rx="0.5" fill="currentColor" stroke="none" /><line x1="11" y1="4.5" x2="11" y2="13.5" /><rect x="9" y="7.5" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" /></IconWrap>
  ),
};

// Drawing-tool icons, keyed by DRAW_TOOLS[].key.
const TOOL_ICONS: Record<string, React.ReactNode> = {
  trend: (
    <IconWrap><line x1="2.5" y1="13" x2="13.5" y2="3.5" /><circle cx="2.5" cy="13" r="1.3" fill="currentColor" stroke="none" /><circle cx="13.5" cy="3.5" r="1.3" fill="currentColor" stroke="none" /></IconWrap>
  ),
  ray: (
    <IconWrap><circle cx="3" cy="12.5" r="1.5" fill="currentColor" stroke="none" /><line x1="3" y1="12.5" x2="14.5" y2="2.8" /></IconWrap>
  ),
  extended: (
    <IconWrap><line x1="1" y1="14.5" x2="15" y2="1.5" /></IconWrap>
  ),
  horizontal: (
    <IconWrap><line x1="1.5" y1="8" x2="14.5" y2="8" /></IconWrap>
  ),
  vertical: (
    <IconWrap><line x1="8" y1="1.5" x2="8" y2="14.5" /></IconWrap>
  ),
  priceline: (
    <IconWrap><line x1="1" y1="8" x2="10" y2="8" strokeDasharray="2 2" /><rect x="10.5" y="5.5" width="4.5" height="5" rx="1" /></IconWrap>
  ),
  fib: (
    <IconWrap><line x1="2" y1="3.5" x2="14" y2="3.5" /><line x1="2" y1="6.5" x2="14" y2="6.5" /><line x1="2" y1="9.5" x2="14" y2="9.5" /><line x1="2" y1="12.5" x2="14" y2="12.5" /></IconWrap>
  ),
  note: (
    <IconWrap><rect x="2" y="2.8" width="12" height="8.2" rx="1.6" /><path d="M5.5 11 L5.5 13.6 L8.2 11" /></IconWrap>
  ),
};

const PENCIL_ICON = (
  <IconWrap><path d="M10.8 2.6 L13.4 5.2 L5.6 13 L2.6 13.6 L3.2 10.6 Z" /><line x1="9.6" y1="3.8" x2="12.2" y2="6.4" /></IconWrap>
);
const INDICATORS_ICON = (
  <IconWrap><line x1="2" y1="13" x2="2" y2="9" /><line x1="6" y1="13" x2="6" y2="5" /><line x1="10" y1="13" x2="10" y2="7" /><line x1="14" y1="13" x2="14" y2="3" /></IconWrap>
);
const RECENTER_ICON = (
  <IconWrap><circle cx="8" cy="8" r="3.1" /><line x1="8" y1="1.4" x2="8" y2="3.3" /><line x1="8" y1="12.7" x2="8" y2="14.6" /><line x1="1.4" y1="8" x2="3.3" y2="8" /><line x1="12.7" y1="8" x2="14.6" y2="8" /></IconWrap>
);
const UNDO_ICON = (
  <IconWrap><path d="M5.5 4 L2.8 6.8 L5.5 9.6" /><path d="M2.8 6.8 H10.4 A2.8 2.8 0 0 1 13.2 9.6 V12.4" /></IconWrap>
);
const CLEAR_ICON = (
  <IconWrap><line x1="2.5" y1="4.4" x2="13.5" y2="4.4" /><path d="M4.6 4.4 V13 H11.4 V4.4" /><path d="M6.4 4.4 V3 H9.6 V4.4" /><line x1="6.6" y1="7" x2="6.6" y2="11" /><line x1="9.4" y1="7" x2="9.4" y2="11" /></IconWrap>
);

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

export default function InteractiveChart({ symbol, seed, isMobile = false, fill = false, height = 460, compact = false, trailing }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const disposeRef = useRef<((el: HTMLElement) => void) | null>(null);
  const rawDataRef = useRef<KLineData[]>(seed ? mapToKLine(seed) : []);
  const overlayIdsRef = useRef<string[]>([]);
  // indicator name -> pane id (for removal). Price overlays share "candle_pane".
  const indicatorPanesRef = useRef<Record<string, string>>({});
  const readyRef = useRef(false);
  const compactRef = useRef(compact);

  const [interval, setIntervalKey] = useState<Interval>("d");
  const [chartType, setChartType] = useState<ChartTypeKey>("candle_solid");
  const [activeIndicators, setActiveIndicators] = useState<IndicatorName[]>(["VOL"]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [drawMenuOpen, setDrawMenuOpen] = useState(false);
  // Fixed (viewport-relative) coords for whichever toolbar dropdown is open.
  // Computed from the trigger button's rect on open and clamped to the
  // viewport so a menu never runs off the right edge on a narrow phone.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const indicatorMenuRef = useRef<HTMLDivElement | null>(null);
  const typeMenuRef = useRef<HTMLDivElement | null>(null);
  const drawMenuRef = useRef<HTMLDivElement | null>(null);
  // Default candle width captured at init, restored by "Recenter".
  const defaultBarSpaceRef = useRef<number | null>(null);

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
      // Apply MyStockHarbor-standard periods where they differ from
      // KLineChart's built-in defaults (see INDICATOR_CALC_PARAMS).
      const calcParams = INDICATOR_CALC_PARAMS[name];
      const createValue = calcParams ? { name, calcParams } : name;
      try {
        const paneId = isPrice
          ? chart.createIndicator(createValue, true, { id: "candle_pane" })
          : chart.createIndicator(createValue);
        if (paneId) indicatorPanesRef.current[name] = paneId;
        else if (isPrice) indicatorPanesRef.current[name] = "candle_pane";
        // Shorten new lower panes in compact (landscape) mode.
        if (paneId && !isPrice) {
          try { chart.setPaneOptions({ id: paneId, height: compactRef.current ? 48 : 82 }); } catch { /* noop */ }
        }
      } catch { /* noop */ }
    }
  }, []);

  // Resize the lower indicator panes when compact mode toggles (landscape) so
  // the main price chart gets more room.
  const applyPaneHeights = useCallback((isCompact: boolean) => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const [name, paneId] of Object.entries(indicatorPanesRef.current)) {
      if ((PRICE_INDICATORS as readonly string[]).includes(name)) continue;
      if (!paneId || paneId === "candle_pane") continue;
      try { chart.setPaneOptions({ id: paneId, height: isCompact ? 48 : 82 }); } catch { /* noop */ }
    }
  }, []);

  useEffect(() => {
    compactRef.current = compact;
    applyPaneHeights(compact);
    // Nudge a resize so the layout recalculates immediately.
    try { chartRef.current?.resize(); } catch { /* noop */ }
  }, [compact, applyPaneHeights]);

  // ---- Init chart (client only) ----
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    (async () => {
      const el = containerRef.current;
      if (!el) return;
      const kl = await import("klinecharts");
      if (cancelled) return;
      // Override the built-in RSI/KDJ with our own (correct math + shaded
      // neutral-zone band) before the chart is created so createIndicator
      // uses them. Idempotent.
      try { registerCustomIndicators(kl); } catch { /* noop */ }
      disposeRef.current = kl.dispose as unknown as (element: HTMLElement) => void;

      const chart = (kl.init(el) as unknown) as ChartApi | null;
      if (!chart) return;
      chartRef.current = chart;
      readyRef.current = true;

      chart.setStyles(CHART_STYLES);

      // Remember the default candle width so "Recenter" can restore the zoom.
      try {
        const bs = chart.getBarSpace();
        if (typeof bs === "number" && Number.isFinite(bs) && bs > 0) defaultBarSpaceRef.current = bs;
      } catch { /* noop */ }

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
    setDrawMenuOpen(false);
    try {
      const value = overlay === "simpleAnnotation"
        ? { name: overlay, extendData: "Note" }
        : overlay;
      const id = chart.createOverlay(value);
      if (id) overlayIdsRef.current.push(id);
    } catch { /* noop */ }
    // The overlay stays in "drawing" mode until the user places its points;
    // reset the visual active state shortly after so the button doesn't stay lit.
    window.setTimeout(() => setActiveTool(null), 600);
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

  // Reset the view: restore the default zoom and scroll the latest data back
  // into frame. Does not touch data, indicators or drawings.
  function recenter() {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      if (defaultBarSpaceRef.current) chart.setBarSpace(defaultBarSpaceRef.current);
    } catch { /* noop */ }
    try { chart.scrollToRealTime(300); } catch { /* noop */ }
    try { chart.setOffsetRightDistance(isMobile ? 8 : 12); } catch { /* noop */ }
  }

  // ---- Close menus on outside click ----
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (indicatorMenuRef.current && !indicatorMenuRef.current.contains(t)) setIndicatorMenuOpen(false);
      if (typeMenuRef.current && !typeMenuRef.current.contains(t)) setTypeMenuOpen(false);
      if (drawMenuRef.current && !drawMenuRef.current.contains(t)) setDrawMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const activeTypeLabel = useMemo(
    () => CHART_TYPES.find((t) => t.key === chartType)?.label ?? "Candle",
    [chartType]
  );

  // Position an about-to-open dropdown just under its trigger button, using
  // fixed (viewport) coordinates clamped horizontally so the menu stays fully
  // on screen even when the button sits near the right edge on mobile.
  const openMenuAt = (el: HTMLElement, menuWidth: number) => {
    const rect = el.getBoundingClientRect();
    const vw = typeof window !== "undefined" ? window.innerWidth : rect.right;
    const left = Math.max(8, Math.min(rect.left, vw - menuWidth - 8));
    setMenuPos({ top: rect.bottom + 6, left });
  };

  // ---- Styles ----
  // `dense` = landscape single-row icon-only toolbar.
  const dense = compact;
  const iconOnlyActions = compact || isMobile;
  const btn = (active: boolean): React.CSSProperties => ({
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 8,
    padding: dense ? "5px 7px" : isMobile ? "8px 10px" : "6px 10px",
    background: active ? "rgba(96,165,250,0.24)" : "rgba(255,255,255,0.04)",
    color: active ? "#dbeafe" : "#9fb0c7",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1.1,
    minHeight: dense ? 30 : isMobile ? 36 : undefined,
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
          gap: dense ? 6 : 8,
          // Only the dense (landscape fullscreen) toolbar stays a single
          // horizontally-scrolling row. In portrait/mobile we must NOT use
          // overflowX:auto here: when either overflow axis is non-visible the
          // other computes to "auto" too, which clips the dropdown menus that
          // open downward out of the toolbar box -- that's the bug where the
          // Candle / Indicators / Drawing-tools menus appeared hidden behind
          // the chart on mobile. Letting the toolbar wrap keeps overflow
          // visible so the menus can escape and paint above the chart.
          flexWrap: dense ? "nowrap" : "wrap",
          overflowX: dense ? "auto" : "visible",
          padding: dense ? "0 2px 5px" : "2px 2px 10px",
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
          <button type="button" onClick={(e) => { const willOpen = !typeMenuOpen; setIndicatorMenuOpen(false); setDrawMenuOpen(false); if (willOpen) openMenuAt(e.currentTarget, 178); setTypeMenuOpen(willOpen); }} title={dense ? activeTypeLabel : undefined} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: dense ? 3 : 6 }}>
            {TYPE_ICONS[chartType]}{!dense ? <span>{activeTypeLabel}</span> : null}<span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {typeMenuOpen ? (
            <div style={{ position: "fixed", top: menuPos?.top ?? 0, left: menuPos?.left ?? 0, zIndex: 3000, minWidth: 178, maxWidth: "calc(100vw - 16px)", background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)", overflow: "hidden" }}>
              {CHART_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setChartType(t.key); setTypeMenuOpen(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "10px 13px", border: "none", background: chartType === t.key ? "rgba(96,165,250,0.18)" : "transparent", color: chartType === t.key ? "#dbeafe" : "#cbd5e1", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                >
                  {TYPE_ICONS[t.key]}<span>{t.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Indicators dropdown */}
        <div style={{ position: "relative" }} ref={indicatorMenuRef}>
          <button type="button" onClick={(e) => { const willOpen = !indicatorMenuOpen; setTypeMenuOpen(false); setDrawMenuOpen(false); if (willOpen) openMenuAt(e.currentTarget, 250); setIndicatorMenuOpen(willOpen); }} title={dense ? "Indicators" : undefined} style={{ ...btn(activeIndicators.length > 0), display: "inline-flex", alignItems: "center", gap: dense ? 4 : 6 }}>
            {dense ? INDICATORS_ICON : null}
            {dense
              ? (activeIndicators.length ? <span style={{ fontSize: 11 }}>{activeIndicators.length}</span> : null)
              : <span>Indicators{activeIndicators.length ? ` · ${activeIndicators.length}` : ""}</span>}
            <span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {indicatorMenuOpen ? (
            <div style={{ position: "fixed", top: menuPos?.top ?? 0, left: menuPos?.left ?? 0, zIndex: 3000, width: 250, maxWidth: "calc(100vw - 16px)", maxHeight: 340, overflowY: "auto", background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)" }}>
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

        {/* Drawing tools dropdown */}
        <div style={{ position: "relative" }} ref={drawMenuRef}>
          <button type="button" onClick={(e) => { const willOpen = !drawMenuOpen; setTypeMenuOpen(false); setIndicatorMenuOpen(false); if (willOpen) openMenuAt(e.currentTarget, 210); setDrawMenuOpen(willOpen); }} title={dense ? "Drawing tools" : undefined} style={{ ...btn(drawMenuOpen || activeTool != null), display: "inline-flex", alignItems: "center", gap: dense ? 3 : 6 }}>
            {PENCIL_ICON}{!dense ? <span>Drawing tools</span> : null}<span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {drawMenuOpen ? (
            <div style={{ position: "fixed", top: menuPos?.top ?? 0, left: menuPos?.left ?? 0, zIndex: 3000, width: 210, maxWidth: "calc(100vw - 16px)", background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)", overflow: "hidden" }}>
              <div style={{ padding: "8px 12px 6px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7c8aa3" }}>Draw</div>
              {DRAW_TOOLS.map((tool) => (
                <button
                  key={tool.key}
                  type="button"
                  onClick={() => startTool(tool.overlay, tool.key)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderTop: "1px solid rgba(255,255,255,0.05)", background: activeTool === tool.key ? "rgba(96,165,250,0.18)" : "transparent", color: "#cbd5e1", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                >
                  {TOOL_ICONS[tool.key]}<span>{tool.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Actions: recenter / undo / clear */}
        <div style={groupWrap} role="group" aria-label="Chart actions">
          <button type="button" onClick={recenter} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6 }} title="Recenter chart">
            {RECENTER_ICON}{!iconOnlyActions ? <span>Recenter</span> : null}
          </button>
          <button type="button" onClick={undoLastDrawing} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6 }} title="Undo last drawing">
            {UNDO_ICON}{!iconOnlyActions ? <span>Undo</span> : null}
          </button>
          <button type="button" onClick={clearDrawings} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6 }} title="Remove all drawings">
            {CLEAR_ICON}{!iconOnlyActions ? <span>Clear</span> : null}
          </button>
        </div>

        {/* Injected controls (mode switch + close) pinned right in landscape */}
        {trailing ? (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            {trailing}
          </div>
        ) : null}
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

      {!compact ? (
        <div style={{ marginTop: 6, fontSize: 11, color: "rgba(148,163,184,0.6)", lineHeight: 1.4 }}>
          Interactive chart · drag to pan, scroll / pinch to zoom, drag an axis to stretch it. Tap a drawing to select, then drag to move.
        </div>
      ) : null}
    </div>
  );
}
