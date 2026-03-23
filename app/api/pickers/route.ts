// app/api/pickers/route.ts
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { detectDivergenceFromHistory } from "../../../lib/ta/divergence";
import { getDailyHistory } from "../../../lib/server/historyCache";

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

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
  dynamicUniverseSize?: number;
  dynamicSymbols?: string[];
};

type PickerTone = "green" | "yellow" | "orange" | "red";

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
  timeframe?: "D" | "W" | "M";
  indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
  // internal sorting helpers (not returned)
  _score?: number;
};

type PickerSection = {
  title: string;
  description?: string;
  foundCount?: number;
  shownCount?: number;
  items: {
    symbol: string;
    note?: string;
    tone?: PickerTone;
    timeframe?: "D" | "W" | "M";
    indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
    dashboardHref?: string;
  }[];
};

type CompositeResult = {
  total: number;
  flagged: number;
  overbought: number;
  oversold: number;
  spikes: number;
  tone: PickerTone;
  tag: string;
};

type SignalRecord = {
  symbol: string;
  note?: string;
  tone?: PickerTone;

  oversold: boolean;
  overbought: boolean;
  buyTheDip: boolean;
  breakout: boolean;
  volumeSpike: boolean;
  atrSpike: boolean;
  aboveMA50: boolean;
  belowMA50: boolean;
  aboveMA200: boolean;
  belowMA200: boolean;
  dailyMa200Proximity: boolean;
  weeklyMa200Proximity: boolean;

  bullishRsiDivergence: boolean;
  bearishRsiDivergence: boolean;
  bullishMacdDivergence: boolean;
  bearishMacdDivergence: boolean;

  preferredTimeframe?: "D" | "W" | "M";
  preferredIndicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
};

/* ----------------------------- caching ------------------------------ */


let memo:
  | {
      ts: number;
      data: any;
    }
  | null = null;

const CACHE_SECONDS = 60; // 1 minute CDN cache
const STALE_SECONDS = 120; // short stale window
const MEMORY_CACHE_MS = 60_000; // 1 minute in-memory cache

/* ------------------------ small util helpers ------------------------ */

function originFromReq(req: NextRequest) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

function lastNum(arr: Array<number | null>) {
  return arr.length ? arr[arr.length - 1] : null;
}

function clampNum(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
function buildDashboardHref(args: {
  symbol: string;
  timeframe?: "D" | "W" | "M";
  indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
}) {
  const params = new URLSearchParams();
  params.set("symbol", args.symbol);

  if (args.timeframe) {
    params.set("tf", args.timeframe);
  }

  if (args.indicator) {
    params.set("indicator", args.indicator);
  }

  return `/?${params.toString()}`;
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
    if (typeof f !== "number" || typeof s !== "number") return null;
    return f - s;
  });

  const lineForEma = line.map((v) => (typeof v === "number" ? v : 0));
  const sigAll = ema(lineForEma, signal);
  const sig: (number | null)[] = sigAll.map((v, i) => (line[i] == null ? null : v));
  const hist: (number | null)[] = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]!));

  return { line, signal: sig, hist };
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

type AggregatedPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

function startOfWeekUtc(dateStr: string) {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const dt = new Date(Date.UTC(year, month - 1, day));
  const weekday = dt.getUTCDay();
  const diffToMonday = weekday === 0 ? 6 : weekday - 1;

  dt.setUTCDate(dt.getUTCDate() - diffToMonday);

  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7);
}

function aggregatePoints(points: Point[], interval: "w" | "m"): AggregatedPoint[] {
  const bucketed: AggregatedPoint[] = [];
  let currentKey = "";
  let current: AggregatedPoint | null = null;

  for (const point of points) {
    const key = interval === "w" ? startOfWeekUtc(point.date) : monthKey(point.date);

    if (!current || key !== currentKey) {
      if (current) bucketed.push(current);

      currentKey = key;
      current = {
        date: point.date,
        close: point.close,
        high: point.high,
        low: point.low,
        volume: typeof point.volume === "number" ? point.volume : undefined,
      };

      continue;
    }

    current.date = point.date;
    current.close = point.close;

    if (typeof point.high === "number") {
      current.high =
        typeof current.high === "number"
          ? Math.max(current.high, point.high)
          : point.high;
    }

    if (typeof point.low === "number") {
      current.low =
        typeof current.low === "number"
          ? Math.min(current.low, point.low)
          : point.low;
    }

    if (typeof point.volume === "number") {
      current.volume =
        typeof current.volume === "number"
          ? current.volume + point.volume
          : point.volume;
    }
  }

  if (current) bucketed.push(current);

  return bucketed;
}

function computeMa200Proximity(
  points: Point[],
  interval: "d" | "w"
): { pctDistance: number; timeframe: "D" | "W" } | null {
  const series =
    interval === "d"
      ? points
      : aggregatePoints(points, "w");

  const closes = series.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 200) return null;

  const ma200Arr = movingAverage(closes, 200);
  const lastClose = closes[closes.length - 1];
  const lastMA200 = lastNum(ma200Arr);

  if (
    typeof lastClose !== "number" ||
    typeof lastMA200 !== "number" ||
    !Number.isFinite(lastClose) ||
    !Number.isFinite(lastMA200) ||
    lastMA200 === 0
  ) {
    return null;
  }

  const pctDistance = ((lastClose - lastMA200) / lastMA200) * 100;

  if (pctDistance < -1 || pctDistance > 3) return null;

  return {
    pctDistance,
    timeframe: interval === "d" ? "D" : "W",
  };
}

/* --------------------- composite + picker logic ---------------------- */

function compositeToneFromCounts(overbought: number, oversold: number, spikes: number) {
  // net > 0 => overbought-heavy (red side), net < 0 => oversold-heavy (green side)
  const net = overbought - oversold;
  const intensity = overbought + oversold + spikes; // 0..10-ish

  if (intensity <= 1) return { tone: "yellow" as const, tag: "Calm" };

  if (net >= 2) return { tone: intensity >= 5 ? ("red" as const) : ("orange" as const), tag: "Overbought-leaning" };
  if (net === 1) return { tone: "orange" as const, tag: "Slightly overbought" };

  if (net <= -2) return { tone: intensity >= 5 ? ("green" as const) : ("yellow" as const), tag: "Oversold-leaning" };
  if (net === -1) return { tone: "yellow" as const, tag: "Slightly oversold" };

  return { tone: intensity >= 5 ? ("orange" as const) : ("yellow" as const), tag: "Mixed" };
}

function buildCompositeFromHistory(points: Point[]): CompositeResult | null {
  if (!points.length) return null;

  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 60) return null;

  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

  // Indicators
  const bb = bollinger(closes, 20, 2);
  const rsi14 = rsiWilder(closes, 14);
  const macdAll = macd(closes, 12, 26, 9);
  const ema20 = ema(closes, 20);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);

  const atr14 = atr(points, 14);

  const volume: (number | null)[] = points.map((p) =>
    typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
  );
  const volSma20 = smaNullable(volume, 20);
  const atrSma20 = smaNullable(atr14, 20);

  const last = {
    bbU: lastNum(bb.upper),
    bbL: lastNum(bb.lower),
    rsi: lastNum(rsi14),
    macdHist: lastNum(macdAll.hist),
    ema20: lastNum(ema20),
    ma50: lastNum(ma50),
    ma200: lastNum(ma200),
    vol: lastNum(volume),
    volSma: lastNum(volSma20),
    atr: lastNum(atr14),
    atrSma: lastNum(atrSma20),
  };

  let overbought = 0;
  let oversold = 0;
  let spikes = 0;

  // RSI
  if (typeof last.rsi === "number") {
    if (last.rsi >= 70) overbought++;
    else if (last.rsi <= 30) oversold++;
  }

  // Bollinger extremes
  if (typeof last.bbU === "number" && lastClose > last.bbU) overbought++;
  else if (typeof last.bbL === "number" && lastClose < last.bbL) oversold++;

  // EMA20 dist (5%)
  if (typeof last.ema20 === "number" && last.ema20 > 0) {
    const pct = (lastClose - last.ema20) / last.ema20;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  // MA50 dist (5%)
  if (typeof last.ma50 === "number" && last.ma50 > 0) {
    const pct = (lastClose - last.ma50) / last.ma50;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  // MA200 dist (5%)
  if (typeof last.ma200 === "number" && last.ma200 > 0) {
    const pct = (lastClose - last.ma200) / last.ma200;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  // MACD hist magnitude vs price (0.2%)
  if (typeof last.macdHist === "number") {
    const thresh = Math.abs(lastClose) * 0.002;
    if (last.macdHist >= thresh) overbought++;
    else if (last.macdHist <= -thresh) oversold++;
  }

  // Volume spike vs SMA20 (1.8x)
  if (typeof last.vol === "number" && typeof last.volSma === "number" && last.volSma > 0) {
    if (last.vol >= last.volSma * 1.8) spikes++;
  }

  // ATR spike vs SMA20 (1.5x)
  if (typeof last.atr === "number" && typeof last.atrSma === "number" && last.atrSma > 0) {
    if (last.atr >= last.atrSma * 1.5) spikes++;
  }

  const total = 8; // (we’re counting 8 checks here)
  const flagged = overbought + oversold + spikes;

  const toneInfo = compositeToneFromCounts(overbought, oversold, spikes);

  return {
    total,
    flagged,
    overbought,
    oversold,
    spikes,
    tone: toneInfo.tone,
    tag: toneInfo.tag,
  };
}

function pickIsGreenOverallSignal(c: CompositeResult) {
  // “green overall signal” = oversold-leaning
  // tweakable thresholds:
  return c.oversold >= 2 && c.oversold > c.overbought;
}

function pickIsRedOverallSignal(c: CompositeResult) {
  // “red overall signal” = overbought-leaning
  return c.overbought >= 2 && c.overbought > c.oversold;
}

function buildTrendScoreFromHistory(points: Point[]) {
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 220) return null;

  const ma50Arr = movingAverage(closes, 50);
  const ma200Arr = movingAverage(closes, 200);
  const macdAll = macd(closes, 12, 26, 9);

  const lastClose = closes[closes.length - 1];
  const lastMA50 = lastNum(ma50Arr);
  const lastMA200 = lastNum(ma200Arr);
  const lastMacdHist = lastNum(macdAll.hist);

  const priceAboveMA200 =
    typeof lastClose === "number" &&
    typeof lastMA200 === "number" &&
    lastClose > lastMA200;

  const priceAboveMA50 =
    typeof lastClose === "number" &&
    typeof lastMA50 === "number" &&
    lastClose > lastMA50;

  const ma50AboveMA200 =
    typeof lastMA50 === "number" &&
    typeof lastMA200 === "number" &&
    lastMA50 > lastMA200;

  const macdBullish =
    typeof lastMacdHist === "number" &&
    lastMacdHist > 0;

  let passed = 0;
  if (priceAboveMA200) passed += 1;
  if (priceAboveMA50) passed += 1;
  if (ma50AboveMA200) passed += 1;
  if (macdBullish) passed += 1;

  return {
    total: 4,
    passed,
    priceAboveMA200,
    priceAboveMA50,
    ma50AboveMA200,
    macdBullish,
  };
}
function computeBuyTheDip(points: Point[]) {
  // Criteria: was at all-time high recently, now -20% within last 4 months (~120 trading days)
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 140) return null;

  const last = closes[closes.length - 1];

  const lookback = 120;
  const slice = closes.slice(-lookback);
  const recentHigh = Math.max(...slice);
  if (!Number.isFinite(recentHigh) || recentHigh <= 0) return null;

  // “recently at ATH”: recentHigh equals all-time high (or within tiny epsilon)
  const allTimeHigh = Math.max(...closes);
  const atAthRecently = Math.abs(recentHigh - allTimeHigh) / allTimeHigh <= 0.002; // within 0.2%

  if (!atAthRecently) return null;

  const drawdown = (last - recentHigh) / recentHigh; // negative if down
  if (drawdown <= -0.2) {
    return { drawdownPct: Math.abs(drawdown) * 100 };
  }
  return null;
}

function computeAthBreakout(points: Point[]) {
  const pts = points.filter((p) => p?.date && Number.isFinite(p.close));
  if (pts.length < 80) return null;

  const closes = pts.map((p) => p.close);
  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

  const allTimeHigh = Math.max(...closes);
  if (!Number.isFinite(allTimeHigh) || allTimeHigh <= 0) return null;

  const eps = 0.01; // within 1%
  const isAtAth = lastClose >= allTimeHigh * (1 - eps);

  if (!isAtAth) return null;

  return {
    allTimeHigh,
    breakoutPct: ((lastClose - allTimeHigh) / allTimeHigh) * 100,
  };
}

function computeThreeMonthBreakout(points: Point[]) {
  const pts = points.filter((p) => p?.date && Number.isFinite(p.close));
  if (pts.length < 90) return null;

  const closes = pts.map((p) => p.close);
  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

  const LOOKBACK_BARS = 63; // ~3 months
  const EXCLUDE_RECENT_BARS = 5;

  const endExclusive = closes.length - EXCLUDE_RECENT_BARS;
  const startInclusive = endExclusive - LOOKBACK_BARS;

  if (startInclusive < 0 || endExclusive <= startInclusive) return null;

  const breakoutWindow = closes.slice(startInclusive, endExclusive);
  if (!breakoutWindow.length) return null;

  const rangeHigh = Math.max(...breakoutWindow);
  if (!Number.isFinite(rangeHigh) || rangeHigh <= 0) return null;

    const eps = 0.005; // within 0.5%
  if (lastClose < rangeHigh * (1 - eps)) return null;

  return {
    rangeHigh,
    breakoutPct: ((lastClose - rangeHigh) / rangeHigh) * 100,
    lookbackBars: LOOKBACK_BARS,
  };
}

/* -------------------------- concurrency limit ------------------------ */

// small p-limit (no dependency)
function pLimit(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

/* ------------------------------ fetchers ----------------------------- */

async function fetchJSON<T>(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${url}`);
  return (await res.json()) as T;
}

async function fetchMarket(origin: string) {
  return fetchJSON<MarketPayload>(`${origin}/api/market`);
}

async function fetchHistory(symbol: string, days: number) {
  const pts = await getDailyHistory(symbol);

  return pts
    .map((p) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close))
    .slice(-days);
}

/* ------------------------------ universe ----------------------------- */

const PRESET_UNIVERSE: string[] = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "BRK.B",
  "AVGO",
  "LLY",
  "JPM",
  "V",
  "UNH",
  "XOM",
  "PG",
  "MA",
  "COST",
  "HD",
  "MRK",
  "ABBV",
  "CRM",
  "NFLX",
  "ORCL",
  "BAC",
  "KO",
  "PEP",
  "ADBE",
  "TMO",
  "WMT",
  "CSCO",
  "ACN",
  "MCD",
  "ABT",
  "CVX",
  "LIN",
  "AMD",
  "NKE",
  "DHR",
  "TXN",
  "INTC",
  "QCOM",
  "PM",
  "IBM",
  "NOW",
  "SBUX",
  "CAT",
  "GE",
  "AMAT",
  "LOW",
];

/* --------------------------- builder function ------------------------ */


async function buildPickersPayload(origin: string) {
  const market = await fetchMarket(origin);

  const topTraded = (market?.topTraded ?? [])
    .map((x) => x.symbol)
    .filter(Boolean);

  const topMovers = (market?.topMovers ?? [])
    .map((x) => x.symbol)
    .filter(Boolean);

  const topRanges = (market?.topRanges ?? [])
    .map((x) => x.symbol)
    .filter(Boolean);

  const accumulatedDynamicUniverse = Array.isArray(market?.dynamicSymbols)
    ? market.dynamicSymbols
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    : [];

  const rankedDynamicUniverse = Array.from(
    new Set([...topTraded, ...topMovers, ...topRanges])
  );

  const dynamicUniverse = Array.from(
    new Set(
      [...accumulatedDynamicUniverse, ...rankedDynamicUniverse]
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const dynamicUniverseSet = new Set(dynamicUniverse);

  const universe = Array.from(
    new Set(
      [...dynamicUniverse, ...PRESET_UNIVERSE]
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, 100);

  const limit = pLimit(8);
  const days = 2600;

  const green: PickerItem[] = [];
  const red: PickerItem[] = [];
  const trendLeaders: PickerItem[] = [];
  const dips: PickerItem[] = [];
  const athBreakouts: PickerItem[] = [];
  const threeMonthBreakouts: PickerItem[] = [];
  const ma200Proximity: PickerItem[] = [];
  const divergences: PickerItem[] = [];
  const signalRecords: SignalRecord[] = [];

  const isDynamicUniverse = (sym: string) => dynamicUniverseSet.has(sym);
  const dynamicBoost = (sym: string) => (isDynamicUniverse(sym) ? 1000 : 0);

  await Promise.all(
    universe.map((symbol) =>
      limit(async () => {
        try {
          const pts = await fetchHistory(symbol, days);
          if (!pts.length) return;

          const comp = buildCompositeFromHistory(pts);

if (comp) {
  const closes = pts.map((p) => p.close).filter((x) => Number.isFinite(x));
  const ma200Arr = closes.length ? movingAverage(closes, 200) : [];
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const lastMA200 = lastNum(ma200Arr);

  const aboveMA200 =
    typeof lastClose === "number" &&
    typeof lastMA200 === "number" &&
    lastClose > lastMA200;

  if (pickIsGreenOverallSignal(comp) && aboveMA200) {
    green.push({
      symbol,
      tone: "green",
      note: `${comp.oversold} oversold • above MA200 • ${comp.flagged}/${comp.total} checks`,
      _score:
        dynamicBoost(symbol) +
        comp.oversold * 50 +
        comp.flagged * 10 +
        200, // bonus for trend quality
    });
  }

            if (pickIsRedOverallSignal(comp)) {
              red.push({
                symbol,
                tone: "red",
                note: `${comp.overbought} overbought • ${comp.flagged}/${comp.total} checks`,
                _score: dynamicBoost(symbol) + comp.overbought * 50 + comp.flagged * 10,
              });
            }
          }

                    const trendScore = buildTrendScoreFromHistory(pts);
          if (trendScore && trendScore.passed >= 3) {
            trendLeaders.push({
              symbol,
              tone: trendScore.passed === 4 ? "green" : "yellow",
              note: `${trendScore.passed}/${trendScore.total} trend checks`,
              _score:
                dynamicBoost(symbol) +
                trendScore.passed * 100 +
                (trendScore.priceAboveMA200 ? 20 : 0) +
                (trendScore.priceAboveMA50 ? 10 : 0) +
                (trendScore.ma50AboveMA200 ? 20 : 0) +
                (trendScore.macdBullish ? 10 : 0),
            });
          }

          const dip = computeBuyTheDip(pts);
          if (dip) {
            dips.push({
              symbol,
              tone: "yellow",
              note: `Down ${dip.drawdownPct.toFixed(1)}% from recent ATH`,
              _score: dynamicBoost(symbol) + dip.drawdownPct,
            });
          }

          const athBo = computeAthBreakout(pts);
          if (athBo) {
            athBreakouts.push({
              symbol,
              tone: "orange",
              note: "At all-time high breakout",
              _score: dynamicBoost(symbol) + 5000 + athBo.breakoutPct * 100,
            });
          }

          const threeMonthBo = computeThreeMonthBreakout(pts);
          if (threeMonthBo) {
            threeMonthBreakouts.push({
              symbol,
              tone: "orange",
              note: `Above ${threeMonthBo.lookbackBars}-bar high`,
              _score:
                dynamicBoost(symbol) +
                1000 +
                threeMonthBo.breakoutPct * 100,
            });
          }

          const dailyMa200Proximity = computeMa200Proximity(pts, "d");
          if (dailyMa200Proximity) {
            const side =
              dailyMa200Proximity.pctDistance >= 0 ? "above" : "below";

            ma200Proximity.push({
              symbol,
              tone: "yellow",
              note: `Near Daily MA200 • ${Math.abs(dailyMa200Proximity.pctDistance).toFixed(1)}% ${side}`,
              timeframe: "D",
              indicator: "MA200",
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: "D",
                indicator: "MA200",
              }),
              _score: dynamicBoost(symbol) + (100 - Math.abs(dailyMa200Proximity.pctDistance)),
            });
          }

          const weeklyMa200Proximity = computeMa200Proximity(pts, "w");
          if (weeklyMa200Proximity) {
            const side =
              weeklyMa200Proximity.pctDistance >= 0 ? "above" : "below";

            ma200Proximity.push({
              symbol,
              tone: "yellow",
              note: `Near Weekly MA200 • ${Math.abs(weeklyMa200Proximity.pctDistance).toFixed(1)}% ${side}`,
              timeframe: "W",
              indicator: "MA200",
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: "W",
                indicator: "MA200",
              }),
              _score: dynamicBoost(symbol) + 200 + (100 - Math.abs(weeklyMa200Proximity.pctDistance)),
            });
          }

          const hasDailyMa200Proximity = !!dailyMa200Proximity;
          const hasWeeklyMa200Proximity = !!weeklyMa200Proximity;

const dailyDiv = detectDivergenceFromHistory(pts, {
  lookbackBars: 45,
  leftRight: 2,
  minPriceSwingPct: 1.6,
  minRsiSwing: 6,
  macdStdMult: 0.5,
  maxPivot2AgeBars: 16,
});

          const weeklyPts = aggregatePoints(pts, "w").map((p) => ({
            date: p.date,
            close: p.close,
            high: p.high,
            low: p.low,
            volume: p.volume,
          }));

const weeklyDiv = detectDivergenceFromHistory(weeklyPts, {
  lookbackBars: 30,
  leftRight: 2,
  minPriceSwingPct: 2.0,
  minRsiSwing: 5,
  macdStdMult: 0.35,
  maxPivot2AgeBars: 10,
});
          
          const scoredDailyDiv =
            dailyDiv
              ? {
                  ...dailyDiv,
                  timeframe: "D" as const,
                  boostedScore: dailyDiv.score,
                }
              : null;

          const scoredWeeklyDiv =
            weeklyDiv
              ? {
                  ...weeklyDiv,
                  timeframe: "W" as const,
                  boostedScore: weeklyDiv.score + 100,
                }
              : null;

          const div =
            scoredDailyDiv && scoredWeeklyDiv
              ? scoredWeeklyDiv.boostedScore >= scoredDailyDiv.boostedScore
                ? scoredWeeklyDiv
                : scoredDailyDiv
              : scoredWeeklyDiv ?? scoredDailyDiv;

          if (div) {
            const preferredIndicator =
              div.hasRsi && !div.hasMacd
                ? "RSI(14)"
                : !div.hasRsi && div.hasMacd
                ? "MACD(12,26,9)"
                : div.hasRsi && div.hasMacd
                ? "MACD(12,26,9)"
                : undefined;

            const preferredTimeframe: "D" | "W" = div.timeframe;
            const timeframeLabel = div.timeframe === "W" ? "Weekly" : "Daily";

            divergences.push({
              symbol,
              tone: div.kind === "bullish" ? "green" : "red",
              note: `${timeframeLabel} ${div.note} • ${div.priceSwingPct.toFixed(1)}% • ${div.pivotSpanBars} bars`,
              timeframe: preferredTimeframe,
              indicator: preferredIndicator,
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: preferredTimeframe,
                indicator: preferredIndicator,
              }),
              _score: dynamicBoost(symbol) + div.boostedScore,
            });
          }

          const closes = pts.map((p) => p.close).filter((x) => Number.isFinite(x));
          const ma50Arr = closes.length ? movingAverage(closes, 50) : [];
          const ma200Arr = closes.length ? movingAverage(closes, 200) : [];
          const atrArr = pts.length ? atr(pts, 14) : [];

          const volumeArr: (number | null)[] = pts.map((p) =>
            typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
          );

          const volSma20Arr = smaNullable(volumeArr, 20);
          const atrSma20Arr = smaNullable(atrArr, 20);

          const lastClose = closes.length ? closes[closes.length - 1] : null;
          const lastMA50 = lastNum(ma50Arr);
          const lastMA200 = lastNum(ma200Arr);
          const lastVol = lastNum(volumeArr);
          const lastVolSma20 = lastNum(volSma20Arr);
          const lastAtr = lastNum(atrArr);
          const lastAtrSma20 = lastNum(atrSma20Arr);

          const oversold = !!comp && comp.oversold >= 2 && comp.oversold > comp.overbought;
          const overbought = !!comp && comp.overbought >= 2 && comp.overbought > comp.oversold;

          const buyTheDip = !!dip;
          const breakout = !!athBo || !!threeMonthBo;

          const volumeSpike =
            typeof lastVol === "number" &&
            typeof lastVolSma20 === "number" &&
            lastVolSma20 > 0 &&
            lastVol >= lastVolSma20 * 1.8;

          const atrSpike =
            typeof lastAtr === "number" &&
            typeof lastAtrSma20 === "number" &&
            lastAtrSma20 > 0 &&
            lastAtr >= lastAtrSma20 * 1.5;

          const aboveMA50 =
            typeof lastClose === "number" &&
            typeof lastMA50 === "number" &&
            lastClose > lastMA50;

          const belowMA50 =
            typeof lastClose === "number" &&
            typeof lastMA50 === "number" &&
            lastClose < lastMA50;

          const aboveMA200 =
            typeof lastClose === "number" &&
            typeof lastMA200 === "number" &&
            lastClose > lastMA200;

          const belowMA200 =
            typeof lastClose === "number" &&
            typeof lastMA200 === "number" &&
            lastClose < lastMA200;

          const bullishRsiDivergence = !!div && div.kind === "bullish" && div.hasRsi;
          const bearishRsiDivergence = !!div && div.kind === "bearish" && div.hasRsi;
          const bullishMacdDivergence = !!div && div.kind === "bullish" && div.hasMacd;
          const bearishMacdDivergence = !!div && div.kind === "bearish" && div.hasMacd;

          const preferredDivergenceIndicator =
            bullishRsiDivergence || bearishRsiDivergence
              ? bullishMacdDivergence || bearishMacdDivergence
                ? "MACD(12,26,9)"
                : "RSI(14)"
              : bullishMacdDivergence || bearishMacdDivergence
              ? "MACD(12,26,9)"
              : undefined;

          const preferredTimeframe: "D" | "W" | undefined =
            preferredDivergenceIndicator && div
              ? div.timeframe
              : undefined;

          signalRecords.push({
            symbol,
            note: comp ? `${comp.flagged}/${comp.total} checks • ${comp.tag}` : undefined,
            tone: comp?.tone,
            oversold,
            overbought,
            buyTheDip,
            breakout,
            volumeSpike,
            atrSpike,
            aboveMA50,
            belowMA50,
            aboveMA200,
            belowMA200,
            dailyMa200Proximity: hasDailyMa200Proximity,
            weeklyMa200Proximity: hasWeeklyMa200Proximity,
            bullishRsiDivergence,
            bearishRsiDivergence,
            bullishMacdDivergence,
            bearishMacdDivergence,
            preferredTimeframe,
            preferredIndicator: preferredDivergenceIndicator,
            dashboardHref:
              preferredTimeframe && preferredDivergenceIndicator
                ? buildDashboardHref({
                    symbol,
                    timeframe: preferredTimeframe,
                    indicator: preferredDivergenceIndicator,
                  })
                : undefined,
          });
        } catch {
          // ignore per-symbol failures
        }
      })
    )
  );

  const takeTop = (
    arr: PickerItem[],
    n: number,
    opts?: { volumeFirstIfMany?: boolean }
  ) => {
    const volumeFirst = opts?.volumeFirstIfMany === true && arr.length > 10;

    const sorted = [...arr].sort((a, b) => {
      if (volumeFirst) return (b._score ?? 0) - (a._score ?? 0);
      return (b._score ?? 0) - (a._score ?? 0);
    });

    return sorted.slice(0, n).map(
      ({ symbol, note, tone, timeframe, indicator, dashboardHref }) => ({
        symbol,
        note,
        tone,
        timeframe,
        indicator,
        dashboardHref,
      })
    );
  };

    const buildSection = (args: {
    title: string;
    description?: string;
    source: PickerItem[];
    take: number;
    opts?: { volumeFirstIfMany?: boolean };
  }): PickerSection => {
    const items = takeTop(args.source, args.take, args.opts);

    return {
      title: args.title,
      description: args.description,
      foundCount: args.source.length,
      shownCount: items.length,
      items,
    };
  };

 const sections: PickerSection[] = [
    buildSection({
      title: "Oversold Stocks Today (Potential Rebound Setups)",
      description:
        "Stocks showing multiple oversold-style technical signals. These are often reviewed for possible rebounds or dip-style entries.",
      source: green,
      take: 20,
    }),
    buildSection({
      title: "Best Trend Score Stocks",
      description:
        "Stocks with the strongest current trend structure based on price vs MA50 and MA200, MA50 vs MA200, and positive MACD momentum.",
      source: trendLeaders,
      take: 20,
    }),
    buildSection({
      title: "MA200 Proximity",
      description:
        "Stocks trading close to their Daily or Weekly MA200. Clicking a result opens the chart on the correct timeframe with MA200 selected.",
      source: ma200Proximity,
      take: 20,
    }),
    buildSection({
      title: "Overbought Stocks Today (Potential Pullback Setups)",
      description:
        "Stocks showing extended or overbought conditions. These are often reviewed for possible pullbacks or weaker near-term conditions.",
      source: red,
      take: 20,
    }),
    buildSection({
      title: "Bullish & Bearish Divergence Stocks (RSI & MACD Signals)",
      description:
        "Stocks where price and momentum may be starting to disagree. Clicking a result opens the chart on the strongest divergence indicator.",
      source: divergences,
      take: 20,
    }),
    buildSection({
      title: "Stocks Down 20% From Recent Highs (Buy the Dip)",
      description:
        "Stocks that recently hit highs and are now 20%+ below them. These are pullback setups from stronger charts, not deep long-term breakdowns.",
      source: dips,
      take: 20,
    }),
    buildSection({
      title: "All-Time High Breakout Stocks",
      description:
        "Stocks trading at or very near all-time closing highs. These are the strongest blue-sky breakout setups.",
      source: athBreakouts,
      take: 20,
      opts: { volumeFirstIfMany: true },
    }),
    buildSection({
      title: "3-Month High Breakout Stocks",
      description:
        "Stocks breaking above their highest closing level from the last 3 months, excluding the most recent few bars.",
      source: threeMonthBreakouts,
      take: 20,
      opts: { volumeFirstIfMany: true },
    }),
  ];

  return {
    updatedAt: new Date().toISOString(),
    universeSize: universe.length,
    dynamicUniverseCount:
      typeof market?.dynamicUniverseSize === "number"
        ? market.dynamicUniverseSize
        : dynamicUniverse.length,
    dynamicUniversePreview: dynamicUniverse.slice(0, 20),
    dynamicSymbols: dynamicUniverse,
    estimatedApiCalls: universe.length + 1,
    sections,
    signalRecords,
  };
  }

/* -------------------------------- GET -------------------------------- */

export async function GET(req: NextRequest) {
  const now = Date.now();

  if (memo && now - memo.ts < MEMORY_CACHE_MS) {
    return NextResponse.json(memo.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  const origin = originFromReq(req);
  const data = await buildPickersPayload(origin);

  memo = { ts: now, data };

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
    },
  });
}
