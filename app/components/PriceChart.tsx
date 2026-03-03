"use client";

import React, { useMemo } from "react";

type Point = { date: string; close: number };

function fmtPct(x: number) {
  const s = x >= 0 ? "+" : "";
  return `${s}${(x * 100).toFixed(2)}%`;
}

export default function PriceChart({
  data,
  ma50,
  ma200,
  height = 240,
}: {
  data: Point[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  height?: number;
}) {
  const width = 760;
  const pad = 34;

  const series = useMemo(() => {
    // align lengths defensively
    const n = data.length;
    const a50 = ma50.length === n ? ma50 : Array(n).fill(null);
    const a200 = ma200.length === n ? ma200 : Array(n).fill(null);

    return data.map((p, i) => ({
      ...p,
      ma50: a50[i],
      ma200: a200[i],
    }));
  }, [data, ma50, ma200]);

  if (!series || series.length < 2) {
    return <div style={{ opacity: 0.7 }}>Not enough data to chart.</div>;
  }

  // y-range based on price + MAs (ignoring nulls)
  const vals: number[] = [];
  for (const p of series) {
    vals.push(p.close);
    if (typeof p.ma50 === "number") vals.push(p.ma50);
    if (typeof p.ma200 === "number") vals.push(p.ma200);
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(1e-9, max - min);

  const x = (i: number) => pad + (i * (width - pad * 2)) / (series.length - 1);
  const y = (v: number) => pad + ((max - v) * (height - pad * 2)) / range;

  const pathFrom = (arr: Array<number | null>, getX: (i: number) => number, getY: (v: number) => number) => {
    // create segments so nulls break the line
    let d = "";
    let started = false;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        started = false;
        continue;
      }
      const cmd = started ? "L" : "M";
      d += `${cmd} ${getX(i).toFixed(2)} ${getY(v).toFixed(2)} `;
      started = true;
    }
    return d.trim();
  };

  const closePath = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(p.close).toFixed(2)}`)
    .join(" ");

  const ma50Path = pathFrom(series.map((p) => p.ma50), x, y);
  const ma200Path = pathFrom(series.map((p) => p.ma200), x, y);

  const first = series[0];
  const last = series[series.length - 1];
  const ret = (last.close - first.close) / first.close;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>AAPL close + MA50/MA200</div>
        <div style={{ opacity: 0.75 }}>Period return: {fmtPct(ret)}</div>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ border: "1px solid #3333", borderRadius: 12 }}
      >
        {/* axes */}
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" opacity="0.15" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" opacity="0.15" />

        {/* price line */}
        <path d={closePath} fill="none" stroke="currentColor" strokeWidth="2.25" opacity="0.95" />

        {/* MA50 */}
        {ma50Path ? (
          <path d={ma50Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" strokeDasharray="6 4" />
        ) : null}

        {/* MA200 */}
        {ma200Path ? (
          <path d={ma200Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" strokeDasharray="2 6" />
        ) : null}

        {/* labels */}
        <text x={pad} y={pad - 10} fontSize="12" opacity="0.65">
          ${max.toFixed(2)}
        </text>
        <text x={pad} y={height - pad + 18} fontSize="12" opacity="0.65">
          ${min.toFixed(2)}
        </text>

        {/* last point marker */}
        <circle cx={x(series.length - 1)} cy={y(last.close)} r="3.5" fill="currentColor" opacity="0.9" />
      </svg>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>Solid: Price</span>
        <span>Dashed: MA50</span>
        <span>Dotted: MA200</span>
        <span style={{ marginLeft: "auto" }}>
          From {series[0].date} → {series[series.length - 1].date}
        </span>
      </div>
    </div>
  );
