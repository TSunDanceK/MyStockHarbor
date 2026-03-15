"use client";

import React, { useMemo } from "react";
import type { DivResult } from "../../lib/ta/divergence";

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

type Props = {
  symbol: string;
  data: Point[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  overlay?: Overlay;

  divergence?: DivResult | null;

  bollUpper?: (number | null)[];
  bollMid?: (number | null)[];
  bollLower?: (number | null)[];

  ema20?: (number | null)[];
  vwap?: (number | null)[];

  rsi14?: (number | null)[];
  macdLine?: (number | null)[];
  macdSignal?: (number | null)[];
  macdHist?: (number | null)[];
  stochK?: (number | null)[];
  stochD?: (number | null)[];
  atr14?: (number | null)[];
  volume?: (number | null)[];

  height?: number;
};

export default function PriceChart(props: Props) {
  const {
    symbol,
    data,
    ma50,
    ma200,
    overlay = "None",
    divergence = null,

    bollUpper,
    bollMid,
    bollLower,

    ema20,
    vwap,

    rsi14,
    macdLine,
    macdSignal,
    macdHist,
    stochK,
    stochD,
    atr14,
    volume,

    height = 320,
  } = props;

  const width = 760;

  // padding
  const padL = 34;
  const padR = 54;
  const padT = 24;
  const padB = 34;

  const wantsSubPanel =
    overlay === "RSI(14)" ||
    overlay === "MACD(12,26,9)" ||
    overlay === "Stochastic(14,3)" ||
    overlay === "ATR(14)" ||
    overlay === "Volume";

  const gap = wantsSubPanel ? 14 : 0;
  const innerH = height - padT - padB - gap;

  const priceH = wantsSubPanel ? Math.max(140, Math.floor(innerH * 0.62)) : innerH;
  const subH = wantsSubPanel ? Math.max(90, innerH - priceH) : 0;

  const series = useMemo(() => {
    const n = data.length;

    const a50 = ma50.length === n ? ma50 : Array(n).fill(null);
    const a200 = ma200.length === n ? ma200 : Array(n).fill(null);

    const u = bollUpper && bollUpper.length === n ? bollUpper : Array(n).fill(null);
    const m = bollMid && bollMid.length === n ? bollMid : Array(n).fill(null);
    const l = bollLower && bollLower.length === n ? bollLower : Array(n).fill(null);

    const e20 = ema20 && ema20.length === n ? ema20 : Array(n).fill(null);
    const vw = vwap && vwap.length === n ? vwap : Array(n).fill(null);

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
      bu: u[i] as number | null,
      bm: m[i] as number | null,
      bl: l[i] as number | null,
      ema20: e20[i] as number | null,
      vwap: vw[i] as number | null,

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
    bollUpper,
    bollMid,
    bollLower,
    ema20,
    vwap,
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
    return (i: number) => padL + (i * (width - padL - padR)) / Math.max(1, series.length - 1);
  }, [series.length]);

  // PRICE Y RANGE (price + price overlays only)
  const { pMin, pMax, pRange } = useMemo(() => {
    if (!hasData) return { pMin: 0, pMax: 1, pRange: 1 };

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

    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const r = Math.max(1e-9, maxV - minV);
    return { pMin: minV, pMax: maxV, pRange: r };
  }, [hasData, series, overlay]);

  const yMain = useMemo(() => {
    return (v: number) => padT + ((pMax - v) * priceH) / pRange;
  }, [pMax, pRange, priceH]);

  const subTop = padT + priceH + gap;

  // SUBPANEL RANGE
  const subRange = useMemo(() => {
    if (!hasData || !wantsSubPanel) return null;

    if (overlay === "RSI(14)") return { min: 0, max: 100 };
    if (overlay === "Stochastic(14,3)") return { min: 0, max: 100 };

    if (overlay === "MACD(12,26,9)") {
      const mm1 = minMax(series.map((p) => p.macdLine));
      const mm2 = minMax(series.map((p) => p.macdSignal));
      const mm3 = minMax(series.map((p) => p.macdHist));
      const mins = [mm1?.min, mm2?.min, mm3?.min].filter((x) => typeof x === "number") as number[];
      const maxs = [mm1?.max, mm2?.max, mm3?.max].filter((x) => typeof x === "number") as number[];
      if (!mins.length || !maxs.length) return null;
      const min = Math.min(...mins);
      const max = Math.max(...maxs);
      if (min === max) return { min: min - 1, max: max + 1 };
      return { min, max };
    }

    if (overlay === "ATR(14)") return minMax(series.map((p) => p.atr14));

    if (overlay === "Volume") {
      let max = 0;
      for (const p of series) {
        const v = p.volume;
        if (typeof v === "number" && Number.isFinite(v) && v > max) max = v;
      }
      if (max <= 0) return null;
      return { min: 0, max };
    }

    return null;
  }, [hasData, wantsSubPanel, overlay, series]);

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
    return series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${yMain(p.close).toFixed(2)}`).join(" ");
  }, [hasData, series, x, yMain]);

  const ma50Path = useMemo(() => pathFrom(series.map((p) => p.ma50), yMain), [series, yMain]);
  const ma200Path = useMemo(() => pathFrom(series.map((p) => p.ma200), yMain), [series, yMain]);

  const bollUPath = useMemo(() => pathFrom(series.map((p) => p.bu), yMain), [series, yMain]);
  const bollMPath = useMemo(() => pathFrom(series.map((p) => p.bm), yMain), [series, yMain]);
  const bollLPath = useMemo(() => pathFrom(series.map((p) => p.bl), yMain), [series, yMain]);

  const ema20Path = useMemo(() => pathFrom(series.map((p) => p.ema20), yMain), [series, yMain]);
  const vwapPath = useMemo(() => pathFrom(series.map((p) => p.vwap), yMain), [series, yMain]);

  // sub paths
  const rsiPath = useMemo(() => pathFrom(series.map((p) => p.rsi14), ySub), [series, ySub]);
  const macdLinePath = useMemo(() => pathFrom(series.map((p) => p.macdLine), ySub), [series, ySub]);
  const macdSignalPath = useMemo(() => pathFrom(series.map((p) => p.macdSignal), ySub), [series, ySub]);
  const stochKPath = useMemo(() => pathFrom(series.map((p) => p.stochK), ySub), [series, ySub]);
  const stochDPath = useMemo(() => pathFrom(series.map((p) => p.stochD), ySub), [series, ySub]);
  const atrPath = useMemo(() => pathFrom(series.map((p) => p.atr14), ySub), [series, ySub]);

  // price y ticks (right)
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

  // x ticks (bottom)
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

  if (!hasData) return <div style={{ opacity: 0.7 }}>Not enough data to chart.</div>;

  const last = series[series.length - 1];

  // --------- Divergence line (MACD subpanel) ----------
  const macdDivLine = useMemo(() => {
    if (overlay !== "MACD(12,26,9)") return null;
    if (!divergence || !divergence.hasMacd) return null;

    const i1 = divergence.p1.idx;
    const i2 = divergence.p2.idx;

    if (i1 < 0 || i2 < 0) return null;
    if (i1 >= series.length || i2 >= series.length) return null;

    const m1 = series[i1]?.macdLine;
    const m2 = series[i2]?.macdLine;
    if (typeof m1 !== "number" || !Number.isFinite(m1)) return null;
    if (typeof m2 !== "number" || !Number.isFinite(m2)) return null;

    return {
      x1: x(i1),
      y1: ySub(m1),
      x2: x(i2),
      y2: ySub(m2),
    };
  }, [overlay, divergence, series, x, ySub]);

  return (
    <div style={{ width: "100%" }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
        {/* PRICE plot box */}
        <rect x={padL} y={padT} width={width - padL - padR} height={priceH} fill="none" stroke="currentColor" opacity="0.10" />

        {/* price grid + y labels */}
        {yTicks.map((t, idx) => (
          <g key={idx}>
            <line x1={padL} y1={t.y} x2={width - padR} y2={t.y} stroke="currentColor" opacity="0.08" />
            <text x={width - padR + 6} y={t.y + 4} fontSize={11} fill="currentColor" opacity="0.6">
              {fmtMoney(t.v)}
            </text>
          </g>
        ))}

        {/* x labels */}
        {xTicks.map((t, idx) => (
          <g key={idx}>
            <line x1={t.x} y1={height - padB} x2={t.x} y2={height - padB + 4} stroke="currentColor" opacity="0.25" />
            <text x={t.x} y={height - 10} fontSize={11} fill="currentColor" opacity="0.6" textAnchor="middle">
              {t.label}
            </text>
          </g>
        ))}

        {/* price line */}
        <path d={closePath} fill="none" stroke="currentColor" strokeWidth="2.25" opacity="0.95" />

        {/* price overlays */}
        {overlay === "MA50" && ma50Path ? <path d={ma50Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" strokeDasharray="6 4" /> : null}
        {overlay === "MA200" && ma200Path ? <path d={ma200Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" strokeDasharray="2 6" /> : null}

        {overlay === "Bollinger(20,2)" ? (
          <>
            {bollUPath ? <path d={bollUPath} fill="none" stroke="currentColor" strokeWidth="1.75" opacity="0.30" /> : null}
            {bollMPath ? <path d={bollMPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeDasharray="6 4" /> : null}
            {bollLPath ? <path d={bollLPath} fill="none" stroke="currentColor" strokeWidth="1.75" opacity="0.30" /> : null}
          </>
        ) : null}

        {overlay === "EMA20" && ema20Path ? <path d={ema20Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeDasharray="5 5" /> : null}
        {overlay === "VWAP" && vwapPath ? <path d={vwapPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeDasharray="3 4" /> : null}

        {/* SUB PANEL */}
        {wantsSubPanel ? (
          <>
            <rect x={padL} y={subTop} width={width - padL - padR} height={subH} fill="none" stroke="currentColor" opacity="0.10" />

            {/* RSI */}
            {overlay === "RSI(14)" ? (
              <>
                <line x1={padL} y1={ySub(70)} x2={width - padR} y2={ySub(70)} stroke="currentColor" opacity="0.10" />
                <line x1={padL} y1={ySub(30)} x2={width - padR} y2={ySub(30)} stroke="currentColor" opacity="0.10" />
                {rsiPath ? <path d={rsiPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" /> : null}
              </>
            ) : null}

            {/* MACD */}
            {overlay === "MACD(12,26,9)" ? (
              <>
                {subRange ? <line x1={padL} y1={ySub(0)} x2={width - padR} y2={ySub(0)} stroke="currentColor" opacity="0.12" /> : null}

                {subRange
                  ? series.map((p, i) => {
                      const v = p.macdHist;
                      if (typeof v !== "number" || !Number.isFinite(v)) return null;
                      const x0 = x(i);
                      const barW = Math.max(1, (width - padL - padR) / Math.max(10, series.length) - 1);
                      const y0 = ySub(0);
                      const yv = ySub(v);
                      const h = Math.abs(yv - y0);
                      return (
                        <rect key={i} x={x0 - barW / 2} y={Math.min(y0, yv)} width={barW} height={h} fill="currentColor" opacity="0.18" />
                      );
                    })
                  : null}

                {macdLinePath ? <path d={macdLinePath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" /> : null}
                {macdSignalPath ? <path d={macdSignalPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" strokeDasharray="6 4" /> : null}

                {/* Divergence line on MACD (matches pivots) */}
                {macdDivLine ? (
                  <line
                    x1={macdDivLine.x1}
                    y1={macdDivLine.y1}
                    x2={macdDivLine.x2}
                    y2={macdDivLine.y2}
                    stroke="currentColor"
                    strokeWidth={3.5}
                    opacity={0.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
              </>
            ) : null}

            {/* Stochastic */}
            {overlay === "Stochastic(14,3)" ? (
              <>
                <line x1={padL} y1={ySub(80)} x2={width - padR} y2={ySub(80)} stroke="currentColor" opacity="0.10" />
                <line x1={padL} y1={ySub(20)} x2={width - padR} y2={ySub(20)} stroke="currentColor" opacity="0.10" />
                {stochKPath ? <path d={stochKPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" /> : null}
                {stochDPath ? <path d={stochDPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" strokeDasharray="6 4" /> : null}
              </>
            ) : null}

            {/* ATR */}
            {overlay === "ATR(14)" ? <>{atrPath ? <path d={atrPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" /> : null}</> : null}

            {/* Volume */}
            {overlay === "Volume" ? (
              <>
                {subRange
                  ? series.map((p, i) => {
                      const v = p.volume;
                      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
                      const x0 = x(i);
                      const barW = Math.max(1, (width - padL - padR) / Math.max(10, series.length) - 1);
                      const y0 = ySub(0);
                      const yv = ySub(v);
                      const h = Math.abs(yv - y0);
                      return (
                        <rect key={i} x={x0 - barW / 2} y={Math.min(y0, yv)} width={barW} height={h} fill="currentColor" opacity="0.25" />
                      );
                    })
                  : null}
              </>
            ) : null}
          </>
        ) : null}

        {/* last point */}
        <circle cx={x(series.length - 1)} cy={yMain(last.close)} r="3.5" fill="currentColor" opacity="0.9" />
      </svg>

      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          From {series[0].date} → {series[series.length - 1].date}
        </div>

        <a
          href={`/api/go/tradingview?symbol=${encodeURIComponent(symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(59,130,246,0.32)",
            background:
              "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
            color: "#dbeafe",
            textDecoration: "none",
            fontWeight: 800,
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          Open in TradingView ↗
        </a>
      </div>
    </div>
  );
}
