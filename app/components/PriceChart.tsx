"use client";

import React from "react";

type Point = { date: string; close: number };

export default function PriceChart({
  data,
  height = 220,
}: {
  data: Point[];
  height?: number;
}) {
  // Basic SVG line chart (no libraries yet)
  const width = 720;
  const pad = 30;

  if (!data || data.length < 2) {
    return <div style={{ opacity: 0.7 }}>Not enough data to chart.</div>;
  }

  const closes = data.map((d) => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = Math.max(1e-9, max - min);

  const x = (i: number) => pad + (i * (width - pad * 2)) / (data.length - 1);
  const y = (v: number) =>
    pad + ((max - v) * (height - pad * 2)) / range;

  const d = data
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(p.close).toFixed(2)}`)
    .join(" ");

  const last = data[data.length - 1];
  const first = data[0];
  const pct = ((last.close - first.close) / first.close) * 100;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>AAPL close (last {data.length} days)</div>
        <div style={{ opacity: 0.75 }}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</div>
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
        {/* axes */}
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" opacity="0.15" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" opacity="0.15" />

        {/* line */}
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.9" />

        {/* min/max labels */}
        <text x={pad} y={pad - 10} fontSize="12" opacity="0.65">
          ${max.toFixed(2)}
        </text>
        <text x={pad} y={height - pad + 18} fontSize="12" opacity="0.65">
          ${min.toFixed(2)}
        </text>

        {/* last point */}
        <circle cx={x(data.length - 1)} cy={y(last.close)} r="3.5" fill="currentColor" opacity="0.9" />
      </svg>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>
        From {data[0].date} → {data[data.length - 1].date}
      </div>
    </div>
  );
}
