"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  computeTrendHelper,
  smaSeries,
  TREND_HELPER_COLORS,
  TREND_HELPER_SLOW,
  TREND_HELPER_FAST,
} from "@/lib/ta/trendHelper";
import { readStored, writeStored } from "@/lib/browserStorage";
import {
  buildChartMenu, clampMenu, parseAction, percentBase, readScale, SCALE_KEY,
  LONG_PRESS_MS, LONG_PRESS_SLOP, type MenuSection, type ScaleMode,
} from "@/lib/interactiveChartMenu";
import { MEASURE_TOOLS, measureColor, measureLabel, measureStats, type MeasureKind, type MeasurePoint } from "@/lib/measure";
import { formatBarDate } from "@/lib/chartDate";

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
  getSize(paneId?: string, position?: "root" | "main" | "yAxis"): { left: number; top: number; width: number; height: number } | null;
  getVisibleRange(): { from: number; to: number };
  getDataList(): KLineData[];
  subscribeAction(type: string, callback: (data?: unknown) => void): void;
  unsubscribeAction(type: string, callback?: (data?: unknown) => void): void;
  overrideOverlay(override: Record<string, unknown>): void;
  convertFromPixel(coordinates: Array<{ x?: number; y?: number }>, finder: { paneId?: string; absolute?: boolean }): unknown;
  setTimezone(timezone: string): void;
  setCustomApi(api: Record<string, unknown>): void;
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
  /** Opens the chart fullscreen. Omitted when already fullscreen. (#553 COWORK #28) */
  onFullscreen?: () => void;
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
const PRICE_INDICATORS = ["MA", "EMA", "BOLL", "NCT_SMOOTH", "NCT_FAST"] as const;
const LOWER_INDICATORS = ["VOL", "MACD", "RSI", "KDJ"] as const;
type IndicatorName = (typeof PRICE_INDICATORS)[number] | (typeof LOWER_INDICATORS)[number];

const INDICATOR_LABELS: Record<IndicatorName, string> = {
  MA: "MA (Moving Averages)",
  EMA: "EMA",
  BOLL: "Bollinger Bands",
  NCT_SMOOTH: "Trend Helper — Smooth",
  NCT_FAST: "Trend Helper — Fast",
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

// ---- Noise Cutter Trend Helper (ported from the user's Pine v6) -----------
// A trend-following price overlay: an HMA trend line coloured by a *confirmed*
// up/down state (needs N consecutive bars closing the same side of a rising/
// falling HMA before the colour flips, so single-bar noise doesn't recolour
// it), plus a purple MA200. Improvement over the original Pine: once a
// direction is confirmed the colour is *held* through pullbacks until the
// opposite direction confirms, instead of dropping back to grey on any single
// counter-bar -- much less flicker. Two presets: Smooth (HMA 55, confirm 2)
// and Fast (HMA 21, confirm 1).
// Colours and math both come from lib/ta/trendHelper.ts -- the single source
// of truth shared with PriceChart.tsx and the server-side picker builder.
const { bull: NCT_BULL, bear: NCT_BEAR, neutral: NCT_NEUTRAL, ma200: NCT_MA200 } = TREND_HELPER_COLORS;

type NctRow = { trend: number | null; ma200: number | null; state: number };

// Builds a KLineChart price-overlay template for one Trend Helper preset. The
// coloured trend line + MA200 are painted in a custom draw (returns true = we
// own the rendering); on any error it returns false so KLineChart falls back
// to plain single-colour figure lines rather than breaking the pane.
function makeTrendHelper(name: "NCT_SMOOTH" | "NCT_FAST", trendLen: number, confirmBars: number) {
  return {
    name,
    shortName: name === "NCT_FAST" ? "Trend Helper (Fast)" : "Trend Helper (Smooth)",
    series: "price",
    figures: [
      { key: "trend", title: "Trend: ", type: "line" },
      { key: "ma200", title: "MA200: ", type: "line" },
    ],
    calc: (dataList: Array<{ close: number }>) => {
      const closes = dataList.map((d) => d.close);
      const { line, state } = computeTrendHelper(closes, trendLen, confirmBars);
      const ma200 = smaSeries(closes, 200);
      return dataList.map((_d, i): NctRow => ({
        trend: line[i] ?? null,
        ma200: ma200[i] ?? null,
        state: state[i],
      }));
    },
    draw: (params: {
      ctx: CanvasRenderingContext2D;
      indicator: { result?: NctRow[] };
      visibleRange: { from: number; to: number };
      xAxis: { convertToPixel: (v: number) => number };
      yAxis: { convertToPixel: (v: number) => number };
    }): boolean => {
      try {
        const { ctx, indicator, visibleRange, xAxis, yAxis } = params;
        const result = indicator?.result;
        if (!result || !result.length) return true;
        const from = Math.max(0, visibleRange.from);
        const to = Math.min(result.length, visibleRange.to);
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        // MA200 (purple)
        ctx.strokeStyle = NCT_MA200;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (let i = from; i < to; i++) {
          const v = result[i]?.ma200;
          if (typeof v !== "number" || !Number.isFinite(v)) { started = false; continue; }
          const px = xAxis.convertToPixel(i), py = yAxis.convertToPixel(v);
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        // Trend line, coloured per bar by confirmed state.
        ctx.lineWidth = 3;
        for (let i = Math.max(1, from); i < to; i++) {
          const a = result[i - 1]?.trend, b = result[i]?.trend;
          if (typeof a !== "number" || !Number.isFinite(a) || typeof b !== "number" || !Number.isFinite(b)) continue;
          const st = result[i]?.state ?? 0;
          ctx.strokeStyle = st > 0 ? NCT_BULL : st < 0 ? NCT_BEAR : NCT_NEUTRAL;
          ctx.beginPath();
          ctx.moveTo(xAxis.convertToPixel(i - 1), yAxis.convertToPixel(a));
          ctx.lineTo(xAxis.convertToPixel(i), yAxis.convertToPixel(b));
          ctx.stroke();
        }
        ctx.restore();
        return true;
      } catch {
        return false;
      }
    },
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

  // Noise Cutter Trend Helper — two presets, price overlays on the candle pane.
  register(makeTrendHelper("NCT_SMOOTH", TREND_HELPER_SLOW.trendLen, TREND_HELPER_SLOW.confirmBars));
  register(makeTrendHelper("NCT_FAST", TREND_HELPER_FAST.trendLen, TREND_HELPER_FAST.confirmBars));

  customIndicatorsRegistered = true;
}

// ---- Measure tools (#553 COWORK #28 part b) ----
// klinecharts has no built-in price/date range tool (its fibonacciLine is a
// retracement), so the three are CUSTOM OVERLAYS registered with
// registerOverlay: a tinted box between the two points, an arrow from the
// start to the end, and a solid label. Being overlays, they select, drag (by a
// corner or the box), undo and remove exactly like the drawings. The numbers
// and the label text come from lib/measure.ts.
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
type Coord = { x: number; y: number };
function arrowHead(from: Coord, to: Coord, size = 7): Coord[] {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  return [
    to,
    { x: to.x - size * Math.cos(ang - Math.PI / 7), y: to.y - size * Math.sin(ang - Math.PI / 7) },
    { x: to.x - size * Math.cos(ang + Math.PI / 7), y: to.y - size * Math.sin(ang + Math.PI / 7) },
  ];
}
let measureOverlaysRegistered = false;
function registerMeasureOverlays(kl: unknown) {
  if (measureOverlaysRegistered) return;
  const register = (kl as { registerOverlay: (t: Record<string, unknown>) => void }).registerOverlay;
  for (const tool of MEASURE_TOOLS) {
    register({
      name: tool.overlay,
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: tool.key !== "price",
      needDefaultYAxisFigure: tool.key !== "date",
      createPointFigures: ({ overlay, coordinates, bounding, precision }: {
        overlay: { points: MeasurePoint[] }; coordinates: Coord[];
        bounding: { width: number; height: number }; precision: { price: number };
      }) => {
        if (coordinates.length < 2) return [];
        const [a, b] = coordinates;
        const stats = measureStats(overlay.points[0] ?? {}, overlay.points[1] ?? {});
        const color = measureColor(tool.key, stats);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const figures: Record<string, unknown>[] = [
          { type: "rect", attrs: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
            styles: { style: "stroke_fill", color: tint(color, 0.14), borderColor: tint(color, 0.55), borderSize: 1 } },
        ];
        const arrow = (from: Coord, to: Coord) => {
          if (Math.hypot(to.x - from.x, to.y - from.y) < 6) return;
          figures.push({ type: "line", attrs: { coordinates: [from, to] }, styles: { color, size: 1.5 }, ignoreEvent: true });
          figures.push({ type: "polygon", attrs: { coordinates: arrowHead(from, to) }, styles: { style: "fill", color }, ignoreEvent: true });
        };
        if (tool.key !== "date") arrow({ x: midX, y: a.y }, { x: midX, y: b.y });
        if (tool.key !== "price") arrow({ x: a.x, y: midY }, { x: b.x, y: midY });
        // The label sits past the END of the move: above the box when it rose,
        // below when it fell, kept inside the pane.
        const lines = measureLabel(tool.key, stats, precision?.price ?? 2);
        if (!lines.length) return figures;
        const LINE_H = 20;
        const blockH = lines.length * LINE_H;
        const widest = Math.max(...lines.map((l) => l.length)) * 7.4 + 14;
        const x = Math.max(widest / 2 + 2, Math.min(midX, bounding.width - widest / 2 - 2));
        const above = tool.key === "date" ? false : stats.up;
        let top = above ? Math.min(a.y, b.y) - 6 - blockH : Math.max(a.y, b.y) + 6;
        top = Math.max(2, Math.min(top, bounding.height - blockH - 2));
        lines.forEach((text, i) => {
          figures.push({
            type: "text",
            attrs: { x, y: top + i * LINE_H, text, align: "center", baseline: "top" },
            styles: { color: "#ffffff", size: 12, weight: "bold", backgroundColor: color, borderRadius: 4, paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 3 },
          });
        });
        return figures;
      },
    });
  }
  measureOverlaysRegistered = true;
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
const RULER_ICON = (
  <IconWrap><rect x="1.8" y="5.2" width="12.4" height="5.6" rx="0.8" /><line x1="4.4" y1="5.2" x2="4.4" y2="7.6" /><line x1="7" y1="5.2" x2="7" y2="8.4" /><line x1="9.6" y1="5.2" x2="9.6" y2="7.6" /><line x1="12.2" y1="5.2" x2="12.2" y2="8.4" /></IconWrap>
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

// ---- Right-click menu and phone sheet (#553 COWORK #28) -------------------
// Both render the same buildChartMenu() model (lib/interactiveChartMenu.ts).

const MENU_W = 196;
// Fly-outs are wider: indicator names ("Trend Helper — Smooth") stay on one line.
const SUB_W = 236;
const MENU_ITEM_H = 32;

/**
 * Desktop right-click menu: a compact list, sub-menus fly out to the side.
 * Keyboard: ↑/↓ move, → or Enter opens a sub-menu, ← closes it, Esc closes.
 */
function ChartContextMenu({ sections, at, box, onAction, onClose }: {
  sections: MenuSection[];
  at: { x: number; y: number };
  box: { width: number; height: number };
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ level: 0 | 1; i: number }>({ level: 0, i: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pos = clampMenu(at.x, at.y, MENU_W, sections.length * MENU_ITEM_H + 8, box.width, box.height);
  const sub = sections.find((s) => s.key === open)?.items ?? [];
  const openIndex = sections.findIndex((s) => s.key === open);
  // The fly-out opens to the right, or to the left when the chart has no room.
  const flyLeft = pos.left + MENU_W + SUB_W + 8 > box.width;
  const subTop = Math.max(6, Math.min(openIndex * MENU_ITEM_H, box.height - pos.top - sub.length * MENU_ITEM_H - 14));

  useEffect(() => { rootRef.current?.querySelector<HTMLElement>("[data-mi='0-0']")?.focus(); }, []);
  useEffect(() => { rootRef.current?.querySelector<HTMLElement>(`[data-mi='${focus.level}-${focus.i}']`)?.focus(); }, [focus, open]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [onClose]);

  const activate = (sec: MenuSection) => {
    if (sec.items?.length) { setOpen(sec.key); setFocus({ level: 1, i: 0 }); }
    else if (sec.id) onAction(sec.id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const n = focus.level === 0 ? sections.length : sub.length;
    if (e.key === "Escape") { e.preventDefault(); if (focus.level === 1) { setFocus({ level: 0, i: openIndex }); setOpen(null); } else onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setFocus({ ...focus, i: (focus.i + 1) % n }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocus({ ...focus, i: (focus.i - 1 + n) % n }); }
    else if (e.key === "ArrowRight" && focus.level === 0) { e.preventDefault(); const sec = sections[focus.i]; if (sec?.items?.length) activate(sec); }
    else if (e.key === "ArrowLeft" && focus.level === 1) { e.preventDefault(); setFocus({ level: 0, i: openIndex }); setOpen(null); }
  };
  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, width: "100%", height: MENU_ITEM_H, padding: "0 12px", border: "none", textAlign: "left",
    background: active ? "rgba(96,165,250,0.18)" : "transparent", color: "#cbd5e1", fontWeight: 700, fontSize: 12.5, cursor: "pointer", outline: "none",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  });
  const panel: React.CSSProperties = {
    position: "absolute", width: MENU_W, background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10,
    boxShadow: "0 16px 30px rgba(0,0,0,0.5)", padding: "4px 0", zIndex: 40,
  };
  return (
    <div ref={rootRef} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()} data-chart-menu style={{ position: "absolute", left: pos.left, top: pos.top, zIndex: 40 }}>
      <div role="menu" aria-label="Chart menu" style={{ ...panel, position: "relative" }}>
        {sections.map((sec, i) => (
          <button key={sec.key} type="button" role="menuitem" data-mi={`0-${i}`} tabIndex={-1}
            aria-haspopup={sec.items?.length ? "menu" : undefined} aria-expanded={sec.items?.length ? open === sec.key : undefined}
            onMouseEnter={() => { setOpen(sec.items?.length ? sec.key : null); }}
            onFocus={() => setFocus((f) => (f.level === 0 && f.i === i ? f : { level: 0, i }))}
            onClick={() => activate(sec)}
            style={itemStyle(open === sec.key || (focus.level === 0 && focus.i === i))}>
            <span style={{ flex: 1 }}>{sec.label}</span>{sec.items?.length ? <span aria-hidden="true" style={{ opacity: 0.6 }}>▸</span> : null}
          </button>
        ))}
        {open && sub.length ? (
          <div role="menu" aria-label={sections[openIndex]?.label} data-chart-submenu={open}
            style={{ ...panel, width: SUB_W, top: subTop, [flyLeft ? "right" : "left"]: MENU_W - 2 }}>
            {sub.map((it, j) => (
              <button key={it.id} type="button" role="menuitemcheckbox" aria-checked={Boolean(it.checked)} data-mi={`1-${j}`} tabIndex={-1}
                onFocus={() => setFocus((f) => (f.level === 1 && f.i === j ? f : { level: 1, i: j }))}
                onClick={() => onAction(it.id)} style={itemStyle(focus.level === 1 && focus.i === j)}>
                <span aria-hidden="true" style={{ width: 12, color: "#93c5fd" }}>{it.checked ? "✓" : ""}</span><span>{it.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Phone: the same menu as a bottom sheet, sub-menus as expandable sections, 44px targets. */
function ChartToolsSheet({ sections, onAction, onClose }: {
  sections: MenuSection[];
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 44, padding: "0 16px", border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "#e2e8f0", fontWeight: 700, fontSize: 15, textAlign: "left", cursor: "pointer" };
  const node = (
    <div data-chart-sheet style={{ position: "fixed", inset: 0, zIndex: 3500 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,0.55)" }} />
      <div role="dialog" aria-label="Chart tools" style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "72vh", overflowY: "auto", background: "#0f172a", borderTop: "1px solid rgba(255,255,255,0.14)", borderRadius: "16px 16px 0 0", paddingBottom: "calc(8px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px" }}>
          <span style={{ fontWeight: 800, color: "#e2e8f0", fontSize: 15 }}>Chart tools</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44, border: "none", background: "transparent", color: "#9fb0c7", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        {sections.map((sec) => (
          <div key={sec.key}>
            <button type="button" style={row} aria-expanded={sec.items?.length ? open === sec.key : undefined}
              onClick={() => (sec.items?.length ? setOpen(open === sec.key ? null : sec.key) : sec.id && onAction(sec.id))}>
              <span style={{ flex: 1 }}>{sec.label}</span>{sec.items?.length ? <span aria-hidden="true" style={{ opacity: 0.6 }}>{open === sec.key ? "▾" : "▸"}</span> : null}
            </button>
            {open === sec.key ? (sec.items ?? []).map((it) => (
              <button key={it.id} type="button" role="menuitemcheckbox" aria-checked={Boolean(it.checked)} onClick={() => onAction(it.id)}
                style={{ ...row, paddingLeft: 32, fontWeight: 600, fontSize: 14, color: it.checked ? "#dbeafe" : "#cbd5e1", background: it.checked ? "rgba(96,165,250,0.14)" : "transparent" }}>
                <span aria-hidden="true" style={{ width: 14, color: "#93c5fd" }}>{it.checked ? "✓" : ""}</span><span>{it.label}</span>
              </button>
            )) : null}
          </div>
        ))}
      </div>
    </div>
  );
  if (typeof document === "undefined") return null;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  const fs = (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) as HTMLElement | null;
  return createPortal(node, fs ?? document.body);
}

// ---- Component ------------------------------------------------------------

export default function InteractiveChart({ symbol, seed, isMobile = false, fill = false, height = 460, compact = false, trailing, onFullscreen }: Props) {
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
  // The open menu's own panel. The panels are portalled out of the toolbar
  // (see menuPortal below), so they are no longer inside the *MenuRef
  // wrappers -- the outside-click handler has to treat both as "inside" or a
  // mousedown on a menu item would close the menu before the click lands.
  const indicatorPanelRef = useRef<HTMLDivElement | null>(null);
  const typePanelRef = useRef<HTMLDivElement | null>(null);
  const drawPanelRef = useRef<HTMLDivElement | null>(null);
  // Default candle width captured at init, restored by "Recenter".
  const defaultBarSpaceRef = useRef<number | null>(null);

  // ---- COWORK #28 (a): % scale, right-click menu, phone sheet; #29 axis drag ----
  // The price axis in price or % (from the FIRST VISIBLE bar: klinecharts'
  // own "percentage" axis). Remembered per viewer; storage is guarded.
  const [scale, setScaleState] = useState<ScaleMode>("price");
  const scaleRef = useRef<ScaleMode>("price");
  // The chip sits at the bottom of the price pane's axis, just above Volume.
  const [chipPos, setChipPos] = useState<{ left: number; top: number } | null>(null);
  const [pctBaseTs, setPctBaseTs] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Touch-first device: the axis touch strips are only mounted here (they
  // would otherwise sit over the axes and take the desktop mouse drag).
  const [coarse, setCoarse] = useState(false);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // ---- COWORK #28 (b), #43: measure tools ----
  // A measure is TEMPORARY (COWORK #43): once drawn, the next click or tap
  // anywhere on the chart (or Esc) removes it and does nothing else. It is not
  // a drawing: not in Undo, not selectable, not draggable, one at a time.
  const [measureMenuOpen, setMeasureMenuOpen] = useState(false);
  const measureMenuRef = useRef<HTMLDivElement | null>(null);
  const measurePanelRef = useRef<HTMLDivElement | null>(null);
  // The selected drawing: Delete (or the phone's Delete pill) removes it.
  const selectedRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The one measure on the chart, being placed (drawn: false) or placed.
  // On touch, panning pauses while it is being placed, so the two taps
  // cannot scroll the chart instead.
  const measureRef = useRef<{ id: string; drawn: boolean } | null>(null);
  const [measure, setMeasureState] = useState<{ id: string; drawn: boolean } | null>(null);
  // The Shift + drag quick measure: not an undoable drawing, gone on the next click.
  const quickRef = useRef<string | null>(null);

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

  // ---- % scale + its chip (#553 COWORK #28) ----
  // setStyles with a y-axis type also turns the price axis's auto-fit back on
  // (klinecharts resets its autoCalcTickFlag), which is what Recenter relies on.
  const applyScale = useCallback((mode: ScaleMode) => {
    try { chartRef.current?.setStyles({ yAxis: { type: mode === "percent" ? "percentage" : "normal" } }); } catch { /* noop */ }
  }, []);

  // Where the chip goes (the bottom of the price pane's axis column, above the
  // Volume pane) and what 0% means right now (the first visible bar).
  const updateChip = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const pane = chart.getSize("candle_pane", "root");
      const axis = chart.getSize("candle_pane", "yAxis");
      if (pane && axis) setChipPos({ left: axis.left + 4, top: pane.top + pane.height - 26 });
    } catch { /* noop */ }
    try {
      const base = percentBase(chart.getDataList(), chart.getVisibleRange().from);
      setPctBaseTs(base ? base.timestamp : null);
    } catch { /* noop */ }
  }, []);

  function setScale(mode: ScaleMode) {
    scaleRef.current = mode;
    setScaleState(mode);
    writeStored(SCALE_KEY, mode);
    applyScale(mode);
    window.requestAnimationFrame(updateChip);
  }

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
      // neutral-zone band) and register the Trend Helper overlays before the
      // chart is created so createIndicator uses them. Idempotent.
      try { registerCustomIndicators(kl); } catch { /* noop */ }
      try { registerMeasureOverlays(kl); } catch { /* noop */ }
      disposeRef.current = kl.dispose as unknown as (element: HTMLElement) => void;

      const chart = (kl.init(el) as unknown) as ChartApi | null;
      if (!chart) return;
      chartRef.current = chart;
      readyRef.current = true;

      chart.setStyles(CHART_STYLES);
      // Every bar is a day, week or month stamped at UTC midnight: dates only,
      // in UTC, in the tooltip, the crosshair label and the axis (#553 COWORK
      // #42). The library's default showed "2026-08-13 01:00" in UK summer time.
      try { chart.setTimezone("UTC"); } catch { /* noop */ }
      try { chart.setCustomApi({ formatDate: (_f: unknown, ts: number, format: string, type: number) => formatBarDate(ts, format, type) }); } catch { /* noop */ }
      // The remembered % / price scale (#553 COWORK #28).
      scaleRef.current = readScale(readStored(SCALE_KEY));
      setScaleState(scaleRef.current);
      applyScale(scaleRef.current);

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

      // The % chip follows the pane layout and the first visible bar.
      try { chart.subscribeAction("onVisibleRangeChange", updateChip); } catch { /* noop */ }
      window.requestAnimationFrame(updateChip);

      // Keep the canvas sized to its container (fullscreen, rotation, resize).
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          try { chartRef.current?.resize(); } catch { /* noop */ }
          window.requestAnimationFrame(updateChip);
        });
        ro.observe(el);
      }
    })();

    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      try { chartRef.current?.unsubscribeAction("onVisibleRangeChange", updateChip); } catch { /* noop */ }
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
        window.requestAnimationFrame(updateChip);
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
    // A lower pane added or removed moves the bottom of the price pane.
    window.requestAnimationFrame(updateChip);
  }

  // ---- Drawing tools ----
  // Every drawing reports selection and removal, so Delete knows what is
  // selected and the id list never keeps a removed overlay.
  function forget(id: string) {
    overlayIdsRef.current = overlayIdsRef.current.filter((x) => x !== id);
    if (selectedRef.current === id) { selectedRef.current = null; setSelectedId(null); }
  }
  type OverlayHookEvent = { overlay: { id: string } };
  const overlayHooks = {
    onSelected: (e: OverlayHookEvent) => { selectedRef.current = e.overlay.id; setSelectedId(e.overlay.id); return false; },
    onDeselected: (e: OverlayHookEvent) => { if (selectedRef.current === e.overlay.id) { selectedRef.current = null; setSelectedId(null); } return false; },
    onRemoved: (e: OverlayHookEvent) => { forget(e.overlay.id); return false; },
  };

  function startTool(overlay: string, key: string) {
    const chart = chartRef.current;
    if (!chart) return;
    clearMeasure();
    setActiveTool(key);
    setDrawMenuOpen(false);
    try {
      const value = overlay === "simpleAnnotation"
        ? { name: overlay, extendData: "Note", ...overlayHooks }
        : { name: overlay, ...overlayHooks };
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
      forget(id);
    }
  }

  function clearDrawings() {
    const chart = chartRef.current;
    if (!chart) return;
    clearMeasure();
    clearQuick();
    for (const id of [...overlayIdsRef.current]) {
      try { chart.removeOverlay({ id }); } catch { /* noop */ }
    }
    overlayIdsRef.current = [];
  }

  // ---- Measure tools (#553 COWORK #28 part b, #43) ----
  function setMeasure(m: { id: string; drawn: boolean } | null) {
    measureRef.current = m;
    setMeasureState(m);
  }
  // Removes the measure (placed, or still being placed) and gives panning back.
  function clearMeasure() {
    const m = measureRef.current;
    if (!m) return;
    setMeasure(null);
    try { chartRef.current?.removeOverlay({ id: m.id }); } catch { /* noop */ }
    try { chartRef.current?.setScrollEnabled(true); } catch { /* noop */ }
  }

  function startMeasure(kind: MeasureKind) {
    const chart = chartRef.current;
    const tool = MEASURE_TOOLS.find((t) => t.key === kind);
    if (!chart || !tool) return;
    setMeasureMenuOpen(false);
    clearMeasure();
    clearQuick();
    let id: string | null = null;
    try {
      id = chart.createOverlay({
        name: tool.overlay,
        onDrawEnd: (e: { overlay: { points: MeasurePoint[] } }) => {
          if (!id || measureRef.current?.id !== id) return false;
          const drawing = id;
          const points = e.overlay.points.map((pt) => ({ ...pt }));
          // Placed: swapped for a LOCKED copy at the same points (no select, no
          // drag). A copy rather than overrideOverlay({ lock }) because the one
          // just drawn stays the library's clicked overlay and keeps showing its
          // corner handles, which say "drag me".
          window.setTimeout(() => {
            const chart2 = chartRef.current;
            if (!chart2 || measureRef.current?.id !== drawing) return;
            try { chart2.removeOverlay({ id: drawing }); } catch { /* noop */ }
            let placed: string | null = null;
            try { placed = chart2.createOverlay({ name: tool.overlay, points, lock: true }); } catch { /* noop */ }
            setMeasure(placed ? { id: placed, drawn: true } : null);
          }, 0);
          setMeasure({ id: drawing, drawn: true });
          try { chartRef.current?.setScrollEnabled(true); } catch { /* noop */ }
          return false;
        },
      });
    } catch { /* noop */ }
    if (!id) return;
    setMeasure({ id, drawn: false });
    if (coarse || isMobile) {
      try { chart.setScrollEnabled(false); } catch { /* noop */ }
    }
  }

  function deleteSelected() {
    const id = selectedRef.current;
    if (!id) return;
    try { chartRef.current?.removeOverlay({ id }); } catch { /* noop */ }
    forget(id);
  }

  function clearQuick() {
    if (!quickRef.current) return;
    try { chartRef.current?.removeOverlay({ id: quickRef.current }); } catch { /* noop */ }
    quickRef.current = null;
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
    // A manual axis stretch turns the price axis's auto-fit off; Recenter
    // turns it back on (as a double-click / double-tap on the axis does).
    applyScale(scaleRef.current);
  }

  // One entry point for the right-click menu and the phone sheet: every item
  // runs the same function its toolbar button runs.
  const menuSections: MenuSection[] = buildChartMenu(
    { interval, chartType, activeIndicators, scale, canFullscreen: Boolean(onFullscreen) },
    {
      chartTypes: CHART_TYPES,
      intervals: INTERVALS,
      indicators: [...PRICE_INDICATORS, ...LOWER_INDICATORS].map((k) => ({ key: k, label: INDICATOR_LABELS[k] })),
      drawTools: DRAW_TOOLS.map((t) => ({ key: t.key, label: t.label })),
      measureTools: MEASURE_TOOLS.map((t) => ({ key: t.key, label: t.label })),
    }
  );
  function runAction(id: string) {
    const [verb, arg] = parseAction(id);
    setCtxMenu(null);
    setSheetOpen(false);
    if (verb === "type" && arg) setChartType(arg as ChartTypeKey);
    else if (verb === "tf" && arg) setIntervalKey(arg as Interval);
    else if (verb === "ind" && arg) toggleIndicator(arg as IndicatorName);
    else if (verb === "draw" && arg) { const t = DRAW_TOOLS.find((d) => d.key === arg); if (t) startTool(t.overlay, t.key); }
    else if (verb === "measure" && arg) startMeasure(arg as MeasureKind);
    else if (verb === "scale" && arg) setScale(arg === "percent" ? "percent" : "price");
    else if (verb === "recenter") recenter();
    else if (verb === "undo") undoLastDrawing();
    else if (verb === "clear") clearDrawings();
    else if (verb === "fullscreen") onFullscreen?.();
  }

  // ---- Right-click menu (desktop) and long-press sheet (touch) ----
  // Our own controls on the chart (axis strips, % chip, menu) never open the
  // menu or start a long-press.
  const onOwnControl = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest("[data-axis-strip],[data-scale-chip],[data-chart-menu],[data-delete-pill]"));
  function onContextMenu(e: React.MouseEvent) {
    if (isMobile || onOwnControl(e.target)) return;
    e.preventDefault();
    const r = canvasWrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setCtxMenu({ x: e.clientX - r.left, y: e.clientY - r.top });
  }
  const pressRef = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  function onPointerDownPress(e: React.PointerEvent) {
    if (e.pointerType === "mouse" || onOwnControl(e.target) || measureRef.current) return;
    if (pressRef.current) { window.clearTimeout(pressRef.current.timer); pressRef.current = null; return; } // a second finger: a pinch
    const timer = window.setTimeout(() => { pressRef.current = null; setSheetOpen(true); }, LONG_PRESS_MS);
    pressRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, timer };
  }
  function onPointerMovePress(e: React.PointerEvent) {
    const p = pressRef.current;
    if (!p || p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) { window.clearTimeout(p.timer); pressRef.current = null; }
  }
  function endPress() {
    if (pressRef.current) { window.clearTimeout(pressRef.current.timer); pressRef.current = null; }
  }

  // ---- #29: drag the price / time axis by touch ----
  // klinecharts 9.8.10 stretches an axis only in its MOUSE handlers
  // (mouseDownEvent / pressedMouseMoveEvent); its touch handlers pass an axis
  // touch to the axis widget, which does nothing with it. So on a touch-first
  // device two strips sit over the axes -- touch-action:none, at least 44px --
  // and replay a touch drag as the mouse drag the library already handles.
  // The whole chart box is touch-action:none already, so the page still
  // scrolls when a finger starts outside the chart.
  const yStripRef = useRef<HTMLDivElement | null>(null);
  const xStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const set = () => setCoarse(mq.matches);
    set();
    mq.addEventListener?.("change", set);
    return () => mq.removeEventListener?.("change", set);
  }, []);
  useEffect(() => {
    if (!coarse) return;
    const cleanups: Array<() => void> = [];
    for (const [strip, axis] of [[yStripRef.current, "y"], [xStripRef.current, "x"]] as const) {
      if (!strip) continue;
      let target: Element | null = null;
      let lastTap = 0;
      // What lies under the strip: the library's own canvas for that axis.
      const under = (x: number, y: number) => {
        strip.style.pointerEvents = "none";
        const t = document.elementFromPoint(x, y);
        strip.style.pointerEvents = "auto";
        return t;
      };
      // A constructed MouseEvent has no sourceCapabilities, and the library
      // ignores mouse events within 500ms of a touch unless they say they did
      // not come from one. Found by the spike (CODE-B #18).
      const replay = (type: string, e: PointerEvent, el: Element) => {
        const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 0, buttons: type === "mouseup" ? 0 : 1, view: window });
        Object.defineProperty(ev, "sourceCapabilities", { value: { firesTouchEvents: false } });
        el.dispatchEvent(ev);
      };
      const down = (e: PointerEvent) => {
        if (e.pointerType === "mouse") return;
        e.preventDefault();
        const now = Date.now();
        // DOUBLE-TAP resets the axis: auto-fit for price, the default candle
        // width for time (TradingView's reset).
        if (now - lastTap < 300) {
          lastTap = 0;
          if (axis === "y") applyScale(scaleRef.current);
          else if (defaultBarSpaceRef.current) { try { chartRef.current?.setBarSpace(defaultBarSpaceRef.current); } catch { /* noop */ } }
          return;
        }
        lastTap = now;
        try { strip.setPointerCapture(e.pointerId); } catch { /* noop */ }
        target = under(e.clientX, e.clientY);
        if (target) replay("mousedown", e, target);
      };
      const move = (e: PointerEvent) => { if (!target) return; e.preventDefault(); replay("mousemove", e, target); };
      const up = (e: PointerEvent) => { if (!target) return; replay("mouseup", e, target); target = null; };
      strip.addEventListener("pointerdown", down);
      strip.addEventListener("pointermove", move);
      strip.addEventListener("pointerup", up);
      strip.addEventListener("pointercancel", up);
      cleanups.push(() => {
        strip.removeEventListener("pointerdown", down);
        strip.removeEventListener("pointermove", move);
        strip.removeEventListener("pointerup", up);
        strip.removeEventListener("pointercancel", up);
      });
    }
    return () => cleanups.forEach((f) => f());
  }, [coarse, applyScale]);

  // ---- #28 (b), #43: the clearing click, Shift + drag quick measure, Esc, Delete ----
  // Capture-phase listeners on the chart box run before klinecharts' own
  // handlers (on the canvas inside it). So:
  //  - with a placed measure, the next press (mouse or touch) only clears it:
  //    the whole press -- down, moves, up, click -- is swallowed, so it cannot
  //    pan, move the crosshair, place a point or select a drawing;
  //  - a Shift-drag measures instead of panning; any later click clears that
  //    quick measure (TradingView's habit).
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    let drag: { id: string; a: MeasurePoint } | null = null;
    const toPoint = (e: MouseEvent): MeasurePoint | null => {
      const chart = chartRef.current;
      const box = containerRef.current?.getBoundingClientRect();
      if (!chart || !box) return null;
      try {
        const p = chart.convertFromPixel([{ x: e.clientX - box.left, y: e.clientY - box.top }], { paneId: "candle_pane", absolute: true }) as MeasurePoint | MeasurePoint[];
        return Array.isArray(p) ? p[0] ?? null : p;
      } catch { return null; }
    };
    let swallowing = false;
    let swallowClickUntil = 0;
    const clearing = (e: Event) => {
      if (!measureRef.current?.drawn || onOwnControl(e.target)) return false;
      e.preventDefault();
      e.stopPropagation();
      clearMeasure();
      swallowing = true;
      return true;
    };
    const eat = (e: Event) => {
      if (!swallowing) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };
    const eatEnd = (e: Event) => {
      if (!swallowing) return;
      eat(e);
      swallowing = false;
      swallowClickUntil = Date.now() + 400;
    };
    const eatClick = (e: Event) => { if (Date.now() < swallowClickUntil) { e.preventDefault(); e.stopPropagation(); } };
    const touchDown = (e: TouchEvent) => { clearing(e); };
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (clearing(e)) return;
      if (!e.shiftKey) { clearQuick(); return; }
      if (onOwnControl(e.target)) return;
      const chart = chartRef.current;
      const a = toPoint(e);
      if (!chart || !a) return;
      e.preventDefault();
      e.stopPropagation();
      clearQuick();
      let id: string | null = null;
      try { id = chart.createOverlay({ name: "mshMeasure", points: [a, a], lock: true }); } catch { /* noop */ }
      if (!id) return;
      quickRef.current = id;
      drag = { id, a };
    };
    const move = (e: MouseEvent) => {
      if (!drag) return;
      const b = toPoint(e);
      if (b) { try { chartRef.current?.overrideOverlay({ id: drag.id, points: [drag.a, b] }); } catch { /* noop */ } }
    };
    const up = () => { drag = null; };
    const opts = { capture: true, passive: false } as const;
    wrap.addEventListener("mousedown", down, true);
    wrap.addEventListener("touchstart", touchDown, opts);
    wrap.addEventListener("mousemove", eat, true);
    wrap.addEventListener("touchmove", eat, opts);
    wrap.addEventListener("mouseup", eatEnd, true);
    wrap.addEventListener("touchend", eatEnd, opts);
    wrap.addEventListener("touchcancel", eatEnd, opts);
    wrap.addEventListener("click", eatClick, true);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      wrap.removeEventListener("mousedown", down, true);
      wrap.removeEventListener("touchstart", touchDown, opts);
      wrap.removeEventListener("mousemove", eat, true);
      wrap.removeEventListener("touchmove", eat, opts);
      wrap.removeEventListener("mouseup", eatEnd, true);
      wrap.removeEventListener("touchend", eatEnd, opts);
      wrap.removeEventListener("touchcancel", eatEnd, opts);
      wrap.removeEventListener("click", eatClick, true);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && (measureRef.current || quickRef.current)) { clearMeasure(); clearQuick(); return; }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selectedRef.current) return;
      // Only when nothing that takes typing has focus.
      const a = document.activeElement;
      if (a && a !== document.body && !canvasWrapRef.current?.contains(a)) return;
      e.preventDefault();
      deleteSelected();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Close menus on outside click ----
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      const outside = (
        wrap: React.RefObject<HTMLDivElement | null>,
        panel: React.RefObject<HTMLDivElement | null>,
      ) => !wrap.current?.contains(t) && !panel.current?.contains(t);
      if (outside(indicatorMenuRef, indicatorPanelRef)) setIndicatorMenuOpen(false);
      if (outside(typeMenuRef, typePanelRef)) setTypeMenuOpen(false);
      if (outside(drawMenuRef, drawPanelRef)) setDrawMenuOpen(false);
      if (outside(measureMenuRef, measurePanelRef)) setMeasureMenuOpen(false);
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

  // Toolbar dropdowns are portalled OUT of the toolbar row rather than
  // rendered inside it. In landscape (`dense`) the toolbar is a horizontally
  // scrolling flex row (`overflowX: auto`), and WebKit mispaints
  // position:fixed descendants of a composited scroller: on an iPhone in
  // landscape fullscreen the menus came out see-through, with the chart
  // painting straight over them. Portalling removes the scroller from the
  // menu's ancestry entirely, so the panel paints on its own.
  //
  // The target matters. When the dashboard has taken *native* browser
  // fullscreen (desktop Chrome/Firefox), only the fullscreen element and its
  // descendants are painted at all, so a <body> portal would be invisible
  // there -- portal into the fullscreen element when there is one.
  const menuPortal = (node: React.ReactNode) => {
    if (typeof document === "undefined") return null;
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const fs = (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) as HTMLElement | null;
    return createPortal(node, fs ?? document.body);
  };

  // ---- Styles ----
  // `dense` = landscape single-row icon-only toolbar.
  const dense = compact;
  // Recenter / Undo / Clear are icon-only everywhere now, with tooltips
  // (#553 COWORK #28: one tidy row).
  const iconOnlyActions = true;
  // Phone portrait: [D W M] + one "Tools ▾" button that opens the sheet, so
  // nothing wraps into a second row. Landscape fullscreen keeps its dense row.
  const narrow = isMobile && !compact;
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

        {narrow ? (
          <button type="button" onClick={() => setSheetOpen(true)} data-chart-tools style={{ ...btn(sheetOpen), display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44 }} aria-haspopup="dialog" aria-expanded={sheetOpen}>
            {PENCIL_ICON}<span>Tools</span><span style={{ opacity: 0.7 }}>▾</span>
          </button>
        ) : null}

        {/* Chart type dropdown */}
        {!narrow ? (<>
        <div style={{ position: "relative" }} ref={typeMenuRef}>
          <button type="button" onClick={(e) => { const willOpen = !typeMenuOpen; setIndicatorMenuOpen(false); setDrawMenuOpen(false); setMeasureMenuOpen(false); if (willOpen) openMenuAt(e.currentTarget, 178); setTypeMenuOpen(willOpen); }} title={dense ? activeTypeLabel : undefined} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: dense ? 3 : 6 }}>
            {TYPE_ICONS[chartType]}{!dense ? <span>{activeTypeLabel}</span> : null}<span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {typeMenuOpen ? menuPortal(
            <div ref={typePanelRef} style={{ position: "fixed", top: menuPos?.top ?? 0, left: menuPos?.left ?? 0, zIndex: 3000, minWidth: 178, maxWidth: "calc(100vw - 16px)", background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)", overflow: "hidden" }}>
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
          <button type="button" onClick={(e) => { const willOpen = !indicatorMenuOpen; setTypeMenuOpen(false); setDrawMenuOpen(false); setMeasureMenuOpen(false); if (willOpen) openMenuAt(e.currentTarget, 250); setIndicatorMenuOpen(willOpen); }} title={dense ? "Indicators" : undefined} style={{ ...btn(activeIndicators.length > 0), display: "inline-flex", alignItems: "center", gap: dense ? 4 : 6 }}>
            {dense ? INDICATORS_ICON : null}
            {dense
              ? (activeIndicators.length ? <span style={{ fontSize: 11 }}>{activeIndicators.length}</span> : null)
              : <span>Indicators{activeIndicators.length ? ` · ${activeIndicators.length}` : ""}</span>}
            <span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {indicatorMenuOpen ? menuPortal(
            <div ref={indicatorPanelRef} style={{ position: "fixed", top: menuPos?.top ?? 0, left: menuPos?.left ?? 0, zIndex: 3000, width: 250, maxWidth: "calc(100vw - 16px)", maxHeight: 340, overflowY: "auto", background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)" }}>
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
          <button type="button" onClick={(e) => { const willOpen = !drawMenuOpen; setTypeMenuOpen(false); setIndicatorMenuOpen(false); setMeasureMenuOpen(false); if (willOpen) openMenuAt(e.currentTarget, 210); setDrawMenuOpen(willOpen); }} title={dense ? "Draw" : undefined} style={{ ...btn(drawMenuOpen || activeTool != null), display: "inline-flex", alignItems: "center", gap: dense ? 3 : 6 }}>
            {PENCIL_ICON}{!dense ? <span>Draw</span> : null}<span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {drawMenuOpen ? menuPortal(
            <div ref={drawPanelRef} style={{ position: "fixed", top: menuPos?.top ?? 0, left: menuPos?.left ?? 0, zIndex: 3000, width: 210, maxWidth: "calc(100vw - 16px)", background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)", overflow: "hidden" }}>
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

        {/* Measure tools dropdown (#553 COWORK #28 part b) */}
        <div style={{ position: "relative" }} ref={measureMenuRef}>
          <button type="button" data-measure-menu onClick={(e) => { const willOpen = !measureMenuOpen; setTypeMenuOpen(false); setIndicatorMenuOpen(false); setDrawMenuOpen(false); if (willOpen) openMenuAt(e.currentTarget, 236); setMeasureMenuOpen(willOpen); }} title={dense ? "Measure" : "Measure a move (or Shift + drag on the chart)"} style={{ ...btn(measureMenuOpen), display: "inline-flex", alignItems: "center", gap: dense ? 3 : 6 }}>
            {RULER_ICON}{!dense ? <span>Measure</span> : null}<span style={{ opacity: 0.7 }}>▾</span>
          </button>
          {measureMenuOpen ? menuPortal(
            <div ref={measurePanelRef} style={{ position: "fixed", top: menuPos?.top ?? 0, left: menuPos?.left ?? 0, zIndex: 3000, width: 236, maxWidth: "calc(100vw - 16px)", background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, boxShadow: "0 18px 34px rgba(0,0,0,0.45)", overflow: "hidden" }}>
              <div style={{ padding: "8px 12px 6px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7c8aa3" }}>Measure</div>
              {MEASURE_TOOLS.map((tool) => (
                <button key={tool.key} type="button" onClick={() => startMeasure(tool.key)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderTop: "1px solid rgba(255,255,255,0.05)", background: "transparent", color: "#cbd5e1", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {RULER_ICON}<span>{tool.label}</span>
                </button>
              ))}
              <div style={{ padding: "7px 12px 9px", fontSize: 11, color: "#7c8aa3", borderTop: "1px solid rgba(255,255,255,0.05)" }}>A measure clears on your next click. Tip: Shift + drag for a quick one.</div>
            </div>
          ) : null}
        </div>

        {/* Actions: recenter / undo / clear -- icon-only, with tooltips */}
        <div style={groupWrap} role="group" aria-label="Chart actions">
          <button type="button" onClick={recenter} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6 }} title="Recenter chart" aria-label="Recenter chart">
            {RECENTER_ICON}{!iconOnlyActions ? <span>Recenter</span> : null}
          </button>
          <button type="button" onClick={undoLastDrawing} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6 }} title="Undo last drawing" aria-label="Undo last drawing">
            {UNDO_ICON}{!iconOnlyActions ? <span>Undo</span> : null}
          </button>
          <button type="button" onClick={clearDrawings} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6 }} title="Remove all drawings" aria-label="Remove all drawings">
            {CLEAR_ICON}{!iconOnlyActions ? <span>Clear</span> : null}
          </button>
        </div>

        {onFullscreen ? (
          <button type="button" onClick={onFullscreen} title="Open chart fullscreen" aria-label="Open chart fullscreen" style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>⛶</span>{!dense ? <span>Fullscreen</span> : null}
          </button>
        ) : null}
        </>) : null}

        {/* Injected controls (mode switch + close) pinned right in landscape */}
        {trailing ? (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            {trailing}
          </div>
        ) : null}
      </div>

      {/* Chart canvas */}
      <div ref={canvasWrapRef} onContextMenu={onContextMenu}
        onPointerDown={onPointerDownPress} onPointerMove={onPointerMovePress} onPointerUp={endPress} onPointerCancel={endPress}
        style={{ position: "relative", width: "100%", flex: fill ? 1 : undefined, minHeight: 0 }}>
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

        {/* % scale chip: bottom of the price axis, just above Volume (#553 COWORK #28) */}
        {chipPos ? (
          <button type="button" data-scale-chip aria-pressed={scale === "percent"}
            data-pct-base={pctBaseTs ?? ""}
            onClick={() => setScale(scale === "percent" ? "price" : "percent")}
            title={scale === "percent" && pctBaseTs ? `Show % change (from ${new Date(pctBaseTs).toISOString().slice(0, 10)}, the first bar on screen)` : "Show % change"}
            aria-label="Show % change"
            style={{ position: "absolute", left: chipPos.left, top: chipPos.top, zIndex: 6, minWidth: coarse ? 44 : 26, height: coarse ? 44 : 22, marginTop: coarse ? -22 : 0,
              padding: "0 6px", borderRadius: 6, border: `1px solid ${scale === "percent" ? "rgba(96,165,250,0.7)" : "rgba(255,255,255,0.18)"}`,
              background: scale === "percent" ? "rgba(47,107,255,0.35)" : "rgba(15,23,42,0.85)", color: scale === "percent" ? "#dbeafe" : "#9fb0c7",
              fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
            %
          </button>
        ) : null}

        {/* #29: touch strips over the axes, touch-first devices only */}
        {coarse ? (<>
          <div ref={yStripRef} data-axis-strip="y" style={{ position: "absolute", top: 0, right: 0, width: 56, bottom: 44, zIndex: 5, touchAction: "none" }} />
          <div ref={xStripRef} data-axis-strip="x" style={{ position: "absolute", left: 0, right: 56, bottom: 0, height: 44, zIndex: 5, touchAction: "none" }} />
        </>) : null}

        {/* The measure hint (#553 COWORK #43). It takes no clicks, so a tap on it
            clears the measure like a tap anywhere else. */}
        {measure ? (
          <div data-measure-hint style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 7, pointerEvents: "none", maxWidth: "calc(100% - 16px)", whiteSpace: "nowrap",
            background: "rgba(15,23,42,0.94)", border: "1px solid rgba(96,165,250,0.5)", borderRadius: 999, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#cbd5e1", boxShadow: "0 8px 20px rgba(0,0,0,0.35)" }}>
            {!measure.drawn
              ? (coarse || isMobile ? "Tap the start, then the end" : "Click the start, then the end")
              : (coarse || isMobile ? "Tap anywhere to clear" : "Click anywhere or press Esc to clear")}
          </div>
        ) : null}
        {/* Touch: a selected drawing gets a Delete pill. */}
        {!measure && selectedId && (coarse || isMobile) ? (
          <div data-delete-pill style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 7, display: "flex", alignItems: "center", gap: 8, maxWidth: "calc(100% - 16px)",
            background: "rgba(15,23,42,0.94)", border: "1px solid rgba(96,165,250,0.5)", borderRadius: 999, padding: "0 0 0 12px", fontSize: 12, fontWeight: 700, color: "#cbd5e1", boxShadow: "0 8px 20px rgba(0,0,0,0.35)" }}>
            <span style={{ whiteSpace: "nowrap" }}>Selected</span>
            <button type="button" data-overlay-delete onClick={deleteSelected} style={{ minHeight: 44, minWidth: 72, border: "none", borderRadius: 999, background: "rgba(239,68,68,0.85)", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Delete</button>
          </div>
        ) : null}

        {ctxMenu ? (
          <ChartContextMenu sections={menuSections} at={ctxMenu}
            box={{ width: canvasWrapRef.current?.clientWidth ?? 800, height: canvasWrapRef.current?.clientHeight ?? 500 }}
            onAction={runAction} onClose={() => setCtxMenu(null)} />
        ) : null}
      </div>
      {sheetOpen ? <ChartToolsSheet sections={menuSections} onAction={runAction} onClose={() => setSheetOpen(false)} /> : null}

      {!compact ? (
        <div style={{ marginTop: 6, fontSize: 11, color: "rgba(148,163,184,0.6)", lineHeight: 1.4 }}>
          Interactive chart · drag to pan, scroll / pinch to zoom, drag an axis to stretch it (double-tap it to reset). {isMobile ? "Long-press the chart for tools, including Measure." : "Right-click the chart for tools; Shift + drag to measure a move."} {isMobile ? "Tap a drawing to select it, then drag to move it." : "Click a drawing to select it, drag to move it, or press Delete to remove it."}
        </div>
      ) : null}
    </div>
  );
}
