"use client"; 
 
import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PriceChart, { type Overlay } from "./PriceChart";
import { detectDivergenceFromHistory } from "../../lib/ta/divergence";
import type { DivResult } from "../../lib/ta/divergence";

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type SymbolResult = { symbol: string; name: string; exchange: string };

type BenchItem = {
  key: string;
  label: string;
  symbol: string;
  date: string | null;
  time: string | null;
  close: number | null;
  prevClose: number | null;
  changePct: number | null;
};

type BenchPayload = {
  updatedAt: string;
  scope: string;
  items: BenchItem[];
};

type NewsPayload = {
  symbol: string;
  feeds: {
    label: string;
    items: { title: string; link: string; pubDate: string | null; source: string | null }[];
  }[];
};

/* ----------------------- indicator math helpers ----------------------- */

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

function rollingStd(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - window + 1; j <= i; j++) mean += values[j];
    mean /= window;

    let variance = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const d = values[j] - mean;
      variance += d * d;
    }
    variance /= window;

    out[i] = Math.sqrt(variance);
  }
  return out;
}

function bollinger(values: number[], window = 20, k = 2) {
  const mid = movingAverage(values, window);
  const sd = rollingStd(values, window);
  const upper = mid.map((m, i) => (m == null || sd[i] == null ? null : m + k * sd[i]!));
  const lower = mid.map((m, i) => (m == null || sd[i] == null ? null : m - k * sd[i]!));
  return { upper, mid, lower };
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length === 0) return out;

  const k = 2 / (period + 1);
  let emaPrev: number | null = null;
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];

    if (i < period) {
      sum += v;
      if (i === period - 1) {
        emaPrev = sum / period;
        out[i] = emaPrev;
      }
      continue;
    }

    emaPrev = emaPrev == null ? v : v * k + emaPrev * (1 - k);
    out[i] = emaPrev;
  }

  return out;
}

function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  const line: (number | null)[] = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (typeof f !== "number" || typeof s !== "number") return null;
    return f - s;
  });

  // EMA expects numbers; we still keep nulls by masking later
  const lineForEma = line.map((v) => (typeof v === "number" ? v : 0));
  const sigAll = ema(lineForEma, signal);

  const sig: (number | null)[] = sigAll.map((v, i) => (line[i] == null ? null : v));
  const hist: (number | null)[] = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]!));

  return { line, signal: sig, hist };
}

function vwapFromPoints(points: Point[]): (number | null)[] {
  const out: (number | null)[] = Array(points.length).fill(null);
  let cumPV = 0;
  let cumV = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const v = typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null;

    if (v == null || v <= 0) {
      out[i] = cumV > 0 ? cumPV / cumV : null;
      continue;
    }

    const h = typeof p.high === "number" && Number.isFinite(p.high) ? p.high : null;
    const l = typeof p.low === "number" && Number.isFinite(p.low) ? p.low : null;
    const typical = h != null && l != null ? (h + l + p.close) / 3 : p.close;

    cumPV += typical * v;
    cumV += v;
    out[i] = cumPV / cumV;
  }

  return out;
}

function stochastic(points: Point[], kPeriod = 14, dPeriod = 3) {
  const k: (number | null)[] = Array(points.length).fill(null);

  for (let i = 0; i < points.length; i++) {
    if (i < kPeriod - 1) continue;

    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (let j = i - kPeriod + 1; j <= i; j++) {
      const hh = points[j].high;
      const ll = points[j].low;
      if (typeof hh !== "number" || !Number.isFinite(hh)) {
        highestHigh = NaN;
        break;
      }
      if (typeof ll !== "number" || !Number.isFinite(ll)) {
        lowestLow = NaN;
        break;
      }
      if (hh > highestHigh) highestHigh = hh;
      if (ll < lowestLow) lowestLow = ll;
    }

    if (!Number.isFinite(highestHigh) || !Number.isFinite(lowestLow)) continue;

    const denom = highestHigh - lowestLow;
    if (denom <= 0) continue;

    k[i] = ((points[i].close - lowestLow) / denom) * 100;
  }

  const d = movingAverage(k.map((v) => (typeof v === "number" ? v : 0)), dPeriod).map((v, i) =>
    k[i] == null ? null : v
  );

  return { k, d };
}

function atr(points: Point[], period = 14): (number | null)[] {
  const tr: (number | null)[] = Array(points.length).fill(null);

  for (let i = 0; i < points.length; i++) {
    const h = points[i].high;
    const l = points[i].low;
    const cPrev = i > 0 ? points[i - 1].close : null;

    if (typeof h !== "number" || !Number.isFinite(h)) continue;
    if (typeof l !== "number" || !Number.isFinite(l)) continue;

    const hl = h - l;
    const hc = cPrev == null ? hl : Math.abs(h - cPrev);
    const lc = cPrev == null ? hl : Math.abs(l - cPrev);

    tr[i] = Math.max(hl, hc, lc);
  }

  const out: (number | null)[] = Array(points.length).fill(null);

  let sum = 0;
  let count = 0;
  let prevATR: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const v = tr[i];

    if (v == null) {
      out[i] = prevATR;
      continue;
    }

    if (prevATR == null) {
      sum += v;
      count++;
      if (count === period) {
        prevATR = sum / period;
        out[i] = prevATR;
      }
      continue;
    }

    prevATR = (prevATR * (period - 1) + v) / period;
    out[i] = prevATR;
  }

  return out;
}

/* ----------------------------- UI helpers ---------------------------- */

function compareTo(lastClose: number | null, name: string, v: number | null) {
  if (lastClose == null) return { label: "Signal unavailable", detail: "No price data." };
  if (v == null) return { label: "Signal unavailable", detail: `Need enough data for ${name}.` };

  const diff = (lastClose - v) / v;
  if (diff <= -0.05)
    return { label: "Undervalued-ish 🟢", detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% below ${name}.` };
  if (diff < 0.05)
    return { label: "Fair-ish 🟡", detail: `Price is ${Math.abs(diff * 100).toFixed(1)}% from ${name}.` };
  return { label: "Overextended 🔴", detail: `Price is ${(diff * 100).toFixed(1)}% above ${name}.` };
}

function compareOscillator(name: string, v: number | null, low: number, high: number) {
  if (v == null) return { label: "Signal unavailable", detail: `Need enough data for ${name}.` };

  if (v >= high) return { label: "Overbought 🔴", detail: `${name} is ${v.toFixed(2)} (≥ ${high}).` };
  if (v <= low) return { label: "Oversold 🟢", detail: `${name} is ${v.toFixed(2)} (≤ ${low}).` };
  return { label: "Neutral-ish 🟡", detail: `${name} is ${v.toFixed(2)}.` };
}

function compareMacdHistogram(lastClose: number | null, hist: number | null) {
  if (lastClose == null) return { label: "Signal unavailable", detail: "No price data." };
  if (hist == null) return { label: "Signal unavailable", detail: "Need enough data for MACD." };

  // Treat “flat” as within ~0.1% of price (tweakable)
  const flat = Math.abs(lastClose) * 0.001;

  if (hist > flat) return { label: "Bullish momentum 🟢", detail: `MACD histogram is positive (${hist.toFixed(4)}).` };
  if (hist < -flat) return { label: "Bearish momentum 🔴", detail: `MACD histogram is negative (${hist.toFixed(4)}).` };
  return { label: "Flat momentum 🟡", detail: `MACD histogram near zero (${hist.toFixed(4)}).` };
}

function compareSpike(name: string, v: number | null, sma: number | null, spikeMult: number, unit?: string) {
  if (v == null || sma == null || sma <= 0) return { label: "Signal unavailable", detail: `Need enough data for ${name}.` };

  const ratio = v / sma;

  if (ratio >= spikeMult) {
    return {
      label: "Spike ⚡",
      detail: `${name} is ${ratio.toFixed(2)}× its 20SMA.${unit ? ` (${unit})` : ""}`,
    };
  }

  return {
    label: "Normal range 🟡",
    detail: `${name} is ${ratio.toFixed(2)}× its 20SMA.${unit ? ` (${unit})` : ""}`,
  };
}

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
}

function HelpTip(props: { text: string; isDark: boolean }) {
  const [open, setOpen] = React.useState(false);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: props.isDark ? "rgba(255,255,255,0.15)" : "rgba(11,18,32,0.12)",
        color: props.isDark ? "#fff" : "#0b1220",
        fontSize: 11,
        fontWeight: 900,
        cursor: "pointer",
        marginLeft: 6,
        flex: "0 0 auto",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      ?
      {open ? (
        <div
          style={{
            position: "absolute",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            width: 240,
            padding: 10,
            borderRadius: 10,
            backgroundColor: props.isDark ? "#0f172a" : "#ffffff",
            border: props.isDark
              ? "1px solid rgba(255,255,255,0.14)"
              : "1px solid rgba(11,18,32,0.14)",
            color: props.isDark ? "#f1f5f9" : "#0b1220",
            fontSize: 12,
            lineHeight: 1.5,
            fontWeight: 600,
            zIndex: 50,
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          {props.text}
        </div>
      ) : null}
    </span>
  );
}

/* ----------------------- divergence (shared engine) ----------------------- */

type DivergenceState = "bullish" | "bearish" | "none";

function divStateForIndicator(div: DivResult | null, which: "rsi" | "macd"): DivergenceState {
  if (!div) return "none";
  if (which === "rsi" && !div.hasRsi) return "none";
  if (which === "macd" && !div.hasMacd) return "none";
  return div.kind;
}

function divergenceLabel(state: DivergenceState) {
  if (state === "bullish") return "Bullish 🟢";
  if (state === "bearish") return "Bearish 🔴";
  return "None 🟡";
}

function divergenceTone(state: DivergenceState): OverviewItem["tone"] {
  if (state === "bullish") return "green";
  if (state === "bearish") return "red";
  return "yellow";
}

function divergenceSeverity(state: DivergenceState) {
  // enough to float near top when present
  if (state === "bearish" || state === "bullish") return 100;
  return 5;
}

type OverviewItem = {
  key: string;
  label: string;
  tone: "green" | "yellow" | "orange" | "red" | "muted";
  valueText: string;

  // used for sorting
  severity: number; // bigger = more important
  order: number; // stable original order
};

function toneToColor(tone: OverviewItem["tone"], isDark: boolean) {
  // simple, readable colors; no new libs
  if (tone === "green") return isDark ? "#22c55e" : "#16a34a";
  if (tone === "yellow") return isDark ? "#eab308" : "#ca8a04";
  if (tone === "orange") return isDark ? "#fb923c" : "#ea580c";
  if (tone === "red") return isDark ? "#ef4444" : "#dc2626";
  return isDark ? "rgba(241,245,249,0.45)" : "rgba(11,18,32,0.45)";
}

function renderFlagsMeter(opts: {
  flagged: number;
  total: number;
  color: string;
  isDark: boolean;
}) {
  const { flagged, total, color, isDark } = opts;
  const safeTotal = Math.max(1, Math.min(20, Math.floor(total)));
  const safeFlagged = Math.max(0, Math.min(safeTotal, Math.floor(flagged)));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {Array.from({ length: safeTotal }).map((_, i) => {
          const on = i < safeFlagged;
          return (
            <span
              key={i}
              style={{
                width: 14,
                height: 6,
                borderRadius: 999,
                background: on ? color : isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
                border: isDark ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(0,0,0,0.10)",
              }}
            />
          );
        })}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
        {safeFlagged}/{safeTotal}
      </div>
    </div>
  );
}

function toneRank(tone: OverviewItem["tone"]) {
  // higher = more attention
  if (tone === "red") return 4;
  if (tone === "orange") return 3;
  if (tone === "yellow") return 2;
  if (tone === "green") return 1;
  return 0;
}

function compositeToneFromCounts(overbought: number, oversold: number, spikes: number) {
  // net > 0 => overbought-heavy (red side), net < 0 => oversold-heavy (green side)
  const net = overbought - oversold;
  const intensity = overbought + oversold + spikes; // 0..10-ish

  if (intensity <= 1) return { tone: "yellow" as const, tag: "Calm" };

  if (net >= 2) return { tone: intensity >= 5 ? ("red" as const) : ("orange" as const), tag: "Overbought-leaning" };
  if (net === 1) return { tone: "orange" as const, tag: "Slightly overbought" };

  if (net <= -2) return { tone: intensity >= 5 ? ("green" as const) : ("yellow" as const), tag: "Oversold-leaning" };
  if (net === -1) return { tone: "yellow" as const, tag: "Slightly oversold" };

  // balanced
  return { tone: intensity >= 5 ? ("orange" as const) : ("yellow" as const), tag: "Mixed" };
}
function trendToneFromScore(ts: TrendScore | null): OverviewItem["tone"] {
  if (!ts) return "muted";

  const ratio = ts.total > 0 ? ts.passed / ts.total : 0;

  // 3/4 or 4/4 => green, 2/4 => yellow, 1/4 => orange, 0/4 => red
  if (ratio >= 0.75) return "green";
  if (ratio >= 0.5) return "yellow";
  if (ratio >= 0.25) return "orange";
  return "red";
}
function clampNum(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Strict SMA over nullable values: returns null if any null in window. */
function smaNullable(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (window <= 0) return out;

  for (let i = window - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        ok = false;
        break;
      }
      sum += v;
    }
    out[i] = ok ? sum / window : null;
  }
  return out;
}

type TrendScore = {
  total: number;     // fixed 4
  passed: number;    // bullish checks passed
  details: { name: string; ok: boolean | null }[];
};

type StretchScore = {
  total: number;      // fixed 6
  flagged: number;    // extreme checks triggered (oversold or overbought)
  oversold: number;
  overbought: number;
  details: { name: string; state: "oversold" | "overbought" | "neutral" | "na" }[];
};

function buildTrendScore(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
  macdHist: number | null;
}): TrendScore {
  const { lastClose, ma50, ma200, macdHist } = args;

  const checks: { name: string; ok: boolean | null }[] = [
    {
      name: "Price > MA200",
      ok: typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : null,
    },
    {
      name: "Price > MA50",
      ok: typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : null,
    },
    {
      name: "MA50 > MA200",
      ok: typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : null,
    },
    {
      name: "MACD hist > 0",
      ok: typeof macdHist === "number" ? macdHist > 0 : null,
    },
  ];

  const passed = checks.reduce((acc, c) => acc + (c.ok === true ? 1 : 0), 0);
  return { total: 4, passed, details: checks };
}

function buildStretchScore(args: {
  lastClose: number | null;
  rsi14: number | null;
  stochK: number | null;
  bollUpper: number | null;
  bollLower: number | null;
  ema20: number | null;
  vwap: number | null;
  ma50: number | null;
}): StretchScore {
  const { lastClose, rsi14, stochK, bollUpper, bollLower, ema20, vwap, ma50 } = args;

  const details: StretchScore["details"] = [];
  let oversold = 0;
  let overbought = 0;

  // 1) RSI(14)
  if (typeof rsi14 === "number") {
    if (rsi14 <= 30) {
      oversold++;
      details.push({ name: "RSI", state: "oversold" });
    } else if (rsi14 >= 70) {
      overbought++;
      details.push({ name: "RSI", state: "overbought" });
    } else {
      details.push({ name: "RSI", state: "neutral" });
    }
  } else {
    details.push({ name: "RSI", state: "na" });
  }

  // 2) Stoch %K
  if (typeof stochK === "number") {
    if (stochK <= 20) {
      oversold++;
      details.push({ name: "Stoch", state: "oversold" });
    } else if (stochK >= 80) {
      overbought++;
      details.push({ name: "Stoch", state: "overbought" });
    } else {
      details.push({ name: "Stoch", state: "neutral" });
    }
  } else {
    details.push({ name: "Stoch", state: "na" });
  }

  // 3) Bollinger extremes (price vs bands)
  if (typeof lastClose === "number" && typeof bollLower === "number" && typeof bollUpper === "number") {
    if (lastClose < bollLower) {
      oversold++;
      details.push({ name: "Bollinger", state: "oversold" });
    } else if (lastClose > bollUpper) {
      overbought++;
      details.push({ name: "Bollinger", state: "overbought" });
    } else {
      details.push({ name: "Bollinger", state: "neutral" });
    }
  } else {
    details.push({ name: "Bollinger", state: "na" });
  }

  // 4) VWAP distance (±2%)
  if (typeof lastClose === "number" && typeof vwap === "number" && vwap > 0) {
    const pct = (lastClose - vwap) / vwap;
    if (pct <= -0.02) {
      oversold++;
      details.push({ name: "VWAP dist", state: "oversold" });
    } else if (pct >= 0.02) {
      overbought++;
      details.push({ name: "VWAP dist", state: "overbought" });
    } else {
      details.push({ name: "VWAP dist", state: "neutral" });
    }
  } else {
    details.push({ name: "VWAP dist", state: "na" });
  }

  // 5) EMA20 distance (±5%)
  if (typeof lastClose === "number" && typeof ema20 === "number" && ema20 > 0) {
    const pct = (lastClose - ema20) / ema20;
    if (pct <= -0.05) {
      oversold++;
      details.push({ name: "EMA20 dist", state: "oversold" });
    } else if (pct >= 0.05) {
      overbought++;
      details.push({ name: "EMA20 dist", state: "overbought" });
    } else {
      details.push({ name: "EMA20 dist", state: "neutral" });
    }
  } else {
    details.push({ name: "EMA20 dist", state: "na" });
  }

  // 6) MA50 distance (±5%)
  if (typeof lastClose === "number" && typeof ma50 === "number" && ma50 > 0) {
    const pct = (lastClose - ma50) / ma50;
    if (pct <= -0.05) {
      oversold++;
      details.push({ name: "MA50 dist", state: "oversold" });
    } else if (pct >= 0.05) {
      overbought++;
      details.push({ name: "MA50 dist", state: "overbought" });
    } else {
      details.push({ name: "MA50 dist", state: "neutral" });
    }
  } else {
    details.push({ name: "MA50 dist", state: "na" });
  }

  const total = 6;
  const flagged = oversold + overbought;

  return { total, flagged, oversold, overbought, details };
}

/* ----------------------------- constants ----------------------------- */

const PRESET_TICKERS: { symbol: string; name: string }[] = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "ABBV", name: "AbbVie Inc." },
  { symbol: "ABT", name: "Abbott Laboratories" },
  { symbol: "ADBE", name: "Adobe Inc." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "AVGO", name: "Broadcom Inc." },
  { symbol: "BAC", name: "Bank of America" },
  { symbol: "BRK.B", name: "Berkshire Hathaway B" },
  { symbol: "COST", name: "Costco Wholesale" },
  { symbol: "CRM", name: "Salesforce Inc." },
  { symbol: "CSCO", name: "Cisco Systems" },
  { symbol: "CVX", name: "Chevron Corp." },
  { symbol: "DIS", name: "Walt Disney Co." },
  { symbol: "GOOGL", name: "Alphabet Inc. Class A" },
  { symbol: "HD", name: "Home Depot" },
  { symbol: "INTC", name: "Intel Corp." },
  { symbol: "JNJ", name: "Johnson & Johnson" },
  { symbol: "JPM", name: "JPMorgan Chase" },
  { symbol: "KO", name: "Coca-Cola Co." },
  { symbol: "LLY", name: "Eli Lilly & Co." },
  { symbol: "MA", name: "Mastercard Inc." },
  { symbol: "MCD", name: "McDonald's Corp." },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "MRK", name: "Merck & Co." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "NFLX", name: "Netflix Inc." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "ORCL", name: "Oracle Corp." },
  { symbol: "PEP", name: "PepsiCo Inc." },
  { symbol: "PG", name: "Procter & Gamble" },
  { symbol: "PYPL", name: "PayPal Holdings" },
  { symbol: "QCOM", name: "Qualcomm Inc." },
  { symbol: "SBUX", name: "Starbucks Corp." },
  { symbol: "T", name: "AT&T Inc." },
  { symbol: "TGT", name: "Target Corp." },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "TXN", name: "Texas Instruments" },
  { symbol: "UNH", name: "UnitedHealth Group" },
  { symbol: "V", name: "Visa Inc." },
  { symbol: "VZ", name: "Verizon Communications" },
  { symbol: "WFC", name: "Wells Fargo" },
  { symbol: "WMT", name: "Walmart Inc." },
  { symbol: "XOM", name: "Exxon Mobil Corp." },
].sort((a, b) => a.symbol.localeCompare(b.symbol));

const TIMEFRAMES: { label: string; days: number }[] = [
  { label: "1D", days: 30 }, // daily-only source: show ~30 days so it renders
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 365 * 3 },
  { label: "MAX", days: 4000 },
];

// Single source of truth: everything we show in Breakdown (and therefore also in the Indicator dropdown)
const BREAKDOWN_DEFS = [
  { key: "vwap", label: "VWAP", overlay: "VWAP" as const },
  { key: "macd", label: "MACD", overlay: "MACD(12,26,9)" as const },
  { key: "rsi", label: "RSI", overlay: "RSI(14)" as const },
  { key: "stoch", label: "Stoch", overlay: "Stochastic(14,3)" as const },
  { key: "ma200", label: "MA200", overlay: "MA200" as const },
  { key: "vol", label: "Volume", overlay: "Volume" as const },
  { key: "atr", label: "ATR", overlay: "ATR(14)" as const },

  // Divergence items (still appear in Breakdown + dropdown)
  { key: "div_rsi", label: "RSI Div", overlay: "RSI(14)" as const },
  { key: "div_macd", label: "MACD Div", overlay: "MACD(12,26,9)" as const },
] as const;

// Dropdown is derived from the above list (so it can't get out of sync)
const INDICATORS: Overlay[] = [
  "None",
  "MA50",
  ...Array.from(new Set(BREAKDOWN_DEFS.map((d) => d.overlay))),
];
/* ----------------------------- component ----------------------------- */

export default function DashboardClient({ defaultSymbol = "SPY" }: { defaultSymbol?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPicking, startPicking] = useTransition();

  const [symbol, setSymbol] = useState(() => {
    if (typeof window === "undefined") return defaultSymbol;
    const saved = window.localStorage.getItem("msh_last_symbol");
    return saved && saved.trim() ? saved.trim().toUpperCase() : defaultSymbol;
  });

  // Track a human-friendly company name for the currently selected symbol
  const [symbolName, setSymbolName] = useState<string>("");

  const presetNameFor = (sym: string) => {
    const hit = PRESET_TICKERS.find((t) => t.symbol === sym);
    return hit ? hit.name : "";
  };

  // Resolve name whenever symbol changes (preset first; otherwise try /api/symbols for exact match)
  useEffect(() => {
    const preset = presetNameFor(symbol);
    if (preset) {
      setSymbolName(preset);
      return;
    }

    let cancelled = false;

    async function resolve() {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("symbols lookup failed");

        const data = (await res.json()) as { results?: SymbolResult[] };
        const rows = Array.isArray(data.results) ? data.results : [];
        const exact = rows.find((r) => (r.symbol ?? "").toUpperCase() === symbol.toUpperCase());

        if (!cancelled) setSymbolName(exact?.name ?? "");
      } catch {
        if (!cancelled) setSymbolName("");
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [symbol]);
  
  useEffect(() => {
    const urlSymbol = searchParams.get("symbol");
    const cleaned = urlSymbol ? urlSymbol.trim().toUpperCase() : "";

    if (cleaned && cleaned !== symbol) {
      setSymbol(cleaned);
    }
  }, [searchParams, symbol]);

  useEffect(() => {
    if (!symbol || !symbol.trim()) return;
    window.localStorage.setItem("msh_last_symbol", symbol.trim().toUpperCase());
  }, [symbol]);

  // Timeframe buttons (used for fetching + resetting view)
  const [tfDays, setTfDays] = useState(365);

  // Zoom/Pan window (display-only; does NOT trigger refetch)
  const [windowDays, setWindowDays] = useState(365);
  const [windowOffset, setWindowOffset] = useState(0); // 0 = most recent, higher = pan left into older data

  const [indicator, setIndicator] = useState<Overlay>("None");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [historyAll, setHistoryAll] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);

  const [bench, setBench] = useState<BenchPayload | null>(null);
  const [news, setNews] = useState<NewsPayload | null>(null);

  // Theme (site-wide)
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const COLORS = useMemo(() => {
    const isDark = theme === "dark";
    return {
      isDark,

      // page
      pageBg: isDark ? "#06080d" : "#f6f7fb",
      pageFg: isDark ? "#f1f5f9" : "#0b1220",
      mutedFg: isDark ? "rgba(241,245,249,0.70)" : "rgba(11,18,32,0.65)",

      // surfaces/cards
      cardBg: isDark ? "#0b1220" : "#ffffff",
      cardFg: isDark ? "#f1f5f9" : "#0b1220",
      border: isDark ? "rgba(255,255,255,0.14)" : "rgba(11,18,32,0.14)",

      // controls
      controlBg: isDark ? "rgba(255,255,255,0.06)" : "rgba(11,18,32,0.04)",
      controlBgSolid: isDark ? "#0f172a" : "#ffffff",
      controlBorder: isDark ? "rgba(255,255,255,0.18)" : "rgba(11,18,32,0.18)",
      controlFg: isDark ? "#f1f5f9" : "#0b1220",
    };
  }, [theme]);

  // Large screen modal
  const [expanded, setExpanded] = useState(false);

  // Reset zoom/pan when switching ticker or timeframe (better UX)
  useEffect(() => {
    setWindowDays(tfDays);
    setWindowOffset(0);
  }, [symbol, tfDays]);

  // ESC closes modal
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Load quote + history
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        // Ensure we always fetch enough data for MA200 etc.
        const historyDays = Math.max(tfDays, 2600);

        const [qRes, hRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=${historyDays}`, { cache: "no-store" }),
        ]);

        if (!qRes.ok) throw new Error("Quote fetch failed");
        if (!hRes.ok) throw new Error("History fetch failed");

        const q = (await qRes.json()) as Quote;
        const h = (await hRes.json()) as { symbol: string; points: any[] };

        if (cancelled) return;

        const ptsRaw = Array.isArray(h.points) ? h.points : [];
        const pts: Point[] = ptsRaw
          .map((p: any) => ({
            date: String(p?.date ?? ""),
            close: Number(p?.close),
            high: p?.high == null ? undefined : Number(p.high),
            low: p?.low == null ? undefined : Number(p.low),
            volume: p?.volume == null ? undefined : Number(p.volume),
          }))
          .filter((p) => p.date && Number.isFinite(p.close));

        setQuote(q);
        setHistoryAll(pts);
      } catch {
        if (cancelled) return;
        setErr("Failed to load data (try another ticker).");
        setQuote(null);
        setHistoryAll([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, tfDays]);

  // Autocomplete (debounced)
  useEffect(() => {
    let cancelled = false;
    const q = query.trim();

    if (!q) {
      setResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = (await res.json()) as { results: SymbolResult[] };
        if (cancelled) return;
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        if (cancelled) return;
        setResults([]);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

// Benchmarks (S&P + Nasdaq) — free, avoids TwelveData credit limits
useEffect(() => {
  let cancelled = false;

  async function loadBench() {
    try {
      const res = await fetch("/api/benchmarks", { cache: "no-store" });
      if (!res.ok) throw new Error("Benchmarks API failed");

      const raw = (await res.json()) as any;

      const safe: BenchPayload = {
        updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
        scope: typeof raw?.scope === "string" ? raw.scope : "Benchmarks",
        items: Array.isArray(raw?.items) ? raw.items : [],
      };

      if (!cancelled) setBench(safe);
    } catch {
      if (!cancelled) setBench({ updatedAt: new Date().toISOString(), scope: "Benchmarks", items: [] });
    }
  }

  loadBench();
  return () => {
    cancelled = true;
  };
}, []);

  // News (per symbol)
  useEffect(() => {
    let cancelled = false;

    async function loadNews() {
      try {
        const res = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const data = (await res.json()) as NewsPayload;
        if (!cancelled) setNews(data);
      } catch {
        if (!cancelled) setNews(null);
      }
    }

    loadNews();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Displayed data window (Zoom/Pan) - always at least 2 points
  const totalPoints = historyAll.length;
  const win = Math.max(windowDays, 2);
  const maxOffset = Math.max(totalPoints - win, 0);
  const offset = Math.min(Math.max(windowOffset, 0), maxOffset);

  const displayedHistory = useMemo(() => {
    if (!historyAll.length) return [];
    const end = totalPoints - offset; // exclusive
    const start = Math.max(0, end - win);
    const slice = historyAll.slice(start, end);
    return slice.length >= 2 ? slice : historyAll.slice(-2);
  }, [historyAll, totalPoints, offset, win]);

  const n = displayedHistory.length;

  // Indicators computed on FULL history for correctness
  const closesAll = useMemo(() => historyAll.map((p) => p.close), [historyAll]);

  const ma50Full = useMemo(() => movingAverage(closesAll, 50), [closesAll]);
  const ma200Full = useMemo(() => movingAverage(closesAll, 200), [closesAll]);

  const ema20Full = useMemo(() => ema(closesAll, 20), [closesAll]);
  const bbFull = useMemo(() => bollinger(closesAll, 20, 2), [closesAll]);
  const rsi14Full = useMemo(() => rsiWilder(closesAll, 14), [closesAll]);
  const macdFull = useMemo(() => macd(closesAll, 12, 26, 9), [closesAll]);

  const vwapFull = useMemo(() => vwapFromPoints(historyAll), [historyAll]);
  const stochFull = useMemo(() => stochastic(historyAll, 14, 3), [historyAll]);
  const atr14Full = useMemo(() => atr(historyAll, 14), [historyAll]);

  // IMPORTANT: slice EVERYTHING to -n (match data length)
  const ma50 = useMemo(() => ma50Full.slice(-n), [ma50Full, n]);
  const ma200 = useMemo(() => ma200Full.slice(-n), [ma200Full, n]);

  const ema20Arr = useMemo(() => ema20Full.slice(-n), [ema20Full, n]);

  const bollUpper = useMemo(() => bbFull.upper.slice(-n), [bbFull, n]);
  const bollMid = useMemo(() => bbFull.mid.slice(-n), [bbFull, n]);
  const bollLower = useMemo(() => bbFull.lower.slice(-n), [bbFull, n]);

  const rsi14Arr = useMemo(() => rsi14Full.slice(-n), [rsi14Full, n]);

  const macdLine = useMemo(() => macdFull.line.slice(-n), [macdFull, n]);
  const macdSignal = useMemo(() => macdFull.signal.slice(-n), [macdFull, n]);
  const macdHist = useMemo(() => macdFull.hist.slice(-n), [macdFull, n]);

  const vwapArr = useMemo(() => vwapFull.slice(-n), [vwapFull, n]);

  const stochK = useMemo(() => stochFull.k.slice(-n), [stochFull, n]);
  const stochD = useMemo(() => stochFull.d.slice(-n), [stochFull, n]);

  const atr14Arr = useMemo(() => atr14Full.slice(-n), [atr14Full, n]);

  // Volume (compute on FULL history so SMA20 works even on short display windows like 1W)
  const volumeFull = useMemo(
    () => historyAll.map((p) => (typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null)),
    [historyAll]
  );

  const volSma20Full = useMemo(() => smaNullable(volumeFull, 20), [volumeFull]);

  // Slice to match displayed length (n)
  const volumeArr = useMemo(() => volumeFull.slice(-n), [volumeFull, n]);
  const volSma20Arr = useMemo(() => volSma20Full.slice(-n), [volSma20Full, n]);

  // ATR SMA20: compute on FULL ATR series, then slice to -n
  const atrSma20Full = useMemo(() => smaNullable(atr14Full, 20), [atr14Full]);
  const atrSma20Arr = useMemo(() => atrSma20Full.slice(-n), [atrSma20Full, n]);

  const lastClose = displayedHistory.length ? displayedHistory[displayedHistory.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);

  const trendScore = useMemo(() => {
    if (indicator !== "None") return null;

    return buildTrendScore({
      lastClose,
      ma50: typeof lastMA50 === "number" ? lastMA50 : null,
      ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      macdHist: lastNum(macdHist),
    });
  }, [indicator, lastClose, lastMA50, lastMA200, macdHist]);

  const stretchScore = useMemo(() => {
    if (indicator !== "None") return null;

    return buildStretchScore({
      lastClose,
      rsi14: lastNum(rsi14Arr),
      stochK: lastNum(stochK),
      bollUpper: lastNum(bollUpper),
      bollLower: lastNum(bollLower),
      ema20: lastNum(ema20Arr),
      vwap: lastNum(vwapArr),
      ma50: typeof lastMA50 === "number" ? lastMA50 : null,
    });
  }, [indicator, lastClose, rsi14Arr, stochK, bollUpper, bollLower, ema20Arr, vwapArr, lastMA50]);

// Divergence computed on the CURRENT visible window (so what you see matches the label).
// If you want it to match Pickers exactly, keep the chart panned to the newest bars (offset = 0).
const divergence = useMemo<{
  div: DivResult | null;
  rsi: DivergenceState;
  macd: DivergenceState;
}>(() => {
  if (indicator !== "None") return { div: null, rsi: "none", macd: "none" };

  const div = detectDivergenceFromHistory(historyAll, {
    lookbackBars: 60,
    leftRight: 2,
    minPriceSwingPct: 1.2,
    minRsiSwing: 4,
    macdStdMult: 0.35,
  });

  const rsi = divStateForIndicator(div, "rsi");
  const macd = divStateForIndicator(div, "macd");

  return { div, rsi, macd };
}, [indicator, historyAll]);

  const signal = useMemo(() => {
    // Overview summary text (Trend + Stretch)
    if (indicator === "None") {
      if (!stretchScore || !trendScore) return { label: "Signal unavailable", detail: "No price data." };

      const parts: string[] = [];
      if (stretchScore.oversold) parts.push(`${stretchScore.oversold} oversold`);
      if (stretchScore.overbought) parts.push(`${stretchScore.overbought} overbought`);

      const detailList = stretchScore.details
        .filter((d) => d.state === "oversold" || d.state === "overbought")
        .slice(0, 4)
        .map((d) => d.name)
        .join(", ");

      return {
        label: `Stretch Score: ${stretchScore.flagged}/${stretchScore.total} checks`,
        detail:
          `Trend Score: ${trendScore.passed}/${trendScore.total}. ` +
          (parts.length ? `${parts.join(" • ")}.` : "No strong stretch extremes detected.") +
          (detailList ? ` Top stretch checks: ${detailList}.` : ""),
      };
    }

    // Existing single-indicator logic
    if (indicator === "MA50") return compareTo(lastClose, "MA50", typeof lastMA50 === "number" ? lastMA50 : null);
    if (indicator === "MA200") return compareTo(lastClose, "MA200", typeof lastMA200 === "number" ? lastMA200 : null);

    if (indicator === "EMA20") {
      const v = lastNum(ema20Arr);
      return compareTo(lastClose, "EMA20", typeof v === "number" ? v : null);
    }

    if (indicator === "VWAP") {
      const v = lastNum(vwapArr);
      return compareTo(lastClose, "VWAP", typeof v === "number" ? v : null);
    }

    if (indicator === "Bollinger(20,2)") {
      const v = lastNum(bollMid);
      return compareTo(lastClose, "BB mid", typeof v === "number" ? v : null);
    }

// Sub-panel indicators: interpret them directly (NOT vs MA200)
if (indicator === "RSI(14)") return compareOscillator("RSI(14)", lastNum(rsi14Arr), 30, 70);

if (indicator === "Stochastic(14,3)") return compareOscillator("Stochastic %K", lastNum(stochK), 20, 80);

if (indicator === "MACD(12,26,9)") {
  return compareMacdHistogram(lastClose, lastNum(macdHist));
}

if (indicator === "Volume") {
  return compareSpike("Volume", lastNum(volumeArr), lastNum(volSma20Arr), 1.8, "higher = more activity");
}

if (indicator === "ATR(14)") {
  return compareSpike("ATR(14)", lastNum(atr14Arr), lastNum(atrSma20Arr), 1.5, "higher = more volatility");
}

// Safety fallback
return { label: "Signal unavailable", detail: "Unknown indicator state." };
  }, [
    indicator,
    trendScore,
    stretchScore,
    lastClose,
    lastMA50,
    lastMA200,
    ema20Arr,
    vwapArr,
    bollMid,
    rsi14Arr,
    stochK,
    macdHist,
    volumeArr,
    volSma20Arr,
    atr14Arr,
    atrSma20Arr,
  ]);

    const overviewMeta = useMemo(() => {
    if (indicator !== "None" || !trendScore || !stretchScore) return null;

    // Tone is based on Stretch extremes (mean-reversion bias).
    // We no longer have "spikes" in the Stretch score, so pass 0.
    const toneInfo = compositeToneFromCounts(stretchScore.overbought, stretchScore.oversold, 0);
    const toneColor = toneToColor(toneInfo.tone, COLORS.isDark);

    // Market regime (simple + robust)
    const ma50v = typeof lastMA50 === "number" ? lastMA50 : null;
    const ma200v = typeof lastMA200 === "number" ? lastMA200 : null;

    let trend = "Range / Mixed";
    if (typeof lastClose === "number" && typeof ma50v === "number" && typeof ma200v === "number") {
      if (lastClose > ma50v && ma50v > ma200v) trend = "Uptrend";
      else if (lastClose < ma50v && ma50v < ma200v) trend = "Downtrend";
    }

    // Volatility regime using ATR ratio
    const atrv = lastNum(atr14Arr);
    const atrSma = lastNum(atrSma20Arr);
    let vol = "Normal";
    if (typeof atrv === "number" && typeof atrSma === "number" && atrSma > 0) {
      const ratio = atrv / atrSma;
      if (ratio >= 1.5) vol = "Elevated";
      else if (ratio <= 0.85) vol = "Quiet";
    }

    return { toneColor, toneTag: toneInfo.tag, trend, vol };
    }, [indicator, trendScore, stretchScore, COLORS.isDark, lastClose, lastMA50, lastMA200, atr14Arr, atrSma20Arr]);

  

    const overviewItems = useMemo<OverviewItem[]>(() => {
    // Only show in Overview mode
    if (indicator !== "None") return [];

    const items: OverviewItem[] = [];
    const isDark = COLORS.isDark;

     let order = 0;
    const push = (it: Omit<OverviewItem, "order">) => items.push({ ...it, order: order++ });

    // Helper: price distance classification
    const distTone = (pctAbs: number) => {
      if (pctAbs >= 5) return "red";
      if (pctAbs >= 2) return "orange";
      return "yellow";
    };

    // VWAP distance (2%)
    const vwap = lastNum(vwapArr);
    if (typeof lastClose === "number" && typeof vwap === "number" && vwap > 0) {
      const pct = ((lastClose - vwap) / vwap) * 100;
      const tone = pct >= 2 || pct <= -2 ? (Math.abs(pct) >= 5 ? "red" : "orange") : "yellow";
      push({
        key: "vwap",
        label: "VWAP",
        tone,
        valueText: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
        severity: Math.abs(pct),
      });
    } else {
     push({ key: "vwap", label: "VWAP", tone: "muted", valueText: "—", severity: 0 });
    }

    // MACD histogram momentum
    const hist = lastNum(macdHist);
    if (typeof lastClose === "number" && typeof hist === "number") {
      const flat = Math.abs(lastClose) * 0.001;
      const tone = hist > flat ? "green" : hist < -flat ? "red" : "yellow";
      push({
        key: "macd",
        label: "MACD",
        tone,
        valueText: hist > flat ? "Bullish" : hist < -flat ? "Bearish" : "Flat",
        severity: (Math.abs(hist) / Math.max(1e-9, Math.abs(lastClose))) * 100, // % of price
      });
    } else {
    push({ key: "macd", label: "MACD", tone: "muted", valueText: "—", severity: 0 });
    }

    // RSI
    const rsi = lastNum(rsi14Arr);
    if (typeof rsi === "number") {
      const tone = rsi >= 70 ? "red" : rsi <= 30 ? "green" : "yellow";
       push({
        key: "rsi",
        label: "RSI",
        tone,
        valueText: rsi >= 70 ? "Overbought" : rsi <= 30 ? "Oversold" : "Neutral",
        severity: rsi >= 70 ? rsi - 70 : rsi <= 30 ? 30 - rsi : 0,
      });
    } else {
    push({ key: "rsi", label: "RSI", tone: "muted", valueText: "—", severity: 0 });
    }

    // Stochastic %K
    const k = lastNum(stochK);
    if (typeof k === "number") {
      const tone = k >= 80 ? "red" : k <= 20 ? "green" : "yellow";
      push({
        key: "stoch",
        label: "Stoch",
        tone,
        valueText: k >= 80 ? "Overbought" : k <= 20 ? "Oversold" : "Neutral",
        severity: k >= 80 ? k - 80 : k <= 20 ? 20 - k : 0,
      });
    } else {
    push({ key: "stoch", label: "Stoch", tone: "muted", valueText: "—", severity: 0 });
    }

    // MA200 distance (5%)
    const ma200v = typeof lastMA200 === "number" ? lastMA200 : null;
    if (typeof lastClose === "number" && typeof ma200v === "number" && ma200v > 0) {
      const pct = ((lastClose - ma200v) / ma200v) * 100;
      const tone = distTone(Math.abs(pct)) as OverviewItem["tone"];
      push({
        key: "ma200",
        label: "MA200",
        tone,
        valueText: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
        severity: Math.abs(pct),
      });
    } else {
    push({ key: "ma200", label: "MA200", tone: "muted", valueText: "—", severity: 0 });
    }

    // Volume spike vs SMA20 (1.8x)
    const vol = lastNum(volumeArr);
    const volSma = lastNum(volSma20Arr);
    if (typeof vol === "number" && typeof volSma === "number" && volSma > 0) {
      const ratio = vol / volSma;
      const tone = ratio >= 1.8 ? "orange" : "yellow";
 push({
        key: "vol",
        label: "Volume",
        tone,
        valueText: ratio >= 1.8 ? `Spike ${ratio.toFixed(2)}×` : `Normal ${ratio.toFixed(2)}×`,
        severity: Math.max(0, ratio - 1),
      });
    } else {
   push({ key: "vol", label: "Volume", tone: "muted", valueText: "—", severity: 0 });
    }

    // ATR spike vs SMA20 (1.5x)
    const atrv = lastNum(atr14Arr);
    const atrSma = lastNum(atrSma20Arr);
    if (typeof atrv === "number" && typeof atrSma === "number" && atrSma > 0) {
      const ratio = atrv / atrSma;
      const tone = ratio >= 1.5 ? "orange" : "yellow";
      push({
        key: "atr",
        label: "ATR",
        tone,
        valueText: ratio >= 1.5 ? `Spike ${ratio.toFixed(2)}×` : `Normal ${ratio.toFixed(2)}×`,
        severity: Math.max(0, ratio - 1),
      });
    } else {
      push({ key: "atr", label: "ATR", tone: "muted", valueText: "—", severity: 0 });
    }

// Divergence (Last ~40 bars) — always render rows (muted if none)
const rsiTone = divergenceTone(divergence.rsi);
const macdTone = divergenceTone(divergence.macd);

push({
  key: "div_rsi",
  label: "RSI Div",
  tone: divergence.rsi === "none" ? "muted" : rsiTone,
  valueText: divergence.rsi === "none" ? "—" : divergenceLabel(divergence.rsi),
  severity: divergence.rsi === "none" ? 0 : divergenceSeverity(divergence.rsi),
});

push({
  key: "div_macd",
  label: "MACD Div",
  tone: divergence.macd === "none" ? "muted" : macdTone,
  valueText: divergence.macd === "none" ? "—" : divergenceLabel(divergence.macd),
  severity: divergence.macd === "none" ? 0 : divergenceSeverity(divergence.macd),
});

    // Sort: most severe first, then by tone, then stable order
    return items.sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      const tr = toneRank(b.tone) - toneRank(a.tone);
      if (tr !== 0) return tr;
      return a.order - b.order;
    });
  }, [
    indicator,
    COLORS.isDark,
    lastClose,
    lastMA200,
    vwapArr,
    macdHist,
    rsi14Arr,
    stochK,
    volumeArr,
    volSma20Arr,
    atr14Arr,
    atrSma20Arr,
    divergence,
  ]);

  const lastIndicatorValue = useMemo(() => {
if (indicator === "None") {
      return {
        label: "Stretch Score",
        value: stretchScore ? stretchScore.flagged : null,
        total: stretchScore ? stretchScore.total : null,
      };
    }

    if (indicator === "MA50") return { label: "MA50", value: lastMA50 };
    if (indicator === "MA200") return { label: "MA200", value: lastMA200 };
    if (indicator === "EMA20") return { label: "EMA20", value: lastNum(ema20Arr) };
    if (indicator === "VWAP") return { label: "VWAP", value: lastNum(vwapArr) };
    if (indicator === "Bollinger(20,2)") return { label: "BB Mid", value: lastNum(bollMid) };

    if (indicator === "RSI(14)") return { label: "RSI(14)", value: lastNum(rsi14Arr) };
    if (indicator === "MACD(12,26,9)") return { label: "MACD line", value: lastNum(macdLine) };
    if (indicator === "Stochastic(14,3)") return { label: "%K", value: lastNum(stochK) };
    if (indicator === "ATR(14)") return { label: "ATR(14)", value: lastNum(atr14Arr) };
    if (indicator === "Volume") return { label: "Volume", value: lastNum(volumeArr) };

    return { label: "Indicator", value: null };
  }, [indicator, stretchScore, lastMA50, lastMA200, ema20Arr, vwapArr, bollMid, rsi14Arr, macdLine, stochK, atr14Arr, volumeArr]);

  function chooseSymbol(s: string) {
    const cleaned = s.trim().toUpperCase();
    if (!cleaned) return;
    setSymbol(cleaned);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

function ChartCard({ height = 460 }: { height?: number | string }) {
  return (
    <div
      style={{
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        background: COLORS.cardBg,
        color: COLORS.cardFg,
        height,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.border}`,
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 800, whiteSpace: "nowrap" }}>
          Price ({indicator === "None" ? "Overview" : indicator})
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: COLORS.controlBgSolid,
            border: `1px solid ${COLORS.controlBorder}`,
            borderRadius: 12,
            padding: 6,
          }}
        >
          <button
            onClick={() => setWindowOffset((o) => Math.min(maxOffset, o + Math.max(1, Math.floor(win * 0.2))))}
            disabled={offset >= maxOffset}
            title="Pan left (older)"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${COLORS.controlBorder}`,
              background: COLORS.controlBg,
              color: COLORS.controlFg,
              cursor: offset >= maxOffset ? "not-allowed" : "pointer",
              opacity: offset >= maxOffset ? 0.45 : 1,
              fontWeight: 900,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ←
          </button>

          <button
            onClick={() => setWindowOffset((o) => Math.max(0, o - Math.max(1, Math.floor(win * 0.2))))}
            disabled={offset <= 0}
            title="Pan right (newer)"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${COLORS.controlBorder}`,
              background: COLORS.controlBg,
              color: COLORS.controlFg,
              cursor: offset <= 0 ? "not-allowed" : "pointer",
              opacity: offset <= 0 ? 0.45 : 1,
              fontWeight: 900,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            →
          </button>

          <button
            onClick={() => {
              setWindowDays((d) => Math.max(2, Math.floor(d * 0.8)));
              setWindowOffset(0);
            }}
            title="Zoom in"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${COLORS.controlBorder}`,
              background: COLORS.controlBg,
              color: COLORS.controlFg,
              cursor: "pointer",
              fontWeight: 900,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            +
          </button>

          <button
            onClick={() => {
              setWindowDays((d) => Math.min(Math.max(2, totalPoints || d), Math.ceil(d * 1.25)));
              setWindowOffset(0);
            }}
            title="Zoom out"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${COLORS.controlBorder}`,
              background: COLORS.controlBg,
              color: COLORS.controlFg,
              cursor: "pointer",
              fontWeight: 900,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            −
          </button>

          <div style={{ fontSize: 12, opacity: 0.8, color: COLORS.mutedFg, whiteSpace: "nowrap", fontWeight: 700 }}>
            {Math.min(win, totalPoints)} bars
          </div>

          <button
            onClick={() => setExpanded(true)}
            title="Expand chart"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${COLORS.controlBorder}`,
              background: COLORS.controlBg,
              color: COLORS.controlFg,
              cursor: "pointer",
              fontWeight: 900,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ⤢
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, padding: 16, minHeight: 0 }}>
        <PriceChart
          data={displayedHistory}
          ma50={ma50}
          ma200={ma200}
          overlay={indicator}
          bollUpper={bollUpper}
          bollMid={bollMid}
          bollLower={bollLower}
          ema20={ema20Arr}
          vwap={vwapArr}
          rsi14={rsi14Arr}
          macdLine={macdLine}
          macdSignal={macdSignal}
          macdHist={macdHist}
          stochK={stochK}
          stochD={stochD}
          atr14={atr14Arr}
          volume={volumeArr}
          divergence={divergence.div}
        />
      </div>
    </div>
  );
}

return (
  <main
    style={{
      padding: 0,
      fontFamily: "system-ui, Arial",
      background: COLORS.pageBg,
      color: COLORS.pageFg,
      minHeight: "100vh",
    }}
  >
<div className="pageWrap">
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginBottom: 8,
      flexWrap: "wrap",
    }}
  >
<div
  style={{
    width: 290,
    height: 72,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    overflow: "visible",
    marginRight: 8,
    flex: "0 0 auto",
   marginLeft: -40,
  }}
>
  <img
    src="/logo.png"
    alt="MyStockHarbor"
    style={{
      height: 72,
      width: "auto",
      objectFit: "contain",
      display: "block",
      transform: "scale(3.0)",
      transformOrigin: "left center",
    }}
  />
</div>



<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
  <button
    type="button"
    onClick={() => router.push("/learn")}
    style={{
      padding: "12px 16px",
      borderRadius: 14,
      border: `1px solid rgba(34,197,94,0.55)`,
      background: COLORS.isDark
        ? "linear-gradient(135deg, rgba(34,197,94,0.28), rgba(34,197,94,0.14))"
        : "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(34,197,94,0.10))",
      color: COLORS.controlFg,
      textDecoration: "none",
      fontWeight: 950,
      fontSize: 15,
      letterSpacing: "0.2px",
      boxShadow: COLORS.isDark ? "0 10px 26px rgba(0,0,0,0.45)" : "0 10px 26px rgba(0,0,0,0.14)",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      opacity: 1,
      position: "relative",
      overflow: "hidden",
    }}
    title="Learn the Basics"
  >
    📚 Learn the Basics <span style={{ opacity: 0.9 }}>→</span>
  </button>

  <button
    type="button"
    onClick={() => router.push("/platforms")}
    style={{
      padding: "12px 16px",
      borderRadius: 14,
      border: `1px solid rgba(168,85,247,0.55)`,
      background: COLORS.isDark
        ? "linear-gradient(135deg, rgba(168,85,247,0.28), rgba(168,85,247,0.14))"
        : "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(168,85,247,0.10))",
      color: COLORS.controlFg,
      textDecoration: "none",
      fontWeight: 950,
      fontSize: 15,
      letterSpacing: "0.2px",
      boxShadow: COLORS.isDark ? "0 10px 26px rgba(0,0,0,0.45)" : "0 10px 26px rgba(0,0,0,0.14)",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      opacity: 1,
      position: "relative",
      overflow: "hidden",
    }}
    title="Choosing your Platform"
  >
    🖥️ Choosing your Platform <span style={{ opacity: 0.9 }}>→</span>
  </button>

  <button
    type="button"
    onClick={() => router.push("/utilities")}
    style={{
      padding: "12px 16px",
      borderRadius: 14,
      border: `1px solid rgba(234,179,8,0.55)`,
      background: COLORS.isDark
        ? "linear-gradient(135deg, rgba(234,179,8,0.24), rgba(249,115,22,0.16))"
        : "linear-gradient(135deg, rgba(234,179,8,0.16), rgba(249,115,22,0.10))",
      color: COLORS.controlFg,
      textDecoration: "none",
      fontWeight: 950,
      fontSize: 15,
      letterSpacing: "0.2px",
      boxShadow: COLORS.isDark ? "0 10px 26px rgba(0,0,0,0.45)" : "0 10px 26px rgba(0,0,0,0.14)",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      opacity: 1,
      position: "relative",
      overflow: "hidden",
    }}
    title="Trading Utilities"
  >
    🧮 Trading Utilities <span style={{ opacity: 0.9 }}>→</span>
  </button>

  <button
    type="button"
    onClick={() => router.push("/about")}
    style={{
      padding: "12px 16px",
      borderRadius: 14,
      border: `1px solid rgba(59,130,246,0.45)`,
      background: COLORS.isDark
        ? "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(59,130,246,0.10))"
        : "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(59,130,246,0.08))",
      color: COLORS.controlFg,
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 15,
      letterSpacing: "0.2px",
      boxShadow: COLORS.isDark ? "0 10px 26px rgba(0,0,0,0.35)" : "0 10px 26px rgba(0,0,0,0.12)",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      opacity: 1,
      position: "relative",
      overflow: "hidden",
    }}
    title="About MyStockHarbor"
  >
    ℹ️ About
  </button>

  <button
    type="button"
    onClick={() => router.push("/contact")}
    style={{
      padding: "12px 16px",
      borderRadius: 14,
      border: `1px solid rgba(14,165,233,0.45)`,
      background: COLORS.isDark
        ? "linear-gradient(135deg, rgba(14,165,233,0.20), rgba(14,165,233,0.10))"
        : "linear-gradient(135deg, rgba(14,165,233,0.12), rgba(14,165,233,0.06))",
      color: COLORS.controlFg,
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 15,
      letterSpacing: "0.2px",
      boxShadow: COLORS.isDark ? "0 10px 26px rgba(0,0,0,0.35)" : "0 10px 26px rgba(0,0,0,0.12)",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      opacity: 1,
      position: "relative",
      overflow: "hidden",
    }}
    title="Contact MyStockHarbor"
  >
    ✉️ Contact
  </button>

  <button
    type="button"
    onClick={() => router.push("/risk-disclaimer")}
    style={{
      padding: "12px 16px",
      borderRadius: 14,
      border: `1px solid rgba(244,114,182,0.45)`,
      background: COLORS.isDark
        ? "linear-gradient(135deg, rgba(244,114,182,0.18), rgba(244,114,182,0.08))"
        : "linear-gradient(135deg, rgba(244,114,182,0.10), rgba(244,114,182,0.05))",
      color: COLORS.controlFg,
      textDecoration: "none",
      fontWeight: 900,
      fontSize: 15,
      letterSpacing: "0.2px",
      boxShadow: COLORS.isDark ? "0 10px 26px rgba(0,0,0,0.35)" : "0 10px 26px rgba(0,0,0,0.12)",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      opacity: 1,
      position: "relative",
      overflow: "hidden",
    }}
    title="Risk Disclaimer"
  >
    ⚠️ Risk Disclaimer
  </button>
</div>

    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginLeft: "auto" }}>
      <button
        onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        style={{
          padding: "10px 12px",
          borderRadius: 12,
          border: `1px solid ${COLORS.controlBorder}`,
          background: COLORS.controlBg,
          color: COLORS.controlFg,
          cursor: "pointer",
          fontWeight: 800,
        }}
        title="Toggle theme"
      >
        {COLORS.isDark ? "🌙 Dark" : "☀️ Light"}
      </button>
    </div>
  </div>

    <p
  style={{
    marginTop: 2,
    opacity: 0.8,
    color: COLORS.mutedFg,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.2px",
  }}
>
  Learn charts. Discover stocks. Trade smarter. — Version 1
</p>
<style>{`
  @keyframes pickersBar {
    0% { transform: translateX(-10%); opacity: 0.55; }
    50% { transform: translateX(120%); opacity: 0.95; }
    100% { transform: translateX(240%); opacity: 0.55; }
  }

  /* ---------- responsive helpers (no libraries) ---------- */
  .pageWrap { padding: 40px; }
  .mainGrid { margin-top: 16px; max-width: 920px; display: grid; gap: 16px; }
  .summaryGrid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 16px; align-items: start; margin-top: 8px; }
  .benchGrid { display: grid; grid-template-columns: repeat(2, minmax(240px, 1fr)); gap: 14px; max-width: 980px; }
  .newsGrid { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; }

  /* Mobile */
  @media (max-width: 760px) {
    .pageWrap { padding: 16px !important; }
    .mainGrid { max-width: 100% !important; }
    .summaryGrid { grid-template-columns: 1fr !important; }
    .benchGrid { grid-template-columns: 1fr !important; }
    .newsGrid { grid-template-columns: 1fr !important; }
  }
`}</style>

      {/* Controls row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* SEARCH */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, lineHeight: 1 }}>
              Search Any Stock
            </div>

            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter") chooseSymbol(query);
              }}
              placeholder="🔎 Search ANY ticker or company"
              style={{
                height: 44,
                padding: "0 14px",
                borderRadius: 14,
                border: "2px solid rgba(59,130,246,0.45)",
                background: "#ffffff",
                color: "#111",
                width: 260,
                fontSize: 14,
                fontWeight: 750,
                boxShadow: COLORS.isDark
                  ? "0 6px 20px rgba(0,0,0,0.35)"
                  : "0 6px 20px rgba(0,0,0,0.12)",
                outline: "none",
              }}
            />

            {open && results.length > 0 ? (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  left: 0,
                  right: 0,
                  border: "1px solid #3333",
                  borderRadius: 12,
                  background: "#fff",
                  color: "#111",
                  overflow: "hidden",
                  zIndex: 9999,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                  maxHeight: 340,
                  overflowY: "auto",
                }}
              >
                {results.map((r) => (
                  <button
                    key={`${r.symbol}-${r.exchange}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chooseSymbol(r.symbol)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      {r.symbol} <span style={{ fontWeight: 600, opacity: 0.7 }}>({r.exchange})</span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{r.name}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

           {/* STOCK PICKERS */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, lineHeight: 1 }}>
              Stock Pickers
            </label>

            <button
              type="button"
              onClick={() => {
                if (isPicking) return;
                startPicking(() => {
                  router.push("/pickers");
                });
              }}
              disabled={isPicking}
              style={{
                height: 44,
                padding: "0 18px",
                borderRadius: 12,
                border: `1px solid rgba(59,130,246,0.55)`,
                background: COLORS.isDark
                  ? "linear-gradient(135deg, rgba(59,130,246,0.35), rgba(59,130,246,0.18))"
                  : "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(59,130,246,0.12))",
                color: COLORS.controlFg,
                fontWeight: 900,
                fontSize: 14,
                letterSpacing: "0.2px",
                cursor: isPicking ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 220,
              }}
            >
              🔎 Find Your Next Stock →
            </button>
          </div>

          {/* INDICATOR */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 850, opacity: 0.85, lineHeight: 1 }}>
              Indicator
            </label>

            <select
              value={indicator}
              onChange={(e) => setIndicator(e.target.value as any)}
              style={{
                height: 44,
                padding: "0 12px",
                borderRadius: 12,
                border: `1px solid ${COLORS.controlBorder}`,
                background: "#ffffff",
                color: "#111",
                fontWeight: 900,
                minWidth: 220,
              }}
            >
              {INDICATORS.map((x) => (
                <option key={x} value={x}>
                  {x === "None" ? "Overview" : x}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Timeframes */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TIMEFRAMES.map((t) => {
            const active = tfDays === t.days;

            return (
              <button
                key={t.label}
                onClick={() => {
                  setTfDays(t.days);
                  setWindowDays(t.days);
                  setWindowOffset(0);
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.controlBorder}`,
                  background: active
                    ? COLORS.isDark
                      ? "rgba(255,255,255,0.18)"
                      : "rgba(0,0,0,0.08)"
                    : COLORS.controlBg,
                  color: COLORS.controlFg,
                  cursor: "pointer",
                  opacity: 1,
                  fontWeight: active ? 900 : 750,
                  boxShadow: active
                    ? COLORS.isDark
                      ? "0 10px 26px rgba(0,0,0,0.45)"
                      : "0 10px 26px rgba(0,0,0,0.12)"
                    : "none",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

     <div className="mainGrid">
        {/* Card 1: Summary */}
        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 28, fontWeight: 950, letterSpacing: "-0.3px" }}>
              {symbol}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, opacity: 0.85, color: COLORS.mutedFg }}>
              {symbolName ? `— ${symbolName}` : "—"}
            </div>
          </div>

          {loading ? (
            <p style={{ margin: "8px 0" }}>Loading…</p>
          ) : err ? (
            <p style={{ margin: "8px 0" }}>{err}</p>
          ) : (
            <>
              {indicator === "None" ? (
                <>
                  {/* ONE ROW: left column = price + big signal, right column = breakdown */}
<div className="summaryGrid">
                    {/* LEFT: price + dominant signal */}
<div style={{ minWidth: 0 }}>
  <div
    style={{
      border: `1px solid ${COLORS.border}`,
      borderRadius: 14,
      background: COLORS.controlBg,
      padding: 16,
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 30,
            fontWeight: 950,
            letterSpacing: "-0.4px",
            lineHeight: 1,
            color: COLORS.pageFg,
          }}
        >
          {symbol}
        </div>

        <div
          style={{
            marginTop: 6,
            fontSize: 15,
            fontWeight: 800,
            color: COLORS.mutedFg,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {symbolName || "Company name unavailable"}
        </div>
      </div>

      <div style={{ textAlign: "right", minWidth: 120 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: COLORS.mutedFg,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          Last Price
        </div>

        <div
          style={{
            marginTop: 6,
            fontSize: 30,
            fontWeight: 950,
            letterSpacing: "-0.4px",
            color: COLORS.pageFg,
          }}
        >
          {quote?.price == null ? "—" : `$${quote.price.toFixed(2)}`}
        </div>
      </div>
    </div>

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginTop: 18,
      }}
    >
      <div
        style={{
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 14,
          background: COLORS.cardBg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
            color: COLORS.mutedFg,
            fontWeight: 850,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: toneToColor(trendToneFromScore(trendScore), COLORS.isDark),
              flex: "0 0 auto",
            }}
          />
          <span>Trend Score</span>
          <HelpTip
            isDark={COLORS.isDark}
            text="Trend Score measures how many bullish trend checks are currently passing, such as price vs moving averages and MACD momentum. Higher scores suggest a stronger trend structure."
          />
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 32,
            fontWeight: 950,
            lineHeight: 1,
            color: COLORS.pageFg,
            letterSpacing: "-0.4px",
          }}
        >
          {trendScore ? `${trendScore.passed}/${trendScore.total}` : "—"}
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            fontWeight: 800,
            color: COLORS.mutedFg,
          }}
        >
          checks passing
        </div>

        {trendScore ? (
          renderFlagsMeter({
            flagged: trendScore.passed,
            total: trendScore.total,
            color: COLORS.isDark ? "#22c55e" : "#16a34a",
            isDark: COLORS.isDark,
          })
        ) : null}
      </div>

      <div
        style={{
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 14,
          background: COLORS.cardBg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
            color: COLORS.mutedFg,
            fontWeight: 850,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: overviewMeta?.toneColor ?? (COLORS.isDark ? "#22c55e" : "#16a34a"),
              flex: "0 0 auto",
            }}
          />
          <span>Stretch Score</span>
          <HelpTip
            isDark={COLORS.isDark}
            text="Stretch Score measures how many indicators suggest price may be extended, overbought, or oversold. Higher scores mean more signs that price is stretched away from normal conditions."
          />
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 32,
            fontWeight: 950,
            lineHeight: 1,
            color: overviewMeta?.toneColor ?? COLORS.pageFg,
            letterSpacing: "-0.4px",
          }}
        >
          {stretchScore ? `${stretchScore.flagged}/${stretchScore.total}` : "—"}
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            fontWeight: 800,
            color: COLORS.mutedFg,
          }}
        >
          stretch checks
        </div>

        {stretchScore && overviewMeta ? (
          renderFlagsMeter({
            flagged: stretchScore.flagged,
            total: stretchScore.total,
            color: overviewMeta.toneColor,
            isDark: COLORS.isDark,
          })
        ) : null}
      </div>
    </div>

    {overviewMeta ? (
      <div
        style={{
          marginTop: 14,
          padding: "10px 12px",
          borderRadius: 12,
          background: COLORS.cardBg,
          border: `1px solid ${COLORS.border}`,
          fontSize: 13,
          fontWeight: 800,
          color: COLORS.mutedFg,
        }}
      >
        Regime: {overviewMeta.trend} • Volatility: {overviewMeta.vol} • Bias: {overviewMeta.toneTag}
      </div>
    ) : null}

    <div
      style={{
        marginTop: 12,
        fontSize: 13,
        lineHeight: 1.6,
        color: COLORS.mutedFg,
      }}
    >
      {signal.detail}
    </div>

    <div
      style={{
        marginTop: 14,
        paddingTop: 12,
        borderTop: `1px solid ${COLORS.border}`,
        fontSize: 13,
        color: COLORS.mutedFg,
      }}
    >
      {quote?.date && quote?.time ? `As of ${quote.date} ${quote.time}` : "Timestamp unavailable"} • Source:{" "}
      {quote?.source ?? "stooq.com"}
    </div>
  </div>
</div>

                    {/* RIGHT: breakdown (top aligned) */}
<div
  style={{
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: 12,
    background: COLORS.controlBg,
    marginTop: 0,
  }}
>
                      <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10, opacity: 0.9 }}>
                        Breakdown
                      </div>

                      <div style={{ display: "grid", gap: 8 }}>
{BREAKDOWN_DEFS.map((d) => {
  const it = overviewItems.find((x) => x.key === d.key);
  if (!it) return null;

  const dot = toneToColor(it.tone, COLORS.isDark);

  return (
    <div
      key={it.key}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: dot,
            boxShadow: COLORS.isDark ? "0 0 0 3px rgba(255,255,255,0.04)" : "0 0 0 3px rgba(0,0,0,0.03)",
            flex: "0 0 auto",
          }}
        />
        <span style={{ fontWeight: 850, fontSize: 13, whiteSpace: "nowrap" }}>{it.label}</span>
      </div>

      <span style={{ fontSize: 12, opacity: 0.85, color: COLORS.mutedFg, textAlign: "right" }}>
        {it.valueText}
      </span>
    </div>
  );
})}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 20, margin: "8px 0" }}>
                    <strong>Last price:</strong> {quote?.price == null ? "Unavailable" : `$${quote.price.toFixed(2)}`}
                  </p>

                  <p style={{ margin: "8px 0 0", opacity: 0.85 }}>
                    <strong>Signal:</strong> {signal.label}
                  </p>
                  <p style={{ margin: "6px 0 0", opacity: 0.7 }}>{signal.detail}</p>

                  <div style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
                    <div>
                      {lastIndicatorValue.label}:{" "}
                      {typeof (lastIndicatorValue as any).value === "number"
                        ? indicator === "RSI(14)" || indicator === "Stochastic(14,3)"
                          ? `${((lastIndicatorValue as any).value as number).toFixed(2)}`
                          : indicator === "MACD(12,26,9)"
                            ? `${((lastIndicatorValue as any).value as number).toFixed(4)}`
                            : indicator === "Volume"
                              ? `${Math.round((lastIndicatorValue as any).value as number).toLocaleString()}`
                              : `$${(((lastIndicatorValue as any).value as number) ?? 0).toFixed(2)}`
                        : "—"}
                    </div>
                  </div>
                </>
              )}

              <p style={{ marginTop: 12, opacity: 0.7 }}>
                {quote?.date && quote?.time ? `As of ${quote.date} ${quote.time}` : "Timestamp unavailable"} • Source:{" "}
                {quote?.source ?? "stooq.com"}
              </p>
            </>
          )}
        </div>

       {/* Card 2: Chart */}
      <ChartCard height={460} />

        {/* Modal (Large screen) */}
        {expanded ? (
          <div
            onMouseDown={() => setExpanded(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.55)",
              zIndex: 99999,
              display: "grid",
              placeItems: "center",
              padding: 16,
            }}
          >
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: "min(1200px, 96vw)",
                height: "min(85vh, 900px)",
                background: "#0b1220",
                color: "#e6e6e6",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                display: "grid",
                gridTemplateRows: "auto 1fr",
                minHeight: 0,
                overflow: "hidden",
                
              }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, borderBottom: "1px solid rgba(255,255,255,0.14)" }}>
                <div style={{ fontWeight: 800 }}>{symbol} — Expanded Chart</div>
                <button
                  onClick={() => setExpanded(false)}
                  style={{
                    borderRadius: 10,
                    border: "1px solid #3333",
                    background: "#fff",
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                >
                  Close ✕
                </button>
              </div>

<div
  style={{
    padding: 14,
    display: "flex",
    flexDirection: "column",
    minHeight: 0, // ✅ allows children to take 1fr height inside grid
  }}
>
  <div
    style={{
      flex: 1,          // ✅ fill the available modal space
      minHeight: 0,     // ✅ prevents overflow bugs
      borderRadius: 12,
      overflow: "hidden",
      background: "#0b1220",
      border: "1px solid rgba(255,255,255,0.14)",
    }}
  >
    <div style={{ height: "100%", filter: "invert(1) hue-rotate(180deg)" }}>
      <ChartCard height="100%" />
    </div>
  </div>
</div>
            </div>
          </div>
        ) : null}

{/* Card 3: Benchmarks */}
<div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
  <h2 style={{ marginTop: 0 }}>Market (Benchmarks)</h2>

  {(() => {
    const items = Array.isArray(bench?.items) ? bench!.items : [];

    if (!bench) {
      return <div style={{ opacity: 0.7 }}>Market data unavailable.</div>;
    }

    if (!items.length) {
      return <div style={{ opacity: 0.7 }}>Market data unavailable.</div>;
    }

    return (
      <>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
          Updated: {new Date(bench.updatedAt).toLocaleString()} • {bench.scope}
        </div>

<div className="benchGrid">
  {items.map((it) => {
    const pct = typeof it.changePct === "number" ? it.changePct : null;
    const isUp = typeof pct === "number" ? pct >= 0 : null;

    const arrow = isUp == null ? "•" : isUp ? "▲" : "▼";
    const arrowColor = isUp == null ? COLORS.mutedFg : isUp ? "#22c55e" : "#ef4444";

    const pctText = pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

    // ✅ Convert stooq ETF symbol like "spy.us" -> "SPY" for your chart
    const chartSymbol = (it.symbol || "").split(".")[0]?.toUpperCase() || it.symbol.toUpperCase();

    return (
      <button
        key={it.key}
        type="button"
        onClick={() => router.push(`/?symbol=${encodeURIComponent(chartSymbol)}`)} // ✅ click loads into chart
        title={`Load ${chartSymbol} in chart`}
        style={{
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          padding: 14,
          background: COLORS.cardBg,
          color: COLORS.cardFg,
          boxShadow: COLORS.isDark ? "0 10px 26px rgba(0,0,0,0.35)" : "0 10px 26px rgba(0,0,0,0.12)",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 950, fontSize: 16, lineHeight: 1.1 }}>{it.label}</div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
              {it.symbol} • Click to load {chartSymbol}
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
              <span style={{ fontWeight: 950, color: arrowColor, fontSize: 16 }}>{arrow}</span>

              {/* ✅ Bigger % */}
              <span style={{ fontWeight: 950, color: arrowColor, fontSize: 22 }}>
                {pctText}
              </span>
            </div>

            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
              {typeof it.close === "number" ? it.close.toFixed(2) : "—"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          {it.date && it.time ? `As of ${it.date} ${it.time}` : "Timestamp unavailable"}
        </div>
      </button>
    );
  })}
</div>
      </>
    );
  })()}
</div>

        {/* Card 4: News */}
        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Latest News</h2>

          {news ? (
            <div className="newsGrid">
              {news.feeds.map((f) => (
                <div key={f.label}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{f.label}</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {f.items.length ? (
                      f.items.map((it, idx) => (
                        <a
                          key={idx}
                          href={it.link}
                          target="_blank"
                          rel="noreferrer"
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          <div style={{ fontWeight: 650 }}>{it.title}</div>
                          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                            {(it.source ?? "Source")} {it.pubDate ? `• ${new Date(it.pubDate).toLocaleString()}` : ""}
                          </div>
                        </a>
                      ))
                    ) : (
                      <div style={{ opacity: 0.7 }}>No headlines right now.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>News unavailable.</div>
          )}
        </div>
      </div>
    </div>
  </main>
);
}
