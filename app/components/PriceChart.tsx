"use client";

import React, { useMemo, useState } from "react";
import type { DivResult } from "../../lib/ta/divergence";
import {
  computeTrendHelper,
  TREND_HELPER_SLOW,
  TREND_HELPER_FAST,
  TREND_HELPER_COLORS,
} from "@/lib/ta/trendHelper";
import TradingViewChartEmbed from "./TradingViewChartEmbed";

type Point = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
};

const CHART_COLORS = {
  price: "rgba(241,245,249,0.96)",
  ma50: "#60a5fa",
  ma200: "#f59e0b",
  weeklyMa200: "#ef4444",
  bollUpper: "rgba(167,139,250,0.55)",
  bollMid: "rgba(196,181,253,0.72)",
  bollLower: "rgba(167,139,250,0.55)",
  ema20: "#22d3ee",
  vwma20: "#14b8a6",
  rsi: "#a78bfa",
  macdLine: "#22c55e",
  macdSignal: "#f59e0b",
  macdHist: "rgba(148,163,184,0.34)",
  macdDivBull: "#22c55e",
  macdDivBear: "#ef4444",
  stochK: "#38bdf8",
  stochD: "#f59e0b",
  atr: "#fb923c",
  volume: "rgba(96,165,250,0.34)",
  supportZone: "#22c55e",
  resistanceZone: "#ef4444",
  referenceLine: "#facc15",
  // Subtle fill for the "neutral zone" band between an oscillator's
  // overbought / oversold thresholds (RSI 30-70, Stochastic 20-80), matching
  // the shaded middle box TradingView draws on these panels.
  rsiBand: "rgba(167,139,250,0.09)",
  stochBand: "rgba(56,189,248,0.08)",
  // Trend Helper (Noise Cutter): HMA trend line coloured by confirmed state,
  // plus a purple MA200. Mirrors the Interactive chart's version.
  nctBull: TREND_HELPER_COLORS.bull,
  nctBear: TREND_HELPER_COLORS.bear,
  nctNeutral: TREND_HELPER_COLORS.neutral,
  nctMa200: TREND_HELPER_COLORS.ma200,
};

// ── Trend Helper (Noise Cutter) ────────────────────────────────────
// The math lives in lib/ta/trendHelper.ts — the single source of truth shared
// with InteractiveChart.tsx and the server-side picker builder. Computed on the
// FULL close history (passed via props) then sliced to the visible window, so
// the line isn't blank through the HMA warm-up period.
type TrendHelperWindow = { line: Array<number | null>; state: number[] };

export type Overlay =
  | "None"
  | "MA50"
  | "MA200"
  | "Weekly MA200"
  | "Bollinger(20,2)"
  | "RSI(14)"
  | "MACD(12,26,9)"
  | "EMA20"
  | "VWMA(20)"
  | "Stochastic(14,3)"
  | "ATR(14)"
  | "Volume"
  | "Trend Helper (Smooth)"
  | "Trend Helper (Fast)"
  | "Support/Resistance";

function fmtMoney(v: number) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtXLabel(s: string) {
  const hasTime = s.includes(":");
  if (hasTime) {
    const m = s.match(/(\d{2}:\d{2})/);
    return m ? m[1] : s.slice(-5);
  }

  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;

  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

// Simple 3-period moving average over a nullable series. Used to turn the
// server-provided Stochastic %K/%D into TradingView's *slow* Stochastic
// (14,3,3): the incoming stochD is already SMA3 of the raw %K (i.e. the slow
// %K), so slow %D = SMA3 of that. Leaves the first two points null.
function sma3(arr: Array<number | null>): (number | null)[] {
  const out: (number | null)[] = Array(arr.length).fill(null);
  for (let i = 2; i < arr.length; i++) {
    const a = arr[i], b = arr[i - 1], c = arr[i - 2];
    if (typeof a === "number" && Number.isFinite(a) && typeof b === "number" && Number.isFinite(b) && typeof c === "number" && Number.isFinite(c)) {
      out[i] = (a + b + c) / 3;
    }
  }
  return out;
}

function minMax(arr: Array<number | null>) {
  let min = Infinity;
  let max = -Infinity;

  for (const v of arr) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

export type ChartType = "line" | "candles";

export type SupportResistanceZone = {
  kind: "support" | "resistance";
  lower: number;
  upper: number;
  label?: string;
};

export type ChartReferenceLine = {
  price: number;
  label?: string;
  color?: string;
};

type Props = {
  symbol: string;
  data: Point[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  weeklyMa200?: (number | null)[];
  overlay?: Overlay;
  selectedIndicators?: Overlay[];
  chartType?: ChartType;
  supportResistanceZones?: SupportResistanceZone[];
  referenceLines?: ChartReferenceLine[];

  divergence?: DivResult | null;

  bollUpper?: (number | null)[];
  bollMid?: (number | null)[];
  bollLower?: (number | null)[];

  ema20?: (number | null)[];
  vwma20?: (number | null)[];

  rsi14?: (number | null)[];
  macdLine?: (number | null)[];
  macdSignal?: (number | null)[];
  macdHist?: (number | null)[];
  stochK?: (number | null)[];
  stochD?: (number | null)[];
  atr14?: (number | null)[];
  volume?: (number | null)[];

  // For the Trend Helper overlay: the FULL close history + the index at which
  // the visible `data` window begins within it. The HMA/state are computed on
  // the full series then sliced to `data`, so the trend line isn't blank
  // through the HMA warm-up. Omitted by non-dashboard callers (SPXChartClient,
  // InsightPostClient) -> the Trend Helper overlays simply don't render there.
  fullCloses?: number[];
  displayStart?: number;

  height?: number;

  // Controlled TradingView toggle: pass both to let a parent (e.g.
  // DashboardClient) own this state so it can hide its own redundant chart
  // controls when TradingView mode is active. If omitted, PriceChart falls
  // back to managing an internal uncontrolled toggle -- existing callers
  // (SPXChartClient, InsightPostClient) keep working unchanged.
  tradingViewActive?: boolean;
  onToggleTradingView?: (next: boolean) => void;

  // Controls the internal "Open in TradingView ↗" and "Trade {symbol} →"
  // links in this component's own footer. Default true preserves existing
  // behavior for callers (SPXChartClient, InsightPostClient). DashboardClient
  // sets both to false since it renders its own equivalently-styled links
  // elsewhere on the page instead.
  showTradingViewLink?: boolean;
  showTradeLink?: boolean;

  // When true, PriceChart renders ONLY its own Basic SVG chart and hides its
  // built-in "MyStockHarbor | TradingView" source toggle. Used by
  // DashboardClient, which owns a 3-way Basic / Interactive / TradingView mode
  // switch itself and renders the TradingView embed and Interactive chart
  // separately. Also set by SPXChartClient (/markets/spx), which wants the
  // MyStockHarbor SVG chart only. Default false preserves the standalone
  // behaviour for other callers (InsightPostClient).
  hideSourceToggle?: boolean;
};

// Fixed, non-interactive brand watermark rendered on top of the chart
// area (SVG or TradingView embed). Positioned via CSS against the
// chart's own fixed-height wrapper -- not against any data-derived SVG
// coordinate -- so it never shifts when the user zooms, pans, or changes
// the visible bar count; only the chart content underneath it changes.
// Sits right at the top edge of the chart box, horizontally, out of the
// way of the price action below. Opacity is kept low so it reads as a
// background mark rather than interfering with the data.
function ChartWatermark() {
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
          fontSize: "clamp(13px, 3vw, 22px)",
          fontWeight: 800,
          color: "rgba(148,163,184,0.20)",
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        MyStockHarbor
      </span>
    </div>
  );
}

export default function PriceChart(props: Props) {
  const {
    symbol,
    data,
    ma50,
    ma200,
    weeklyMa200,
    overlay = "None",
    selectedIndicators = [],
    chartType = "line",
    supportResistanceZones = [],
    referenceLines = [],
    divergence = null,

    bollUpper,
    bollMid,
    bollLower,

    ema20,
    vwma20,

    rsi14,
    macdLine,
    macdSignal,
    macdHist,
    stochK,
    stochD,
    atr14,
    volume,

    fullCloses,
    displayStart,

    height = 320,
    tradingViewActive,
    onToggleTradingView,
    showTradingViewLink = true,
    showTradeLink = true,
    hideSourceToggle = false,
  } = props;

  const width = 760;

  // Only mounts TradingViewChartEmbed (and its ~500KB tv.js script) once the
  // user explicitly clicks the toggle below -- the default experience never
  // pays this cost. Controlled by a parent when tradingViewActive is passed
  // (see Props above); otherwise managed internally.
  const [internalShowTradingView, setInternalShowTradingView] = useState(false);
  const isTradingViewControlled = tradingViewActive !== undefined;
  // When hideSourceToggle is set, this component is Basic-only (the parent owns
  // the mode switch), so never mount the internal TradingView embed.
  const showTradingView = hideSourceToggle
    ? false
    : isTradingViewControlled
    ? tradingViewActive!
    : internalShowTradingView;

  function setTradingViewMode(next: boolean) {
    if (onToggleTradingView) onToggleTradingView(next);
    if (!isTradingViewControlled) setInternalShowTradingView(next);
  }

  const padL = 34;
  const padR = 54;
  const padT = 24;
  const padB = 34;

  const activeIndicators = selectedIndicators.filter((v) => v !== "None");

  const activeLowerOverlay = useMemo<Overlay | null>(() => {
    const lower = activeIndicators.find(
      (v) =>
        v === "RSI(14)" ||
        v === "MACD(12,26,9)" ||
        v === "Stochastic(14,3)" ||
        v === "ATR(14)" ||
        v === "Volume"
    );

    if (lower) return lower;

    if (
      overlay === "RSI(14)" ||
      overlay === "MACD(12,26,9)" ||
      overlay === "Stochastic(14,3)" ||
      overlay === "ATR(14)" ||
      overlay === "Volume"
    ) {
      return overlay;
    }

    return null;
  }, [activeIndicators, overlay]);

  const wantsSubPanel = activeLowerOverlay != null;

  const showMA50 = activeIndicators.includes("MA50");
  const showMA200 = activeIndicators.includes("MA200");
  const showWeeklyMA200 = activeIndicators.includes("Weekly MA200");
  const showBollinger = activeIndicators.includes("Bollinger(20,2)");
  const showEMA20 = activeIndicators.includes("EMA20");
  const showVWMA20 = activeIndicators.includes("VWMA(20)");
  const showSupportResistance = activeIndicators.includes("Support/Resistance");
  const showTrendSmooth = activeIndicators.includes("Trend Helper (Smooth)");
  const showTrendFast = activeIndicators.includes("Trend Helper (Fast)");
  const showTrendHelper = showTrendSmooth || showTrendFast;

  // Trend Helper series for the visible window (see computeTrendHelper). Only
  // computed when a Trend Helper overlay is active and the full close history +
  // window offset were supplied. Sliced from the full-history computation so
  // the line is populated across the whole visible window.
  const trendSmooth = useMemo<TrendHelperWindow | null>(() => {
    if (!showTrendSmooth || !Array.isArray(fullCloses) || fullCloses.length === 0 || typeof displayStart !== "number") return null;
    const full = computeTrendHelper(fullCloses, TREND_HELPER_SLOW.trendLen, TREND_HELPER_SLOW.confirmBars);
    const end = displayStart + data.length;
    return { line: full.line.slice(displayStart, end), state: full.state.slice(displayStart, end) };
  }, [showTrendSmooth, fullCloses, displayStart, data.length]);
  const trendFast = useMemo<TrendHelperWindow | null>(() => {
    if (!showTrendFast || !Array.isArray(fullCloses) || fullCloses.length === 0 || typeof displayStart !== "number") return null;
    const full = computeTrendHelper(fullCloses, TREND_HELPER_FAST.trendLen, TREND_HELPER_FAST.confirmBars);
    const end = displayStart + data.length;
    return { line: full.line.slice(displayStart, end), state: full.state.slice(displayStart, end) };
  }, [showTrendFast, fullCloses, displayStart, data.length]);

  const gap = wantsSubPanel ? 14 : 0;
  const innerH = height - padT - padB - gap;

  const priceH = wantsSubPanel ? Math.max(140, Math.floor(innerH * 0.62)) : innerH;
  const subH = wantsSubPanel ? Math.max(90, innerH - priceH) : 0;

  const series = useMemo(() => {
    const n = data.length;

    const a50 = ma50.length === n ? ma50 : Array(n).fill(null);
    const a200 = ma200.length === n ? ma200 : Array(n).fill(null);
    const w200 =
      weeklyMa200 && weeklyMa200.length === n ? weeklyMa200 : Array(n).fill(null);

    const u = bollUpper && bollUpper.length === n ? bollUpper : Array(n).fill(null);
    const m = bollMid && bollMid.length === n ? bollMid : Array(n).fill(null);
    const l = bollLower && bollLower.length === n ? bollLower : Array(n).fill(null);

    const e20 = ema20 && ema20.length === n ? ema20 : Array(n).fill(null);
    const vw = vwma20 && vwma20.length === n ? vwma20 : Array(n).fill(null);

    const rsi = rsi14 && rsi14.length === n ? rsi14 : Array(n).fill(null);
    const ml = macdLine && macdLine.length === n ? macdLine : Array(n).fill(null);
    const ms = macdSignal && macdSignal.length === n ? macdSignal : Array(n).fill(null);
    const mh = macdHist && macdHist.length === n ? macdHist : Array(n).fill(null);

    const sk = stochK && stochK.length === n ? stochK : Array(n).fill(null);
    const sd = stochD && stochD.length === n ? stochD : Array(n).fill(null);

    const at = atr14 && atr14.length === n ? atr14 : Array(n).fill(null);
    const vol = volume && volume.length === n ? volume : Array(n).fill(null);

    return data.map((p, i) => ({
      ...p,
      ma50: a50[i] as number | null,
      ma200: a200[i] as number | null,
      weeklyMa200: w200[i] as number | null,
      bu: u[i] as number | null,
      bm: m[i] as number | null,
      bl: l[i] as number | null,
      ema20: e20[i] as number | null,
      vwma20: vw[i] as number | null,
      rsi14: rsi[i] as number | null,
      macdLine: ml[i] as number | null,
      macdSignal: ms[i] as number | null,
      macdHist: mh[i] as number | null,
      stochK: sk[i] as number | null,
      stochD: sd[i] as number | null,
      atr14: at[i] as number | null,
      volume: vol[i] as number | null,
    }));
  }, [
    data,
    ma50,
    ma200,
    weeklyMa200,
    bollUpper,
    bollMid,
    bollLower,
    ema20,
    vwma20,
    rsi14,
    macdLine,
    macdSignal,
    macdHist,
    stochK,
    stochD,
    atr14,
    volume,
  ]);

  const hasData = series.length >= 2;

  const x = useMemo(() => {
    return (i: number) =>
      padL + (i * (width - padL - padR)) / Math.max(1, series.length - 1);
  }, [series.length]);

  const { pMin, pMax, pRange } = useMemo(() => {
    if (!hasData) return { pMin: 0, pMax: 1, pRange: 1 };

    const vals: number[] = [];

    for (const p of series) {
      vals.push(p.close);

      if (chartType === "candles") {
        if (typeof p.open === "number" && Number.isFinite(p.open)) vals.push(p.open);
        if (typeof p.high === "number" && Number.isFinite(p.high)) vals.push(p.high);
        if (typeof p.low === "number" && Number.isFinite(p.low)) vals.push(p.low);
      }

      if (showMA50 && typeof p.ma50 === "number") vals.push(p.ma50);
      if (showMA200 && typeof p.ma200 === "number") vals.push(p.ma200);
      if (showWeeklyMA200 && typeof p.weeklyMa200 === "number") vals.push(p.weeklyMa200);

      if (showBollinger) {
        if (typeof p.bu === "number") vals.push(p.bu);
        if (typeof p.bm === "number") vals.push(p.bm);
        if (typeof p.bl === "number") vals.push(p.bl);
      }

      if (showEMA20 && typeof p.ema20 === "number") vals.push(p.ema20);
      if (showVWMA20 && typeof p.vwma20 === "number") vals.push(p.vwma20);
    }

    if (showSupportResistance) {
      for (const zone of supportResistanceZones) {
        if (typeof zone.lower === "number" && Number.isFinite(zone.lower)) vals.push(zone.lower);
        if (typeof zone.upper === "number" && Number.isFinite(zone.upper)) vals.push(zone.upper);
      }
    }

    if (showTrendHelper) {
      for (const t of [trendSmooth, trendFast]) {
        if (!t) continue;
        for (const v of t.line) if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
      }
      // MA200 is drawn (purple) as part of the Trend Helper, so keep it in range.
      for (const p of series) if (typeof p.ma200 === "number" && Number.isFinite(p.ma200)) vals.push(p.ma200);
    }

    for (const line of referenceLines) {
      if (typeof line.price === "number" && Number.isFinite(line.price)) vals.push(line.price);
    }

    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const r = Math.max(1e-9, maxV - minV);

    return { pMin: minV, pMax: maxV, pRange: r };
  }, [
    hasData,
    series,
    showMA50,
    showMA200,
    showWeeklyMA200,
    showBollinger,
    showEMA20,
    showVWMA20,
    showSupportResistance,
    supportResistanceZones,
    showTrendHelper,
    trendSmooth,
    trendFast,
    referenceLines,
    chartType,
  ]);

  const yMain = useMemo(() => {
    return (v: number) => padT + ((pMax - v) * priceH) / pRange;
  }, [pMax, pRange, priceH]);

  const subTop = padT + priceH + gap;

  const subRange = useMemo(() => {
    if (!hasData || !wantsSubPanel) return null;

    if (activeLowerOverlay === "RSI(14)") return { min: 0, max: 100 };
    if (activeLowerOverlay === "Stochastic(14,3)") return { min: 0, max: 100 };

    if (activeLowerOverlay === "MACD(12,26,9)") {
      const mm1 = minMax(series.map((p) => p.macdLine));
      const mm2 = minMax(series.map((p) => p.macdSignal));
      const mm3 = minMax(series.map((p) => p.macdHist));

      const mins = [mm1?.min, mm2?.min, mm3?.min].filter(
        (x) => typeof x === "number"
      ) as number[];
      const maxs = [mm1?.max, mm2?.max, mm3?.max].filter(
        (x) => typeof x === "number"
      ) as number[];

      if (!mins.length || !maxs.length) return null;

      const min = Math.min(...mins);
      const max = Math.max(...maxs);

      if (min === max) return { min: min - 1, max: max + 1 };
      return { min, max };
    }

    if (activeLowerOverlay === "ATR(14)") {
      return minMax(series.map((p) => p.atr14));
    }

    if (activeLowerOverlay === "Volume") {
      let max = 0;

      for (const p of series) {
        const v = p.volume;
        if (typeof v === "number" && Number.isFinite(v) && v > max) max = v;
      }

      if (max <= 0) return null;
      return { min: 0, max };
    }

    return null;
  }, [hasData, wantsSubPanel, activeLowerOverlay, series]);

  const ySub = useMemo(() => {
    if (!subRange) return (_v: number) => subTop + subH / 2;
    const r = Math.max(1e-9, subRange.max - subRange.min);
    return (v: number) => subTop + ((subRange.max - v) * subH) / r;
  }, [subRange, subTop, subH]);

  const pathFrom = (arr: Array<number | null>, yFn: (v: number) => number) => {
    let d = "";
    let started = false;

    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        started = false;
        continue;
      }

      const cmd = started ? "L" : "M";
      d += `${cmd} ${x(i).toFixed(2)} ${yFn(v).toFixed(2)} `;
      started = true;
    }

    return d.trim();
  };

  const closePath = useMemo(() => {
    if (!hasData) return "";
    return series
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${yMain(p.close).toFixed(2)}`)
      .join(" ");
  }, [hasData, series, x, yMain]);

  const candleSlotWidth = (width - padL - padR) / Math.max(1, series.length);
  const candleBodyWidth = Math.max(2.5, Math.min(9, candleSlotWidth * 0.58));

  const ma50Path = useMemo(() => pathFrom(series.map((p) => p.ma50), yMain), [series, yMain]);
  const ma200Path = useMemo(() => pathFrom(series.map((p) => p.ma200), yMain), [series, yMain]);
  const weeklyMa200Path = useMemo(
    () => pathFrom(series.map((p) => p.weeklyMa200), yMain),
    [series, yMain]
  );

  const bollUPath = useMemo(() => pathFrom(series.map((p) => p.bu), yMain), [series, yMain]);
  const bollMPath = useMemo(() => pathFrom(series.map((p) => p.bm), yMain), [series, yMain]);
  const bollLPath = useMemo(() => pathFrom(series.map((p) => p.bl), yMain), [series, yMain]);

  const ema20Path = useMemo(() => pathFrom(series.map((p) => p.ema20), yMain), [series, yMain]);
  const vwma20Path = useMemo(
    () => pathFrom(series.map((p) => p.vwma20), yMain),
    [series, yMain]
  );

  const rsiPath = useMemo(() => pathFrom(series.map((p) => p.rsi14), ySub), [series, ySub]);
  const macdLinePath = useMemo(
    () => pathFrom(series.map((p) => p.macdLine), ySub),
    [series, ySub]
  );
  const macdSignalPath = useMemo(
    () => pathFrom(series.map((p) => p.macdSignal), ySub),
    [series, ySub]
  );

  // TradingView "slow" Stochastic (14,3,3): the server already hands us the raw
  // %K (stochK) and its SMA3 (stochD, = slow %K). Plot that smoothed line as
  // %K, and its own SMA3 as slow %D, so the panel matches TradingView instead
  // of the noisier fast Stochastic.
  const slowStochK = useMemo(() => series.map((p) => p.stochD), [series]);
  const slowStochD = useMemo(() => sma3(slowStochK), [slowStochK]);
  const stochKPath = useMemo(() => pathFrom(slowStochK, ySub), [slowStochK, ySub]);
  const stochDPath = useMemo(() => pathFrom(slowStochD, ySub), [slowStochD, ySub]);
  const atrPath = useMemo(() => pathFrom(series.map((p) => p.atr14), ySub), [series, ySub]);

  const yTicks = useMemo(() => {
    if (!hasData) return [];

    const ticks: { v: number; y: number }[] = [];
    const nTicks = 5;

    for (let i = 0; i < nTicks; i++) {
      const t = i / (nTicks - 1);
      const v = pMax - t * pRange;
      ticks.push({ v, y: yMain(v) });
    }

    return ticks;
  }, [hasData, pMax, pRange, yMain]);

  const xTicks = useMemo(() => {
    if (!hasData) return [];

    const nTicks = 5;
    const ticks: { i: number; x: number; label: string }[] = [];

    for (let k = 0; k < nTicks; k++) {
      const t = k / (nTicks - 1);
      const i = Math.round(t * (series.length - 1));
      ticks.push({ i, x: x(i), label: fmtXLabel(series[i].date) });
    }

    const seen = new Set<string>();
    return ticks.filter((t) => {
      if (seen.has(t.label)) return false;
      seen.add(t.label);
      return true;
    });
  }, [hasData, series, x]);

  if (!hasData) {
    return <div style={{ opacity: 0.7 }}>Not enough data to chart.</div>;
  }

  const last = series[series.length - 1];

  return (
    <div style={{ width: "100%" }}>
      <div style={{ position: "relative", width: "100%" }}>
      {showTradingView ? (
        <TradingViewChartEmbed symbol={symbol} height={Math.max(height, 480)} />
      ) : (
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ border: "1px solid #3333", borderRadius: 12 }}
      >
        <rect
          x={padL}
          y={padT}
          width={width - padL - padR}
          height={priceH}
          fill="none"
          stroke="currentColor"
          opacity="0.10"
        />

        {yTicks.map((t, idx) => (
          <g key={idx}>
            <line
              x1={padL}
              y1={t.y}
              x2={width - padR}
              y2={t.y}
              stroke="currentColor"
              opacity="0.08"
            />
            <text
              x={width - padR + 6}
              y={t.y + 4}
              fontSize={11}
              fill="currentColor"
              opacity="0.6"
            >
              {fmtMoney(t.v)}
            </text>
          </g>
        ))}

        {showSupportResistance
          ? supportResistanceZones.map((zone, idx) => {
              if (
                typeof zone.lower !== "number" ||
                typeof zone.upper !== "number" ||
                !Number.isFinite(zone.lower) ||
                !Number.isFinite(zone.upper)
              ) {
                return null;
              }

              const lower = Math.min(zone.lower, zone.upper);
              const upper = Math.max(zone.lower, zone.upper);
              const yTop = yMain(upper);
              const yBottom = yMain(lower);
              const yMid = yMain((lower + upper) / 2);
              const color = zone.kind === "support" ? CHART_COLORS.supportZone : CHART_COLORS.resistanceZone;
              const label =
                zone.label ??
                `${zone.kind === "support" ? "Macro support" : "Macro resistance"} ${fmtMoney(lower)}-${fmtMoney(upper)}`;

              return (
                <g key={`${zone.kind}-${idx}`}>
                  <rect
                    x={padL}
                    y={Math.min(yTop, yBottom)}
                    width={width - padL - padR}
                    height={Math.max(3, Math.abs(yBottom - yTop))}
                    fill={color}
                    opacity="0.16"
                    rx="2"
                  />
                  <line
                    x1={padL}
                    y1={yMid}
                    x2={width - padR}
                    y2={yMid}
                    stroke={color}
                    strokeWidth="2.6"
                    strokeDasharray="9 5"
                    opacity="0.98"
                  />
                  <text
                    x={padL + 8}
                    y={Math.max(padT + 13, yMid - 7)}
                    fontSize="11"
                    fill={color}
                    fontWeight="800"
                    opacity="0.95"
                  >
                    {label}
                  </text>
                </g>
              );
            })
          : null}

        {referenceLines.map((line, idx) => {
          if (typeof line.price !== "number" || !Number.isFinite(line.price)) return null;

          const y = yMain(line.price);
          const color = line.color ?? CHART_COLORS.referenceLine;
          const label = line.label ?? fmtMoney(line.price);

          return (
            <g key={`ref-line-${idx}`}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke={color}
                strokeWidth="1.6"
                strokeDasharray="5 4"
                opacity="0.9"
              />
              <text
                x={width - padR - 6}
                y={Math.max(padT + 13, y - 6)}
                fontSize="11"
                fill={color}
                fontWeight="800"
                opacity="0.95"
                textAnchor="end"
              >
                {label}
              </text>
            </g>
          );
        })}

        {xTicks.map((t, idx) => (
          <g key={idx}>
            <line
              x1={t.x}
              y1={height - padB}
              x2={t.x}
              y2={height - padB + 4}
              stroke="currentColor"
              opacity="0.25"
            />
            <text
              x={t.x}
              y={height - 10}
              fontSize={11}
              fill="currentColor"
              opacity="0.6"
              textAnchor="middle"
            >
              {t.label}
            </text>
          </g>
        ))}

        {chartType === "candles" ? (
          <>
            {series.map((p, i) => {
              const previousClose = i > 0 ? series[i - 1].close : p.close;

              const open =
                typeof p.open === "number" && Number.isFinite(p.open)
                  ? p.open
                  : previousClose;

              const close = p.close;

              const high =
                typeof p.high === "number" && Number.isFinite(p.high)
                  ? Math.max(p.high, open, close)
                  : Math.max(open, close);

              const low =
                typeof p.low === "number" && Number.isFinite(p.low)
                  ? Math.min(p.low, open, close)
                  : Math.min(open, close);

              const cx = x(i);
              const openY = yMain(open);
              const closeY = yMain(close);
              const highY = yMain(high);
              const lowY = yMain(low);
              const bodyTop = Math.min(openY, closeY);
              const bodyHeight = Math.max(2, Math.abs(closeY - openY));
              const isUp = close >= open;

              return (
                <g key={`${p.date}-${i}-candle`}>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={highY}
                    y2={lowY}
                    stroke={isUp ? "rgba(226,232,240,0.92)" : "rgba(37,99,235,0.95)"}
                    strokeWidth="1.1"
                    strokeLinecap="round"
                  />

                  <rect
                    x={cx - candleBodyWidth / 2}
                    y={bodyTop}
                    width={candleBodyWidth}
                    height={bodyHeight}
                    rx="1.5"
                    fill={isUp ? "rgba(226,232,240,0.88)" : "rgba(37,99,235,0.92)"}
                    stroke={isUp ? "rgba(248,250,252,0.95)" : "rgba(96,165,250,0.95)"}
                    strokeWidth="0.8"
                  />
                </g>
              );
            })}
          </>
        ) : (
          <path
            d={closePath}
            fill="none"
            stroke={CHART_COLORS.price}
            strokeWidth="2.25"
            opacity="1"
          />
        )}

        {showMA50 && ma50Path ? (
          <path
            d={ma50Path}
            fill="none"
            stroke={CHART_COLORS.ma50}
            strokeWidth="2.1"
            opacity="0.92"
            strokeDasharray="6 4"
          />
        ) : null}

        {showMA200 && ma200Path ? (
          <path
            d={ma200Path}
            fill="none"
            stroke={CHART_COLORS.ma200}
            strokeWidth="2.1"
            opacity="0.9"
            strokeDasharray="2 6"
          />
        ) : null}

        {showWeeklyMA200 && weeklyMa200Path ? (
          <path
            d={weeklyMa200Path}
            fill="none"
            stroke={CHART_COLORS.weeklyMa200}
            strokeWidth="2.4"
            opacity="0.95"
          />
        ) : null}

        {showBollinger ? (
          <>
            {bollUPath ? (
              <path
                d={bollUPath}
                fill="none"
                stroke={CHART_COLORS.bollUpper}
                strokeWidth="1.75"
                opacity="1"
              />
            ) : null}
            {bollMPath ? (
              <path
                d={bollMPath}
                fill="none"
                stroke={CHART_COLORS.bollMid}
                strokeWidth="2"
                opacity="1"
                strokeDasharray="6 4"
              />
            ) : null}
            {bollLPath ? (
              <path
                d={bollLPath}
                fill="none"
                stroke={CHART_COLORS.bollLower}
                strokeWidth="1.75"
                opacity="1"
              />
            ) : null}
          </>
        ) : null}

        {showEMA20 && ema20Path ? (
          <path
            d={ema20Path}
            fill="none"
            stroke={CHART_COLORS.ema20}
            strokeWidth="2"
            opacity="0.95"
            strokeDasharray="5 5"
          />
        ) : null}

        {showVWMA20 && vwma20Path ? (
          <path
            d={vwma20Path}
            fill="none"
            stroke={CHART_COLORS.vwma20}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        ) : null}

        {showTrendHelper ? (
          <>
            {/* Purple MA200 — drawn as part of the Trend Helper. */}
            {ma200Path ? (
              <path d={ma200Path} fill="none" stroke={CHART_COLORS.nctMa200} strokeWidth="2" opacity="0.9" />
            ) : null}
            {/* Coloured HMA trend line(s): one segment per bar, coloured by the
                confirmed trend state (blue up / yellow down / grey unconfirmed). */}
            {[trendSmooth, trendFast].map((t, ti) =>
              t
                ? series.map((_p, i) => {
                    if (i === 0) return null;
                    const a = t.line[i - 1], b = t.line[i];
                    if (typeof a !== "number" || !Number.isFinite(a) || typeof b !== "number" || !Number.isFinite(b)) return null;
                    const st = t.state[i] ?? 0;
                    const color = st > 0 ? CHART_COLORS.nctBull : st < 0 ? CHART_COLORS.nctBear : CHART_COLORS.nctNeutral;
                    return (
                      <line
                        key={`nct-${ti}-${i}`}
                        x1={x(i - 1)}
                        y1={yMain(a)}
                        x2={x(i)}
                        y2={yMain(b)}
                        stroke={color}
                        strokeWidth="2.6"
                        strokeLinecap="round"
                      />
                    );
                  })
                : null
            )}
          </>
        ) : null}

        {wantsSubPanel ? (
          <>
            <rect
              x={padL}
              y={subTop}
              width={width - padL - padR}
              height={subH}
              fill="none"
              stroke="currentColor"
              opacity="0.10"
            />

            {activeLowerOverlay === "RSI(14)" ? (
              <>
                <rect
                  x={padL}
                  y={ySub(70)}
                  width={width - padL - padR}
                  height={Math.max(0, ySub(30) - ySub(70))}
                  fill={CHART_COLORS.rsiBand}
                />
                <line
                  x1={padL}
                  y1={ySub(70)}
                  x2={width - padR}
                  y2={ySub(70)}
                  stroke="currentColor"
                  opacity="0.10"
                />
                <line
                  x1={padL}
                  y1={ySub(30)}
                  x2={width - padR}
                  y2={ySub(30)}
                  stroke="currentColor"
                  opacity="0.10"
                />
                {rsiPath ? (
                  <path
                    d={rsiPath}
                    fill="none"
                    stroke={CHART_COLORS.rsi}
                    strokeWidth="2"
                    opacity="0.95"
                  />
                ) : null}
              </>
            ) : null}

            {activeLowerOverlay === "MACD(12,26,9)" ? (
              <>
                {subRange ? (
                  <line
                    x1={padL}
                    y1={ySub(0)}
                    x2={width - padR}
                    y2={ySub(0)}
                    stroke="currentColor"
                    opacity="0.12"
                  />
                ) : null}

                {subRange
                  ? series.map((p, i) => {
                      const v = p.macdHist;
                      if (typeof v !== "number" || !Number.isFinite(v)) return null;

                      const x0 = x(i);
                      const barW =
                        Math.max(1, (width - padL - padR) / Math.max(10, series.length) - 1);
                      const y0 = ySub(0);
                      const yv = ySub(v);
                      const h = Math.abs(yv - y0);

                      return (
                        <rect
                          key={i}
                          x={x0 - barW / 2}
                          y={Math.min(y0, yv)}
                          width={barW}
                          height={h}
                          fill={CHART_COLORS.macdHist}
                          opacity="1"
                        />
                      );
                    })
                  : null}

                {macdLinePath ? (
                  <path
                    d={macdLinePath}
                    fill="none"
                    stroke={CHART_COLORS.macdLine}
                    strokeWidth="2"
                    opacity="0.95"
                  />
                ) : null}

                {macdSignalPath ? (
                  <path
                    d={macdSignalPath}
                    fill="none"
                    stroke={CHART_COLORS.macdSignal}
                    strokeWidth="2"
                    opacity="0.95"
                    strokeDasharray="6 4"
                  />
                ) : null}
              </>
            ) : null}

            {activeLowerOverlay === "Stochastic(14,3)" ? (
              <>
                <rect
                  x={padL}
                  y={ySub(80)}
                  width={width - padL - padR}
                  height={Math.max(0, ySub(20) - ySub(80))}
                  fill={CHART_COLORS.stochBand}
                />
                <line
                  x1={padL}
                  y1={ySub(80)}
                  x2={width - padR}
                  y2={ySub(80)}
                  stroke="currentColor"
                  opacity="0.10"
                />
                <line
                  x1={padL}
                  y1={ySub(20)}
                  x2={width - padR}
                  y2={ySub(20)}
                  stroke="currentColor"
                  opacity="0.10"
                />
                {stochKPath ? (
                  <path
                    d={stochKPath}
                    fill="none"
                    stroke={CHART_COLORS.stochK}
                    strokeWidth="2"
                    opacity="0.95"
                  />
                ) : null}
                {stochDPath ? (
                  <path
                    d={stochDPath}
                    fill="none"
                    stroke={CHART_COLORS.stochD}
                    strokeWidth="2"
                    opacity="0.95"
                    strokeDasharray="6 4"
                  />
                ) : null}
              </>
            ) : null}

            {activeLowerOverlay === "ATR(14)" ? (
              <>
                {atrPath ? (
                  <path
                    d={atrPath}
                    fill="none"
                    stroke={CHART_COLORS.atr}
                    strokeWidth="2"
                    opacity="0.95"
                  />
                ) : null}
              </>
            ) : null}

            {activeLowerOverlay === "Volume" ? (
              <>
                {subRange
                  ? series.map((p, i) => {
                      const v = p.volume;
                      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;

                      const x0 = x(i);
                      const barW =
                        Math.max(1, (width - padL - padR) / Math.max(10, series.length) - 1);
                      const y0 = ySub(0);
                      const yv = ySub(v);
                      const h = Math.abs(yv - y0);

                      return (
                        <rect
                          key={i}
                          x={x0 - barW / 2}
                          y={Math.min(y0, yv)}
                          width={barW}
                          height={h}
                          fill={CHART_COLORS.volume}
                          opacity="1"
                        />
                      );
                    })
                  : null}
              </>
            ) : null}
          </>
        ) : null}

        {chartType === "line" ? (
          <circle
            cx={x(series.length - 1)}
            cy={yMain(last.close)}
            r="3.5"
            fill={CHART_COLORS.price}
            opacity="1"
          />
        ) : null}
      </svg>
      )}

      <ChartWatermark />
      </div>

      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {showTradingView
              ? `Live TradingView chart for ${symbol}`
              : `From ${series[0].date} → ${series[series.length - 1].date}`}
          </div>

          {!hideSourceToggle ? (
          <div
            style={{
              display: "inline-flex",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 10,
              padding: 3,
              gap: 3,
              flex: "0 0 auto",
            }}
            role="group"
            aria-label="Chart source"
          >
            <button
              type="button"
              onClick={() => setTradingViewMode(false)}
              aria-pressed={!showTradingView}
              style={{
                border: "none",
                borderRadius: 7,
                padding: "7px 12px",
                background: !showTradingView ? "rgba(167,139,250,0.28)" : "transparent",
                color: !showTradingView ? "#ede9fe" : "#8a97ad",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                boxShadow: !showTradingView ? "inset 0 0 0 1px rgba(167,139,250,0.36)" : "none",
                whiteSpace: "nowrap",
              }}
            >
              MyStockHarbor
            </button>
            <button
              type="button"
              onClick={() => setTradingViewMode(true)}
              aria-pressed={showTradingView}
              style={{
                border: "none",
                borderRadius: 7,
                padding: "7px 12px",
                background: showTradingView ? "rgba(167,139,250,0.28)" : "transparent",
                color: showTradingView ? "#ede9fe" : "#8a97ad",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                boxShadow: showTradingView ? "inset 0 0 0 1px rgba(167,139,250,0.36)" : "none",
                whiteSpace: "nowrap",
              }}
            >
              TradingView
            </button>
          </div>
          ) : null}
        </div>

        {showTradingViewLink || showTradeLink ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {showTradingViewLink ? (
              <a
                href={`/api/go/tradingview?symbol=${encodeURIComponent(symbol)}`}
                target="_blank"
                rel="noopener noreferrer sponsored nofollow"
                className="pcActionLink"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(59,130,246,0.40)",
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                  color: "#dbeafe",
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                Open in TradingView ↗
              </a>
            ) : null}

            {showTradeLink ? (
              <a
                href="/platforms"
                className="pcActionLink"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(34,197,94,0.40)",
                  background:
                    "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
                  color: "#dcfce7",
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                Trade {symbol} →
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Below 640px, "Open in TradingView" and "Trade {symbol}" drop their
          pill/card treatment (background, border, radius, horizontal
          padding) and render as plain inline text links instead, to save
          horizontal space. Desktop/tablet keep the original button look. */}
      <style>{`
        @media (max-width: 640px) {
          .pcActionLink {
            background: transparent !important;
            border: none !important;
            border-radius: 0 !important;
            padding: 2px 0 !important;
            box-shadow: none !important;
            text-decoration: underline !important;
            text-underline-offset: 3px !important;
          }
        }
      `}</style>
    </div>
  );
}
