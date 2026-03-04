"use client";

import React, { useEffect, useMemo, useState } from "react";
import PriceChart, { type Overlay } from "./PriceChart";

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

type MarketRow = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

type MarketPayload = {
  updatedAt: string;
  topTraded: MarketRow[];
  topMovers: MarketRow[];
  topRanges: MarketRow[];
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

type OverviewItem = {
  key: string;
  label: string;
  tone: "green" | "yellow" | "orange" | "red" | "muted";
  valueText: string;
};

function toneToColor(tone: OverviewItem["tone"], isDark: boolean) {
  // simple, readable colors; no new libs
  if (tone === "green") return isDark ? "#22c55e" : "#16a34a";
  if (tone === "yellow") return isDark ? "#eab308" : "#ca8a04";
  if (tone === "orange") return isDark ? "#fb923c" : "#ea580c";
  if (tone === "red") return isDark ? "#ef4444" : "#dc2626";
  return isDark ? "rgba(241,245,249,0.45)" : "rgba(11,18,32,0.45)";
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

type CompositeDetail = {
  name: string;
  state: "overbought" | "oversold" | "spike";
  value?: number | null;
};

type CompositeSignal = {
  total: number;
  flagged: number;
  overbought: number;
  oversold: number;
  spikes: number;
  details: CompositeDetail[];
};

function buildCompositeSignal(args: {
  lastClose: number | null;
  rsi14: number | null;
  stochK: number | null;
  bollUpper: number | null;
  bollLower: number | null;
  macdHist: number | null;
  ma50: number | null;
  ma200: number | null;
  ema20: number | null;
  vwap: number | null;
  vol: number | null;
  volSma20: number | null;
  atr14: number | null;
  atrSma20: number | null;
}): CompositeSignal | null {
  const {
    lastClose,
    rsi14,
    stochK,
    bollUpper,
    bollLower,
    macdHist,
    ma50,
    ma200,
    ema20,
    vwap,
    vol,
    volSma20,
    atr14,
    atrSma20,
  } = args;

  if (lastClose == null) return null;

  const details: CompositeDetail[] = [];
  let overbought = 0;
  let oversold = 0;
  let spikes = 0;

  // 1) RSI
  if (typeof rsi14 === "number") {
    if (rsi14 >= 70) {
      overbought++;
      details.push({ name: "RSI(14)", state: "overbought", value: rsi14 });
    } else if (rsi14 <= 30) {
      oversold++;
      details.push({ name: "RSI(14)", state: "oversold", value: rsi14 });
    }
  }

  // 2) Stoch %K
  if (typeof stochK === "number") {
    if (stochK >= 80) {
      overbought++;
      details.push({ name: "Stoch %K", state: "overbought", value: stochK });
    } else if (stochK <= 20) {
      oversold++;
      details.push({ name: "Stoch %K", state: "oversold", value: stochK });
    }
  }

  // 3) Bollinger extremes
  if (typeof bollUpper === "number" && lastClose > bollUpper) {
    overbought++;
    details.push({ name: "Bollinger", state: "overbought", value: lastClose });
  } else if (typeof bollLower === "number" && lastClose < bollLower) {
    oversold++;
    details.push({ name: "Bollinger", state: "oversold", value: lastClose });
  }

  // 4) VWAP distance (2%)
  if (typeof vwap === "number" && vwap > 0) {
    const pct = (lastClose - vwap) / vwap;
    if (pct >= 0.02) {
      overbought++;
      details.push({ name: "VWAP dist", state: "overbought", value: pct * 100 });
    } else if (pct <= -0.02) {
      oversold++;
      details.push({ name: "VWAP dist", state: "oversold", value: pct * 100 });
    }
  }

  // 5) Price vs EMA20 (5%)
  if (typeof ema20 === "number" && ema20 > 0) {
    const pct = (lastClose - ema20) / ema20;
    if (pct >= 0.05) {
      overbought++;
      details.push({ name: "EMA20 dist", state: "overbought", value: pct * 100 });
    } else if (pct <= -0.05) {
      oversold++;
      details.push({ name: "EMA20 dist", state: "oversold", value: pct * 100 });
    }
  }

  // 6) Price vs MA50 (5%)
  if (typeof ma50 === "number" && ma50 > 0) {
    const pct = (lastClose - ma50) / ma50;
    if (pct >= 0.05) {
      overbought++;
      details.push({ name: "MA50 dist", state: "overbought", value: pct * 100 });
    } else if (pct <= -0.05) {
      oversold++;
      details.push({ name: "MA50 dist", state: "oversold", value: pct * 100 });
    }
  }

  // 7) Price vs MA200 (5%)
  if (typeof ma200 === "number" && ma200 > 0) {
    const pct = (lastClose - ma200) / ma200;
    if (pct >= 0.05) {
      overbought++;
      details.push({ name: "MA200 dist", state: "overbought", value: pct * 100 });
    } else if (pct <= -0.05) {
      oversold++;
      details.push({ name: "MA200 dist", state: "oversold", value: pct * 100 });
    }
  }

  // 8) MACD hist magnitude vs price (0.2%)
  if (typeof macdHist === "number" && Number.isFinite(macdHist)) {
    const thresh = Math.abs(lastClose) * 0.002; // 0.2% of price
    if (macdHist >= thresh) {
      overbought++;
      details.push({ name: "MACD hist", state: "overbought", value: macdHist });
    } else if (macdHist <= -thresh) {
      oversold++;
      details.push({ name: "MACD hist", state: "oversold", value: macdHist });
    }
  }

  // 9) Volume spike vs SMA20 (1.8x)
  if (typeof vol === "number" && typeof volSma20 === "number" && volSma20 > 0) {
    if (vol >= volSma20 * 1.8) {
      spikes++;
      details.push({ name: "Volume spike", state: "spike", value: vol / volSma20 });
    }
  }

  // 10) ATR spike vs SMA20 (1.5x)
  if (typeof atr14 === "number" && typeof atrSma20 === "number" && atrSma20 > 0) {
    if (atr14 >= atrSma20 * 1.5) {
      spikes++;
      details.push({ name: "ATR spike", state: "spike", value: atr14 / atrSma20 });
    }
  }

  const total = 10;
  const flagged = overbought + oversold + spikes;

  return { total, flagged, overbought, oversold, spikes, details };
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

const INDICATORS: Overlay[] = [
  "None",
  "MA50",
  "MA200",
  "Bollinger(20,2)",
  "RSI(14)",
  "MACD(12,26,9)",
  "EMA20",
  "VWAP",
  "Stochastic(14,3)",
  "ATR(14)",
  "Volume",
];

/* ----------------------------- component ----------------------------- */

export default function DashboardClient({ defaultSymbol = "AAPL" }: { defaultSymbol?: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);

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

  const [market, setMarket] = useState<MarketPayload | null>(null);
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

  // Market overview
  useEffect(() => {
    let cancelled = false;

    async function loadMarket() {
      try {
        const res = await fetch("/api/market", { cache: "no-store" });
        const data = (await res.json()) as MarketPayload;
        if (!cancelled) setMarket(data);
      } catch {
        if (!cancelled) setMarket(null);
      }
    }

    loadMarket();
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

  const volumeArr = useMemo(
    () => displayedHistory.map((p) => (typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null)),
    [displayedHistory]
  );

  const volSma20Arr = useMemo(() => smaNullable(volumeArr, 20), [volumeArr]);
  const atrSma20Arr = useMemo(() => smaNullable(atr14Arr, 20), [atr14Arr]);

  const lastClose = displayedHistory.length ? displayedHistory[displayedHistory.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);

  const composite = useMemo(() => {
    if (indicator !== "None") return null;

    return buildCompositeSignal({
      lastClose,
      rsi14: lastNum(rsi14Arr),
      stochK: lastNum(stochK),
      bollUpper: lastNum(bollUpper),
      bollLower: lastNum(bollLower),
      macdHist: lastNum(macdHist),
      ma50: typeof lastMA50 === "number" ? lastMA50 : null,
      ma200: typeof lastMA200 === "number" ? lastMA200 : null,
      ema20: lastNum(ema20Arr),
      vwap: lastNum(vwapArr),
      vol: lastNum(volumeArr),
      volSma20: lastNum(volSma20Arr),
      atr14: lastNum(atr14Arr),
      atrSma20: lastNum(atrSma20Arr),
    });
  }, [
    indicator,
    lastClose,
    rsi14Arr,
    stochK,
    bollUpper,
    bollLower,
    macdHist,
    lastMA50,
    lastMA200,
    ema20Arr,
    vwapArr,
    volumeArr,
    volSma20Arr,
    atr14Arr,
    atrSma20Arr,
  ]);

  const signal = useMemo(() => {
    // NEW: composite when None
    if (indicator === "None") {
      if (!composite) return { label: "Signal unavailable", detail: "No price data." };

      const parts: string[] = [];
      if (composite.overbought) parts.push(`${composite.overbought} overbought`);
      if (composite.oversold) parts.push(`${composite.oversold} oversold`);
      if (composite.spikes) parts.push(`${composite.spikes} spikes`);

      const detailList = composite.details
        .slice(0, 4)
        .map((d) => d.name)
        .join(", ");

      return {
        label: `Composite: ${composite.flagged}/${composite.total} flags`,
        detail:
          (parts.length ? `${parts.join(" • ")}.` : "No strong extremes detected.") +
          (detailList ? ` Top flags: ${detailList}.` : ""),
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
    composite,
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

    const overviewItems = useMemo<OverviewItem[]>(() => {
    // Only show in Overview mode
    if (indicator !== "None") return [];

    const items: OverviewItem[] = [];
    const isDark = COLORS.isDark;

    const push = (it: OverviewItem) => items.push(it);

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
      });
    } else {
      push({ key: "vwap", label: "VWAP", tone: "muted", valueText: "—" });
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
      });
    } else {
      push({ key: "macd", label: "MACD", tone: "muted", valueText: "—" });
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
      });
    } else {
      push({ key: "rsi", label: "RSI", tone: "muted", valueText: "—" });
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
      });
    } else {
      push({ key: "stoch", label: "Stoch", tone: "muted", valueText: "—" });
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
      });
    } else {
      push({ key: "ma200", label: "MA200", tone: "muted", valueText: "—" });
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
      });
    } else {
      push({ key: "vol", label: "Volume", tone: "muted", valueText: "—" });
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
      });
    } else {
      push({ key: "atr", label: "ATR", tone: "muted", valueText: "—" });
    }

    // Keep the list compact (you can reorder these later)
    return items;
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
  ]);

  const lastIndicatorValue = useMemo(() => {
    if (indicator === "None") {
      return { label: "Composite", value: composite ? composite.flagged : null, total: composite ? composite.total : null };
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
  }, [indicator, composite, lastMA50, lastMA200, ema20Arr, vwapArr, bollMid, rsi14Arr, macdLine, stochK, atr14Arr, volumeArr]);

  function chooseSymbol(s: string) {
    const cleaned = s.trim().toUpperCase();
    if (!cleaned) return;
    setSymbol(cleaned);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

const ChartCard = (opts?: { height?: number | string }) => {
  const height = opts?.height ?? 460;

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
        />
      </div>
    </div>
  );
};

  return (
    <main
      style={{
        padding: 40,
        fontFamily: "system-ui, Arial",
        background: COLORS.pageBg,
        color: COLORS.pageFg,
        minHeight: "100vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontSize: 32, margin: 0 }}>My Stock Dashboard</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
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

      <p style={{ marginTop: 0, opacity: 0.75, color: COLORS.mutedFg }}>Version 1 – Learning Build (free data)</p>

      {/* Controls row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
        <label style={{ fontWeight: 600 }}>Ticker</label>

        <select
          value={symbol}
          onChange={(e) => chooseSymbol(e.target.value)}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #3336",
            background: "#fff",
            color: "#111",
            fontWeight: 700,
          }}
        >
          {PRESET_TICKERS.map((t) => (
            <option key={t.symbol} value={t.symbol}>
              {t.symbol} – {t.name}
            </option>
          ))}
        </select>

        {/* SWAPPED: manual search comes earlier */}
        <div style={{ position: "relative" }}>
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
            placeholder="Search ticker or company"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #3333",
              width: 360,
            }}
          />

          {open && results.length > 0 ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
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
                  <div style={{ fontWeight: 700 }}>
                    {r.symbol} <span style={{ fontWeight: 500, opacity: 0.7 }}>({r.exchange})</span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{r.name}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Indicator (next to search) */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontWeight: 600 }}>Indicator</label>
          <select
            value={indicator}
            onChange={(e) => setIndicator(e.target.value as any)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #3336",
              background: "#fff",
              color: "#111",
              fontWeight: 700,
              minWidth: 200,
            }}
          >
                     {INDICATORS.map((x) => (
              <option key={x} value={x}>
                {x === "None" ? "Overview" : x}
              </option>
            ))}
          </select>
        </div>

{/* Timeframes (pinned right) */}
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


      <div style={{ marginTop: 16, maxWidth: 920, display: "grid", gap: 16 }}>
        {/* Card 1: Summary */}
        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>{symbol}</h2>

          {loading ? (
            <p style={{ margin: "8px 0" }}>Loading…</p>
          ) : err ? (
            <p style={{ margin: "8px 0" }}>{err}</p>
          ) : (
            <>
              <p style={{ fontSize: 20, margin: "8px 0" }}>
                <strong>Last price:</strong> {quote?.price == null ? "Unavailable" : `$${quote.price.toFixed(2)}`}
              </p>

              {indicator === "None" ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.1fr 0.9fr",
                    gap: 16,
                    marginTop: 10,
                    alignItems: "start",
                  }}
                >
                  {/* LEFT: Big dominant signal */}
                  <div>
                    <div style={{ fontSize: 14, opacity: 0.8, color: COLORS.mutedFg, fontWeight: 800 }}>
                      Signal
                    </div>

                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 26,
                        fontWeight: 950,
                        letterSpacing: "-0.2px",
                        lineHeight: 1.15,
                      }}
                    >
                      {signal.label}
                    </div>

                    <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75, color: COLORS.mutedFg }}>
                      {signal.detail}
                    </div>

                    <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                      <strong>Overview:</strong> Composite {composite ? `${composite.flagged}/${composite.total}` : "—"} flags
                    </div>
                  </div>

                  {/* RIGHT: Compact breakdown list */}
                  <div
                    style={{
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      padding: 12,
                      background: COLORS.controlBg,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10, opacity: 0.9 }}>
                      Breakdown
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      {overviewItems.map((it) => {
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
              ) : (
                <>
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
        {ChartCard({ height: 460 })}

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
      {ChartCard({ height: "100%" })}
    </div>
  </div>
</div>
            </div>
          </div>
        ) : null}

        {/* Card 3: Market */}
        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Market Overview</h2>

          {market ? (
            <>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
                Updated: {new Date(market.updatedAt).toLocaleString()}
              </div>

              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Top 10 traded (by volume)</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {(market.topTraded?.length ? market.topTraded : market.topRanges).map((r) => (
                      <div key={r.symbol} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700 }}>{r.symbol}</span>
                        <span style={{ opacity: 0.8 }}>{r.volume == null ? "—" : `${Math.round(r.volume).toLocaleString()} vol`}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Top 5 movers (by %)</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {market.topMovers.map((r) => (
                      <div key={r.symbol} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700 }}>{r.symbol}</span>
                        <span style={{ opacity: 0.8 }}>
                          {r.changePct == null ? "—" : `${r.changePct >= 0 ? "Up" : "Down"} ${Math.abs(r.changePct).toFixed(2)}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.7 }}>Market overview unavailable (check Twelve Data key).</div>
          )}
        </div>

        {/* Card 4: News */}
        <div style={{ padding: 16, border: "1px solid #3333", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Latest News</h2>

          {news ? (
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
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
    </main>
  );
}
