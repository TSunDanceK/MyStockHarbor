"use client";

import Link from "next/link";
import React, { useMemo } from "react";

type Point = {
  date: string;
  close: number;
};

type Props = {
  symbol: string;
  data: Point[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  height?: number;
};

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

export default function StockPriceChart({
  symbol,
  data,
  ma50,
  ma200,
  height = 360,
}: Props) {
  const width = 920;
  const padL = 38;
  const padR = 60;
  const padT = 24;
  const padB = 34;

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

  const pathFrom = (arr: Array<number | null>) => {
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
  };

  const ma50Path = useMemo(() => pathFrom(series.map((p) => p.ma50)), [series, x, y]);
  const ma200Path = useMemo(() => pathFrom(series.map((p) => p.ma200)), [series, x, y]);

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

  return (
    <div style={{ width: "100%" }}>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{
          display: "block",
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
          {symbol} • {series[0].date} → {series[series.length - 1].date}
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

          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 2,
                borderRadius: 999,
                background: "#22c55e",
                display: "inline-block",
              }}
            />
            MA50
          </span>

          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 2,
                borderRadius: 999,
                background: "#eab308",
                display: "inline-block",
              }}
            />
            MA200
          </span>
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <Link
          href={`/stock/${encodeURIComponent(symbol.toUpperCase())}/news`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 42,
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid rgba(59,130,246,0.24)",
            background:
              "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.08))",
            color: "#dbeafe",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 850,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          Check out the {symbol.toUpperCase()} headlines →
        </Link>
      </div>
    </div>
  );
}
