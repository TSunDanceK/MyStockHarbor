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

export default function PriceChart({
  data,
  ma50,
  ma200,
  overlay = "None",
  bollUpper,
  bollMid,
  bollLower,
  height = 240,
}: {
  data: Point[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  overlay?: Overlay;

  // Optional Bollinger bands (aligned to data length)
  bollUpper?: (number | null)[];
  bollMid?: (number | null)[];
  bollLower?: (number | null)[];
  height?: number;
}) {
  const width = 760;
  const pad = 34;

  const series = useMemo(() => {
    const n = data.length;
    const a50 = ma50.length === n ? ma50 : Array(n).fill(null);
    const a200 = ma200.length === n ? ma200 : Array(n).fill(null);

    const u = bollUpper && bollUpper.length === n ? bollUpper : Array(n).fill(null);
    const m = bollMid && bollMid.length === n ? bollMid : Array(n).fill(null);
    const l = bollLower && bollLower.length === n ? bollLower : Array(n).fill(null);

    return data.map((p, i) => ({
      ...p,
      ma50: a50[i],
      ma200: a200[i],
      bu: u[i],
      bm: m[i],
      bl: l[i],
    }));
  }, [data, ma50, ma200, bollUpper, bollMid, bollLower]);

  if (!series || series.length < 2) return <div style={{ opacity: 0.7 }}>Not enough data to chart.</div>;

  // y-range based on visible overlays + price
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
  }
  // If no overlay values were added, just use price
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(1e-9, max - min);

  const x = (i: number) => pad + (i * (width - pad * 2)) / (series.length - 1);
  const y = (v: number) => pad + ((max - v) * (height - pad * 2)) / range;

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

  const first = series[0];
  const last = series[series.length - 1];
  const ret = (last.close - first.close) / first.close;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>Price ({overlay === "None" ? "no overlay" : overlay})</div>
        <div style={{ opacity: 0.75 }}>Period return: {fmtPct(ret)}</div>
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" opacity="0.15" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" opacity="0.15" />

        {/* price */}
        <path d={closePath} fill="none" stroke="currentColor" strokeWidth="2.25" opacity="0.95" />

        {/* overlay lines */}
        {overlay === "MA50" && ma50Path ? (
          <path d={ma50Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" strokeDasharray="6 4" />
        ) : null}

        {overlay === "MA200" && ma200Path ? (
          <path d={ma200Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" strokeDasharray="2 6" />
        ) : null}

        {overlay === "Bollinger(20,2)" ? (
          <>
            {bollUPath ? <path d={bollUPath} fill="none" stroke="currentColor" strokeWidth="1.75" opacity="0.35" /> : null}
            {bollMPath ? <path d={bollMPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeDasharray="6 4" /> : null}
            {bollLPath ? <path d={bollLPath} fill="none" stroke="currentColor" strokeWidth="1.75" opacity="0.35" /> : null}
          </>
        ) : null}

        <circle cx={x(series.length - 1)} cy={y(last.close)} r="3.5" fill="currentColor" opacity="0.9" />
      </svg>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>From {series[0].date} → {series[series.length - 1].date}</span>
      </div>
    </div>
  );
}
