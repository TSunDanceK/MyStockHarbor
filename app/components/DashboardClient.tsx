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
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: props.isDark ? "rgba(255,255,255,0.15)" : "rgba(11,18,32,0.12)",
        color: props.isDark ? "#fff" : "#0b1220",
        fontSize: 11,
        fontWeight: 900,
        cursor: "pointer",
        marginLeft: 6,
        flex: "0 0 auto",
        zIndex: 6,
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
            top: "calc(100% + 10px)",
            right: 0,
            left: "auto",
            transform: "none",
            width: 260,
            maxWidth: "min(260px, calc(100vw - 32px))",
            padding: 12,
            borderRadius: 12,
            backgroundColor: props.isDark ? "#0f172a" : "#ffffff",
            border: props.isDark
              ? "1px solid rgba(255,255,255,0.14)"
              : "1px solid rgba(11,18,32,0.14)",
            color: props.isDark ? "#f1f5f9" : "#0b1220",
            fontSize: 12,
            lineHeight: 1.5,
            fontWeight: 600,
            zIndex: 80,
            boxShadow: "0 10px 24px rgba(0,0,0,0.28)",
            pointerEvents: "none",
            whiteSpace: "normal",
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
  if (state === "bearish" || state === "bullish") return 100;
  return 5;
}

type OverviewItem = {
  key: string;
  label: string;
  tone: "green" | "yellow" | "orange" | "red" | "muted";
  valueText: string;
  severity: number;
  order: number;
};

function toneToColor(tone: OverviewItem["tone"], isDark: boolean) {
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
  if (tone === "red") return 4;
  if (tone === "orange") return 3;
  if (tone === "yellow") return 2;
  if (tone === "green") return 1;
  return 0;
}

function compositeToneFromCounts(overbought: number, oversold: number, spikes: number) {
  const net = overbought - oversold;
  const intensity = overbought + oversold + spikes;

  if (intensity <= 1) return { tone: "yellow" as const, tag: "Calm" };

  if (net >= 2) return { tone: intensity >= 5 ? ("red" as const) : ("orange" as const), tag: "Overbought-leaning" };
  if (net === 1) return { tone: "orange" as const, tag: "Slightly overbought" };

  if (net <= -2) return { tone: intensity >= 5 ? ("green" as const) : ("yellow" as const), tag: "Oversold-leaning" };
  if (net === -1) return { tone: "yellow" as const, tag: "Slightly oversold" };

  return { tone: intensity >= 5 ? ("orange" as const) : ("yellow" as const), tag: "Mixed" };
}

function trendToneFromScore(ts: TrendScore | null): OverviewItem["tone"] {
  if (!ts) return "muted";

  const ratio = ts.total > 0 ? ts.passed / ts.total : 0;

  if (ratio >= 0.75) return "green";
  if (ratio >= 0.5) return "yellow";
  if (ratio >= 0.25) return "orange";
  return "red";
}

function clampNum(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

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
  total: number;
  passed: number;
  details: { name: string; ok: boolean | null }[];
};

type StretchScore = {
  total: number;
  flagged: number;
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
  { label: "1D", days: 30 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 365 * 3 },
  { label: "MAX", days: 4000 },
];

const BREAKDOWN_DEFS = [
  { key: "vwap", label: "VWAP", overlay: "VWAP" as const },
  { key: "macd", label: "MACD", overlay: "MACD(12,26,9)" as const },
  { key: "rsi", label: "RSI", overlay: "RSI(14)" as const },
  { key: "stoch", label: "Stoch", overlay: "Stochastic(14,3)" as const },
  { key: "ma200", label: "MA200", overlay: "MA200" as const },
  { key: "vol", label: "Volume", overlay: "Volume" as const },
  { key: "atr", label: "ATR", overlay: "ATR(14)" as const },
  { key: "div_rsi", label: "RSI Div", overlay: "RSI(14)" as const },
  { key: "div_macd", label: "MACD Div", overlay: "MACD(12,26,9)" as const },
] as const;

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

  const [symbolName, setSymbolName] = useState<string>("");

  const presetNameFor = (sym: string) => {
    const hit = PRESET_TICKERS.find((t) => t.symbol === sym);
    return hit ? hit.name : "";
  };

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

  const [tfDays, setTfDays] = useState(365);
  const [windowDays, setWindowDays] = useState(365);
  const [windowOffset, setWindowOffset] = useState(0);

  const [indicator, setIndicator] = useState<Overlay>("None");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [historyAll, setHistoryAll] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState(symbol);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);

  const [bench, setBench] = useState<BenchPayload | null>(null);
  const [news, setNews] = useState<NewsPayload | null>(null);

  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const COLORS = useMemo(() => {
    const isDark = theme === "dark";
    return {
      isDark,
      pageBg: isDark ? "#06080d" : "#f6f7fb",
      pageFg: isDark ? "#f1f5f9" : "#0b1220",
      mutedFg: isDark ? "rgba(241,245,249,0.70)" : "rgba(11,18,32,0.65)",
      cardBg: isDark ? "#0b1220" : "#ffffff",
      cardFg: isDark ? "#f1f5f9" : "#0b1220",
      border: isDark ? "rgba(255,255,255,0.14)" : "rgba(11,18,32,0.14)",
      controlBg: isDark ? "rgba(255,255,255,0.06)" : "rgba(11,18,32,0.04)",
      controlBgSolid: isDark ? "#0f172a" : "#ffffff",
      controlBorder: isDark ? "rgba(255,255,255,0.18)" : "rgba(11,18,32,0.18)",
      controlFg: isDark ? "#f1f5f9" : "#0b1220",
    };
  }, [theme]);

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setWindowDays(tfDays);
    setWindowOffset(0);
  }, [symbol, tfDays]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
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

  const totalPoints = historyAll.length;
  const win = Math.max(windowDays, 2);
  const maxOffset = Math.max(totalPoints - win, 0);
  const offset = Math.min(Math.max(windowOffset, 0), maxOffset);

  const displayedHistory = useMemo(() => {
    if (!historyAll.length) return [];
    const end = totalPoints - offset;
    const start = Math.max(0, end - win);
    const slice = historyAll.slice(start, end);
    return slice.length >= 2 ? slice : historyAll.slice(-2);
  }, [historyAll, totalPoints, offset, win]);

  const n = displayedHistory.length;

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

  const volumeFull = useMemo(
    () => historyAll.map((p) => (typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null)),
    [historyAll]
  );

  const volSma20Full = useMemo(() => smaNullable(volumeFull, 20), [volumeFull]);

  const volumeArr = useMemo(() => volumeFull.slice(-n), [volumeFull, n]);
  const volSma20Arr = useMemo(() => volSma20Full.slice(-n), [volSma20Full, n]);

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
    if (indicator === "None") {
      if (!stretchScore || !trendScore) return { label: "Signal unavailable", detail: "No price data." };

      const detailList = stretchScore.details
        .filter((d) => d.state === "oversold" || d.state === "overbought")
        .slice(0, 4)
        .map((d) => d.name)
        .join(", ");

      return {
        label: `Stretch Score: ${stretchScore.flagged}/${stretchScore.total}`,
        detail:
          `Trend Score: ${trendScore.passed} of ${trendScore.total} checks passing. ` +
          `${stretchScore.flagged} stretch signals elevated. ` +
          (detailList ? `Top stretch signals: ${detailList}.` : ""),
      };
    }

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

    const toneInfo = compositeToneFromCounts(stretchScore.overbought, stretchScore.oversold, 0);
    const toneColor = toneToColor(toneInfo.tone, COLORS.isDark);

    const ma50v = typeof lastMA50 === "number" ? lastMA50 : null;
    const ma200v = typeof lastMA200 === "number" ? lastMA200 : null;

    let trend = "Range / Mixed";
    if (typeof lastClose === "number" && typeof ma50v === "number" && typeof ma200v === "number") {
      if (lastClose > ma50v && ma50v > ma200v) trend = "Uptrend";
      else if (lastClose < ma50v && ma50v < ma200v) trend = "Downtrend";
    }

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
    if (indicator !== "None") return [];

    const items: OverviewItem[] = [];

    let order = 0;
    const push = (it: Omit<OverviewItem, "order">) => items.push({ ...it, order: order++ });

    const distTone = (pctAbs: number) => {
      if (pctAbs >= 5) return "red";
      if (pctAbs >= 2) return "orange";
      return "yellow";
    };

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

    const hist = lastNum(macdHist);
    if (typeof lastClose === "number" && typeof hist === "number") {
      const flat = Math.abs(lastClose) * 0.001;
      const tone = hist > flat ? "green" : hist < -flat ? "red" : "yellow";
      push({
        key: "macd",
        label: "MACD",
        tone,
        valueText: hist > flat ? "Bullish" : hist < -flat ? "Bearish" : "Flat",
        severity: (Math.abs(hist) / Math.max(1e-9, Math.abs(lastClose))) * 100,
      });
    } else {
      push({ key: "macd", label: "MACD", tone: "muted", valueText: "—", severity: 0 });
    }

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

    return items.sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      const tr = toneRank(b.tone) - toneRank(a.tone);
      if (tr !== 0) return tr;
      return a.order - b.order;
    });
  }, [
    indicator,
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
}, [
  indicator,
  stretchScore,
  lastMA50,
  lastMA200,
  ema20Arr,
  vwapArr,
  bollMid,
  rsi14Arr,
  macdLine,
  stochK,
  atr14Arr,
  volumeArr,
]);

const [isMobile, setIsMobile] = useState(false);

useEffect(() => {
  const onResize = () => setIsMobile(window.innerWidth <= 768);
  onResize();
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}, []);

function chooseSymbol(s: string) {
  const cleaned = s.trim().toUpperCase();
  if (!cleaned) return;

  setSymbol(cleaned);
  setQuery(cleaned);
  setResults([]);
  setOpen(false);
  setWindowOffset(0);
}

function prettyIndicatorName(v: Overlay) {
  if (v === "None") return "Overview";
  return v;
}

function selectValueFromIndicator(v: Overlay) {
  return v === "None" ? "Overview" : v;
}

function setIndicatorFromSelect(v: string) {
  setIndicator(v === "Overview" ? "None" : (v as Overlay));
  setWindowOffset(0);
}

function formatMaybeNumber(v: unknown, digits = 2) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function formatPctFromBase(last: number | null, base: number | null) {
  if (typeof last !== "number" || typeof base !== "number" || !Number.isFinite(last) || !Number.isFinite(base) || base === 0) {
    return null;
  }
  return ((last - base) / base) * 100;
}

function chipToneColor(tone: OverviewItem["tone"]) {
  return toneToColor(tone, COLORS.isDark);
}

function signalDotColor(label: string) {
  if (label.includes("🔴")) return COLORS.isDark ? "#ef4444" : "#dc2626";
  if (label.includes("🟢")) return COLORS.isDark ? "#22c55e" : "#16a34a";
  if (label.includes("⚡")) return COLORS.isDark ? "#fb923c" : "#ea580c";
  return COLORS.isDark ? "#eab308" : "#ca8a04";
}
  function indicatorLearnHref(indicatorName: string) {
  if (indicatorName === "MA50") return "/learn/moving-averages";
  if (indicatorName === "MA200") return "/learn/moving-averages";
  if (indicatorName === "EMA20") return "/learn/moving-averages";
  if (indicatorName === "VWAP") return "/learn/vwap";
  if (indicatorName === "Bollinger(20,2)") return "/learn/bollinger-bands";
  if (indicatorName === "RSI(14)") return "/learn/rsi";
  if (indicatorName === "MACD(12,26,9)") return "/learn/macd";
  if (indicatorName === "Stochastic(14,3)") return "/learn/stochastic";
  if (indicatorName === "ATR(14)") return "/learn/atr";
  if (indicatorName === "Volume") return "/learn/volume";
  return "/learn";
}

function indicatorHelpText(indicatorName: string) {
  if (indicatorName === "MA50") {
    return "MA50 shows the medium-term trend and helps spot whether price is trading above or below that trend.";
  }
  if (indicatorName === "MA200") {
    return "MA200 shows the long-term trend and helps judge whether a stock is in a stronger or weaker structure.";
  }
  if (indicatorName === "EMA20") {
    return "EMA20 is a faster moving average used to read short-term trend and pullbacks.";
  }
  if (indicatorName === "VWAP") {
    return "VWAP helps show whether price is stretched away from a fairer average trading level.";
  }
  if (indicatorName === "Bollinger(20,2)") {
    return "Bollinger Bands help show when price is near its normal range or stretching to extremes.";
  }
  if (indicatorName === "RSI(14)") {
    return "RSI measures momentum and highlights potential overbought or oversold conditions.";
  }
  if (indicatorName === "MACD(12,26,9)") {
    return "MACD helps read momentum direction and whether it is strengthening or weakening.";
  }
  if (indicatorName === "Stochastic(14,3)") {
    return "Stochastic is a fast momentum indicator used to identify short-term stretch.";
  }
  if (indicatorName === "ATR(14)") {
    return "ATR measures volatility and helps judge how large price movements are.";
  }
  if (indicatorName === "Volume") {
    return "Volume shows how much participation is behind a price move.";
  }

  return "This indicator helps interpret trend, momentum, volatility, or stretch conditions.";
}

function BreakdownHelpButton(props: { indicator: Overlay }) {
  const isOverview = props.indicator === "None";

  const helpText = isOverview
    ? "Breakdown shows the main dashboard indicators including trend, momentum, stretch, volatility and divergence clues."
    : indicatorHelpText(props.indicator);

  const learnHref = isOverview
    ? "/learn"
    : indicatorLearnHref(props.indicator);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <HelpTip text={helpText} isDark={COLORS.isDark} />

      <Link
        href={learnHref}
        style={{
          color: COLORS.isDark ? "#93c5fd" : "#2563eb",
          textDecoration: "none",
          fontWeight: 800,
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        Learn more →
      </Link>
    </div>
  );
}

const currentIndicatorName = prettyIndicatorName(indicator);

const chartHeight = isMobile ? 250 : 430;

const ma50Pct = formatPctFromBase(lastClose, typeof lastMA50 === "number" ? lastMA50 : null);
const ma200Pct = formatPctFromBase(lastClose, typeof lastMA200 === "number" ? lastMA200 : null);
const ema20Pct = formatPctFromBase(lastClose, lastNum(ema20Arr));
const vwapPct = formatPctFromBase(lastClose, lastNum(vwapArr));
const bbUpperLast = lastNum(bollUpper);
const bbLowerLast = lastNum(bollLower);
const bbMidLast = lastNum(bollMid);
const rsiLast = lastNum(rsi14Arr);
const stochLast = lastNum(stochK);
const macdHistLast = lastNum(macdHist);
const macdLineLast = lastNum(macdLine);
const macdSignalLast = lastNum(macdSignal);
const atrLast = lastNum(atr14Arr);
const atrSmaLast = lastNum(atrSma20Arr);
const volumeLast = lastNum(volumeArr);
const volumeSmaLast = lastNum(volSma20Arr);

const indicatorInsight = useMemo(() => {
  if (indicator === "None") return null;

  if (indicator === "MA50") {
    return {
      title: "MA50 Insight",
      accent: compareTo(lastClose, "MA50", typeof lastMA50 === "number" ? lastMA50 : null),
      stats: [
        { label: "Price vs MA50", value: ma50Pct == null ? "—" : `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}%` },
        { label: "MA50 value", value: formatMaybeNumber(lastMA50) },
        {
          label: "Trend slope",
          value:
            ma50.length >= 6 &&
            typeof ma50[ma50.length - 1] === "number" &&
            typeof ma50[ma50.length - 6] === "number"
              ? (ma50[ma50.length - 1]! > ma50[ma50.length - 6]! ? "Rising" : "Falling")
              : "—",
        },
        {
          label: "Structure",
          value:
            typeof lastClose === "number" && typeof lastMA50 === "number"
              ? lastClose >= lastMA50
                ? "Above trend support"
                : "Below trend support"
              : "—",
        },
      ],
      note:
        typeof ma50Pct === "number"
          ? ma50Pct > 5
            ? "Price is stretched well above the 50-day average."
            : ma50Pct < -5
            ? "Price is trading notably below the 50-day average."
            : "Price is trading close enough to the 50-day average to be considered fairly balanced."
          : "Need more data for a clearer MA50 read.",
    };
  }

  if (indicator === "MA200") {
    return {
      title: "MA200 Insight",
      accent: compareTo(lastClose, "MA200", typeof lastMA200 === "number" ? lastMA200 : null),
      stats: [
        { label: "Price vs MA200", value: ma200Pct == null ? "—" : `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}%` },
        { label: "MA200 value", value: formatMaybeNumber(lastMA200) },
        {
          label: "Long trend",
          value:
            typeof lastClose === "number" && typeof lastMA200 === "number"
              ? lastClose >= lastMA200
                ? "Above long-term trend"
                : "Below long-term trend"
              : "—",
        },
        {
          label: "MA50 vs MA200",
          value:
            typeof lastMA50 === "number" && typeof lastMA200 === "number"
              ? lastMA50 >= lastMA200
                ? "Bullish stack"
                : "Bearish stack"
              : "—",
        },
      ],
      note:
        typeof ma200Pct === "number"
          ? Math.abs(ma200Pct) >= 10
            ? "This is a large long-term distance from the 200-day average."
            : "This long-term distance is still fairly contained."
          : "Need more data for a clearer MA200 read.",
    };
  }

  if (indicator === "EMA20") {
    return {
      title: "EMA20 Insight",
      accent: compareTo(lastClose, "EMA20", lastNum(ema20Arr)),
      stats: [
        { label: "Price vs EMA20", value: ema20Pct == null ? "—" : `${ema20Pct >= 0 ? "+" : ""}${ema20Pct.toFixed(2)}%` },
        { label: "EMA20 value", value: formatMaybeNumber(lastNum(ema20Arr)) },
        {
          label: "Short trend",
          value:
            typeof lastClose === "number" && typeof lastNum(ema20Arr) === "number"
              ? lastClose >= (lastNum(ema20Arr) as number)
                ? "Above short trend"
                : "Below short trend"
              : "—",
        },
        {
          label: "Use case",
          value: "Fast trend guide",
        },
      ],
      note: "EMA20 reacts faster than MA50, so it is useful for short-term trend and pullback structure.",
    };
  }

  if (indicator === "VWAP") {
    return {
      title: "VWAP Insight",
      accent: compareTo(lastClose, "VWAP", lastNum(vwapArr)),
      stats: [
        { label: "Price vs VWAP", value: vwapPct == null ? "—" : `${vwapPct >= 0 ? "+" : ""}${vwapPct.toFixed(2)}%` },
        { label: "VWAP value", value: formatMaybeNumber(lastNum(vwapArr)) },
        {
          label: "Stretch",
          value:
            typeof vwapPct === "number"
              ? Math.abs(vwapPct) >= 5
                ? "High"
                : Math.abs(vwapPct) >= 2
                ? "Moderate"
                : "Low"
              : "—",
        },
        {
          label: "Read",
          value:
            typeof vwapPct === "number"
              ? vwapPct >= 0
                ? "Trading above value"
                : "Trading below value"
              : "—",
        },
      ],
      note: "VWAP is useful for judging whether price is extended away from a fairer average trading level.",
    };
  }

  if (indicator === "Bollinger(20,2)") {
    let bandRead = "Inside bands";
    if (typeof lastClose === "number" && typeof bbUpperLast === "number" && lastClose > bbUpperLast) bandRead = "Above upper band";
    if (typeof lastClose === "number" && typeof bbLowerLast === "number" && lastClose < bbLowerLast) bandRead = "Below lower band";

    return {
      title: "Bollinger Insight",
      accent: compareTo(lastClose, "BB mid", bbMidLast),
      stats: [
        { label: "Upper band", value: formatMaybeNumber(bbUpperLast) },
        { label: "Mid band", value: formatMaybeNumber(bbMidLast) },
        { label: "Lower band", value: formatMaybeNumber(bbLowerLast) },
        { label: "Band location", value: bandRead },
      ],
      note: "Bollinger Bands help show when price is expanding, compressing, or pushing into an extreme zone.",
    };
  }

  if (indicator === "RSI(14)") {
    return {
      title: "RSI Insight",
      accent: compareOscillator("RSI(14)", rsiLast, 30, 70),
      stats: [
        { label: "RSI value", value: formatMaybeNumber(rsiLast) },
        {
          label: "Zone",
          value: typeof rsiLast === "number" ? (rsiLast >= 70 ? "Overbought" : rsiLast <= 30 ? "Oversold" : "Neutral") : "—",
        },
        { label: "Divergence", value: divergenceLabel(divergence.rsi) },
        {
          label: "Momentum",
          value:
            rsi14Arr.length >= 4 &&
            typeof rsi14Arr[rsi14Arr.length - 1] === "number" &&
            typeof rsi14Arr[rsi14Arr.length - 4] === "number"
              ? rsi14Arr[rsi14Arr.length - 1]! > rsi14Arr[rsi14Arr.length - 4]!
                ? "Improving"
                : "Weakening"
              : "—",
        },
      ],
      note: "RSI helps show whether momentum is hot, weak, or potentially diverging from price.",
    };
  }

  if (indicator === "MACD(12,26,9)") {
    return {
      title: "MACD Insight",
      accent: compareMacdHistogram(lastClose, macdHistLast),
      stats: [
        { label: "MACD line", value: formatMaybeNumber(macdLineLast, 4) },
        { label: "Signal line", value: formatMaybeNumber(macdSignalLast, 4) },
        { label: "Histogram", value: formatMaybeNumber(macdHistLast, 4) },
        { label: "Divergence", value: divergenceLabel(divergence.macd) },
      ],
      note: "MACD is best for reading directional momentum, line cross behaviour, and whether momentum is strengthening or fading.",
    };
  }

  if (indicator === "Stochastic(14,3)") {
    return {
      title: "Stochastic Insight",
      accent: compareOscillator("Stochastic %K", stochLast, 20, 80),
      stats: [
        { label: "%K", value: formatMaybeNumber(lastNum(stochK)) },
        { label: "%D", value: formatMaybeNumber(lastNum(stochD)) },
        {
          label: "Zone",
          value: typeof stochLast === "number" ? (stochLast >= 80 ? "Overbought" : stochLast <= 20 ? "Oversold" : "Neutral") : "—",
        },
        { label: "Use case", value: "Fast stretch read" },
      ],
      note: "Stochastic reacts quickly, so it is useful for spotting short-term stretch before price mean reverts or continues.",
    };
  }

  if (indicator === "ATR(14)") {
    const ratio =
      typeof atrLast === "number" && typeof atrSmaLast === "number" && atrSmaLast > 0 ? atrLast / atrSmaLast : null;

    return {
      title: "ATR Insight",
      accent: compareSpike("ATR(14)", atrLast, atrSmaLast, 1.5, "higher = more volatility"),
      stats: [
        { label: "ATR value", value: formatMaybeNumber(atrLast) },
        { label: "ATR vs 20SMA", value: ratio == null ? "—" : `${ratio.toFixed(2)}×` },
        {
          label: "Volatility",
          value: ratio == null ? "—" : ratio >= 1.5 ? "Elevated" : ratio <= 0.85 ? "Quiet" : "Normal",
        },
        { label: "Use case", value: "Risk / stop sizing" },
      ],
      note: "ATR does not tell direction. It tells how much price has been moving and whether volatility is heating up or cooling down.",
    };
  }

  if (indicator === "Volume") {
    const ratio =
      typeof volumeLast === "number" && typeof volumeSmaLast === "number" && volumeSmaLast > 0
        ? volumeLast / volumeSmaLast
        : null;

    return {
      title: "Volume Insight",
      accent: compareSpike("Volume", volumeLast, volumeSmaLast, 1.8, "higher = more activity"),
      stats: [
        { label: "Volume", value: typeof volumeLast === "number" ? volumeLast.toLocaleString() : "—" },
        { label: "20-day avg", value: typeof volumeSmaLast === "number" ? Math.round(volumeSmaLast).toLocaleString() : "—" },
        { label: "Volume ratio", value: ratio == null ? "—" : `${ratio.toFixed(2)}×` },
        {
          label: "Participation",
          value: ratio == null ? "—" : ratio >= 1.8 ? "Heavy" : ratio <= 0.8 ? "Light" : "Normal",
        },
      ],
      note: "Volume helps judge whether a move has real participation behind it or is happening on lighter activity.",
    };
  }

  return null;
}, [
  indicator,
  lastClose,
  lastMA50,
  lastMA200,
  ma50Pct,
  ma200Pct,
  ema20Pct,
  vwapPct,
  ma50,
  ema20Arr,
  vwapArr,
  bollUpper,
  bollMid,
  bollLower,
  bbUpperLast,
  bbLowerLast,
  bbMidLast,
  rsiLast,
  rsi14Arr,
  divergence,
  macdHistLast,
  macdLineLast,
  macdSignalLast,
  stochLast,
  stochK,
  stochD,
  atrLast,
  atrSmaLast,
  volumeLast,
  volumeSmaLast,
]);

function SmallNavLink(props: { href: string; children: React.ReactNode }) {
const isLearn = props.href === "/learn";
const isPlatforms = props.href === "/platforms";
const isPickers = props.href === "/pickers";
const isUtilities = props.href === "/utilities";

const icon =
  isLearn ? "📘" :
  isPlatforms ? "🏦" :
  isPickers ? "📊" :
  isUtilities ? "🧮" :
  "→";

const bg = isLearn
  ? "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))"
  : isPlatforms
    ? "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(16,185,129,0.10))"
    : isPickers
      ? "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))"
      : isUtilities
        ? "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))"
        : COLORS.controlBg;

const border = isLearn
  ? "rgba(59,130,246,0.45)"
  : isPlatforms
    ? "rgba(34,197,94,0.45)"
    : isPickers
      ? "rgba(239,68,68,0.45)"
      : isUtilities
        ? "rgba(168,85,247,0.45)"
        : COLORS.controlBorder;

  return (
    <Link
      href={props.href}
      className="msh-top-nav-btn"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 42,
        padding: "9px 13px",
        borderRadius: 14,
        border: `1px solid ${border}`,
        background: bg,
        color: isPickers ? "#fef2f2" : COLORS.controlFg,
        textDecoration: "none",
        fontWeight: 900,
        fontSize: 14,
        whiteSpace: "nowrap",
        boxShadow: COLORS.isDark
          ? "0 8px 18px rgba(0,0,0,0.20)"
          : "0 8px 18px rgba(0,0,0,0.06)",
        transition:
          "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: 15,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>

      <span>{props.children}</span>
    </Link>
  );
}

function TimeframeButton(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        padding: isMobile ? "8px 10px" : "10px 12px",
        borderRadius: 12,
        border: `1px solid ${props.active ? "rgba(255,255,255,0.32)" : COLORS.controlBorder}`,
        background: props.active ? (COLORS.isDark ? "rgba(255,255,255,0.10)" : "rgba(11,18,32,0.08)") : COLORS.controlBg,
        color: COLORS.controlFg,
        fontWeight: 900,
        fontSize: isMobile ? 13 : 14,
        cursor: "pointer",
        minWidth: isMobile ? 48 : 54,
      }}
    >
      {props.label}
    </button>
  );
}

function SectionCard(props: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  allowOverflow?: boolean;
}) {
  return (
    <section
      style={{
        border: `1px solid ${COLORS.border}`,
        borderRadius: 18,
        background: COLORS.cardBg,
        color: COLORS.cardFg,
        boxShadow: COLORS.isDark ? "0 14px 34px rgba(0,0,0,0.28)" : "0 14px 34px rgba(0,0,0,0.08)",
        overflow: props.allowOverflow ? "visible" : "hidden",
        minWidth: 0,
        ...props.style,
      }}
    >
      {props.title || props.right ? (
        <div
          style={{
            padding: "14px 16px",
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 15 }}>{props.title}</div>
          {props.right}
        </div>
      ) : null}

      <div style={{ padding: 16, ...props.bodyStyle }}>{props.children}</div>
    </section>
  );
}

function ChartToolbar() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
          lineHeight: 1,
        }}
      >
        −
      </button>

      <div
        style={{
          padding: "8px 10px",
          borderRadius: 10,
          border: `1px solid ${COLORS.controlBorder}`,
          background: COLORS.controlBg,
          color: COLORS.mutedFg,
          fontSize: 12,
          fontWeight: 800,
        }}
      >
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
          lineHeight: 1,
        }}
      >
        ⤢
      </button>
    </div>
  );
}

function OverviewPanel() {
  if (!trendScore || !stretchScore) {
    return (
      <SectionCard title={`${symbol} Overview`} allowOverflow>
        <div style={{ opacity: 0.75 }}>Overview unavailable.</div>
      </SectionCard>
    );
  }

  const trendTone = trendToneFromScore(trendScore);
  const trendColor = toneToColor(trendTone, COLORS.isDark);
  const stretchTone = compositeToneFromCounts(stretchScore.overbought, stretchScore.oversold, 0).tone;
  const stretchColor = toneToColor(stretchTone, COLORS.isDark);

  return (
    <SectionCard title={`${symbol} Overview`}>
      <div style={{ display: "grid", gap: 14 }}>
        <div
          className="msh-overview-head"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 950, lineHeight: 1.1 }}>{symbol}</div>
            <div style={{ marginTop: 4, color: COLORS.mutedFg, fontWeight: 700 }}>{symbolName || "—"}</div>
          </div>

          <div
            style={{
              textAlign: "right",
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: COLORS.mutedFg,
                fontWeight: 900,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Last price
            </div>
            <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 950, lineHeight: 1.05 }}>
              {quote?.price != null ? `$${quote.price.toFixed(2)}` : "—"}
            </div>
          </div>
        </div>

        <div className="msh-score-grid">
          <div
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              padding: 16,
              background: COLORS.controlBg,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
              <span style={{ color: trendColor }}>●</span>
              <span>Trend Score</span>
              <HelpTip text="Trend score checks price vs MA50/MA200 and MACD histogram direction." isDark={COLORS.isDark} />
            </div>

            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 950, color: trendColor }}>
              {trendScore.passed}/{trendScore.total}
            </div>

            {renderFlagsMeter({
              flagged: trendScore.passed,
              total: trendScore.total,
              color: trendColor,
              isDark: COLORS.isDark,
            })}
          </div>

          <div
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              padding: 16,
              background: COLORS.controlBg,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
              <span style={{ color: stretchColor }}>●</span>
              <span>Stretch Score</span>
              <HelpTip text="Stretch score checks RSI, Stoch, Bollinger, VWAP, EMA20 and MA50 extension." isDark={COLORS.isDark} />
            </div>

            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 950, color: stretchColor }}>
              {stretchScore.flagged}/{stretchScore.total}
            </div>

        
            {renderFlagsMeter({
              flagged: stretchScore.flagged,
              total: stretchScore.total,
              color: stretchColor,
              isDark: COLORS.isDark,
            })}
          </div>
        </div>

        {overviewMeta ? (
          <div
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 14,
              background: COLORS.controlBg,
              fontWeight: 800,
              lineHeight: 1.45,
            }}
          >
            Regime: {overviewMeta.trend} • Volatility: {overviewMeta.vol} • Bias:{" "}
            <span style={{ color: overviewMeta.toneColor }}>{overviewMeta.toneTag}</span>
          </div>
        ) : null}

        <div style={{ color: COLORS.mutedFg, lineHeight: 1.55 }}>{signal.detail}</div>

        <div
          style={{
            paddingTop: 12,
            borderTop: `1px solid ${COLORS.border}`,
            fontSize: 12,
            color: COLORS.mutedFg,
            fontWeight: 700,
          }}
        >
          As of {quote?.date ?? "—"} {quote?.time ?? ""} • Source: {quote?.source ?? "stooq.com"}
        </div>
      </div>
    </SectionCard>
  );
}

function IndicatorPanel() {
  if (!indicatorInsight) return null;

  return (
    <SectionCard title={indicatorInsight.title}>
      <div style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            border: `1px solid ${COLORS.border}`,
            borderRadius: 14,
            padding: 14,
            background: COLORS.controlBg,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: signalDotColor(indicatorInsight.accent.label), flex: "0 0 auto" }} />
            <div style={{ fontWeight: 900 }}>{indicatorInsight.accent.label.replace(/[🟢🔴🟡⚡]/g, "").trim()}</div>
          </div>
          <div style={{ marginTop: 8, color: COLORS.mutedFg, lineHeight: 1.5 }}>{indicatorInsight.accent.detail}</div>
        </div>

        <div className="msh-info-grid">
          {indicatorInsight.stats.map((row) => (
            <div
              key={row.label}
              style={{
                border: `1px solid ${COLORS.border}`,
                borderRadius: 14,
                padding: 14,
                background: COLORS.controlBg,
                minWidth: 0,
              }}
            >
              <div style={{ fontSize: 12, color: COLORS.mutedFg, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {row.label}
              </div>
              <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900, wordBreak: "break-word" }}>{row.value}</div>
            </div>
          ))}
        </div>

        <div style={{ color: COLORS.mutedFg, lineHeight: 1.55 }}>{indicatorInsight.note}</div>

        <div style={{ paddingTop: 12, borderTop: `1px solid ${COLORS.border}`, fontSize: 12, color: COLORS.mutedFg, fontWeight: 700 }}>
          Current view: {currentIndicatorName}
        </div>
      </div>
    </SectionCard>
  );
}

function BreakdownPanel() {
  const rows = indicator === "None" ? overviewItems : [];

  if (indicator !== "None") {
    const focusedRows: { label: string; tone: OverviewItem["tone"]; value: string }[] = [];

    if (indicator === "RSI(14)") {
      focusedRows.push({
        label: "RSI",
        tone: typeof rsiLast === "number" ? (rsiLast >= 70 ? "red" : rsiLast <= 30 ? "green" : "yellow") : "muted",
        value: typeof rsiLast === "number" ? rsiLast.toFixed(2) : "—",
      });
      focusedRows.push({
        label: "RSI Div",
        tone: divergence.rsi === "none" ? "muted" : divergenceTone(divergence.rsi),
        value: divergence.rsi === "none" ? "—" : divergenceLabel(divergence.rsi),
      });
    } else if (indicator === "MACD(12,26,9)") {
      focusedRows.push({
        label: "Histogram",
        tone: typeof macdHistLast === "number" ? (macdHistLast > 0 ? "green" : macdHistLast < 0 ? "red" : "yellow") : "muted",
        value: typeof macdHistLast === "number" ? macdHistLast.toFixed(4) : "—",
      });
      focusedRows.push({
        label: "MACD Div",
        tone: divergence.macd === "none" ? "muted" : divergenceTone(divergence.macd),
        value: divergence.macd === "none" ? "—" : divergenceLabel(divergence.macd),
      });
    } else if (indicator === "MA50") {
      focusedRows.push({
        label: "Distance",
        tone: typeof ma50Pct === "number" ? (Math.abs(ma50Pct) >= 5 ? "red" : Math.abs(ma50Pct) >= 2 ? "orange" : "yellow") : "muted",
        value: ma50Pct == null ? "—" : `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}%`,
      });
      focusedRows.push({ label: "MA50", tone: "muted", value: formatMaybeNumber(lastMA50) });
    } else if (indicator === "MA200") {
      focusedRows.push({
        label: "Distance",
        tone: typeof ma200Pct === "number" ? (Math.abs(ma200Pct) >= 10 ? "red" : Math.abs(ma200Pct) >= 4 ? "orange" : "yellow") : "muted",
        value: ma200Pct == null ? "—" : `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}%`,
      });
      focusedRows.push({ label: "MA200", tone: "muted", value: formatMaybeNumber(lastMA200) });
    } else if (indicator === "Volume") {
      const ratio = typeof volumeLast === "number" && typeof volumeSmaLast === "number" && volumeSmaLast > 0 ? volumeLast / volumeSmaLast : null;
      focusedRows.push({
        label: "Volume ratio",
        tone: ratio == null ? "muted" : ratio >= 1.8 ? "orange" : "yellow",
        value: ratio == null ? "—" : `${ratio.toFixed(2)}×`,
      });
    } else if (indicator === "ATR(14)") {
      const ratio = typeof atrLast === "number" && typeof atrSmaLast === "number" && atrSmaLast > 0 ? atrLast / atrSmaLast : null;
      focusedRows.push({
        label: "ATR ratio",
        tone: ratio == null ? "muted" : ratio >= 1.5 ? "orange" : "yellow",
        value: ratio == null ? "—" : `${ratio.toFixed(2)}×`,
      });
    } else if (indicator === "VWAP") {
      focusedRows.push({
        label: "Distance",
        tone: typeof vwapPct === "number" ? (Math.abs(vwapPct) >= 5 ? "red" : Math.abs(vwapPct) >= 2 ? "orange" : "yellow") : "muted",
        value: vwapPct == null ? "—" : `${vwapPct >= 0 ? "+" : ""}${vwapPct.toFixed(2)}%`,
      });
    } else if (indicator === "Bollinger(20,2)") {
      focusedRows.push({ label: "Upper", tone: "muted", value: formatMaybeNumber(bbUpperLast) });
      focusedRows.push({ label: "Lower", tone: "muted", value: formatMaybeNumber(bbLowerLast) });
    } else if (indicator === "EMA20") {
      focusedRows.push({
        label: "Distance",
        tone: typeof ema20Pct === "number" ? (Math.abs(ema20Pct) >= 5 ? "red" : Math.abs(ema20Pct) >= 2 ? "orange" : "yellow") : "muted",
        value: ema20Pct == null ? "—" : `${ema20Pct >= 0 ? "+" : ""}${ema20Pct.toFixed(2)}%`,
      });
    } else if (indicator === "Stochastic(14,3)") {
      focusedRows.push({
        label: "%K",
        tone: typeof stochLast === "number" ? (stochLast >= 80 ? "red" : stochLast <= 20 ? "green" : "yellow") : "muted",
        value: typeof stochLast === "number" ? stochLast.toFixed(2) : "—",
      });
      focusedRows.push({ label: "%D", tone: "muted", value: formatMaybeNumber(lastNum(stochD)) });
    }

    return (
      <SectionCard
        title="Indicator Snapshot"
        right={<BreakdownHelpButton indicator={indicator} />}
        allowOverflow
      >
        <div style={{ display: "grid", gap: 12 }}>
          {focusedRows.length ? (
            focusedRows.map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: chipToneColor(row.tone),
                      flex: "0 0 auto",
                    }}
                  />
                  <span style={{ fontWeight: 900 }}>{row.label}</span>
                </div>
                <div style={{ color: COLORS.mutedFg, fontWeight: 800, textAlign: "right" }}>{row.value}</div>
              </div>
            ))
          ) : (
            <div style={{ opacity: 0.75 }}>No additional snapshot available.</div>
          )}

          <button
            type="button"
            onClick={() => {
              setIndicator("None");
              setWindowOffset(0);
            }}
            style={{
              marginTop: 4,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "9px 12px",
              borderRadius: 12,
              border: `1px solid ${COLORS.controlBorder}`,
              background: COLORS.controlBg,
              color: COLORS.controlFg,
              fontWeight: 900,
              fontSize: 13,
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            ← Back to Overview
          </button>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Breakdown"
      right={<BreakdownHelpButton indicator="None" />}
      allowOverflow
    >
      <div className="msh-breakdown-grid">
        {rows.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() =>
              setIndicator(
                item.key === "div_rsi"
                  ? "RSI(14)"
                  : item.key === "div_macd"
                  ? "MACD(12,26,9)"
                  : BREAKDOWN_DEFS.find((d) => d.key === item.key)?.overlay ?? "None"
              )
            }
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              alignItems: "center",
              padding: "8px 10px",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              background: COLORS.controlBg,
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background: chipToneColor(item.tone),
                  flex: "0 0 auto",
                }}
              />
              <span style={{ fontWeight: 900, fontSize: 14, minWidth: 0 }}>{item.label}</span>
            </div>
            <div
              style={{
                color: COLORS.mutedFg,
                fontWeight: 800,
                textAlign: "right",
                fontSize: 13,
                whiteSpace: "nowrap",
                marginLeft: 8,
              }}
            >
              {item.valueText}
            </div>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}


function ChartPanel() {
  return (
    <SectionCard
      title=""
    right={null}
      bodyStyle={{ padding: 0 }}
      style={{ minHeight: isMobile ? "auto" : 0 }}
    >
<div style={{ padding: 16, borderBottom: `1px solid ${COLORS.border}` }}>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    }}
  >
    <div style={{ fontWeight: 900, fontSize: 15 }}>Price ({currentIndicatorName})</div>

    <div className="msh-timeframes">
      {TIMEFRAMES.map((t) => (
        <TimeframeButton
          key={t.label}
          label={t.label}
          active={tfDays === t.days}
          onClick={() => {
            setTfDays(t.days);
            setWindowDays(t.days);
            setWindowOffset(0);
          }}
        />
      ))}
    </div>
  </div>

  <div
    className="msh-chart-head-row"
    style={{
      marginTop: 14,
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 12,
          color: COLORS.mutedFg,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Indicator
      </div>
      <select
        value={selectValueFromIndicator(indicator)}
        onChange={(e) => setIndicatorFromSelect(e.target.value)}
        style={{
          marginTop: 6,
          width: isMobile ? "100%" : 240,
          padding: "12px 14px",
          borderRadius: 14,
          border: `1px solid ${COLORS.controlBorder}`,
          background: COLORS.controlBgSolid,
          color: COLORS.controlFg,
          fontWeight: 900,
          fontSize: 16,
          outline: "none",
        }}
      >
        <option value="Overview">Overview</option>
        {INDICATORS.filter((x) => x !== "None").map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>

    <ChartToolbar />
  </div>
</div>

      <div style={{ padding: 16 }}>
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
          height={chartHeight}
        />

        <div
          style={{
            marginTop: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            fontSize: 13,
            fontWeight: 700,
            color: COLORS.mutedFg,
          }}
        >
          <div>
            {displayedHistory.length
              ? `From ${displayedHistory[0].date} → ${displayedHistory[displayedHistory.length - 1].date}`
              : "No chart data"}
          </div>

         <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
  <Link
    href="/platforms"
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "6px 12px",
      borderRadius: 10,
      border: `1px solid rgba(59,130,246,0.45)`,
      background: COLORS.isDark
        ? "linear-gradient(135deg, rgba(37,99,235,0.25), rgba(29,78,216,0.15))"
        : "linear-gradient(135deg, rgba(37,99,235,0.12), rgba(29,78,216,0.06))",
      color: "#3b82f6",
      fontWeight: 900,
      fontSize: 13,
      textDecoration: "none",
      whiteSpace: "nowrap",
    }}
  >
    Trade {symbol} →
  </Link>

  <span style={{ fontSize: 12, color: COLORS.mutedFg }}>
    Compare platforms
  </span>
</div>
        </div>
      </div>
    </SectionCard>
  );
}

function BenchmarksPanel() {
  return (
    <SectionCard title="Market Benchmarks">
      <div style={{ fontSize: 12, color: COLORS.mutedFg, marginBottom: 12 }}>
        Updated: {bench?.updatedAt ? new Date(bench.updatedAt).toLocaleString() : "—"} • Benchmarks (Stooq, free)
      </div>

      <div className="msh-bench-grid">
        {(bench?.items ?? []).map((it) => {
          const pct = typeof it.changePct === "number" ? it.changePct : null;
          const isUp = typeof pct === "number" ? pct >= 0 : null;
          const arrow = isUp == null ? "•" : isUp ? "▲" : "▼";
          const arrowColor = isUp == null ? COLORS.mutedFg : isUp ? "#22c55e" : "#ef4444";
          const pctText = pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
          const chartSymbol = (it.symbol || "").split(".")[0]?.toUpperCase() || it.symbol.toUpperCase();

return (
  <button
    key={it.key}
    type="button"
    onClick={() => chooseSymbol(chartSymbol)}
    title={`Open ${chartSymbol} on chart`}
    style={{
      border: `1px solid ${COLORS.border}`,
      borderRadius: 16,
      padding: 14,
      background: COLORS.controlBg,
      color: COLORS.cardFg,
      textAlign: "left",
      width: "100%",
      cursor: "pointer",
      transition: "transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease, filter 120ms ease",
      boxShadow: COLORS.isDark ? "0 8px 18px rgba(0,0,0,0.14)" : "0 8px 18px rgba(0,0,0,0.04)",
    }}
  >
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 950, fontSize: 16, lineHeight: 1.1 }}>{it.label}</div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>{it.symbol}</div>
        </div>

        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            <span style={{ fontWeight: 950, color: arrowColor, fontSize: 14 }}>{arrow}</span>
            <span style={{ fontWeight: 950, color: arrowColor, fontSize: 20 }}>{pctText}</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
            {typeof it.close === "number" ? it.close.toFixed(2) : "—"}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.7 }}>
        {it.date && it.time ? `As of ${it.date} ${it.time}` : "Timestamp unavailable"}
      </div>
    </div>
  </button>
);
        })}
      </div>
    </SectionCard>
  );
}

function NewsPanel() {
  return (
    <SectionCard title="Latest News">
      {news ? (
        <div className="msh-news-sections">
          {news.feeds.map((f) => (
            <div key={f.label} className="msh-news-section">
              <div className="msh-news-section-title">{f.label}</div>

              <div className="msh-news-section-grid">
                {(f.items || []).map((it, idx) => (
                  <a
                    key={`${f.label}-${idx}-${it.link}`}
                    href={it.link}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        border: `1px solid ${COLORS.border}`,
                        background: COLORS.controlBg,
                        height: "100%",
                      }}
                    >
                      <div style={{ fontWeight: 800, lineHeight: 1.45 }}>{it.title}</div>

                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                        <div style={{ fontWeight: 800 }}>{f.label}</div>
                        <div>
                          {(it.source ?? "Source")}
                          {it.pubDate ? ` • ${new Date(it.pubDate).toLocaleString()}` : ""}
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ opacity: 0.7 }}>News unavailable.</div>
      )}
    </SectionCard>
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

<style>{`
  .msh-page-wrap {
    width: min(1480px, calc(100% - 24px));
    margin: 0 auto;
    padding: 18px 0 28px;
  }

  .msh-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }

  .msh-top-left {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    position: relative;
  }

  .msh-top-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
  }

  .msh-top-nav-btn:hover {
    transform: translateY(-1px);
    filter: brightness(1.05);
  }

  .msh-toolbar-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.9fr);
    gap: 14px;
    align-items: end;
    margin-bottom: 18px;
  }

  .msh-main-grid {
    display: grid;
    grid-template-columns: minmax(320px, 430px) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  .msh-left-stack {
    display: grid;
    gap: 18px;
  }

  .msh-lower-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 18px;
    margin-top: 18px;
  }

  .msh-chart-head-row {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .msh-timeframes {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .msh-score-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .msh-info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .msh-breakdown-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .msh-bench-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .msh-news-head-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .msh-news-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .msh-news-sections {
    display: grid;
    gap: 18px;
  }

  .msh-news-section {
    display: grid;
    gap: 12px;
  }

  .msh-news-section-title {
    font-weight: 950;
    text-align: center;
  }

  .msh-news-section-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .msh-mobile-nav {
    display: none;
  }

  .msh-overview-head {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  @media (min-width: 761px) {
    .msh-top-nav-btn {
      min-height: 48px !important;
      padding: 12px 18px !important;
      font-size: 16px !important;
      gap: 10px !important;
    }
  }

  @media (max-width: 1180px) {
    .msh-bench-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .msh-news-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .msh-news-section-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 980px) {
    .msh-main-grid {
      grid-template-columns: 1fr;
    }

    .msh-mobile-primary {
      order: 1;
    }

    .msh-mobile-secondary {
      order: 2;
    }

    .msh-score-grid,
    .msh-info-grid,
    .msh-breakdown-grid,
    .msh-bench-grid,
    .msh-news-grid,
    .msh-news-head-grid,
    .msh-news-section-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .msh-page-wrap {
      width: min(100%, calc(100% - 16px));
      padding-top: 12px;
    }

    .msh-topbar {
      gap: 10px;
      margin-bottom: 12px;
    }

    .msh-top-right {
      display: none;
    }

    .msh-mobile-nav {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }

    .msh-top-nav-btn {
      min-height: 38px !important;
      padding: 7px 10px !important;
      font-size: 13px !important;
      gap: 6px !important;
      border-radius: 12px !important;
    }

    .msh-toolbar-grid {
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .msh-score-grid,
    .msh-info-grid,
    .msh-bench-grid,
    .msh-news-grid,
    .msh-breakdown-grid,
    .msh-news-section-grid {
      grid-template-columns: 1fr;
    }

    .msh-news-head-grid {
      display: none;
    }

    .msh-news-section-title {
      text-align: left;
    }

.msh-chart-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.msh-timeframes {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 6px;
}

.msh-timeframes > * {
  width: 100%;
  padding: 6px 0;
  font-size: 12px;
}

.msh-timeframes button:nth-child(4),
.msh-timeframes button:nth-child(5) {
  display: none;
}

    .msh-overview-head {
      grid-template-columns: minmax(0, 1fr) auto !important;
      align-items: center !important;
    }
  }

  @media (max-width: 420px) {
    .msh-overview-head {
      grid-template-columns: 1fr;
    }
  }
`}</style>
    <div className="msh-page-wrap">
      <div className="msh-topbar">
<div className="msh-top-left">
  <Link
    href="/"
    style={{
      display: "inline-flex",
      alignItems: "center",
      textDecoration: "none",
      flex: "0 0 auto",
      marginRight: isMobile ? 4 : 8,
    }}
  >
    <img
      src="/logo.png"
      alt="MyStockHarbor"
      style={{
        height: isMobile ? 56 : 78,
        width: "auto",
        objectFit: "contain",
        display: "block",
      }}
    />
  </Link>

  <div style={{ paddingTop: isMobile ? 2 : 0 }}>
    <div style={{ fontWeight: 900, fontSize: isMobile ? 14 : 16 }}>Learn charts. Discover stocks. Trade smarter.</div>
    <div style={{ color: COLORS.mutedFg, fontSize: 13, fontWeight: 700 }}>Version 1</div>
  </div>
</div>

        <div className="msh-top-right">
<SmallNavLink href="/learn">Learn</SmallNavLink>
<SmallNavLink href="/platforms">Platforms</SmallNavLink>
<SmallNavLink href="/pickers">Stock Pickers</SmallNavLink>
<SmallNavLink href="/utilities">Calculators</SmallNavLink>
          <button
  type="button"
  onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
  className="msh-top-nav-btn"
  style={{
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 42,
    padding: "9px 13px",
    borderRadius: 14,
    border: `1px solid ${COLORS.controlBorder}`,
    background: COLORS.controlBg,
    color: COLORS.controlFg,
    fontWeight: 900,
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: COLORS.isDark
      ? "0 8px 18px rgba(0,0,0,0.20)"
      : "0 8px 18px rgba(0,0,0,0.06)",
    transition:
      "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
  }}
>
  {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
</button>

        </div>
      </div>

      <div className="msh-mobile-nav">
<SmallNavLink href="/learn">Learn</SmallNavLink>
<SmallNavLink href="/platforms">Platforms</SmallNavLink>
<SmallNavLink href="/pickers">Stock Pickers</SmallNavLink>
<SmallNavLink href="/utilities">Calculators</SmallNavLink>

        <button
          type="button"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="msh-top-nav-btn"
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 38,
            minWidth: 38,
            padding: "7px 10px",
            borderRadius: 12,
            border: `1px solid ${COLORS.controlBorder}`,
            background: COLORS.controlBg,
            color: COLORS.controlFg,
            fontWeight: 900,
            fontSize: 16,
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: COLORS.isDark
              ? "0 8px 18px rgba(0,0,0,0.20)"
              : "0 8px 18px rgba(0,0,0,0.06)",
            transition:
              "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
          }}
        >
          {theme === "dark" ? "🌙" : "☀️"}
        </button>
      </div>

      <div className="msh-toolbar-grid">
        <div style={{ position: "relative", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Search Any Stock</div>

<input
  value={query}
  onChange={(e) => {
    setQuery(e.target.value);
    setOpen(true);
  }}
  onFocus={() => setOpen(true)}
onKeyDown={(e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    chooseSymbol(query || symbol);
  }
}}
  placeholder="🔎 Search ANY ticker or company"
  style={{
    width: "100%",
    padding: "14px 16px",
    borderRadius: 16,
    border: `1px solid ${COLORS.controlBorder}`,
    background: COLORS.controlBgSolid,
    color: COLORS.controlFg,
    outline: "none",
    fontSize: 15,
    fontWeight: 700,
  }}
/>

          {open && results.length > 0 ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                left: 0,
                right: 0,
                zIndex: 20,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 16,
                background: COLORS.cardBg,
                boxShadow: COLORS.isDark ? "0 18px 34px rgba(0,0,0,0.40)" : "0 18px 34px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              {results.slice(0, 8).map((r) => (
                <button
                  key={`${r.symbol}-${r.exchange}`}
                  type="button"
                  onClick={() => chooseSymbol(r.symbol)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    borderBottom: `1px solid ${COLORS.border}`,
                    background: COLORS.cardBg,
                    color: COLORS.cardFg,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 900 }}>{r.symbol}</div>
                  <div style={{ fontSize: 13, color: COLORS.mutedFg }}>
                    {r.name} {r.exchange ? `• ${r.exchange}` : ""}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Stock Pickers</div>

          <button
            type="button"
            onClick={() => router.push("/pickers")}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 16,
              border: `1px solid rgba(59,130,246,0.45)`,
              background: COLORS.isDark
                ? "linear-gradient(135deg, rgba(37,99,235,0.26), rgba(29,78,216,0.16))"
                : "linear-gradient(135deg, rgba(37,99,235,0.14), rgba(29,78,216,0.08))",
              color: COLORS.controlFg,
              fontWeight: 950,
              fontSize: 15,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            🔎 Find Your Next Stock →
          </button>
        </div>

      </div>

      {err ? (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            borderRadius: 14,
            border: `1px solid rgba(239,68,68,0.35)`,
            background: COLORS.isDark ? "rgba(127,29,29,0.28)" : "rgba(254,226,226,0.75)",
            color: COLORS.cardFg,
            fontWeight: 800,
          }}
        >
          {err}
        </div>
      ) : null}

<div className="msh-main-grid">
  <div className="msh-left-stack msh-mobile-secondary">
    {indicator === "None" ? <OverviewPanel /> : <IndicatorPanel />}
    <BreakdownPanel />
  </div>

  <div className="msh-mobile-primary">
    <ChartPanel />
  </div>
</div>

      <div className="msh-lower-grid">
        <BenchmarksPanel />
        <NewsPanel />
      </div>

      {expanded ? (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1280px, 100%)",
              maxHeight: "92vh",
              overflow: "auto",
              borderRadius: 20,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.cardBg,
              boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                padding: "14px 16px",
                borderBottom: `1px solid ${COLORS.border}`,
              }}
            >
              <div style={{ fontWeight: 900 }}>Expanded Chart ({currentIndicatorName})</div>

              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.controlBorder}`,
                  background: COLORS.controlBg,
                  color: COLORS.controlFg,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 16 }}>
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
                height={isMobile ? 280 : 520}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  </main>
);
}
