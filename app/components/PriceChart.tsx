"use client";

import React, { useMemo } from "react";

type Point = { date: string; close: number };

export type Overlay =
  | "None"
  | "MA50"
  | "MA200"
  | "Bollinger(20,2)"
  | "RSI(14)"
  | "MACD(12,26,9)"
  | "EMA20"
  | "VWAP"
  | "Stochastic(14,3)"
  | "ATR(14)"
  | "Volume";

function fmtPct(x: number) {
  const s = x >= 0 ? "+" : "";
  return `${s}${(x * 100).toFixed(2)}%`;
}

function fmtMoney(v: number) {
  // lightweight formatting (no Intl surprises)
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtXLabel(s: string) {
  // If it's ISO-like with time, show time; else show date
  // ex: "2026-03-03" => "03/03"
  // ex: "2026-03-03 14:30" => "14:30"
  const hasTime = s.includes(":");
  if (hasTime) {
    const m = s.match(/(\d{2}:\d{2})/);
    return m ? m[1] : s.slice(-5);
  }
  // date
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

export default function PriceChart({
  data,
  ma50,
  ma200,
  overlay = "None",
  bollUpper,
  bollMid,
  bollLower,
  ema20,
  vwap,
  height = 260,
}: {
  data: Point[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  overlay?: Overlay;

  bollUpper?: (number | null)[];
  bollMid?: (number | null)[];
  bollLower?: (number | null)[];

  ema20?: (number | null)[];
  vwap?: (number | null)[];

  height?: number;
}) {
  const width = 760;

  // padding:
  const padL = 34; // left
  const padR = 54; // right for price labels
  const padT = 24;
  const padB = 34; // bottom for x labels

  const series = useMemo(() => {
    const n = data.length;
    const a50 = ma50.length === n ? ma50 : Array(n).fill(null);
    const a200 = ma200.length === n ? ma200 : Array(n).fill(null);

    const u = bollUpper && bollUpper.length === n ? bollUpper : Array(n).fill(null);
    const m = bollMid && bollMid.length === n ? bollMid : Array(n).fill(null);
    const l = bollLower && bollLower.length === n ? bollLower : Array(n).fill(null);

    const e20 = ema20 && ema20.length === n ? ema20 : Array(n).fill(null);
    const vw = vwap && vwap.length === n ? vwap : Array(n).fill(null);

    return data.map((p, i) => ({
      ...p,
      ma50: a50[i],
      ma200: a200[i],
      bu: u[i],
      bm: m[i],
      bl: l[i],
      ema20: e20[i],
      vwap: vw[i],
    }));
  }, [data, ma50, ma200, bollUpper, bollMid, bollLower, ema20, vwap]);

  if (!series || series.length < 2) return <div style={{ opacity: 0.7 }}>Not enough data to chart.</div>;

  // y-range based on price + active overlays
  const vals: number[] = [];
  for (const p of series) {
    vals.push(p.close);

    if (overlay === "MA50" && typeof p.ma50 === "number") vals.push(p.ma50);
    if (overlay === "MA200" && typeof p.ma200 === "number") vals.push(p.ma200);

    if (overlay === "Bollinger(20,2)") {
      if (typeof p.bu === "number") vals.push(p.bu);
      if (typeof p.bm === "number") vals.push(p.bm);
      if (typeof p.bl === "number") vals.push(p.bl);
    }

    if (overlay === "EMA20" && typeof p.ema20 === "number") vals.push(p.ema20);
    if (overlay === "VWAP" && typeof p.vwap === "number") vals.push(p.vwap);
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(1e-9, max - min);

  const x = (i: number) => padL + (i * (width - padL - padR)) / (series.length - 1);
  const y = (v: number) => padT + ((max - v) * (height - padT - padB)) / range;

  const pathFrom = (arr: Array<number | null>) => {
    let d = "";
    let started = false;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        started = false;
        continue;
      }
      const cmd = started ? "L" : "M";
      d += `${cmd} ${x(i).toFixed(2)} ${y(v).toFixed(2)} `;
      started = true;
    }
    return d.trim();
  };

  const closePath = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(p.close).toFixed(2)}`)
    .join(" ");

  const ma50Path = pathFrom(series.map((p) => p.ma50));
  const ma200Path = pathFrom(series.map((p) => p.ma200));

  const bollUPath = pathFrom(series.map((p) => p.bu));
  const bollMPath = pathFrom(series.map((p) => p.bm));
  const bollLPath = pathFrom(series.map((p) => p.bl));

  const ema20Path = pathFrom(series.map((p) => p.ema20));
  const vwapPath = pathFrom(series.map((p) => p.vwap));

  const first = series[0];
  const last = series[series.length - 1];
  const ret = (last.close - first.close) / first.close;

  // y-axis ticks on right (5 ticks)
  const yTicks = useMemo(() => {
    const ticks: { v: number; y: number }[] = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const v = max - t * range;
      ticks.push({ v, y: y(v) });
    }
    return ticks;
  }, [max, range, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // x-axis ticks (5 ticks)
  const xTicks = useMemo(() => {
    const n = 5;
    const ticks: { i: number; x: number; label: string }[] = [];
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const i = Math.round(t * (series.length - 1));
      ticks.push({ i, x: x(i), label: fmtXLabel(series[i].date) });
    }
    // de-dupe identical labels
    const seen = new Set<string>();
    return ticks.filter((t) => {
      if (seen.has(t.label)) return false;
      seen.add(t.label);
      return true;
    });
  }, [series]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>Price ({overlay === "None" ? "no overlay" : overlay})</div>
        <div style={{ opacity: 0.75 }}>Period return: {fmtPct(ret)}</div>
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
        {/* plot area box */}
        <rect
          x={padL}
          y={padT}
          width={width - padL - padR}
          height={height - padT - padB}
          fill="none"
          stroke="currentColor"
          opacity="0.10"
        />

        {/* horizontal grid + right y labels */}
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
            <text x={width - padR + 6} y={t.y + 4} fontSize={11} fill="currentColor" opacity="0.6">
              {fmtMoney(t.v)}
            </text>
          </g>
        ))}

        {/* bottom x labels */}
        {xTicks.map((t, idx) => (
          <g key={idx}>
            <line x1={t.x} y1={height - padB} x2={t.x} y2={height - padB + 4} stroke="currentColor" opacity="0.25" />
            <text x={t.x} y={height - 10} fontSize={11} fill="currentColor" opacity="0.6" textAnchor="middle">
              {t.label}
            </text>
          </g>
        ))}

        {/* price */}
        <path d={closePath} fill="none" stroke="currentColor" strokeWidth="2.25" opacity="0.95" />

        {/* overlays */}
        {overlay === "MA50" && ma50Path ? (
          <path d={ma50Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" strokeDasharray="6 4" />
        ) : null}

        {overlay === "MA200" && ma200Path ? (
          <path d={ma200Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" strokeDasharray="2 6" />
        ) : null}

        {overlay === "Bollinger(20,2)" ? (
          <>
            {bollUPath ? <path d={bollUPath} fill="none" stroke="currentColor" strokeWidth="1.75" opacity="0.30" /> : null}
            {bollMPath ? (
              <path d={bollMPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeDasharray="6 4" />
            ) : null}
            {bollLPath ? <path d={bollLPath} fill="none" stroke="currentColor" strokeWidth="1.75" opacity="0.30" /> : null}
          </>
        ) : null}

        {overlay === "EMA20" && ema20Path ? (
          <path d={ema20Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeDasharray="5 5" />
        ) : null}

        {overlay === "VWAP" && vwapPath ? (
          <path d={vwapPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeDasharray="3 4" />
        ) : null}

        {/* last point */}
        <circle cx={x(series.length - 1)} cy={y(last.close)} r="3.5" fill="currentColor" opacity="0.9" />
      </svg>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>
          From {series[0].date} → {series[series.length - 1].date}
        </span>
      </div>
    </div>
  );
}
