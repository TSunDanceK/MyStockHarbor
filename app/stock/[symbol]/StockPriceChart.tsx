"use client";

import React, { useMemo, useRef, useState } from "react";
import { utcDay } from "@/lib/utcDate";
import { chartReadout, indexAtFraction, shownIndex, stepIndex } from "@/lib/chartReadout";
import { chartGapZones, inGapWords, zoneAt, type ChartGapZone, type GapInputBar } from "@/lib/chartGaps";
import { STRETCH_NOTE, stretchHistory, stretchLine } from "@/lib/stretch";
import { candleFit, candleFitWords, candleOf, candleWords } from "@/lib/chartCandles";
import { useChartMode, usePlotWidth } from "@/lib/useChartMode";

type Point = {
  date: string;
  close: number;
  // The stored daily bar's open, high and low, for the candle view (#553
  // COWORK #165). Already on the bars the page holds: no fetch.
  open?: number;
  high?: number;
  low?: number;
  // Tiingo's newest point when it is today's partial bar (step 3, #553 COWORK
  // #57 §2): "today so far (IEX), hh:mm ET".
  label?: string;
};

type Props = {
  symbol: string;
  data: Point[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  height?: number;
  // The linked "Market data from Tiingo.com", rendered by page.tsx when the
  // series is Tiingo's (step 3, COWORK #71/#92).
  credit?: React.ReactNode;
  // The page's full daily history (highs and lows), for the fair value gap
  // zones (#553 COWORK #140/#144). The same bars the page holds: no fetch.
  gapBars?: readonly GapInputBar[];
};

/** The tap note's words (#553 COWORK #140): descriptive, past only. */
export const GAP_NOTE = "A price gap left when the market moved too fast for candles to overlap. Some traders watch whether price returns to it. A description, not a forecast.";

// SAY WHY, NOT A BARE "—" (#553 COWORK #88, applied to B's chart MAs): a young
// listing (KRMN, ~410 stored bars) cannot have an MA200 over the shown window.
export const SHORT_HISTORY_NOTE = "Not enough price history stored yet";

const NO_ZONES: ChartGapZone[] = [];
// The plot's share of the viewBox width (920 less the 38 + 60 px gutters).
const PLOT_FRACTION = (920 - 38 - 60) / 920;
const UP = "#22c55e";
const DOWN = "#ef4444";

function fmtMoney(v: number) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtXLabel(s: string) {
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

function pathFrom(arr: Array<number | null>, x: (i: number) => number, y: (v: number) => number) {
  let d = "";
  let started = false;

  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      started = false;
      continue;
    }

    d += `${started ? "L" : "M"} ${x(i).toFixed(2)} ${y(v).toFixed(2)} `;
    started = true;
  }

  return d.trim();
}

export default function StockPriceChart({
  symbol,
  data,
  ma50,
  ma200,
  height = 360,
  credit,
  gapBars,
}: Props) {
  const width = 920;
  const padL = 38;
  const padR = 60;
  const padT = 24;
  const padB = 34;

  // THE READOUT (#553 COWORK #136): hover (mouse), touch-and-drag (phone) or
  // ←/→ (keyboard, once focused) picks a bar; null shows the latest bar. The
  // readout reads the bars already drawn here, so hovering fetches nothing.
  const [picked, setPicked] = useState<number | null>(null);
  // Said to screen readers on keyboard steps only, never on every mouse move.
  const [spoken, setSpoken] = useState("");
  // FAIR VALUE GAPS (#553 COWORK #140/#144): off until asked for; the note on a tap.
  const [showGaps, setShowGaps] = useState(false);
  const [gapNote, setGapNote] = useState(false);
  const [stretchNote, setStretchNote] = useState(false);
  // The pointer's height in the chart, as a price, to say when it is inside a zone.
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  // LINE | CANDLES (#553 COWORK #165): Line by default and on the server; the
  // browser's remembered choice after mount (useChartMode). Only the stock
  // page's chart (the one handed its bars) offers it.
  const { mode, chooseMode } = useChartMode(Boolean(gapBars));
  const candles = mode === "candles" && Boolean(gapBars);
  // The plot's on-screen width, for the >= 3 px candle rule (phones show fewer days).
  const svgRef = useRef<SVGSVGElement | null>(null);
  const plotPx = usePlotWidth(svgRef, PLOT_FRACTION);

  const fullSeries = useMemo(() => {
    const n = data.length;
    const safe50 = ma50.length === n ? ma50 : Array(n).fill(null);
    const safe200 = ma200.length === n ? ma200 : Array(n).fill(null);

    return data.map((p, i) => ({
      ...p,
      ma50: safe50[i] as number | null,
      ma200: safe200[i] as number | null,
    }));
  }, [data, ma50, ma200]);

  // In candle view, only the latest sessions that fit at >= 3 px each.
  const shownCount = candles ? candleFit(plotPx, fullSeries.length) : fullSeries.length;
  const series = useMemo(() => (shownCount < fullSeries.length ? fullSeries.slice(-shownCount) : fullSeries), [fullSeries, shownCount]);
  const fitWords = candles ? candleFitWords(series.length, fullSeries.length) : null;

  const hasData = series.length >= 2;

  const gaps = useMemo(() => chartGapZones(gapBars ?? [], series.map((p) => p.date)), [gapBars, series]);
  const zones = showGaps ? gaps.zones : NO_ZONES;
  // STRETCH (#553 COWORK #141/#144): this stock's own past, from the same bars;
  // completed sessions only, like the gaps.
  const stretch = useMemo(() => {
    if (!gapBars) return null;
    const done = gapBars.filter((b) => !b.label && Number.isFinite(b.close));
    return stretchLine(symbol, stretchHistory(done));
  }, [gapBars, symbol]);

  const x = useMemo(() => {
    return (i: number) =>
      padL + (i * (width - padL - padR)) / Math.max(1, series.length - 1);
  }, [series.length]);

  const { minV, maxV, rangeV } = useMemo(() => {
    if (!hasData) return { minV: 0, maxV: 1, rangeV: 1 };

    const vals: number[] = [];
    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      vals.push(p.close);
      // A candle shown is a candle in full: its wick widens the scale.
      if (candles) {
        const c = candleOf(series, i);
        vals.push(c.high, c.low);
      }
      if (typeof p.ma50 === "number") vals.push(p.ma50);
      if (typeof p.ma200 === "number") vals.push(p.ma200);
    }
    // A zone shown is a zone in full: the scale widens to hold it.
    for (const z of zones) vals.push(z.lower, z.upper);

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = Math.max(1e-9, max - min);

    return { minV: min, maxV: max, rangeV: range };
  }, [hasData, series, zones, candles]);

  const y = useMemo(() => {
    const innerH = height - padT - padB;
    return (v: number) => padT + ((maxV - v) * innerH) / rangeV;
  }, [height, maxV, rangeV]);

  const closePath = useMemo(() => {
    if (!hasData) return "";
    return series
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(p.close).toFixed(2)}`)
      .join(" ");
  }, [hasData, series, x, y]);

  const ma50Path = useMemo(() => pathFrom(series.map((p) => p.ma50), x, y), [series, x, y]);
  const ma200Path = useMemo(() => pathFrom(series.map((p) => p.ma200), x, y), [series, x, y]);
  const has50 = series.some((p) => typeof p.ma50 === "number");
  const has200 = series.some((p) => typeof p.ma200 === "number");

  const yTicks = useMemo(() => {
    if (!hasData) return [];
    const ticks: { v: number; y: number }[] = [];
    const nTicks = 5;

    for (let i = 0; i < nTicks; i++) {
      const t = i / (nTicks - 1);
      const v = maxV - t * rangeV;
      ticks.push({ v, y: y(v) });
    }

    return ticks;
  }, [hasData, maxV, rangeV, y]);

  const xTicks = useMemo(() => {
    if (!hasData) return [];
    const out: { x: number; label: string }[] = [];
    const nTicks = 5;

    for (let i = 0; i < nTicks; i++) {
      const t = i / (nTicks - 1);
      const idx = Math.round(t * (series.length - 1));
      out.push({ x: x(idx), label: fmtXLabel(series[idx].date) });
    }

    const seen = new Set<string>();
    return out.filter((item) => {
      if (seen.has(item.label)) return false;
      seen.add(item.label);
      return true;
    });
  }, [hasData, series, x]);

  if (!hasData) {
    return (
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 16,
          padding: 18,
          background: "rgba(255,255,255,0.03)",
          opacity: 0.78,
        }}
      >
        Not enough data to chart.
      </div>
    );
  }

  const last = series[series.length - 1];
  const readout = chartReadout(series, picked);
  const at = shownIndex(picked, series.length);
  const box = { width, padL, padR };

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const inner = el.clientWidth || r.width;
    if (!inner) return;
    setPicked(indexAtFraction((e.clientX - r.left - el.clientLeft) / inner, series.length, box));
    // The same scale vertically (the viewBox keeps its aspect): the pointer's price.
    const vy = ((e.clientY - r.top - el.clientTop) / inner) * width;
    setHoverValue(maxV - ((vy - padT) * rangeV) / (height - padT - padB));
  };
  const hoverZone = picked !== null && hoverValue !== null ? zoneAt(zones, at, hoverValue) : null;
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const next = stepIndex(picked, e.key, series.length);
    if (next === undefined) return;
    e.preventDefault();
    setPicked(next);
    setHoverValue(null);
    const r = chartReadout(series, next);
    if (r) setSpoken(`${r.heading} ${r.date}: ${r.close}${r.change ? `, ${r.change.text}` : ""}`);
  };

  return (
    <div style={{ width: "100%", containerType: "inline-size" }}>
      {/* Phone (the default): three fixed lines, so the chart never jumps
          while scrubbing; a column 640 px or wider: one line. */}
      <style>{`
        .chart-readout-wrap { container-type: inline-size; }
        .chart-readout { display: grid; grid-template-columns: minmax(0, 1fr); grid-auto-rows: 20px; height: 60px; margin-bottom: 8px; font-size: 0.8125rem; line-height: 20px; font-variant-numeric: tabular-nums; }
        .chart-readout > span { white-space: nowrap; overflow: hidden; }
        @container (min-width: 640px) {
          .chart-readout { display: flex; column-gap: 14px; height: 20px; }
        }
        .chart-gap-row { display: flex; flex-wrap: wrap; align-items: center; column-gap: 10px; row-gap: 4px; margin-bottom: 6px; font-size: var(--fs-label); }
        .chart-gap-toggle, .chart-gap-why { min-height: 32px; padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.04); color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
        .chart-gap-toggle[aria-pressed="true"] { border-color: rgba(34,197,94,0.55); background: rgba(34,197,94,0.12); }
        .chart-gap-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
        .chart-mode { display: inline-flex; border: 1px solid rgba(255,255,255,0.16); border-radius: 999px; padding: 2px; background: rgba(255,255,255,0.04); }
        .chart-mode-btn { min-height: 28px; padding: 2px 12px; border: 0; border-radius: 999px; background: none; color: inherit; font: inherit; font-weight: 700; cursor: pointer; opacity: 0.75; }
        .chart-mode-btn[aria-pressed="true"] { background: rgba(56,189,248,0.16); box-shadow: inset 0 0 0 1px rgba(56,189,248,0.5); opacity: 1; }
        .chart-mode-btn:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        .chart-readout.candles { grid-auto-rows: 20px; height: 80px; }
        @container (min-width: 640px) { .chart-readout.candles { flex-wrap: wrap; height: 40px; } }
        /* The two tap questions and the status line are read, so they sit at
           --fs-read, not the row's --fs-label (#553 COWORK #148: C's
           measure-reading-size found them at 13px). */
        .chart-gap-why { font-weight: 500; border-style: dashed; font-size: var(--fs-read); }
        /* Its own line, always reserved, so the words coming and going never move the chart. */
        .chart-gap-status { flex: 1 0 100%; height: calc(var(--fs-read) * var(--lh-read)); font-size: var(--fs-read); line-height: var(--lh-read); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; }
        @container (min-width: 640px) { .chart-gap-status { flex: 1 1 auto; } }
        .chart-stretch { margin: 0 0 8px; font-size: var(--fs-read); line-height: var(--lh-read); }
        .chart-stretch .chart-gap-why { font-size: var(--fs-read); margin-left: 4px; }
        .chart-gap-note { margin: 0 0 8px; font-size: var(--fs-read); line-height: var(--lh-read); opacity: 0.9; }
      `}</style>
      {/* THE GAP TOGGLE (#553 COWORK #140/#144): off by default; with none, it
          stays visible, disabled, with the reason beside it, never hidden. The
          line beside it also says when the pointer is inside a zone. */}
      {/* Only where the page passes its bars (the SPX page's chart has no toggle). */}
      {gapBars ? (<>
      {stretch ? (
        <p className="chart-stretch" data-chart-stretch>
          {stretch}{" "}
          <button type="button" className="chart-gap-why" aria-expanded={stretchNote} aria-controls={`${symbol}-stretch-note`} onClick={() => setStretchNote((v) => !v)}>
            How is this counted?
          </button>
        </p>
      ) : null}
      {stretchNote ? <p id={`${symbol}-stretch-note`} className="chart-gap-note">{STRETCH_NOTE}</p> : null}
      <div className="chart-gap-row" data-chart-gaps={gaps.zones.length ? (showGaps ? "on" : "off") : "none"}>
        {/* LINE | CANDLES (#553 COWORK #165): a real button group, Line by default. */}
        <span className="chart-mode" role="group" aria-label="Chart style">
          {(["line", "candles"] as const).map((m) => (
            <button key={m} type="button" className="chart-mode-btn" aria-pressed={mode === m} onClick={() => chooseMode(m)}>
              {m === "line" ? "Line" : "Candles"}
            </button>
          ))}
        </span>
        <button
          type="button"
          className="chart-gap-toggle"
          aria-pressed={showGaps}
          disabled={!gaps.zones.length}
          onClick={() => setShowGaps((v) => !v)}
        >
          {showGaps ? "Hide gaps" : "Show gaps"}
        </button>
        <button type="button" className="chart-gap-why" aria-expanded={gapNote} aria-controls={`${symbol}-gap-note`} onClick={() => setGapNote((v) => !v)}>
          What is a gap?
        </button>
        <span className="chart-gap-status" data-chart-gap-status>
          {gaps.reason ?? (hoverZone ? inGapWords(hoverZone) : "")}
        </span>
      </div>
      {gapNote ? (
        <p id={`${symbol}-gap-note`} className="chart-gap-note">{GAP_NOTE}</p>
      ) : null}
      </>) : null}
      {readout ? (
        <div className="chart-readout-wrap">
          <div className={candles ? "chart-readout candles" : "chart-readout"} data-chart-readout={readout.isLatest ? "latest" : "picked"}>
            <span>
              <span style={{ opacity: 0.74 }}>{readout.heading} · {readout.date}</span>
              <span style={{ marginLeft: 10, fontWeight: 800 }}>{readout.close}</span>
            </span>
            {candles && at >= 0 ? <span data-chart-ohlc>{candleWords(candleOf(series, at))}</span> : null}
            <span
              data-chart-change={readout.change?.dir ?? "none"}
              style={{ fontWeight: 700, color: readout.change?.dir === "up" ? UP : readout.change?.dir === "down" ? DOWN : undefined, opacity: readout.change ? 1 : 0.6 }}
            >
              {readout.change ? `${readout.change.text} vs previous close` : "no previous close shown"}
            </span>
            <span style={{ opacity: 0.8 }}>
              MA50 {readout.ma50 ?? "n/a"} · MA200 {readout.ma200 ?? "n/a"}
            </span>
          </div>
        </div>
      ) : null}
      <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {spoken}
      </span>
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        tabIndex={0}
        aria-label={`${symbol} price chart with MA50 and MA200. Arrow keys step through the days; Escape returns to the latest close.`}
        onPointerDown={(e) => {
          // A finger keeps scrubbing past the chart's edge.
          if (e.pointerType !== "mouse") {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
          }
          pick(e);
        }}
        onPointerMove={pick}
        onPointerUp={(e) => { if (e.pointerType !== "mouse") { setPicked(null); setHoverValue(null); } }}
        onPointerCancel={() => { setPicked(null); setHoverValue(null); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") { setPicked(null); setHoverValue(null); } }}
        onKeyDown={onKeyDown}
        onBlur={() => setPicked(null)}
        style={{
          display: "block",
          // The 1 px border sat outside width: 100% and ran 2 px past the
          // column (#553 CODE-C #74).
          boxSizing: "border-box",
          // Vertical swipes still scroll the page; a sideways drag scrubs.
          touchAction: "pan-y",
          cursor: "crosshair",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "linear-gradient(180deg, rgba(8,14,28,0.96), rgba(6,10,18,0.98))",
        }}
      >
        <rect
          x={padL}
          y={padT}
          width={width - padL - padR}
          height={height - padT - padB}
          fill="none"
          stroke="currentColor"
          opacity="0.08"
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
              fontSize="0.75rem"
              fill="currentColor"
              opacity="0.6"
            >
              {fmtMoney(t.v)}
            </text>
          </g>
        ))}

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
              fontSize="0.75rem"
              fill="currentColor"
              opacity="0.6"
              textAnchor="middle"
            >
              {t.label}
            </text>
          </g>
        ))}

        {zones.map((z) => (
          <rect
            key={`${z.kind}-${z.startIndex}-${z.lower}`}
            data-chart-gap={z.kind}
            x={x(z.startIndex)}
            y={y(z.upper)}
            width={Math.max(1, width - padR - x(z.startIndex))}
            height={Math.max(1, y(z.lower) - y(z.upper))}
            fill={z.kind === "bullish" ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.16)"}
            stroke={z.kind === "bullish" ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)"}
            strokeWidth="1"
            pointerEvents="none"
          />
        ))}

        {candles ? (
          // ONE CANDLE PER STORED DAILY BAR (#553 COWORK #165): green when the
          // close is at or above the open, red otherwise; a 1 px wick; the body
          // width from the spacing; a flat day still a visible body; today's
          // partial session hollow, so it never reads as a finished day.
          <g data-chart-candles={series.length}>
            {series.map((p, i) => {
              const c = candleOf(series, i);
              const step = (width - padL - padR) / Math.max(1, series.length - 1);
              const bodyW = Math.max(1, Math.min(14, step * 0.7));
              const pxPerUnit = plotPx > 0 ? (width - padL - padR) / plotPx : 1;
              const top = y(Math.max(c.open, c.close));
              const bodyH = Math.max(1.5 * pxPerUnit, Math.abs(y(c.open) - y(c.close)));
              const colour = c.up ? UP : DOWN;
              return (
                <g key={p.date} data-candle={c.up ? "up" : "down"} data-candle-partial={c.partial ? "1" : undefined}>
                  <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={colour} strokeWidth={pxPerUnit} vectorEffect="non-scaling-stroke" opacity={c.partial ? 0.7 : 1} />
                  <rect
                    x={x(i) - bodyW / 2}
                    y={top - (bodyH - Math.abs(y(c.open) - y(c.close))) / 2}
                    width={bodyW}
                    height={bodyH}
                    fill={c.partial ? "none" : colour}
                    stroke={colour}
                    strokeWidth={c.partial ? 1.2 : 0}
                    opacity={c.partial ? 0.85 : 1}
                  />
                </g>
              );
            })}
          </g>
        ) : (
          <path d={closePath} fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.95" data-chart-line />
        )}

        {ma50Path ? (
          <path
            d={ma50Path}
            fill="none"
            stroke="#22c55e"
            strokeWidth="2"
            opacity="0.9"
            strokeDasharray="6 4"
          />
        ) : null}

        {ma200Path ? (
          <path
            d={ma200Path}
            fill="none"
            stroke="#eab308"
            strokeWidth="2"
            opacity="0.85"
            strokeDasharray="3 5"
          />
        ) : null}

        <circle
          cx={x(series.length - 1)}
          cy={y(last.close)}
          r="3.5"
          fill="currentColor"
          opacity="0.95"
        />

        {picked !== null && at >= 0 ? (
          <g data-chart-marker={at} pointerEvents="none">
            <line x1={x(at)} y1={padT} x2={x(at)} y2={height - padB} stroke="currentColor" strokeWidth="1" opacity="0.45" />
            <circle cx={x(at)} cy={y(series[at].close)} r="5" fill="currentColor" stroke="#020617" strokeWidth="2" />
          </g>
        ) : null}
      </svg>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: "0.75rem",
          opacity: 0.74,
        }}
      >
        <div data-fine-print>
          {/* 2026-10-03 (#553 COWORK #113/#114): read "2025-10-20 → 2026-10-02";
              now "20 Oct 2025 → 2 Oct 2026" (utcDay: UTC fields, by hand, so the
              server and browser render the same text). */}
          {symbol} • {utcDay(series[0].date) ?? series[0].date} → {utcDay(series[series.length - 1].date) ?? series[series.length - 1].date}
          {series[series.length - 1].label ? ` (${series[series.length - 1].label})` : null}
          {fitWords ? <> · <span data-chart-fit>{fitWords}</span></> : null}
          {credit ? <> · {credit}</> : null}
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 2,
                borderRadius: 999,
                background: "currentColor",
                display: "inline-block",
              }}
            />
            Price
          </span>

          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: has50 ? 1 : 0.55 }}
            title={has50 ? undefined : SHORT_HISTORY_NOTE}
          >
            <span
              style={{
                width: 10,
                height: 2,
                borderRadius: 999,
                background: "#22c55e",
                display: "inline-block",
              }}
            />
            MA50{has50 ? null : " (n/a)"}
          </span>

          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: has200 ? 1 : 0.55 }}
            title={has200 ? undefined : SHORT_HISTORY_NOTE}
          >
            <span
              style={{
                width: 10,
                height: 2,
                borderRadius: 999,
                background: "#eab308",
                display: "inline-block",
              }}
            />
            MA200{has200 ? null : " (n/a)"}
          </span>
        </div>
      </div>
    </div>
  );
}
