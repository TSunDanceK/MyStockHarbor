"use client";

import React, { useMemo, useState } from "react";
import { utcDay } from "@/lib/utcDate";
import { chartReadout, indexAtFraction, shownIndex, stepIndex } from "@/lib/chartReadout";

type Point = {
  date: string;
  close: number;
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
};

// SAY WHY, NOT A BARE "—" (#553 COWORK #88, applied to B's chart MAs): a young
// listing (KRMN, ~410 stored bars) cannot have an MA200 over the shown window.
export const SHORT_HISTORY_NOTE = "Not enough price history stored yet";

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

  const series = useMemo(() => {
    const n = data.length;
    const safe50 = ma50.length === n ? ma50 : Array(n).fill(null);
    const safe200 = ma200.length === n ? ma200 : Array(n).fill(null);

    return data.map((p, i) => ({
      ...p,
      ma50: safe50[i] as number | null,
      ma200: safe200[i] as number | null,
    }));
  }, [data, ma50, ma200]);

  const hasData = series.length >= 2;

  const x = useMemo(() => {
    return (i: number) =>
      padL + (i * (width - padL - padR)) / Math.max(1, series.length - 1);
  }, [series.length]);

  const { minV, maxV, rangeV } = useMemo(() => {
    if (!hasData) return { minV: 0, maxV: 1, rangeV: 1 };

    const vals: number[] = [];
    for (const p of series) {
      vals.push(p.close);
      if (typeof p.ma50 === "number") vals.push(p.ma50);
      if (typeof p.ma200 === "number") vals.push(p.ma200);
    }

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = Math.max(1e-9, max - min);

    return { minV: min, maxV: max, rangeV: range };
  }, [hasData, series]);

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
  };
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const next = stepIndex(picked, e.key, series.length);
    if (next === undefined) return;
    e.preventDefault();
    setPicked(next);
    const r = chartReadout(series, next);
    if (r) setSpoken(`${r.heading} ${r.date}: ${r.close}${r.change ? `, ${r.change.text}` : ""}`);
  };

  return (
    <div style={{ width: "100%" }}>
      {/* Phone (the default): three fixed lines, so the chart never jumps
          while scrubbing; a column 640 px or wider: one line. */}
      <style>{`
        .chart-readout-wrap { container-type: inline-size; }
        .chart-readout { display: grid; grid-template-columns: minmax(0, 1fr); grid-auto-rows: 20px; height: 60px; margin-bottom: 8px; font-size: 13px; line-height: 20px; font-variant-numeric: tabular-nums; }
        .chart-readout > span { white-space: nowrap; overflow: hidden; }
        @container (min-width: 640px) {
          .chart-readout { display: flex; column-gap: 14px; height: 20px; }
        }
      `}</style>
      {readout ? (
        <div className="chart-readout-wrap">
          <div className="chart-readout" data-chart-readout={readout.isLatest ? "latest" : "picked"}>
            <span>
              <span style={{ opacity: 0.74 }}>{readout.heading} · {readout.date}</span>
              <span style={{ marginLeft: 10, fontWeight: 800 }}>{readout.close}</span>
            </span>
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
        onPointerUp={(e) => { if (e.pointerType !== "mouse") setPicked(null); }}
        onPointerCancel={() => setPicked(null)}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setPicked(null); }}
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
              fontSize={11}
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
              fontSize={11}
              fill="currentColor"
              opacity="0.6"
              textAnchor="middle"
            >
              {t.label}
            </text>
          </g>
        ))}

        <path d={closePath} fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.95" />

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
          fontSize: 12,
          opacity: 0.74,
        }}
      >
        <div>
          {/* 2026-10-03 (#553 COWORK #113/#114): read "2025-10-20 → 2026-10-02";
              now "20 Oct 2025 → 2 Oct 2026" (utcDay: UTC fields, by hand, so the
              server and browser render the same text). */}
          {symbol} • {utcDay(series[0].date) ?? series[0].date} → {utcDay(series[series.length - 1].date) ?? series[series.length - 1].date}
          {series[series.length - 1].label ? ` (${series[series.length - 1].label})` : null}
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
