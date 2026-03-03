"use client";

import React, { useMemo } from "react";

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

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

  // Bollinger (aligned to data length)
  bollUpper,
  bollMid,
  bollLower,

  // EMA20 (aligned)
  ema20,

  // RSI (aligned)
  rsi14,

  // MACD (aligned)
  macdLine,
  macdSignal,
  macdHist,

  // NEW indicators (aligned)
  vwap,
  volume,
  stochK,
  stochD,
  atr14,

  height = 240,
}: {
  data: Point[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  overlay?: Overlay;

  bollUpper?: (number | null)[];
  bollMid?: (number | null)[];
  bollLower?: (number | null)[];

  ema20?: (number | null)[];

  rsi14?: (number | null)[];

  macdLine?: (number | null)[];
  macdSignal?: (number | null)[];
  macdHist?: (number | null)[];

  vwap?: (number | null)[];
  volume?: (number | null)[];
  stochK?: (number | null)[];
  stochD?: (number | null)[];
  atr14?: (number | null)[];

  height?: number;
}) {
  const width = 760;
  const pad = 34;
  const panelHeight = 130;

  const series = useMemo(() => {
    const n = data.length;

    const a50 = ma50.length === n ? ma50 : Array(n).fill(null);
    const a200 = ma200.length === n ? ma200 : Array(n).fill(null);

    const e20 = ema20 && ema20.length === n ? ema20 : Array(n).fill(null);

    const u = bollUpper && bollUpper.length === n ? bollUpper : Array(n).fill(null);
    const m = bollMid && bollMid.length === n ? bollMid : Array(n).fill(null);
    const l = bollLower && bollLower.length === n ? bollLower : Array(n).fill(null);

    const r = rsi14 && rsi14.length === n ? rsi14 : Array(n).fill(null);

    const ml = macdLine && macdLine.length === n ? macdLine : Array(n).fill(null);
    const ms = macdSignal && macdSignal.length === n ? macdSignal : Array(n).fill(null);
    const mh = macdHist && macdHist.length === n ? macdHist : Array(n).fill(null);

    const vw = vwap && vwap.length === n ? vwap : Array(n).fill(null);
    const vol = volume && volume.length === n ? volume : Array(n).fill(null);
    const sk = stochK && stochK.length === n ? stochK : Array(n).fill(null);
    const sd = stochD && stochD.length === n ? stochD : Array(n).fill(null);
    const a14 = atr14 && atr14.length === n ? atr14 : Array(n).fill(null);

    return data.map((p, i) => ({
      ...p,
      ma50: a50[i],
      ma200: a200[i],
      ema20: e20[i],
      bu: u[i],
      bm: m[i],
      bl: l[i],
      rsi: r[i],
      macd: ml[i],
      signal: ms[i],
      hist: mh[i],
      vwap: vw[i],
      volume: vol[i],
      stochK: sk[i],
      stochD: sd[i],
      atr14: a14[i],
    }));
  }, [
    data,
    ma50,
    ma200,
    ema20,
    bollUpper,
    bollMid,
    bollLower,
    rsi14,
    macdLine,
    macdSignal,
    macdHist,
    vwap,
    volume,
    stochK,
    stochD,
    atr14,
  ]);

  if (!series || series.length < 2) {
    return <div style={{ opacity: 0.7 }}>Not enough data to chart.</div>;
  }

  const x = (i: number) => pad + (i * (width - pad * 2)) / (series.length - 1);

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

  // ---------- Main (price) y-range ----------
  const mainVals: number[] = [];
  for (const p of series) {
    if (Number.isFinite(p.close)) mainVals.push(p.close);

    if (overlay === "MA50" && typeof p.ma50 === "number") mainVals.push(p.ma50);
    if (overlay === "MA200" && typeof p.ma200 === "number") mainVals.push(p.ma200);
    if (overlay === "EMA20" && typeof p.ema20 === "number") mainVals.push(p.ema20);
    if (overlay === "VWAP" && typeof p.vwap === "number") mainVals.push(p.vwap);

    if (overlay === "Bollinger(20,2)") {
      if (typeof p.bu === "number") mainVals.push(p.bu);
      if (typeof p.bm === "number") mainVals.push(p.bm);
      if (typeof p.bl === "number") mainVals.push(p.bl);
    }
  }

  const mainMin = Math.min(...mainVals);
  const mainMax = Math.max(...mainVals);
  const mainRange = Math.max(1e-9, mainMax - mainMin);
  const yMain = (v: number) => pad + ((mainMax - v) * (height - pad * 2)) / mainRange;

  const closePath = pathFrom(
    series.map((p) => (typeof p.close === "number" && Number.isFinite(p.close) ? p.close : null)),
    yMain
  );

  const ma50Path = pathFrom(series.map((p) => p.ma50), yMain);
  const ma200Path = pathFrom(series.map((p) => p.ma200), yMain);
  const ema20Path = pathFrom(series.map((p) => p.ema20), yMain);
  const vwapPath = pathFrom(series.map((p) => p.vwap), yMain);

  const bollUPath = pathFrom(series.map((p) => p.bu), yMain);
  const bollMPath = pathFrom(series.map((p) => p.bm), yMain);
  const bollLPath = pathFrom(series.map((p) => p.bl), yMain);

  // Bollinger shaded band (no hooks)
  let bollBandPath = "";
  if (overlay === "Bollinger(20,2)") {
    const upperPts: { x: number; y: number }[] = [];
    const lowerPts: { x: number; y: number }[] = [];

    for (let i = 0; i < series.length; i++) {
      const u = series[i].bu;
      const l = series[i].bl;
      if (typeof u !== "number" || !Number.isFinite(u)) continue;
      if (typeof l !== "number" || !Number.isFinite(l)) continue;

      upperPts.push({ x: x(i), y: yMain(u) });
      lowerPts.push({ x: x(i), y: yMain(l) });
    }

    if (upperPts.length >= 2 && lowerPts.length >= 2) {
      let d = `M ${upperPts[0].x.toFixed(2)} ${upperPts[0].y.toFixed(2)}`;
      for (let i = 1; i < upperPts.length; i++) d += ` L ${upperPts[i].x.toFixed(2)} ${upperPts[i].y.toFixed(2)}`;
      for (let i = lowerPts.length - 1; i >= 0; i--) d += ` L ${lowerPts[i].x.toFixed(2)} ${lowerPts[i].y.toFixed(2)}`;
      d += " Z";
      bollBandPath = d;
    }
  }

  // ---------- RSI panel ----------
  const showRSI = overlay === "RSI(14)";
  const yRSI = (v: number) => pad + ((100 - v) * (panelHeight - pad * 2)) / 100;
  const rsiPath = showRSI ? pathFrom(series.map((p) => p.rsi), yRSI) : "";

  // ---------- MACD panel ----------
  const showMACD = overlay === "MACD(12,26,9)";
  const macdArr = showMACD ? series.map((p) => p.macd) : [];
  const sigArr = showMACD ? series.map((p) => p.signal) : [];
  const histArr = showMACD ? series.map((p) => p.hist) : [];

  const macdVals: number[] = [];
  if (showMACD) {
    for (let i = 0; i < series.length; i++) {
      const a = macdArr[i];
      const b = sigArr[i];
      const c = histArr[i];
      if (typeof a === "number" && Number.isFinite(a)) macdVals.push(a);
      if (typeof b === "number" && Number.isFinite(b)) macdVals.push(b);
      if (typeof c === "number" && Number.isFinite(c)) macdVals.push(c);
    }
  }
  const macdAbsMax = macdVals.length ? Math.max(...macdVals.map((v) => Math.abs(v))) : 1;
  const yMACD = (v: number) => pad + ((macdAbsMax - v) * (panelHeight - pad * 2)) / (macdAbsMax * 2 || 1);

  const macdPath = showMACD ? pathFrom(macdArr, yMACD) : "";
  const sigPath = showMACD ? pathFrom(sigArr, yMACD) : "";

  // ---------- Volume panel ----------
  const showVolume = overlay === "Volume";
  const volArr = showVolume ? series.map((p) => p.volume) : [];
  const volMax = showVolume
    ? Math.max(1, ...volArr.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0)))
    : 1;
  const yVOL = (v: number) => pad + ((volMax - v) * (panelHeight - pad * 2)) / volMax;

  // ---------- Stochastic panel ----------
  const showStoch = overlay === "Stochastic(14,3)";
  const ySTO = (v: number) => pad + ((100 - v) * (panelHeight - pad * 2)) / 100;
  const stochKPath = showStoch ? pathFrom(series.map((p) => p.stochK), ySTO) : "";
  const stochDPath = showStoch ? pathFrom(series.map((p) => p.stochD), ySTO) : "";

  // ---------- ATR panel ----------
  const showATR = overlay === "ATR(14)";
  const atrArr = showATR ? series.map((p) => p.atr14) : [];
  const atrVals = showATR
    ? atrArr.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : [];
  const atrMin = atrVals.length ? Math.min(...atrVals) : 0;
  const atrMax = atrVals.length ? Math.max(...atrVals) : 1;
  const atrRange = Math.max(1e-9, atrMax - atrMin);
  const yATR = (v: number) => pad + ((atrMax - v) * (panelHeight - pad * 2)) / atrRange;
  const atrPath = showATR ? pathFrom(atrArr, yATR) : "";

  const first = series[0];
  const last = series[series.length - 1];
  const ret = (last.close - first.close) / first.close;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>Price ({overlay === "None" ? "no overlay" : overlay})</div>
        <div style={{ opacity: 0.75 }}>Period return: {fmtPct(ret)}</div>
      </div>

      {/* MAIN PRICE CHART */}
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" opacity="0.15" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" opacity="0.15" />

        {overlay === "Bollinger(20,2)" && bollBandPath ? (
          <path d={bollBandPath} fill="currentColor" opacity="0.08" stroke="none" />
        ) : null}

        <path d={closePath} fill="none" stroke="currentColor" strokeWidth="2.25" opacity="0.95" />

        {overlay === "MA50" && ma50Path ? (
          <path d={ma50Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" strokeDasharray="6 4" />
        ) : null}

        {overlay === "MA200" && ma200Path ? (
          <path d={ma200Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" strokeDasharray="2 6" />
        ) : null}

        {overlay === "EMA20" && ema20Path ? (
          <path d={ema20Path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" strokeDasharray="3 4" />
        ) : null}

        {overlay === "VWAP" && vwapPath ? (
          <path d={vwapPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" strokeDasharray="8 4" />
        ) : null}

        {overlay === "Bollinger(20,2)" ? (
          <>
            {bollUPath ? <path d={bollUPath} fill="none" stroke="currentColor" strokeWidth="1.75" opacity="0.35" /> : null}
            {bollMPath ? (
              <path d={bollMPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" strokeDasharray="6 4" />
            ) : null}
            {bollLPath ? <path d={bollLPath} fill="none" stroke="currentColor" strokeWidth="1.75" opacity="0.35" /> : null}
          </>
        ) : null}

        <circle cx={x(series.length - 1)} cy={yMain(last.close)} r="3.5" fill="currentColor" opacity="0.9" />
      </svg>

      {/* RSI PANEL */}
      {showRSI ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>RSI (14)</div>
          <svg width="100%" viewBox={`0 0 ${width} ${panelHeight}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
            <line x1={pad} y1={panelHeight - pad} x2={width - pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            <line x1={pad} y1={pad} x2={pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            <line x1={pad} y1={yRSI(70)} x2={width - pad} y2={yRSI(70)} stroke="currentColor" opacity="0.12" strokeDasharray="4 5" />
            <line x1={pad} y1={yRSI(30)} x2={width - pad} y2={yRSI(30)} stroke="currentColor" opacity="0.12" strokeDasharray="4 5" />
            {rsiPath ? <path d={rsiPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.85" /> : null}
          </svg>
        </div>
      ) : null}

      {/* MACD PANEL */}
      {showMACD ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>MACD (12, 26, 9)</div>
          <svg width="100%" viewBox={`0 0 ${width} ${panelHeight}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
            <line x1={pad} y1={panelHeight - pad} x2={width - pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            <line x1={pad} y1={pad} x2={pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            <line x1={pad} y1={yMACD(0)} x2={width - pad} y2={yMACD(0)} stroke="currentColor" opacity="0.12" />
            {histArr.map((v, i) => {
              if (typeof v !== "number" || !Number.isFinite(v)) return null;
              const xi = x(i);
              return (
                <line
                  key={i}
                  x1={xi}
                  x2={xi}
                  y1={yMACD(0)}
                  y2={yMACD(v)}
                  stroke="currentColor"
                  opacity="0.25"
                  strokeWidth={2}
                />
              );
            })}
            {macdPath ? <path d={macdPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.85" /> : null}
            {sigPath ? <path d={sigPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" strokeDasharray="6 4" /> : null}
          </svg>
        </div>
      ) : null}

      {/* VOLUME PANEL */}
      {showVolume ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Volume</div>
          <svg width="100%" viewBox={`0 0 ${width} ${panelHeight}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
            <line x1={pad} y1={panelHeight - pad} x2={width - pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            <line x1={pad} y1={pad} x2={pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            {volArr.map((v, i) => {
              if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
              const xi = x(i);
              return (
                <line
                  key={i}
                  x1={xi}
                  x2={xi}
                  y1={panelHeight - pad}
                  y2={yVOL(v)}
                  stroke="currentColor"
                  opacity="0.25"
                  strokeWidth={3}
                />
              );
            })}
          </svg>
        </div>
      ) : null}

      {/* STOCHASTIC PANEL */}
      {showStoch ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Stochastic (14, 3)</div>
          <svg width="100%" viewBox={`0 0 ${width} ${panelHeight}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
            <line x1={pad} y1={panelHeight - pad} x2={width - pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            <line x1={pad} y1={pad} x2={pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            <line x1={pad} y1={ySTO(80)} x2={width - pad} y2={ySTO(80)} stroke="currentColor" opacity="0.12" strokeDasharray="4 5" />
            <line x1={pad} y1={ySTO(20)} x2={width - pad} y2={ySTO(20)} stroke="currentColor" opacity="0.12" strokeDasharray="4 5" />
            {stochKPath ? <path d={stochKPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.85" /> : null}
            {stochDPath ? <path d={stochDPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" strokeDasharray="6 4" /> : null}
          </svg>
        </div>
      ) : null}

      {/* ATR PANEL */}
      {showATR ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>ATR (14)</div>
          <svg width="100%" viewBox={`0 0 ${width} ${panelHeight}`} style={{ border: "1px solid #3333", borderRadius: 12 }}>
            <line x1={pad} y1={panelHeight - pad} x2={width - pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            <line x1={pad} y1={pad} x2={pad} y2={panelHeight - pad} stroke="currentColor" opacity="0.15" />
            {atrPath ? <path d={atrPath} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.85" /> : null}
          </svg>
        </div>
      ) : null}

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>
          From {series[0].date} → {series[series.length - 1].date}
        </span>
      </div>
    </div>
  );
}
