"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PriceChart, { type Overlay } from "./PriceChart";
import { detectDivergenceFromHistory } from "../../lib/ta/divergence";

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

type ChartInterval = "d" | "w" | "m";

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

type InternalNewsCard = {
  title: string;
  source: string | null;
  pubDate: string | null;
  summary: string;
  whyItMatters: string;
  debugAiUsed: 0 | 1;
};

type NewsPayload = {
  symbol: string;
  companyName: string;
  isInvalidTicker: boolean;
  trend: string;
  newsScoreLabel: string;
  newsScoreValue: number;
  cards: InternalNewsCard[];
  ctaHref: string;
};

type CachedSymbolData = {
  quote: Quote | null;
  history: Point[];
};

type DivergenceState = "bullish" | "bearish" | "none";

type OverviewItem = {
  key: string;
  label: string;
  tone: "green" | "yellow" | "orange" | "red" | "muted";
  valueText: string;
  severity: number;
  order: number;
};

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
  if (!values.length) return out;

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
    if (typeof f !== "number" || !Number.isFinite(f)) return null;
    if (typeof s !== "number" || !Number.isFinite(s)) return null;
    return f - s;
  });

  const sig: (number | null)[] = Array(values.length).fill(null);
  const hist: (number | null)[] = Array(values.length).fill(null);

  const validMacd: { index: number; value: number }[] = [];
  for (let i = 0; i < line.length; i++) {
    const v = line[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      validMacd.push({ index: i, value: v });
    }
  }

  if (validMacd.length < signal) {
    return { line, signal: sig, hist };
  }

  let signalSeed = 0;
  for (let i = 0; i < signal; i++) {
    signalSeed += validMacd[i].value;
  }

  let prevSignal = signalSeed / signal;
  sig[validMacd[signal - 1].index] = prevSignal;

  const k = 2 / (signal + 1);

  for (let i = signal; i < validMacd.length; i++) {
    prevSignal = validMacd[i].value * k + prevSignal * (1 - k);
    sig[validMacd[i].index] = prevSignal;
  }

  for (let i = 0; i < line.length; i++) {
    const l = line[i];
    const s = sig[i];
    if (typeof l === "number" && Number.isFinite(l) && typeof s === "number" && Number.isFinite(s)) {
      hist[i] = l - s;
    }
  }

  return { line, signal: sig, hist };
}

function vwma(values: number[], volumes: (number | undefined)[], window = 20): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) continue;

    let pvSum = 0;
    let vSum = 0;

    for (let j = i - window + 1; j <= i; j++) {
      const price = values[j];
      const volume = volumes[j];

      if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        typeof volume !== "number" ||
        !Number.isFinite(volume) ||
        volume <= 0
      ) {
        continue;
      }

      pvSum += price * volume;
      vSum += volume;
    }

    out[i] = vSum > 0 ? pvSum / vSum : null;
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

  const d = movingAverage(
    k.map((v) => (typeof v === "number" ? v : 0)),
    dPeriod
  ).map((v, i) => (k[i] == null ? null : v));

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

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
}

/* ----------------------------- helpers ----------------------------- */

function divStateForIndicator(
  div: ReturnType<typeof detectDivergenceFromHistory> | null,
  which: "rsi" | "macd"
): DivergenceState {
  if (!div) return "none";
  if (which === "rsi" && !div.hasRsi) return "none";
  if (which === "macd" && !div.hasMacd) return "none";
  return div.kind;
}

function divergenceLabel(state: DivergenceState) {
  if (state === "bullish") return "Bullish";
  if (state === "bearish") return "Bearish";
  return "—";
}

function divergenceTone(state: DivergenceState): OverviewItem["tone"] {
  if (state === "bullish") return "green";
  if (state === "bearish") return "red";
  return "muted";
}

function toneToColor(tone: OverviewItem["tone"], isDark: boolean) {
  if (tone === "green") return isDark ? "#22c55e" : "#16a34a";
  if (tone === "yellow") return isDark ? "#eab308" : "#ca8a04";
  if (tone === "orange") return isDark ? "#fb923c" : "#ea580c";
  if (tone === "red") return isDark ? "#ef4444" : "#dc2626";
  return isDark ? "rgba(241,245,249,0.45)" : "rgba(11,18,32,0.45)";
}

function toneRank(tone: OverviewItem["tone"]) {
  if (tone === "red") return 4;
  if (tone === "orange") return 3;
  if (tone === "yellow") return 2;
  if (tone === "green") return 1;
  return 0;
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
                border: isDark
                  ? "1px solid rgba(255,255,255,0.14)"
                  : "1px solid rgba(0,0,0,0.10)",
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

function formatMaybeNumber(v: unknown, digits = 2) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function formatPctFromBase(last: number | null, base: number | null) {
  if (
    typeof last !== "number" ||
    typeof base !== "number" ||
    !Number.isFinite(last) ||
    !Number.isFinite(base) ||
    base === 0
  ) {
    return null;
  }
  return ((last - base) / base) * 100;
}

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
      details.push({ name: "VWMA dist", state: "oversold" });
} else if (pct >= 0.02) {
  overbought++;
  details.push({ name: "VWMA dist", state: "overbought" });
} else {
      details.push({ name: "VWMA dist", state: "neutral" });
    }
} else {
  details.push({ name: "VWMA dist", state: "na" });
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

  return {
    total: 6,
    flagged: oversold + overbought,
    oversold,
    overbought,
    details,
  };
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

type TimeframePreset = {
  label: string;
  interval: ChartInterval;
  fetchBars: number;
  defaultVisibleBars: number;
};

const TIMEFRAMES: TimeframePreset[] = [
  { label: "D", interval: "d", fetchBars: 2600, defaultVisibleBars: 75 },
  { label: "W", interval: "w", fetchBars: 2600, defaultVisibleBars: 75 },
  { label: "M", interval: "m", fetchBars: 360, defaultVisibleBars: 75 },
];

const PRICE_OVERLAY_OPTIONS: Overlay[] = [
  "MA50",
  "MA200",
  "EMA20",
   "VWMA(20)",
  "Bollinger(20,2)",
];

const LOWER_OVERLAY_OPTIONS: Overlay[] = [
  "RSI(14)",
  "MACD(12,26,9)",
  "Stochastic(14,3)",
  "ATR(14)",
  "Volume",
];

function isLowerOverlay(v: Overlay) {
  return LOWER_OVERLAY_OPTIONS.includes(v);
}

/* ----------------------------- component ----------------------------- */

export default function DashboardClient({ defaultSymbol = "SPY" }: { defaultSymbol?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [symbol, setSymbol] = useState(() => {
    if (typeof window === "undefined") return defaultSymbol;
    const saved = window.localStorage.getItem("msh_last_symbol");
    return saved && saved.trim() ? saved.trim().toUpperCase() : defaultSymbol;
  });

  const [symbolName, setSymbolName] = useState("");
  const [activeTimeframe, setActiveTimeframe] = useState("D");
  const [visibleBars, setVisibleBars] = useState(75);
  const [windowOffset, setWindowOffset] = useState(0);
  const [chartInterval, setChartInterval] = useState<ChartInterval>("d");
  useEffect(() => {
  if (symbolName.trim()) return;

  const fallback = PRESET_TICKERS.find(
    (x) => x.symbol.toUpperCase() === symbol.toUpperCase()
  );

  if (fallback?.name) {
    setSymbolName(fallback.name);
  }
}, [symbol, symbolName]);

  const [indicator, setIndicator] = useState<Overlay>("None");
  const [selectedIndicators, setSelectedIndicators] = useState<Overlay[]>([]);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const indicatorMenuRef = useRef<HTMLDivElement | null>(null);
  const chartSectionRef = useRef<HTMLDivElement | null>(null);
  const [highlightChart, setHighlightChart] = useState(false);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [historyAll, setHistoryAll] = useState<Point[]>([]);
  const [symbolCache, setSymbolCache] = useState<Record<string, CachedSymbolData>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState(symbol);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);

  const [bench, setBench] = useState<BenchPayload | null>(null);
  const [news, setNews] = useState<NewsPayload | null>(null);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const selectedTimeframe = useMemo(
    () => TIMEFRAMES.find((t) => t.label === activeTimeframe) ?? TIMEFRAMES[0],
    [activeTimeframe]
  );

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
      yellowBorder: isDark ? "rgba(234,179,8,0.38)" : "rgba(202,138,4,0.35)",
      yellowBg: isDark ? "rgba(234,179,8,0.10)" : "rgba(250,204,21,0.14)",
      yellowText: isDark ? "#fde68a" : "#854d0e",
    };
  }, [theme]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setChartInterval(selectedTimeframe.interval);
    setVisibleBars(selectedTimeframe.defaultVisibleBars);
    setWindowOffset(0);
  }, [symbol, selectedTimeframe]);

  useEffect(() => {
    const urlSymbol = searchParams.get("symbol");
    const cleaned = urlSymbol ? urlSymbol.trim().toUpperCase() : "";
    if (!cleaned) return;

    const urlTf = (searchParams.get("tf") || "").trim().toUpperCase();
    const urlIndicator = (searchParams.get("indicator") || "").trim();

    setSymbol(cleaned);
    setQuery(cleaned);
    setResults([]);
    setOpen(false);

    if (urlTf === "D" || urlTf === "W" || urlTf === "M") {
      setActiveTimeframe(urlTf);
    } else {
      setActiveTimeframe("D");
    }

    if (urlIndicator === "MA200") {
      setSelectedIndicators(["MA200"]);
      setIndicator("MA200");
    } else if (urlIndicator === "RSI(14)") {
      setSelectedIndicators(["RSI(14)"]);
      setIndicator("RSI(14)");
    } else if (urlIndicator === "MACD(12,26,9)") {
      setSelectedIndicators(["MACD(12,26,9)"]);
      setIndicator("MACD(12,26,9)");
    } else {
      setSelectedIndicators([]);
      setIndicator("None");
    }

    setIndicatorMenuOpen(false);
    setWindowOffset(0);
  }, [searchParams]);

  useEffect(() => {
    if (!symbol.trim()) return;
    window.localStorage.setItem("msh_last_symbol", symbol.trim().toUpperCase());
  }, [symbol]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!indicatorMenuRef.current) return;
      if (!indicatorMenuRef.current.contains(e.target as Node)) {
        setIndicatorMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const preset = PRESET_TICKERS.find((t) => t.symbol === symbol);
    if (preset) {
      setSymbolName(preset.name);
      return;
    }

    let cancelled = false;

    async function resolve() {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(symbol)}`);
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
    let cancelled = false;

    async function load() {
      const cacheKey = `${symbol}:${activeTimeframe}:${selectedTimeframe.fetchBars}:${selectedTimeframe.interval}`;
      const cacheHit = symbolCache[cacheKey];
      if (cacheHit) {
        setErr(null);
        setQuote(cacheHit.quote);
        setHistoryAll(cacheHit.history);
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);

      try {
     const historyDays = selectedTimeframe.fetchBars;

const [qRes, hRes] = await Promise.all([
  fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
  fetch(
    `/api/history?symbol=${encodeURIComponent(symbol)}&days=${historyDays}&interval=${chartInterval}`
  ),
]);

        if (!qRes.ok) throw new Error("Quote fetch failed");
        if (!hRes.ok) throw new Error("History fetch failed");

        const q = (await qRes.json()) as Quote;
        const h = (await hRes.json()) as { points: any[] };

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

        setSymbolCache((prev) => ({
          ...prev,
          [cacheKey]: {
            quote: q,
            history: pts,
          },
        }));
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
  }, [symbol, activeTimeframe, selectedTimeframe, chartInterval, symbolCache]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();

    if (!q) {
      setResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results: SymbolResult[] };
        if (cancelled) return;
        const rows = Array.isArray(data.results) ? data.results : [];
const cleanedQuery = q.toUpperCase();

const sortedRows = [...rows].sort((a, b) => {
  const aSymbol = a.symbol.toUpperCase();
  const bSymbol = b.symbol.toUpperCase();

  if (aSymbol === cleanedQuery && bSymbol !== cleanedQuery) return -1;
  if (bSymbol === cleanedQuery && aSymbol !== cleanedQuery) return 1;

  if (aSymbol.startsWith(cleanedQuery) && !bSymbol.startsWith(cleanedQuery)) return -1;
  if (bSymbol.startsWith(cleanedQuery) && !aSymbol.startsWith(cleanedQuery)) return 1;

  return aSymbol.localeCompare(bSymbol);
});

setResults(sortedRows);
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
        const res = await fetch("/api/benchmarks");
        if (!res.ok) throw new Error("Benchmarks API failed");

        const raw = (await res.json()) as any;

        const safe: BenchPayload = {
          updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
          scope: typeof raw?.scope === "string" ? raw.scope : "Benchmarks",
          items: Array.isArray(raw?.items) ? raw.items : [],
        };

        if (!cancelled) setBench(safe);
      } catch {
        if (!cancelled) {
          setBench({
            updatedAt: new Date().toISOString(),
            scope: "Benchmarks",
            items: [],
          });
        }
      }
    }

    loadBench();
    return () => {
      cancelled = true;
    };
  }, []);
  
useEffect(() => {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (hash !== "#chart") return;
  if (!historyAll.length) return;

  const t = window.setTimeout(() => {
    chartSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    // trigger highlight
    setHighlightChart(true);

    // remove highlight after short delay
    setTimeout(() => setHighlightChart(false), 1200);
  }, 80);

  return () => window.clearTimeout(t);
}, [historyAll, symbol]);


  useEffect(() => {
    let cancelled = false;

    async function loadNews() {
      try {
        const res = await fetch(`/api/internal-news?symbol=${encodeURIComponent(symbol)}`);

        if (!res.ok) throw new Error("Internal news API failed");

        const data = (await res.json()) as NewsPayload;

        if (!cancelled) {
          setNews(data);
        }
      } catch {
        if (!cancelled) {
          setNews(null);
        }
      }
    }

    loadNews();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const totalPoints = historyAll.length;
  const win = Math.max(visibleBars, 2);
  const maxOffset = Math.max(totalPoints - win, 0);
  const offset = Math.min(Math.max(windowOffset, 0), maxOffset);

  const { displayStart, displayEnd, displayedHistory } = useMemo(() => {
    if (!historyAll.length) {
      return {
        displayStart: 0,
        displayEnd: 0,
        displayedHistory: [] as Point[],
      };
    }

    const end = totalPoints - offset;
    const start = Math.max(0, end - win);
    const slice = historyAll.slice(start, end);

    if (slice.length >= 2) {
      return {
        displayStart: start,
        displayEnd: end,
        displayedHistory: slice,
      };
    }

    return {
      displayStart: Math.max(totalPoints - 2, 0),
      displayEnd: totalPoints,
      displayedHistory: historyAll.slice(-2),
    };
  }, [historyAll, totalPoints, offset, win]);

  const closesAll = useMemo(() => historyAll.map((p) => p.close), [historyAll]);

  const ma50Full = useMemo(() => movingAverage(closesAll, 50), [closesAll]);
  const ma200Full = useMemo(() => movingAverage(closesAll, 200), [closesAll]);
  const ema20Full = useMemo(() => ema(closesAll, 20), [closesAll]);
  const bbFull = useMemo(() => bollinger(closesAll, 20, 2), [closesAll]);
  const rsi14Full = useMemo(() => rsiWilder(closesAll, 14), [closesAll]);
  const macdFull = useMemo(() => macd(closesAll, 12, 26, 9), [closesAll]);
  const vwma20Full = useMemo(
    () => vwma(historyAll.map((p) => p.close), historyAll.map((p) => p.volume), 20),
    [historyAll]
  );
  const stochFull = useMemo(() => stochastic(historyAll, 14, 3), [historyAll]);
  const atr14Full = useMemo(() => atr(historyAll, 14), [historyAll]);

  const ma50 = useMemo(
    () => ma50Full.slice(displayStart, displayEnd),
    [ma50Full, displayStart, displayEnd]
  );
  const ma200 = useMemo(
    () => ma200Full.slice(displayStart, displayEnd),
    [ma200Full, displayStart, displayEnd]
  );
  const ema20Arr = useMemo(
    () => ema20Full.slice(displayStart, displayEnd),
    [ema20Full, displayStart, displayEnd]
  );
  const bollUpper = useMemo(
    () => bbFull.upper.slice(displayStart, displayEnd),
    [bbFull, displayStart, displayEnd]
  );
  const bollMid = useMemo(
    () => bbFull.mid.slice(displayStart, displayEnd),
    [bbFull, displayStart, displayEnd]
  );
  const bollLower = useMemo(
    () => bbFull.lower.slice(displayStart, displayEnd),
    [bbFull, displayStart, displayEnd]
  );
  const rsi14Arr = useMemo(
    () => rsi14Full.slice(displayStart, displayEnd),
    [rsi14Full, displayStart, displayEnd]
  );
  const macdLine = useMemo(
    () => macdFull.line.slice(displayStart, displayEnd),
    [macdFull, displayStart, displayEnd]
  );
  const macdSignal = useMemo(
    () => macdFull.signal.slice(displayStart, displayEnd),
    [macdFull, displayStart, displayEnd]
  );
  const macdHist = useMemo(
    () => macdFull.hist.slice(displayStart, displayEnd),
    [macdFull, displayStart, displayEnd]
  );
  const vwma20Arr = useMemo(
    () => vwma20Full.slice(displayStart, displayEnd),
    [vwma20Full, displayStart, displayEnd]
  );
  const stochK = useMemo(
    () => stochFull.k.slice(displayStart, displayEnd),
    [stochFull, displayStart, displayEnd]
  );
  const stochD = useMemo(
    () => stochFull.d.slice(displayStart, displayEnd),
    [stochFull, displayStart, displayEnd]
  );
  const atr14Arr = useMemo(
    () => atr14Full.slice(displayStart, displayEnd),
    [atr14Full, displayStart, displayEnd]
  );

  const volumeFull = useMemo(
    () =>
      historyAll.map((p) =>
        typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
      ),
    [historyAll]
  );
  const volSma20Full = useMemo(() => smaNullable(volumeFull, 20), [volumeFull]);
  const volumeArr = useMemo(
    () => volumeFull.slice(displayStart, displayEnd),
    [volumeFull, displayStart, displayEnd]
  );
  const volSma20Arr = useMemo(
    () => volSma20Full.slice(displayStart, displayEnd),
    [volSma20Full, displayStart, displayEnd]
  );
  const atrSma20Full = useMemo(() => smaNullable(atr14Full, 20), [atr14Full]);
  const atrSma20Arr = useMemo(
    () => atrSma20Full.slice(displayStart, displayEnd),
    [atrSma20Full, displayStart, displayEnd]
  );

  const lastClose = displayedHistory.length ? displayedHistory[displayedHistory.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);

  const ma50Pct = formatPctFromBase(lastClose, typeof lastMA50 === "number" ? lastMA50 : null);
  const ma200Pct = formatPctFromBase(lastClose, typeof lastMA200 === "number" ? lastMA200 : null);
  const ema20Pct = formatPctFromBase(lastClose, lastNum(ema20Arr));
   const vwma20Pct = formatPctFromBase(lastClose, lastNum(vwma20Arr));
  const bbUpperLast = lastNum(bollUpper);
  const bbLowerLast = lastNum(bollLower);
  const rsiLast = lastNum(rsi14Arr);
  const stochLast = lastNum(stochK);
  const macdHistLast = lastNum(macdHist);
  const atrLast = lastNum(atr14Arr);
  const atrSmaLast = lastNum(atrSma20Arr);
  const volumeLast = lastNum(volumeArr);
  const volumeSmaLast = lastNum(volSma20Arr);

  const trendScore = useMemo(
    () =>
      buildTrendScore({
        lastClose,
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
        ma200: typeof lastMA200 === "number" ? lastMA200 : null,
        macdHist: lastNum(macdHist),
      }),
    [lastClose, lastMA50, lastMA200, macdHist]
  );

  const stretchScore = useMemo(
    () =>
      buildStretchScore({
        lastClose,
        rsi14: lastNum(rsi14Arr),
        stochK: lastNum(stochK),
        bollUpper: lastNum(bollUpper),
        bollLower: lastNum(bollLower),
        ema20: lastNum(ema20Arr),
         vwap: lastNum(vwma20Arr),
        ma50: typeof lastMA50 === "number" ? lastMA50 : null,
      }),
        [lastClose, rsi14Arr, stochK, bollUpper, bollLower, ema20Arr, vwma20Arr, lastMA50]
  );

  const divergence = useMemo(() => {
    const div = detectDivergenceFromHistory(historyAll, {
      lookbackBars: 60,
      leftRight: 2,
      minPriceSwingPct: 1.2,
      minRsiSwing: 4,
      macdStdMult: 0.35,
    });

    return {
      div,
      rsi: divStateForIndicator(div, "rsi"),
      macd: divStateForIndicator(div, "macd"),
    };
  }, [historyAll]);

  const overviewMeta = useMemo(() => {
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
  }, [stretchScore, COLORS.isDark, lastClose, lastMA50, lastMA200, atr14Arr, atrSma20Arr]);

  const customMode = selectedIndicators.length > 0;

  function chartIndicatorLabel(values: Overlay[]) {
    if (!values.length) return "Overview";
    return values.join(", ");
  }

function chooseSymbol(s: string, name?: string) {
  const cleaned = s.trim().toUpperCase();
  if (!cleaned) return;

  setSymbol(cleaned);
  setSymbolName(name?.trim() ? name.trim() : "");
  setQuery(cleaned);
  setResults([]);
  setOpen(false);
  setActiveTimeframe("D");
  setSelectedIndicators([]);
  setIndicator("None");
  setWindowOffset(0);
}

  function clearIndicatorSelection() {
    setSelectedIndicators([]);
    setIndicator("None");
    setWindowOffset(0);
    setIndicatorMenuOpen(false);
  }

  function getNextFocusedIndicator(values: Overlay[]) {
    const activeLower = values.find((v) => isLowerOverlay(v));
    if (activeLower) return activeLower;
    if (values.length) return values[values.length - 1];
    return "None" as Overlay;
  }

  function toggleIndicatorSelection(next: Overlay) {
    if (next === "None") {
      clearIndicatorSelection();
      return;
    }

    setSelectedIndicators((prev) => {
      const alreadyOn = prev.includes(next);
      let nextValues: Overlay[];

      if (isLowerOverlay(next)) {
        nextValues = alreadyOn
          ? prev.filter((v) => v !== next)
          : [...prev.filter((v) => !isLowerOverlay(v)), next];
      } else {
        nextValues = alreadyOn ? prev.filter((v) => v !== next) : [...prev, next];
      }

      setIndicator(getNextFocusedIndicator(nextValues));
      return nextValues;
    });

    setWindowOffset(0);
  }

  const chartIndicatorName = chartIndicatorLabel(selectedIndicators);

  const chartSummaryText = useMemo(() => {
    if (!customMode) {
      let trendText = "mixed structure";

      if (
        typeof lastClose === "number" &&
        typeof lastMA50 === "number" &&
        typeof lastMA200 === "number"
      ) {
        if (lastClose > lastMA50 && lastMA50 > lastMA200) {
          trendText = "stronger bullish structure";
        } else if (lastClose < lastMA50 && lastMA50 < lastMA200) {
          trendText = "weaker bearish structure";
        } else if (lastClose > lastMA50) {
          trendText = "mildly constructive structure";
        } else if (lastClose < lastMA50) {
          trendText = "softer short-term structure";
        }
      }

      let stretchText = "limited stretch signals";
      if (stretchScore.overbought >= 3) {
        stretchText = "several overbought-style stretch signals";
      } else if (stretchScore.oversold >= 3) {
        stretchText = "several oversold-style stretch signals";
      } else if (stretchScore.flagged >= 2) {
        stretchText = "some mixed stretch signals";
      }

      let momentumText = "";
      if (typeof rsiLast === "number") {
        if (rsiLast >= 70) momentumText = ` RSI is ${rsiLast.toFixed(1)} and overbought.`;
        else if (rsiLast <= 30) momentumText = ` RSI is ${rsiLast.toFixed(1)} and oversold.`;
        else momentumText = ` RSI is ${rsiLast.toFixed(1)} and neutral.`;
      }

      let divergenceText = "";
      if (divergence.rsi === "bullish" || divergence.macd === "bullish") {
        divergenceText = " Bullish divergence is present.";
      } else if (divergence.rsi === "bearish" || divergence.macd === "bearish") {
        divergenceText = " Bearish divergence is present.";
      }

      return `${symbol} is showing ${trendText} with ${stretchText}.${momentumText}${divergenceText}`;
    }

    const parts: string[] = [];

    selectedIndicators.forEach((ind) => {
      if (ind === "MA50") {
        parts.push(
          ma50Pct == null
            ? "MA50 needs more data."
            : `Price is ${ma50Pct >= 0 ? `${ma50Pct.toFixed(1)}% above` : `${Math.abs(ma50Pct).toFixed(1)}% below`} MA50.`
        );
      }

      if (ind === "MA200") {
        parts.push(
          ma200Pct == null
            ? "MA200 needs more data."
            : `Price is ${ma200Pct >= 0 ? `${ma200Pct.toFixed(1)}% above` : `${Math.abs(ma200Pct).toFixed(1)}% below`} MA200.`
        );
      }

      if (ind === "EMA20") {
        parts.push(
          ema20Pct == null
            ? "EMA20 needs more data."
            : `Price is ${ema20Pct >= 0 ? `${ema20Pct.toFixed(1)}% above` : `${Math.abs(ema20Pct).toFixed(1)}% below`} EMA20.`
        );
      }

      if (ind === "VWMA(20)") {
        parts.push(
          vwma20Pct == null
            ? "VWMA(20) needs more data."
            : `Price is ${vwma20Pct >= 0 ? `${vwma20Pct.toFixed(1)}% above` : `${Math.abs(vwma20Pct).toFixed(1)}% below`} VWMA(20).`
        );
      }

      if (ind === "Bollinger(20,2)") {
        if (
          typeof lastClose === "number" &&
          typeof bbUpperLast === "number" &&
          typeof bbLowerLast === "number"
        ) {
          if (lastClose > bbUpperLast) parts.push("Price is above the upper Bollinger Band.");
          else if (lastClose < bbLowerLast) parts.push("Price is below the lower Bollinger Band.");
          else parts.push("Price is trading inside the Bollinger Bands.");
        } else {
          parts.push("Bollinger Bands need more data.");
        }
      }

      if (ind === "RSI(14)") {
        if (typeof rsiLast === "number") {
          if (rsiLast >= 70) parts.push(`RSI is ${rsiLast.toFixed(1)} and overbought.`);
          else if (rsiLast <= 30) parts.push(`RSI is ${rsiLast.toFixed(1)} and oversold.`);
          else parts.push(`RSI is ${rsiLast.toFixed(1)} and neutral.`);
        } else {
          parts.push("RSI needs more data.");
        }
      }

      if (ind === "MACD(12,26,9)") {
        if (typeof macdHistLast === "number") {
          if (macdHistLast > 0) parts.push("MACD momentum is bullish.");
          else if (macdHistLast < 0) parts.push("MACD momentum is bearish.");
          else parts.push("MACD momentum is flat.");
        } else {
          parts.push("MACD needs more data.");
        }
      }

      if (ind === "Stochastic(14,3)") {
        if (typeof stochLast === "number") {
          if (stochLast >= 80) parts.push(`Stochastic is ${stochLast.toFixed(1)} and overbought.`);
          else if (stochLast <= 20) parts.push(`Stochastic is ${stochLast.toFixed(1)} and oversold.`);
          else parts.push(`Stochastic is ${stochLast.toFixed(1)} and neutral.`);
        } else {
          parts.push("Stochastic needs more data.");
        }
      }

      if (ind === "ATR(14)") {
        if (typeof atrLast === "number" && typeof atrSmaLast === "number" && atrSmaLast > 0) {
          const ratio = atrLast / atrSmaLast;
          parts.push(`ATR is running at ${ratio.toFixed(2)}× its 20-day average.`);
        } else {
          parts.push("ATR needs more data.");
        }
      }

      if (ind === "Volume") {
        if (
          typeof volumeLast === "number" &&
          typeof volumeSmaLast === "number" &&
          volumeSmaLast > 0
        ) {
          const ratio = volumeLast / volumeSmaLast;
          parts.push(`Volume is running at ${ratio.toFixed(2)}× its 20-day average.`);
        } else {
          parts.push("Volume needs more data.");
        }
      }
    });

    return parts.length
      ? parts.join(" ")
      : "Custom indicator view is active.";
  }, [
    customMode,
    symbol,
    selectedIndicators,
    lastClose,
    lastMA50,
    lastMA200,
    ma50Pct,
    ma200Pct,
    ema20Pct,
    vwma20Pct,
    bbUpperLast,
    bbLowerLast,
    rsiLast,
    stochLast,
    macdHistLast,
    atrLast,
    atrSmaLast,
    volumeLast,
    volumeSmaLast,
    stretchScore,
    divergence,
  ]);

  const selectedBreakdownRows = useMemo(() => {
    const rows: { label: string; tone: OverviewItem["tone"]; value: string }[] = [];

    selectedIndicators.forEach((ind) => {
      if (ind === "MA50") {
        rows.push({
          label: "MA50 Distance",
          tone:
            typeof ma50Pct === "number"
              ? Math.abs(ma50Pct) >= 5
                ? "red"
                : Math.abs(ma50Pct) >= 2
                ? "orange"
                : "yellow"
              : "muted",
          value: ma50Pct == null ? "—" : `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}%`,
        });
      }

      if (ind === "MA200") {
        rows.push({
          label: "MA200 Distance",
          tone:
            typeof ma200Pct === "number"
              ? Math.abs(ma200Pct) >= 10
                ? "red"
                : Math.abs(ma200Pct) >= 4
                ? "orange"
                : "yellow"
              : "muted",
          value: ma200Pct == null ? "—" : `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}%`,
        });
      }

      if (ind === "EMA20") {
        rows.push({
          label: "EMA20 Distance",
          tone:
            typeof ema20Pct === "number"
              ? Math.abs(ema20Pct) >= 5
                ? "red"
                : Math.abs(ema20Pct) >= 2
                ? "orange"
                : "yellow"
              : "muted",
          value: ema20Pct == null ? "—" : `${ema20Pct >= 0 ? "+" : ""}${ema20Pct.toFixed(2)}%`,
        });
      }

      if (ind === "VWMA(20)") {
        rows.push({
          label: "VWMA(20) Distance",
          tone:
            typeof vwma20Pct === "number"
              ? Math.abs(vwma20Pct) >= 5
                ? "red"
                : Math.abs(vwma20Pct) >= 2
                ? "orange"
                : "yellow"
              : "muted",
          value: vwma20Pct == null ? "—" : `${vwma20Pct >= 0 ? "+" : ""}${vwma20Pct.toFixed(2)}%`,
        });
      }

      if (ind === "Bollinger(20,2)") {
        let value = "—";
        let tone: OverviewItem["tone"] = "muted";

        if (
          typeof lastClose === "number" &&
          typeof bbUpperLast === "number" &&
          typeof bbLowerLast === "number"
        ) {
          if (lastClose > bbUpperLast) {
            value = "Above upper band";
            tone = "red";
          } else if (lastClose < bbLowerLast) {
            value = "Below lower band";
            tone = "green";
          } else {
            value = "Inside bands";
            tone = "yellow";
          }
        }

        rows.push({
          label: "Bollinger",
          tone,
          value,
        });
      }

 if (ind === "RSI(14)") {
        rows.push({
          label: "RSI",
          tone:
            typeof rsiLast === "number"
              ? rsiLast >= 70
                ? "red"
                : rsiLast <= 30
                ? "green"
                : "yellow"
              : "muted",
          value: typeof rsiLast === "number" ? rsiLast.toFixed(2) : "—",
        });

        if (divergence.rsi !== "none") {
          rows.push({
            label: "RSI Div",
            tone: divergenceTone(divergence.rsi),
            value: divergenceLabel(divergence.rsi),
          });
        }
      }

      if (ind === "MACD(12,26,9)") {
        rows.push({
          label: "MACD Hist",
          tone:
            typeof macdHistLast === "number"
              ? macdHistLast > 0
                ? "green"
                : macdHistLast < 0
                ? "red"
                : "yellow"
              : "muted",
          value: typeof macdHistLast === "number" ? macdHistLast.toFixed(4) : "—",
        });

        if (divergence.macd !== "none") {
          rows.push({
            label: "MACD Div",
            tone: divergenceTone(divergence.macd),
            value: divergenceLabel(divergence.macd),
          });
        }
      }

      if (ind === "Stochastic(14,3)") {
        rows.push({
          label: "Stoch",
          tone:
            typeof stochLast === "number"
              ? stochLast >= 80
                ? "red"
                : stochLast <= 20
                ? "green"
                : "yellow"
              : "muted",
          value: typeof stochLast === "number" ? stochLast.toFixed(2) : "—",
        });
      }

      if (ind === "ATR(14)") {
        const ratio =
          typeof atrLast === "number" && typeof atrSmaLast === "number" && atrSmaLast > 0
            ? atrLast / atrSmaLast
            : null;

        rows.push({
          label: "ATR Ratio",
          tone: ratio == null ? "muted" : ratio >= 1.5 ? "orange" : "yellow",
          value: ratio == null ? "—" : `${ratio.toFixed(2)}×`,
        });
      }

      if (ind === "Volume") {
        const ratio =
          typeof volumeLast === "number" &&
          typeof volumeSmaLast === "number" &&
          volumeSmaLast > 0
            ? volumeLast / volumeSmaLast
            : null;

        rows.push({
          label: "Volume Ratio",
          tone: ratio == null ? "muted" : ratio >= 1.8 ? "orange" : "yellow",
          value: ratio == null ? "—" : `${ratio.toFixed(2)}×`,
        });
      }
    });

    return rows;
  }, [
    selectedIndicators,
    ma50Pct,
    ma200Pct,
    ema20Pct,
    vwma20Pct,
    lastClose,
    bbUpperLast,
    bbLowerLast,
    rsiLast,
    stochLast,
    macdHistLast,
    atrLast,
    atrSmaLast,
    volumeLast,
    volumeSmaLast,
    divergence,
  ]);

  const overviewItems = useMemo<OverviewItem[]>(() => {
    const items: OverviewItem[] = [];
    let order = 0;
    const push = (it: Omit<OverviewItem, "order">) => items.push({ ...it, order: order++ });

     const vwap = lastNum(vwma20Arr);
    if (typeof lastClose === "number" && typeof vwap === "number" && vwap > 0) {
      const pct = ((lastClose - vwap) / vwap) * 100;
      push({
        key: "vwap",
        label: "VWMA(20)",
        tone: pct >= 2 || pct <= -2 ? (Math.abs(pct) >= 5 ? "red" : "orange") : "yellow",
        valueText: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
        severity: Math.abs(pct),
      });
    } else {
      push({ key: "vwap", label: "VWMA(20)", tone: "muted", valueText: "—", severity: 0 });
    }

    if (typeof macdHistLast === "number") {
      push({
        key: "macd",
        label: "MACD",
        tone: macdHistLast > 0 ? "green" : macdHistLast < 0 ? "red" : "yellow",
        valueText: macdHistLast > 0 ? "Bullish" : macdHistLast < 0 ? "Bearish" : "Flat",
        severity: Math.abs(macdHistLast),
      });
    } else {
      push({ key: "macd", label: "MACD", tone: "muted", valueText: "—", severity: 0 });
    }

    if (typeof rsiLast === "number") {
      push({
        key: "rsi",
        label: "RSI",
        tone: rsiLast >= 70 ? "red" : rsiLast <= 30 ? "green" : "yellow",
        valueText: rsiLast >= 70 ? "Overbought" : rsiLast <= 30 ? "Oversold" : "Neutral",
        severity: rsiLast >= 70 ? rsiLast - 70 : rsiLast <= 30 ? 30 - rsiLast : 0,
      });
    } else {
      push({ key: "rsi", label: "RSI", tone: "muted", valueText: "—", severity: 0 });
    }

    if (typeof stochLast === "number") {
      push({
        key: "stoch",
        label: "Stoch",
        tone: stochLast >= 80 ? "red" : stochLast <= 20 ? "green" : "yellow",
        valueText: stochLast >= 80 ? "Overbought" : stochLast <= 20 ? "Oversold" : "Neutral",
        severity: stochLast >= 80 ? stochLast - 80 : stochLast <= 20 ? 20 - stochLast : 0,
      });
    } else {
      push({ key: "stoch", label: "Stoch", tone: "muted", valueText: "—", severity: 0 });
    }

    if (typeof ma200Pct === "number") {
      push({
        key: "ma200",
        label: "MA200",
        tone: Math.abs(ma200Pct) >= 5 ? "red" : Math.abs(ma200Pct) >= 2 ? "orange" : "yellow",
        valueText: `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}%`,
        severity: Math.abs(ma200Pct),
      });
    } else {
      push({ key: "ma200", label: "MA200", tone: "muted", valueText: "—", severity: 0 });
    }

    if (
      typeof volumeLast === "number" &&
      typeof volumeSmaLast === "number" &&
      volumeSmaLast > 0
    ) {
      const ratio = volumeLast / volumeSmaLast;
      push({
        key: "vol",
        label: "Volume",
        tone: ratio >= 1.8 ? "orange" : "yellow",
        valueText: ratio >= 1.8 ? `Spike ${ratio.toFixed(2)}×` : `Normal ${ratio.toFixed(2)}×`,
        severity: Math.max(0, ratio - 1),
      });
    } else {
      push({ key: "vol", label: "Volume", tone: "muted", valueText: "—", severity: 0 });
    }

    if (typeof atrLast === "number" && typeof atrSmaLast === "number" && atrSmaLast > 0) {
      const ratio = atrLast / atrSmaLast;
      push({
        key: "atr",
        label: "ATR",
        tone: ratio >= 1.5 ? "orange" : "yellow",
        valueText: ratio >= 1.5 ? `Spike ${ratio.toFixed(2)}×` : `Normal ${ratio.toFixed(2)}×`,
        severity: Math.max(0, ratio - 1),
      });
    } else {
      push({ key: "atr", label: "ATR", tone: "muted", valueText: "—", severity: 0 });
    }

    if (divergence.rsi !== "none") {
      push({
        key: "div_rsi",
        label: "RSI Div",
        tone: divergenceTone(divergence.rsi),
        valueText: divergenceLabel(divergence.rsi),
        severity: 100,
      });
    }

    if (divergence.macd !== "none") {
      push({
        key: "div_macd",
        label: "MACD Div",
        tone: divergenceTone(divergence.macd),
        valueText: divergenceLabel(divergence.macd),
        severity: 100,
      });
    }

    return items.sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      const tr = toneRank(b.tone) - toneRank(a.tone);
      if (tr !== 0) return tr;
      return a.order - b.order;
    });
  }, [
    lastClose,
    vwma20Arr,
    macdHistLast,
    rsiLast,
    stochLast,
    ma200Pct,
    volumeLast,
    volumeSmaLast,
    atrLast,
    atrSmaLast,
    divergence,
  ]);

  function chipToneColor(tone: OverviewItem["tone"]) {
    return toneToColor(tone, COLORS.isDark);
  }

  function HelpTip(props: { text: string; isDark: boolean }) {
    const [openTip, setOpenTip] = useState(false);

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
        onMouseEnter={() => setOpenTip(true)}
        onMouseLeave={() => setOpenTip(false)}
        onClick={() => setOpenTip((v) => !v)}
      >
        ?
        {openTip ? (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 10px)",
              right: 0,
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

  function SmallNavLink(props: { href: string; children: React.ReactNode }) {
    const isLearn = props.href === "/learn";
    const isPlatforms = props.href === "/platforms";
    const isPickers = props.href === "/pickers";
    const isUtilities = props.href === "/utilities";

    const icon = isLearn ? "📘" : isPlatforms ? "🏦" : isPickers ? "📊" : isUtilities ? "🧮" : "→";

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
          border: `1px solid ${
            props.active ? "rgba(96,165,250,0.95)" : COLORS.controlBorder
          }`,
          background: props.active
            ? COLORS.isDark
              ? "linear-gradient(135deg, rgba(37,99,235,0.32), rgba(59,130,246,0.18))"
              : "linear-gradient(135deg, rgba(37,99,235,0.16), rgba(59,130,246,0.10))"
            : COLORS.controlBg,
          color: props.active ? "#ffffff" : COLORS.controlFg,
          fontWeight: 900,
          fontSize: isMobile ? 13 : 14,
          cursor: "pointer",
          minWidth: isMobile ? 48 : 54,
          boxShadow: props.active
            ? COLORS.isDark
              ? "0 0 0 1px rgba(96,165,250,0.18) inset, 0 8px 18px rgba(37,99,235,0.22)"
              : "0 0 0 1px rgba(96,165,250,0.12) inset, 0 8px 18px rgba(37,99,235,0.10)"
            : "none",
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
          boxShadow: COLORS.isDark
            ? "0 14px 34px rgba(0,0,0,0.28)"
            : "0 14px 34px rgba(0,0,0,0.08)",
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

  function BreakdownHelpButton() {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <HelpTip
          text={
            customMode
              ? "This breakdown is showing the indicators you currently selected on the chart."
              : "Breakdown shows the main dashboard indicators including trend, momentum, stretch, volatility and divergence clues."
          }
          isDark={COLORS.isDark}
        />

        <Link
          href="/learn"
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

function ChartToolbar() {
  return (
    <div
      style={{
        display: "flex",
        gap: isMobile ? 6 : 8,
        alignItems: "center",
        flexWrap: "nowrap",
        overflowX: "auto",
      }}
    >
        <button
          onClick={() =>
            setWindowOffset((o) => Math.min(maxOffset, o + Math.max(1, Math.floor(win * 0.2))))
          }
          disabled={offset >= maxOffset}
          title="Pan left (older)"
          style={{
padding: isMobile ? "6px 8px" : "8px 10px",
borderRadius: isMobile ? 8 : 10,
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
          onClick={() =>
            setWindowOffset((o) => Math.max(0, o - Math.max(1, Math.floor(win * 0.2))))
          }
          disabled={offset <= 0}
          title="Pan right (newer)"
          style={{
padding: isMobile ? "6px 8px" : "8px 10px",
borderRadius: isMobile ? 8 : 10,
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
            setVisibleBars((d) => Math.max(2, Math.floor(d * 0.8)));
            setWindowOffset(0);
          }}
          title="Zoom in"
          style={{
padding: isMobile ? "6px 8px" : "8px 10px",
borderRadius: isMobile ? 8 : 10,
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
            setVisibleBars((d) => Math.min(Math.max(2, totalPoints || d), Math.ceil(d * 1.25)));
            setWindowOffset(0);
          }}
          title="Zoom out"
          style={{
padding: isMobile ? "6px 8px" : "8px 10px",
borderRadius: isMobile ? 8 : 10,
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
    padding: isMobile ? "6px 8px" : "8px 10px",
    borderRadius: isMobile ? 8 : 10,
    border: `1px solid ${COLORS.controlBorder}`,
    background: COLORS.controlBg,
    color: COLORS.mutedFg,
    fontSize: isMobile ? 11 : 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
  }}
>
  {Math.min(win, totalPoints)} bars
</div>

        <button
          onClick={() => {
            setVisibleBars(Math.max(totalPoints, 2));
            setWindowOffset(0);
          }}
          title="Show full chart"
          style={{
padding: isMobile ? "6px 8px" : "8px 10px",
borderRadius: isMobile ? 8 : 10,
            border: `1px solid ${COLORS.controlBorder}`,
            background: COLORS.controlBg,
            color: COLORS.controlFg,
            cursor: "pointer",
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
       MAX
        </button>

        <button
          onClick={() => setExpanded(true)}
          title="Expand chart"
          style={{
padding: isMobile ? "6px 8px" : "8px 10px",
borderRadius: isMobile ? 8 : 10,
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

    function MobileStockAnalysisCard() {
    return (
      <SectionCard title="Stock Analysis">
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              padding: 14,
              background: COLORS.controlBg,
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 950,
                lineHeight: 1.1,
              }}
            >
              {symbol} Stock Analysis
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 14,
                  padding: 12,
                  background: COLORS.cardBg,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: COLORS.mutedFg,
                  }}
                >
                  Last price
                </div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 950 }}>
                  {quote?.price != null ? `$${quote.price.toFixed(2)}` : "—"}
                </div>
              </div>

              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 14,
                  padding: 12,
                  background: COLORS.cardBg,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: COLORS.mutedFg,
                  }}
                >
                  Trend
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 18,
                    fontWeight: 900,
                    lineHeight: 1.15,
                  }}
                >
                  {overviewMeta.trend}
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>
    );
  }

  function OverviewPanel() {
    const trendColor = toneToColor(trendToneFromScore(trendScore), COLORS.isDark);
    const stretchTone = compositeToneFromCounts(
      stretchScore.overbought,
      stretchScore.oversold,
      0
    ).tone;
    const stretchColor = toneToColor(stretchTone, COLORS.isDark);

return (
  <SectionCard
    title={`${symbol} Overview`}
    allowOverflow
    right={
      <Link
        href={`/stock/${encodeURIComponent(symbol)}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid rgba(250,204,21,0.45)",
          background:
            "linear-gradient(135deg, rgba(250,204,21,0.22), rgba(202,138,4,0.12))",
          color: "#fef3c7",
          textDecoration: "none",
          fontWeight: 800,
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        Company Overview →
      </Link>
    }
  >
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
              <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 950, lineHeight: 1.1 }}>
                {symbol}
              </div>

              <div style={{ marginTop: 4, color: COLORS.mutedFg, fontWeight: 700 }}>
                {symbolName || "—"}
              </div>


            </div>

            <div style={{ textAlign: "right", minWidth: 0 }}>
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
              <div
                style={{
                  fontSize: isMobile ? 22 : 28,
                  fontWeight: 950,
                  lineHeight: 1.05,
                }}
              >
                {quote?.price != null ? `$${quote.price.toFixed(2)}` : "—"}
              </div>
            </div>
          </div>

          <div className="msh-score-grid">
                       <div
              style={{
                border: `1px solid ${COLORS.border}`,
                borderRadius: 16,
                padding: isMobile ? 12 : 16,
                background: COLORS.controlBg,
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
                <span style={{ color: trendColor }}>●</span>
                <span>{isMobile ? "Trend" : "Trend Score"}</span>
                <HelpTip
                  text="Trend score checks price vs MA50/MA200 and MACD histogram direction."
                  isDark={COLORS.isDark}
                />
              </div>

              <div
                style={{
                  marginTop: isMobile ? 6 : 8,
                  fontSize: isMobile ? 18 : 20,
                  fontWeight: 950,
                  color: trendColor,
                }}
              >
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
                padding: isMobile ? 12 : 16,
                background: COLORS.controlBg,
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
                <span style={{ color: stretchColor }}>●</span>
                <span>{isMobile ? "Stretch" : "Stretch Score"}</span>
                <HelpTip
                 text="Stretch score checks RSI, Stoch, Bollinger, VWMA(20), EMA20 and MA50 extension."
                  isDark={COLORS.isDark}
                />
              </div>

              <div
                style={{
                  marginTop: isMobile ? 6 : 8,
                  fontSize: isMobile ? 18 : 20,
                  fontWeight: 950,
                  color: stretchColor,
                }}
              >
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

          <div
            style={{
              border: customMode ? `1px solid ${COLORS.yellowBorder}` : `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 12,
              background: customMode ? COLORS.yellowBg : COLORS.controlBg,
              lineHeight: 1.55,
              color: customMode ? COLORS.yellowText : COLORS.mutedFg,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: customMode ? COLORS.yellowText : COLORS.cardFg,
                marginBottom: 6,
              }}
            >
              {customMode ? "Selected Indicator Summary" : "Chart Summary"}
            </div>
            {chartSummaryText}
          </div>

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

  function BreakdownPanel() {
    return (
      <SectionCard
        title={customMode ? "Selected Indicators" : "Breakdown"}
        right={<BreakdownHelpButton />}
        allowOverflow
      >
        <div className="msh-breakdown-grid">
          {(customMode ? selectedBreakdownRows : overviewItems).map((item: any) => (
            <div
              key={customMode ? item.label : item.key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
                padding: "8px 10px",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                background: COLORS.controlBg,
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
                {customMode ? item.value : item.valueText}
              </div>
            </div>
          ))}
        </div>

        {customMode ? (
          <button
            type="button"
            onClick={clearIndicatorSelection}
            style={{
              marginTop: 14,
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
        ) : null}
      </SectionCard>
    );
  }

  function ChartPanel() {
    return (
      <div
        id="chart"
        ref={chartSectionRef}
        style={{ scrollMarginTop: isMobile ? 12 : 24 }}
      >
        <SectionCard
          title=""
          right={null}
          bodyStyle={{ padding: 0 }}
          style={{
            minHeight: isMobile ? "auto" : 0,
            transition: "box-shadow 0.4s ease, transform 0.4s ease",
            boxShadow: highlightChart
              ? "0 0 0 2px rgba(59,130,246,0.35), 0 10px 30px rgba(59,130,246,0.25)"
              : undefined,
          }}
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
              <div style={{ fontWeight: 900, fontSize: 15 }}>Price ({chartIndicatorName})</div>

              <div className="msh-timeframes">
                {TIMEFRAMES.map((t) => (
                  <TimeframeButton
                    key={t.label}
                    label={t.label}
                    active={activeTimeframe === t.label}
                    onClick={() => {
                      setActiveTimeframe(t.label);
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="msh-chart-head-row" style={{ marginTop: 14 }}>
              <div style={{ minWidth: 0, position: "relative" }} ref={indicatorMenuRef}>
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

                <button
                  type="button"
                  onClick={() => setIndicatorMenuOpen((v) => !v)}
                  style={{
                    marginTop: 6,
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: `1px solid ${COLORS.controlBorder}`,
                    background: COLORS.controlBgSolid,
                    color: COLORS.controlFg,
                    fontWeight: 900,
                    fontSize: 16,
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selectedIndicators.length ? chartIndicatorName : "Overview"}
                  </span>
                  <span aria-hidden="true">▾</span>
                </button>

                {indicatorMenuOpen ? (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      left: 0,
                      zIndex: 40,
                      width: isMobile ? "100%" : 320,
                      maxHeight: isMobile ? 320 : 420,
                      borderRadius: 16,
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.cardBg,
                      boxShadow: COLORS.isDark
                        ? "0 18px 34px rgba(0,0,0,0.40)"
                        : "0 18px 34px rgba(0,0,0,0.12)",
                      overflowY: "auto",
                      overflowX: "hidden",
                      WebkitOverflowScrolling: "touch",
                    }}
                  >
                    <button
                      type="button"
                      onClick={clearIndicatorSelection}
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        border: "none",
                        borderBottom: `1px solid ${COLORS.border}`,
                        background: COLORS.controlBg,
                        color: COLORS.cardFg,
                        textAlign: "left",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Clear all / Overview
                    </button>

                    <div
                      style={{
                        padding: "10px 14px 8px",
                        fontSize: 11,
                        fontWeight: 900,
                        color: COLORS.mutedFg,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      Price overlays
                    </div>

                    {PRICE_OVERLAY_OPTIONS.map((opt) => {
                      const checked = selectedIndicators.includes(opt);
                      return (
                        <label
                          key={opt}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 14px",
                            borderTop: `1px solid ${COLORS.border}`,
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleIndicatorSelection(opt)}
                          />
                          <span>{opt}</span>
                        </label>
                      );
                    })}

                    <div
                      style={{
                        padding: "10px 14px 8px",
                        fontSize: 11,
                        fontWeight: 900,
                        color: COLORS.mutedFg,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderTop: `1px solid ${COLORS.border}`,
                      }}
                    >
                      Lower indicator (1 max)
                    </div>

                    {LOWER_OVERLAY_OPTIONS.map((opt) => {
                      const checked = selectedIndicators.includes(opt);
                      return (
                        <label
                          key={opt}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 14px",
                            borderTop: `1px solid ${COLORS.border}`,
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleIndicatorSelection(opt)}
                          />
                          <span>{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <ChartToolbar />
            </div>
          </div>

          <div style={{ padding: 16 }}>
            <PriceChart
              symbol={symbol}
              data={displayedHistory}
              ma50={ma50}
              ma200={ma200}
              overlay={indicator}
              selectedIndicators={selectedIndicators}
              bollUpper={bollUpper}
              bollMid={bollMid}
              bollLower={bollLower}
              ema20={ema20Arr}
              vwma20={vwma20Arr}
              rsi14={rsi14Arr}
              macdLine={macdLine}
              macdSignal={macdSignal}
              macdHist={macdHist}
              stochK={stochK}
              stochD={stochD}
              atr14={atr14Arr}
              volume={volumeArr}
              divergence={divergence.div}
              height={isMobile ? 340 : 430}
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

              <Link
                href="/platforms"
                style={{
                  fontSize: 12,
                  color: COLORS.isDark ? "#93c5fd" : "#2563eb",
                  textDecoration: "none",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                Compare platforms →
              </Link>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

  function BenchmarksPanel() {
    return (
      <SectionCard title="Market Benchmarks">
        <div style={{ fontSize: 12, color: COLORS.mutedFg, marginBottom: 12 }}>
          Updated: {bench?.updatedAt ? new Date(bench.updatedAt).toLocaleString() : "—"} •
          Benchmarks (Stooq, free)
        </div>

        <div className="msh-bench-grid">
          {(bench?.items ?? []).map((it) => {
            const pct = typeof it.changePct === "number" ? it.changePct : null;
            const isUp = typeof pct === "number" ? pct >= 0 : null;
            const arrow = isUp == null ? "•" : isUp ? "▲" : "▼";
            const arrowColor = isUp == null ? COLORS.mutedFg : isUp ? "#22c55e" : "#ef4444";
            const pctText = pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
            const chartSymbol =
              (it.symbol || "").split(".")[0]?.toUpperCase() || it.symbol.toUpperCase();

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
                }}
              >
                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 950, fontSize: 16, lineHeight: 1.1 }}>
                        {it.label}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>{it.symbol}</div>
                    </div>

                    <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 8,
                        }}
                      >
                        <span style={{ fontWeight: 950, color: arrowColor, fontSize: 14 }}>
                          {arrow}
                        </span>
                        <span style={{ fontWeight: 950, color: arrowColor, fontSize: 20 }}>
                          {pctText}
                        </span>
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
      <SectionCard title={news ? `Latest Headlines on ${news.symbol}` : "Latest Headlines"}>
        {news ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: 1.1,
                    opacity: 0.7,
                    textTransform: "uppercase",
                  }}
                >
                  MyStockHarbor Briefing
                </div>

                <div
                  style={{
                    marginTop: 6,
                    fontSize: isMobile ? 20 : 22,
                    fontWeight: 950,
                    lineHeight: 1.1,
                  }}
                >
                  Latest headlines on {news.symbol}
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: isMobile ? 13 : 14,
                    lineHeight: 1.6,
                    opacity: 0.78,
                  }}
                >
                  {news.companyName ? `${news.companyName} · ` : ""}
                  {news.newsScoreLabel} news tone · {news.trend}
                </div>
              </div>

              <Link
                href={news.ctaHref}
                style={{
                  textDecoration: "none",
                  padding: "11px 14px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.yellowBorder}`,
                  background: COLORS.yellowBg,
                  color: COLORS.yellowText,
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                  width: isMobile ? "100%" : "auto",
                  textAlign: "center",
                }}
              >
                Open full {news.symbol} news page
              </Link>
            </div>

            {news.isInvalidTicker ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(239,68,68,0.35)",
                  background: "rgba(127,29,29,0.18)",
                  color: "#fecaca",
                  lineHeight: 1.7,
                }}
              >
                This ticker does not have enough usable market data yet, so the internal news briefing
                is showing fallback coverage only.
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "1fr"
                  : news.cards.length >= 3
                  ? "repeat(3, minmax(0, 1fr))"
                  : "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
            >
              {news.cards.map((item, idx) => (
                <div
                  key={`${item.title}-${idx}`}
                  style={{
                    padding: isMobile ? 12 : 14,
                    borderRadius: 16,
                    border: `1px solid ${COLORS.border}`,
                    background: COLORS.controlBg,
                    display: "grid",
                    gap: 10,
                    alignContent: "start",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        opacity: 0.72,
                        textTransform: "uppercase",
                      }}
                    >
                      {item.source ?? "Publisher"}
                    </div>

                    <div style={{ fontSize: 11, opacity: 0.62, whiteSpace: "nowrap" }}>
                      {item.pubDate ? new Date(item.pubDate).toLocaleDateString() : "Recent"}
                    </div>
                  </div>

                  <div
                    style={{
                      fontWeight: 900,
                      lineHeight: 1.45,
                      fontSize: isMobile ? 15 : 16,
                    }}
                  >
                    {item.title}
                  </div>

                  <div
                    style={{
                      fontSize: isMobile ? 13 : 14,
                      lineHeight: 1.7,
                      opacity: 0.86,
                    }}
                  >
                    {item.summary}
                  </div>

                  <div
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.035)",
                      border: `1px solid ${COLORS.border}`,
                      fontSize: 13,
                      lineHeight: 1.6,
                      opacity: 0.92,
                    }}
                  >
                    <span style={{ fontWeight: 900 }}>Why this matters:</span> {item.whyItMatters}
                  </div>
                </div>
              ))}
            </div>

            {!news.cards.length ? (
              <div style={{ opacity: 0.7 }}>No headline cards are available for this ticker yet.</div>
            ) : null}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 14,
            }}
          >
            <div
              style={{
                height: 12,
                borderRadius: 999,
                overflow: "hidden",
                background: "rgba(255,255,255,0.08)",
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div className="msh-news-loading-bar" />
            </div>

            <div style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.76 }}>
              Building your latest headline briefing for this ticker...
            </div>
          </div>
        )}
      </SectionCard>
    );
  }

    function InsightsPanel() {
    return (
      <SectionCard title="Latest Market Insights">
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              padding: 16,
              background: COLORS.controlBg,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: COLORS.mutedFg,
              }}
            >
              Fresh content
            </div>

            <div
              style={{
                marginTop: 8,
                fontSize: isMobile ? 20 : 22,
                fontWeight: 950,
                lineHeight: 1.15,
              }}
            >
              Read the latest stock market insights and trade ideas
            </div>

            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.65,
                color: COLORS.mutedFg,
                maxWidth: 760,
              }}
            >
              Explore chart-based market insights, trade ideas, technical analysis
              write-ups and stock breakdowns from MyStockHarbor (My Stock Harbor). 
            </div>

            <div
              style={{
                marginTop: 14,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Link
                href="/insights"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(59,130,246,0.32)",
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                  color: "#eff6ff",
                  textDecoration: "none",
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                }}
              >
                Open Insights →
              </Link>

              <Link
                href="/pickers"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(34,197,94,0.28)",
                  background:
                    "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(16,185,129,0.08))",
                  color: "#dcfce7",
                  textDecoration: "none",
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                }}
              >
                Scan Stock Pickers →
              </Link>
            </div>
          </div>
        </div>
      </SectionCard>
    );
  }

    function MobileHero() {
    return (
      <section
        style={{
          marginBottom: 14,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 20,
          background: COLORS.cardBg,
          color: COLORS.cardFg,
          boxShadow: COLORS.isDark
            ? "0 14px 34px rgba(0,0,0,0.28)"
            : "0 14px 34px rgba(0,0,0,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 14px 14px",
            background: COLORS.isDark
              ? "linear-gradient(180deg, rgba(37,99,235,0.16), rgba(11,18,32,0.00))"
              : "linear-gradient(180deg, rgba(37,99,235,0.08), rgba(255,255,255,0.00))",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none",
                flex: "0 0 auto",
              }}
            >
              <img
                src="/logo.png"
                alt="MyStockHarbor"
                style={{
                  height: 54,
                  width: "auto",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </Link>

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: COLORS.mutedFg,
                  lineHeight: 1.35,
                }}
              >
                Educational stock dashboard and market research tools.
              </div>
            </div>
          </div>

          <div
            style={{
              margin: 0,
              fontWeight: 950,
              fontSize: 28,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
            }}
          >
            Stock Analysis Tools, Stock Pickers & Market Insights
          </div>

          <div
            style={{
              marginTop: 8,
              color: COLORS.mutedFg,
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.55,
            }}
          >
            Scan the market for ideas, or search any stock to open its full analysis page and latest news.
          </div>

          <button
            type="button"
            onClick={() => router.push("/pickers")}
            className="msh-stock-picker-cta msh-mobile-hero-cta"
            style={{
              width: "100%",
              marginTop: 16,
              padding: "16px 16px",
              borderRadius: 18,
              border: `1px solid rgba(59,130,246,0.52)`,
              background: COLORS.isDark
                ? "linear-gradient(135deg, rgba(37,99,235,0.34), rgba(16,185,129,0.18))"
                : "linear-gradient(135deg, rgba(37,99,235,0.18), rgba(16,185,129,0.10))",
              color: COLORS.controlFg,
              fontWeight: 950,
              fontSize: 18,
              cursor: "pointer",
              textAlign: "left",
              transition: "transform 120ms ease, filter 120ms ease, border-color 120ms ease",
              boxShadow: COLORS.isDark
                ? "0 16px 32px rgba(37,99,235,0.22)"
                : "0 12px 24px rgba(37,99,235,0.12)",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                width: "100%",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }} aria-hidden="true">
                  🔎
                </span>
                <span>Scan for Stock Ideas</span>
              </span>

              <span
                className="msh-stock-picker-cta-arrow"
                aria-hidden="true"
                style={{ fontSize: 20, lineHeight: 1 }}
              >
                →
              </span>
            </span>
          </button>

          <div style={{ marginTop: 14 }}>
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
              placeholder="🔎 Search ticker or company"
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
                  position: "relative",
                  marginTop: 8,
                  zIndex: 20,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 16,
                  background: COLORS.cardBg,
                  boxShadow: COLORS.isDark
                    ? "0 18px 34px rgba(0,0,0,0.40)"
                    : "0 18px 34px rgba(0,0,0,0.12)",
                  overflow: "hidden",
                }}
              >
                {results.slice(0, 8).map((r) => (
                  <button
                    key={`${r.symbol}-${r.exchange}`}
                    type="button"
                    onClick={() => chooseSymbol(r.symbol, r.name)}
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
        </div>
      </section>
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "logo nav"
    "title title";
  column-gap: 18px;
  row-gap: 12px;
  margin-bottom: 18px;
  align-items: start;
}

.msh-top-left {
  grid-area: logo;
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.msh-top-heading-block {
  grid-area: title;
  min-width: 0;
}

.msh-desktop-nav-row {
  grid-area: nav;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 0;
  flex: 0 0 auto;
}

@media (max-width: 1180px) {
  .msh-topbar {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "logo"
      "nav"
      "title";
  }

  .msh-desktop-nav-row {
    justify-content: flex-start;
  }
}

        .msh-top-nav-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.05);
        }

        .msh-stock-picker-cta:hover {
          transform: translateY(-1px);
          filter: brightness(1.04);
        }

        .msh-stock-picker-cta-arrow {
          display: inline-block;
          transition: transform 140ms ease;
        }

        .msh-stock-picker-cta:hover .msh-stock-picker-cta-arrow {
          transform: translateX(4px);
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

        .msh-news-sections {
          display: grid;
          gap: 18px;
        }

        .msh-news-loading-bar {
          width: 36%;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            rgba(59,130,246,0.92),
            rgba(34,197,94,0.88)
          );
          box-shadow: 0 0 22px rgba(59,130,246,0.22);
          animation: mshNewsLoad 1.15s ease-in-out infinite;
        }

        @keyframes mshNewsLoad {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(320%);
          }
        }

        .msh-mobile-nav {
          display: none;
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
          .msh-breakdown-grid,
          .msh-bench-grid,
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
            display: none;
          }

          .msh-desktop-nav-row {
            display: none;
          }

          .msh-mobile-nav {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            margin-bottom: 14px;
            width: 100%;
          }

          .msh-mobile-nav .msh-top-nav-btn {
            width: 100%;
            min-width: 0;
            justify-content: center !important;
          }

          .msh-top-nav-btn {
            min-height: 38px !important;
            padding: 7px 10px !important;
            font-size: 13px !important;
            gap: 6px !important;
            border-radius: 12px !important;
          }

          .msh-mobile-hero-cta:hover {
            transform: translateY(-1px);
            filter: brightness(1.03);
          }

          .msh-toolbar-grid {
            display: none;
          }

          .msh-score-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .msh-bench-grid,
          .msh-breakdown-grid,
          .msh-news-section-grid {
            grid-template-columns: 1fr;
          }

          .msh-news-section-title {
            text-align: left;
          }

          .msh-chart-head-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            flex-wrap: wrap;
          }

          .msh-chart-head-row > div:first-child {
            width: 100%;
          }

          .msh-timeframes {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            width: 100%;
          }
          .msh-timeframes > * {
            width: 100%;
            padding: 6px 0;
            font-size: 12px;
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
        marginRight: 8,
      }}
    >
      <img
        src="/logo.png"
        alt="MyStockHarbor"
        style={{
          height: 78,
          width: "auto",
          objectFit: "contain",
          display: "block",
        }}
      />
    </Link>
  </div>

  <div className="msh-top-heading-block">
    <h1
      style={{
        margin: 0,
        fontWeight: 950,
        fontSize: 28,
        lineHeight: 1.05,
        letterSpacing: "-0.03em",
      }}
    >
      Stock Analysis Tools, Stock Pickers & Market Insights
    </h1>

    <div
      style={{
        marginTop: 6,
        color: COLORS.mutedFg,
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      Learn charts. Discover stocks. Trade smarter.
    </div>
  </div>

  <div className="msh-desktop-nav-row">
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
              }}
            >
              {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
            </button>
          </div>
        </div>

        <div className="msh-mobile-nav">
          <SmallNavLink href="/learn">Learn</SmallNavLink>
          <SmallNavLink href="/platforms">Platforms</SmallNavLink>
          <SmallNavLink href="/utilities">Calculators</SmallNavLink>
        </div>

        {isMobile ? MobileHero() : null}

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
                  boxShadow: COLORS.isDark
                    ? "0 18px 34px rgba(0,0,0,0.40)"
                    : "0 18px 34px rgba(0,0,0,0.12)",
                  overflow: "hidden",
                }}
              >
                {results.slice(0, 8).map((r) => (
                  <button
                    key={`${r.symbol}-${r.exchange}`}
                    type="button"
                    onClick={() => chooseSymbol(r.symbol, r.name)}
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
              className="msh-stock-picker-cta"
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
                transition: "transform 120ms ease, filter 120ms ease, border-color 120ms ease",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span>🔎 Scan for Stock Ideas</span>
                <span className="msh-stock-picker-cta-arrow" aria-hidden="true">
                  →
                </span>
              </span>
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

        {isMobile ? (
          <>
            <div className="msh-lower-grid" style={{ marginTop: 0 }}>
              <MobileStockAnalysisCard />
            </div>

            <div className="msh-lower-grid">
              <ChartPanel />
            </div>

            <div className="msh-lower-grid">
              <OverviewPanel />
              <BreakdownPanel />
            </div>

            <div className="msh-lower-grid">
              <NewsPanel />
            </div>

            <div className="msh-lower-grid">
              <BenchmarksPanel />
            </div>

            <div className="msh-lower-grid">
              <InsightsPanel />
            </div>
          </>
        ) : (
          <>
            <div className="msh-main-grid">
              <div className="msh-left-stack msh-mobile-secondary">
                <OverviewPanel />
                <BreakdownPanel />
              </div>

              <div className="msh-mobile-primary">
                <ChartPanel />
              </div>
            </div>

            <div className="msh-lower-grid">
              <BenchmarksPanel />
              <NewsPanel />
              <InsightsPanel />
            </div>
          </>
        )}

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
                <div style={{ fontWeight: 900 }}>Expanded Chart ({chartIndicatorName})</div>

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
                  symbol={symbol}
                  data={displayedHistory}
                  ma50={ma50}
                  ma200={ma200}
                  overlay={indicator}
                  selectedIndicators={selectedIndicators}
                  bollUpper={bollUpper}
                  bollMid={bollMid}
                  bollLower={bollLower}
                  ema20={ema20Arr}
                  vwma20={vwma20Arr}
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

        {loading ? (
          <div style={{ marginTop: 14, fontSize: 13, opacity: 0.7 }}>Loading chart data…</div>
        ) : null}
      </div>
    </main>
  );
}
