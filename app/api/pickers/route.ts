// app/api/pickers/route.ts
export const dynamic = "force-dynamic";

import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";
import { detectDivergenceFromHistory } from "../../../lib/ta/divergence";
import { getDailyHistory } from "../../../lib/server/historyCache";
import {
  addToDynamicUniverse,
  readDynamicUniverse,
} from "../../../lib/server/dynamicUniverseCache";

type Point = {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
};

type PickerChartPoint = {
  date: string;
  open?: number;
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
  chartPoints?: PickerChartPoint[];
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
    chartPoints?: PickerChartPoint[];
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
  chartPoints?: PickerChartPoint[];

  isDynamicUniverse?: boolean;
};

type PickersPayload = {
  updatedAt: string;
  universeSize: number;
  dynamicUniverseCount: number;
  dynamicUniversePreview: string[];
  dynamicSymbols: string[];
  estimatedApiCalls: number;
  sections: PickerSection[];
  signalRecords: SignalRecord[];
};

type CachedPickersPayload = {
  cachedAt: number;
  data: PickersPayload;
};

type TrendScoreResult = {
  total: number;
  passed: number;
  priceAboveMA200: boolean;
  priceAboveMA50: boolean;
  ma50AboveMA200: boolean;
  macdBullish: boolean;
};

type Ma200Candidate = {
  pctDistance: number;
  timeframe: "D" | "W";
  score: number;
  deepUnderPct: number;
  abovePct: number;
  slopePct: number;
};

type OversoldCandidate = {
  score: number;
  note: string;
};

type OverboughtCandidate = {
  score: number;
  note: string;
};

type AthPullbackCandidate = {
  score: number;
  drawdownPct: number;
  avgDollarVolume: number;
};

type BreakoutCandidate = {
  score: number;
  breakoutPct: number;
  breakoutBarsAgo: number;
  avgDollarVolume: number;
};

type EarningsRow = {
  symbol?: string;
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
};

type EarningsCandidate = {
  score: number;
  note: string;
  tone: PickerTone;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

/* ----------------------------- caching ------------------------------ */

let memo:
  | {
      ts: number;
      data: PickersPayload;
    }
  | null = null;

const CACHE_SECONDS = 60 * 6; // 6 minutes
const STALE_SECONDS = 60 * 6; // 6 minutes
const MEMORY_CACHE_MS = 60_000;

const PICKERS_REDIS_KEY = "msh:pickers:v6:earnings-sections";
const PICKERS_REDIS_TTL_SECONDS = 6 * 60;
const PICKERS_LOCK_KEY = "msh:pickers:v6:earnings-sections:lock";
const PICKERS_LOCK_TTL_SECONDS = 120;

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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function pctChange(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return 0;
  return ((to - from) / from) * 100;
}

function buildPickerChartPoints(points: Point[], bars = 56): PickerChartPoint[] {
  return points
    .slice(-bars)
    .map((point, index, arr) => {
      const fallbackOpen = index > 0 ? arr[index - 1].close : point.close;
      return {
        date: point.date,
        open:
          typeof point.open === "number" && Number.isFinite(point.open)
            ? Number(point.open.toFixed(2))
            : Number(fallbackOpen.toFixed(2)),
        close: Number(point.close.toFixed(2)),
        high:
          typeof point.high === "number" && Number.isFinite(point.high)
            ? Number(point.high.toFixed(2))
            : undefined,
        low:
          typeof point.low === "number" && Number.isFinite(point.low)
            ? Number(point.low.toFixed(2))
            : undefined,
        volume:
          typeof point.volume === "number" && Number.isFinite(point.volume)
            ? point.volume
            : undefined,
      };
    })
    .filter((point) => point.date && Number.isFinite(point.close));
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

function scoreLinear(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function scoreInverse(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return clamp(((max - value) / (max - min)) * 100, 0, 100);
}

function scoreTargetBand(value: number, idealMin: number, idealMax: number, hardMin: number, hardMax: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < hardMin || value > hardMax) return 0;
  if (value >= idealMin && value <= idealMax) return 100;

  if (value < idealMin) {
    return clamp(((value - hardMin) / (idealMin - hardMin)) * 100, 0, 100);
  }

  return clamp(((hardMax - value) / (hardMax - idealMax)) * 100, 0, 100);
}

function readPickersNotePercent(points: Point[], bars: number) {
  const slice = points.slice(-bars);
  return slice.length ? slice : points;
}

async function readPickersCache() {
  if (!redis) return null;

  try {
    const entry = await redis.get<CachedPickersPayload>(PICKERS_REDIS_KEY);
    if (!entry || typeof entry !== "object") return null;
    if (!entry.data || typeof entry.data !== "object") return null;
    return entry;
  } catch {
    return null;
  }
}

async function writePickersCache(data: PickersPayload) {
  if (!redis) return;

  try {
    const entry: CachedPickersPayload = {
      cachedAt: Date.now(),
      data,
    };

    await redis.set(PICKERS_REDIS_KEY, entry, {
      ex: PICKERS_REDIS_TTL_SECONDS,
    });
  } catch {
    // fail open
  }
}

async function acquirePickersLock() {
  if (!redis) return "no-redis";

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const result = await redis.set(PICKERS_LOCK_KEY, token, {
      nx: true,
      ex: PICKERS_LOCK_TTL_SECONDS,
    });

    if (result === "OK") return token;
    return null;
  } catch {
    return null;
  }
}

async function releasePickersLock(token: string | null) {
  if (!redis || !token || token === "no-redis") return;

  try {
    const current = await redis.get<string>(PICKERS_LOCK_KEY);
    if (current === token) {
      await redis.del(PICKERS_LOCK_KEY);
    }
  } catch {
    // fail open
  }
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

function computeMa200ProximityBasic(
  points: Point[],
  interval: "d" | "w"
): { pctDistance: number; timeframe: "D" | "W" } | null {
  const series = interval === "d" ? points : aggregatePoints(points, "w");

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

function averageDollarVolume(points: Point[], lookback = 20) {
  const slice = points.slice(-lookback);
  const values = slice
    .map((p) => {
      if (
        typeof p.close !== "number" ||
        !Number.isFinite(p.close) ||
        typeof p.volume !== "number" ||
        !Number.isFinite(p.volume)
      ) {
        return null;
      }
      return p.close * p.volume;
    })
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  return values.length ? avg(values) : 0;
}

function liquidityScore(points: Point[]) {
  const adv = averageDollarVolume(points, 20);
  return scoreLinear(Math.log10(Math.max(adv, 1)), 5, 8.7);
}

function recentVolatilityPct(points: Point[], lookback = 20) {
  const slice = points.slice(-lookback).filter((p) => Number.isFinite(p.close));
  if (slice.length < 2) return 0;

  let total = 0;
  let count = 0;

  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1].close;
    const cur = slice[i].close;
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) continue;
    total += Math.abs(((cur - prev) / prev) * 100);
    count++;
  }

  return count ? total / count : 0;
}

function computeMa200Candidate(points: Point[], interval: "d" | "w"): Ma200Candidate | null {
  const baseSeries = interval === "d" ? points : aggregatePoints(points, "w").map((p) => ({
    date: p.date,
    close: p.close,
    high: p.high,
    low: p.low,
    volume: p.volume,
  }));

  if (baseSeries.length < 220) return null;

  const closes = baseSeries.map((p) => p.close);
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

  const pctDistance = pctChange(lastMA200, lastClose);
  if (pctDistance < -1 || pctDistance > 3) return null;

  const lookback = Math.min(interval === "d" ? 500 : 260, closes.length);
  const start = Math.max(0, closes.length - lookback);

  let counted = 0;
  let deepUnder = 0;
  let above = 0;

  for (let i = start; i < closes.length; i++) {
    const close = closes[i];
    const ma200 = ma200Arr[i];
    if (typeof close !== "number" || typeof ma200 !== "number" || ma200 <= 0) continue;

    const distPct = ((close - ma200) / ma200) * 100;
    counted++;
    if (distPct < -7) deepUnder++;
    if (distPct > 0) above++;
  }

  if (!counted) return null;

  const deepUnderPct = (deepUnder / counted) * 100;
  const abovePct = (above / counted) * 100;

  const slopeLookback = Math.min(interval === "d" ? 30 : 12, ma200Arr.length - 1);
  const oldMA200 = ma200Arr[ma200Arr.length - 1 - slopeLookback];
  const slopePct =
    typeof oldMA200 === "number" && oldMA200 > 0
      ? ((lastMA200 - oldMA200) / oldMA200) * 100
      : 0;

  const distanceScore = scoreTargetBand(pctDistance, -0.25, 1.5, -1, 3);
  const deepUnderScore = scoreInverse(deepUnderPct, 20, 60);
  const aboveScore = scoreLinear(abovePct, 45, 85);
  const slopeScore = scoreLinear(slopePct, -2, 4);
  const liqScore = liquidityScore(points);

  const score =
    distanceScore * 0.28 +
    deepUnderScore * 0.32 +
    aboveScore * 0.18 +
    slopeScore * 0.14 +
    liqScore * 0.08;

  return {
    pctDistance,
    timeframe: interval === "d" ? "D" : "W",
    score,
    deepUnderPct,
    abovePct,
    slopePct,
  };
}

function compositeToneFromCounts(overbought: number, oversold: number, spikes: number) {
  const net = overbought - oversold;
  const intensity = overbought + oversold + spikes;

  if (intensity <= 1) return { tone: "yellow" as const, tag: "Calm" };

  if (net >= 2) {
    return {
      tone: intensity >= 5 ? ("red" as const) : ("orange" as const),
      tag: "Overbought-leaning",
    };
  }

  if (net === 1) return { tone: "orange" as const, tag: "Slightly overbought" };

  if (net <= -2) {
    return {
      tone: intensity >= 5 ? ("green" as const) : ("yellow" as const),
      tag: "Oversold-leaning",
    };
  }

  if (net === -1) return { tone: "yellow" as const, tag: "Slightly oversold" };

  return { tone: intensity >= 5 ? ("orange" as const) : ("yellow" as const), tag: "Mixed" };
}

function buildCompositeFromHistory(points: Point[]): CompositeResult | null {
  if (!points.length) return null;

  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 60) return null;

  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

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

  if (typeof last.rsi === "number") {
    if (last.rsi >= 70) overbought++;
    else if (last.rsi <= 30) oversold++;
  }

  if (typeof last.bbU === "number" && lastClose > last.bbU) overbought++;
  else if (typeof last.bbL === "number" && lastClose < last.bbL) oversold++;

  if (typeof last.ema20 === "number" && last.ema20 > 0) {
    const pct = (lastClose - last.ema20) / last.ema20;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  if (typeof last.ma50 === "number" && last.ma50 > 0) {
    const pct = (lastClose - last.ma50) / last.ma50;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  if (typeof last.ma200 === "number" && last.ma200 > 0) {
    const pct = (lastClose - last.ma200) / last.ma200;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  if (typeof last.macdHist === "number") {
    const thresh = Math.abs(lastClose) * 0.002;
    if (last.macdHist >= thresh) overbought++;
    else if (last.macdHist <= -thresh) oversold++;
  }

  if (typeof last.vol === "number" && typeof last.volSma === "number" && last.volSma > 0) {
    if (last.vol >= last.volSma * 1.8) spikes++;
  }

  if (typeof last.atr === "number" && typeof last.atrSma === "number" && last.atrSma > 0) {
    if (last.atr >= last.atrSma * 1.5) spikes++;
  }

  const total = 8;
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
  return c.oversold >= 2 && c.oversold > c.overbought;
}

function pickIsRedOverallSignal(c: CompositeResult) {
  return c.overbought >= 2 && c.overbought > c.oversold;
}

function buildTrendScoreFromHistory(points: Point[]): TrendScoreResult | null {
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

function computeOversoldCandidate(points: Point[], comp: CompositeResult | null, trendScore: TrendScoreResult | null): OversoldCandidate | null {
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 60 || !comp) return null;
  if (!pickIsGreenOverallSignal(comp)) return null;

  const rsi14 = rsiWilder(closes, 14);
  const ema20Arr = ema(closes, 20);
  const ma50Arr = movingAverage(closes, 50);
  const bb = bollinger(closes, 20, 2);

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2] ?? lastClose;
  const lastRsi = lastNum(rsi14);
  const lastEma20 = lastNum(ema20Arr);
  const lastMa50 = lastNum(ma50Arr);
  const lastBbLower = lastNum(bb.lower);

  const advScore = liquidityScore(points);

  const oversoldStrength =
    clamp(
      (typeof lastRsi === "number" ? scoreInverse(lastRsi, 15, 35) : 0) * 0.45 +
      comp.oversold * 12 +
      comp.flagged * 3,
      0,
      100
    );

  const distFromEma20 =
    typeof lastEma20 === "number" && lastEma20 > 0
      ? Math.abs(((lastClose - lastEma20) / lastEma20) * 100)
      : 0;

  const distFromMa50 =
    typeof lastMa50 === "number" && lastMa50 > 0
      ? Math.abs(((lastClose - lastMa50) / lastMa50) * 100)
      : 0;

  const distanceScore = clamp(
    scoreLinear(distFromEma20, 2, 12) * 0.6 + scoreLinear(distFromMa50, 3, 15) * 0.4,
    0,
    100
  );

  const dailyDrop1 = prevClose > 0 ? Math.max(0, ((prevClose - lastClose) / prevClose) * 100) : 0;
  const dailyDrop5Base = closes.length >= 6 ? closes[closes.length - 6] : prevClose;
  const dailyDrop5 = dailyDrop5Base > 0 ? Math.max(0, ((dailyDrop5Base - lastClose) / dailyDrop5Base) * 100) : 0;
  const avgAbsMove = recentVolatilityPct(points, 20);

  const exhaustionScore = clamp(
    scoreLinear(dailyDrop1, 0.8, 6) * 0.4 +
    scoreLinear(dailyDrop5, 2, 12) * 0.45 +
    scoreLinear(avgAbsMove, 1.2, 4.5) * 0.15,
    0,
    100
  );

  let structureScore = 50;
  if (trendScore) {
    structureScore =
      (trendScore.priceAboveMA200 ? 45 : 20) +
      (trendScore.priceAboveMA50 ? 20 : 5) +
      (trendScore.ma50AboveMA200 ? 20 : 5) +
      (trendScore.macdBullish ? 15 : 5);
  }

  if (typeof lastBbLower === "number" && lastClose < lastBbLower) {
    structureScore += 5;
  }

  const recencyScore = 100;

  let penalty = 0;
  if (dailyDrop1 < 0.6 && dailyDrop5 < 3) penalty += 12;
  if (advScore < 35) penalty += 25;
  if (trendScore && !trendScore.priceAboveMA200 && !trendScore.ma50AboveMA200) penalty += 10;

  const score =
    oversoldStrength * 0.3 +
    advScore * 0.25 +
    exhaustionScore * 0.2 +
    distanceScore * 0.15 +
    clamp(structureScore, 0, 100) * 0.05 +
    recencyScore * 0.05 -
    penalty;

  return {
    score,
    note: `${comp.oversold} oversold • liquid ${Math.round(advScore)} • exhaustion ${Math.round(exhaustionScore)}`,
  };
}

function computeOverboughtCandidate(points: Point[], comp: CompositeResult | null, trendScore: TrendScoreResult | null): OverboughtCandidate | null {
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 60 || !comp) return null;
  if (!pickIsRedOverallSignal(comp)) return null;

  const rsi14 = rsiWilder(closes, 14);
  const ema20Arr = ema(closes, 20);
  const ma50Arr = movingAverage(closes, 50);
  const bb = bollinger(closes, 20, 2);

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2] ?? lastClose;
  const lastRsi = lastNum(rsi14);
  const lastEma20 = lastNum(ema20Arr);
  const lastMa50 = lastNum(ma50Arr);
  const lastBbUpper = lastNum(bb.upper);

  const advScore = liquidityScore(points);

  const overboughtStrength =
    clamp(
      (typeof lastRsi === "number" ? scoreLinear(lastRsi, 65, 85) : 0) * 0.45 +
      comp.overbought * 12 +
      comp.flagged * 3,
      0,
      100
    );

  const distFromEma20 =
    typeof lastEma20 === "number" && lastEma20 > 0
      ? Math.abs(((lastClose - lastEma20) / lastEma20) * 100)
      : 0;

  const distFromMa50 =
    typeof lastMa50 === "number" && lastMa50 > 0
      ? Math.abs(((lastClose - lastMa50) / lastMa50) * 100)
      : 0;

  const distanceScore = clamp(
    scoreLinear(distFromEma20, 2, 12) * 0.6 + scoreLinear(distFromMa50, 3, 15) * 0.4,
    0,
    100
  );

  const dailyJump1 = prevClose > 0 ? Math.max(0, ((lastClose - prevClose) / prevClose) * 100) : 0;
  const dailyJump5Base = closes.length >= 6 ? closes[closes.length - 6] : prevClose;
  const dailyJump5 = dailyJump5Base > 0 ? Math.max(0, ((lastClose - dailyJump5Base) / dailyJump5Base) * 100) : 0;
  const avgAbsMove = recentVolatilityPct(points, 20);

  const extensionScore = clamp(
    scoreLinear(dailyJump1, 0.8, 6) * 0.4 +
    scoreLinear(dailyJump5, 2, 12) * 0.45 +
    scoreLinear(avgAbsMove, 1.2, 4.5) * 0.15,
    0,
    100
  );

  let structureScore = 50;
  if (trendScore) {
    structureScore =
      (trendScore.priceAboveMA200 ? 35 : 10) +
      (trendScore.priceAboveMA50 ? 25 : 5) +
      (trendScore.ma50AboveMA200 ? 20 : 5) +
      (trendScore.macdBullish ? 20 : 10);
  }

  if (typeof lastBbUpper === "number" && lastClose > lastBbUpper) {
    structureScore += 5;
  }

  let penalty = 0;
  if (dailyJump1 < 0.6 && dailyJump5 < 3) penalty += 12;
  if (advScore < 35) penalty += 25;

  const score =
    overboughtStrength * 0.3 +
    advScore * 0.25 +
    extensionScore * 0.2 +
    distanceScore * 0.15 +
    clamp(structureScore, 0, 100) * 0.05 +
    100 * 0.05 -
    penalty;

  return {
    score,
    note: `${comp.overbought} overbought • liquid ${Math.round(advScore)} • extension ${Math.round(extensionScore)}`,
  };
}

function computeAthPullback(points: Point[]): AthPullbackCandidate | null {
  const closes = points.map((p) => p.close).filter((x) => Number.isFinite(x));
  if (closes.length < 220) return null;

  const lastClose = closes[closes.length - 1];
  const allTimeHigh = Math.max(...closes);
  if (!Number.isFinite(allTimeHigh) || allTimeHigh <= 0) return null;

  const drawdownPct = ((allTimeHigh - lastClose) / allTimeHigh) * 100;
  if (drawdownPct < 20) return null;

  const adv = averageDollarVolume(points, 20);
  const advScore = liquidityScore(points);

  const distanceScore = scoreTargetBand(drawdownPct, 20, 35, 20, 65);

  const last20 = closes.slice(-20);
  const max20 = Math.max(...last20);
  const min20 = Math.min(...last20);
  const rangePct = min20 > 0 ? ((max20 - min20) / min20) * 100 : 0;
  const structureScore = scoreInverse(rangePct, 8, 35);

  const ma200Arr = movingAverage(closes, 200);
  const ma50Arr = movingAverage(closes, 50);
  const lastMa200 = lastNum(ma200Arr);
  const lastMa50 = lastNum(ma50Arr);

  let trendContext = 35;
  if (typeof lastMa200 === "number" && typeof lastMa50 === "number") {
    trendContext =
      (lastClose > lastMa200 ? 45 : 12) +
      (lastClose > lastMa50 ? 25 : 8) +
      (lastMa50 > lastMa200 ? 20 : 6);
  }

  const lookback10 = closes.length >= 11 ? closes[closes.length - 11] : closes[0];
  const recentBehaviour = lookback10 > 0 ? scoreTargetBand(pctChange(lookback10, lastClose), -4, 6, -15, 12) : 40;

  let penalty = 0;
  if (drawdownPct > 50) penalty += 20;
  if (drawdownPct > 60) penalty += 15;
  if (advScore < 35) penalty += 30;
  if (typeof lastMa200 === "number" && lastClose < lastMa200 * 0.85) penalty += 15;

  const score =
    distanceScore * 0.3 +
    advScore * 0.3 +
    structureScore * 0.2 +
    clamp(trendContext, 0, 100) * 0.1 +
    recentBehaviour * 0.1 -
    penalty;

  return {
    score,
    drawdownPct,
    avgDollarVolume: adv,
  };
}

function findMostRecentAthBreakoutBarsAgo(closes: number[]) {
  if (closes.length < 2) return null;

  for (let i = closes.length - 1; i >= 1; i--) {
    const before = closes.slice(0, i);
    if (!before.length) continue;
    const priorHigh = Math.max(...before);
    if (closes[i] >= priorHigh * 1.001) {
      return closes.length - 1 - i;
    }
  }

  return null;
}

function computeAthBreakout(points: Point[]): BreakoutCandidate | null {
  const pts = points.filter((p) => p?.date && Number.isFinite(p.close));
  if (pts.length < 120) return null;

  const closes = pts.map((p) => p.close);
  const lastClose = closes[closes.length - 1];
  const allTimeHigh = Math.max(...closes);
  if (!Number.isFinite(allTimeHigh) || allTimeHigh <= 0) return null;

  const eps = 0.01;
  const isAtAth = lastClose >= allTimeHigh * (1 - eps);
  if (!isAtAth) return null;

  const breakoutBarsAgo = findMostRecentAthBreakoutBarsAgo(closes);
  const breakoutPct = ((lastClose - allTimeHigh) / allTimeHigh) * 100;
  const adv = averageDollarVolume(points, 20);
  const advScore = liquidityScore(points);

  const recencyScore = breakoutBarsAgo == null ? 50 : scoreInverse(breakoutBarsAgo, 0, 25);
  const extensionScore = scoreInverse(Math.abs(breakoutPct), 0, 8);

  const volumeArr: (number | null)[] = pts.map((p) =>
    typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
  );
  const volSma20 = smaNullable(volumeArr, 20);
  const lastVol = lastNum(volumeArr);
  const lastVolSma = lastNum(volSma20);
  const volumeScore =
    typeof lastVol === "number" && typeof lastVolSma === "number" && lastVolSma > 0
      ? scoreLinear(lastVol / lastVolSma, 0.9, 2.2)
      : 45;

  let penalty = 0;
  if (advScore < 35) penalty += 25;
  if (Math.abs(breakoutPct) > 6) penalty += 15;

  const score =
    recencyScore * 0.45 +
    volumeScore * 0.25 +
    advScore * 0.2 +
    extensionScore * 0.1 -
    penalty;

  return {
    score,
    breakoutPct,
    breakoutBarsAgo: breakoutBarsAgo ?? 999,
    avgDollarVolume: adv,
  };
}

function computeThreeMonthBreakout(points: Point[]): BreakoutCandidate | null {
  const pts = points.filter((p) => p?.date && Number.isFinite(p.close));
  if (pts.length < 90) return null;

  const closes = pts.map((p) => p.close);
  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

  const LOOKBACK_BARS = 63;
  const EXCLUDE_RECENT_BARS = 5;

  const endExclusive = closes.length - EXCLUDE_RECENT_BARS;
  const startInclusive = endExclusive - LOOKBACK_BARS;

  if (startInclusive < 0 || endExclusive <= startInclusive) return null;

  const breakoutWindow = closes.slice(startInclusive, endExclusive);
  if (!breakoutWindow.length) return null;

  const rangeHigh = Math.max(...breakoutWindow);
  if (!Number.isFinite(rangeHigh) || rangeHigh <= 0) return null;

  const eps = 0.005;
  if (lastClose < rangeHigh * (1 - eps)) return null;

  let breakoutBarsAgo = 0;
  for (let i = closes.length - 1; i >= endExclusive; i--) {
    if (closes[i] >= rangeHigh * (1 - eps)) {
      breakoutBarsAgo = closes.length - 1 - i;
    }
  }

  const breakoutPct = ((lastClose - rangeHigh) / rangeHigh) * 100;
  const adv = averageDollarVolume(points, 20);
  const advScore = liquidityScore(points);

  const recencyScore = scoreInverse(breakoutBarsAgo, 0, 20);
  const extensionScore = scoreInverse(Math.abs(breakoutPct), 0, 10);

  const volumeArr: (number | null)[] = pts.map((p) =>
    typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null
  );
  const volSma20 = smaNullable(volumeArr, 20);
  const lastVol = lastNum(volumeArr);
  const lastVolSma = lastNum(volSma20);
  const volumeScore =
    typeof lastVol === "number" && typeof lastVolSma === "number" && lastVolSma > 0
      ? scoreLinear(lastVol / lastVolSma, 0.9, 2.2)
      : 45;

  let penalty = 0;
  if (advScore < 35) penalty += 25;
  if (Math.abs(breakoutPct) > 8) penalty += 12;

  const score =
    recencyScore * 0.45 +
    volumeScore * 0.25 +
    advScore * 0.2 +
    extensionScore * 0.1 -
    penalty;

  return {
    score,
    breakoutPct,
    breakoutBarsAgo,
    avgDollarVolume: adv,
  };
}

/* -------------------------- concurrency limit ------------------------ */

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

async function fetchJSON<T>(url: string, forceFresh = false) {
  const res = await fetch(
    forceFresh ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url,
    forceFresh
      ? { cache: "no-store" }
      : { next: { revalidate: 300 } }
  );

  if (!res.ok) throw new Error(`Fetch failed: ${url}`);
  return (await res.json()) as T;
}

async function fetchMarket(origin: string, forceFresh = false) {
  return fetchJSON<MarketPayload>(`${origin}/api/market`, forceFresh);
}

async function fetchHistory(symbol: string, days: number) {
  const pts = await getDailyHistory(symbol);

  return pts
    .map((p) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
      open: p?.open == null ? undefined : Number(p.open),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close))
    .slice(-days);
}

/* ------------------------------ universe ----------------------------- */

const PRESET_UNIVERSE: string[] = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","BRK.B","AVGO","LLY",
  "JPM","V","UNH","XOM","PG","MA","COST","HD","MRK","ABBV",
  "CRM","NFLX","ORCL","BAC","KO","PEP","ADBE","TMO","WMT","CSCO",
  "ACN","MCD","ABT","CVX","LIN","AMD","NKE","DHR","TXN","INTC",
  "QCOM","PM","IBM","NOW","SBUX","CAT","GE","AMAT","LOW","UBER",
  "PANW","PLTR","SHOP","MU","KLAC","LRCX","ANET","SNOW","CRWD","MELI",
  "ASML","APH","DE","PGR","VRTX","ADP","INTU","CMCSA","COP","AXP",
  "BKNG","AMGN","HON","ISRG","TJX","SYK","UNP","GILD","MDT","ADI",
  "CB","C","MO","GS","ETN","MMC","TMUS","CI","SO","DUK",
  "ELV","SCHW","BLK","REGN","FI","TT","PH","PYPL","CDNS","MAR",
];

const UNIVERSE_CAP = 200;

/* --------------------------- builder function ------------------------ */

async function buildPickersPayload(origin: string, forceFreshMarket = false): Promise<PickersPayload> {
  const market = await fetchMarket(origin, forceFreshMarket);

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

  const sharedUniverseEntries = await readDynamicUniverse();

  const sharedUniverseSymbols = sharedUniverseEntries.map(
    (entry) => entry.symbol
  );

  const dynamicUniverse = Array.from(
    new Set(
      [
        ...sharedUniverseSymbols,
        ...accumulatedDynamicUniverse,
        ...rankedDynamicUniverse,
      ]
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    )
  );

  await addToDynamicUniverse(
    [...accumulatedDynamicUniverse, ...rankedDynamicUniverse],
    "market",
    1
  );

  const dynamicUniverseSet = new Set(dynamicUniverse);

  const universe = Array.from(
    new Set(
      [...dynamicUniverse, ...PRESET_UNIVERSE]
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, UNIVERSE_CAP);

  const limit = pLimit(10);
  const days = 1300;

  const hotDynamicNames: PickerItem[] = [];
  const green: PickerItem[] = [];
  const red: PickerItem[] = [];
  const trendLeaders: PickerItem[] = [];
  const dips: PickerItem[] = [];
  const athBreakouts: PickerItem[] = [];
  const threeMonthBreakouts: PickerItem[] = [];
  const ma200Proximity: PickerItem[] = [];
  const divergences: PickerItem[] = [];
  const positiveLastEarnings: PickerItem[] = [];
  const strongEarningsGrowth: PickerItem[] = [];
  const signalRecords: SignalRecord[] = [];

  const isDynamicUniverse = (sym: string) => dynamicUniverseSet.has(sym);
  const dynamicBoost = (sym: string) => (isDynamicUniverse(sym) ? 10 : 0);

  await Promise.all(
    universe.map((symbol) =>
      limit(async () => {
        try {
          const [pts, earningsRows] = await Promise.all([
            fetchHistory(symbol, days),
            fetchFmpEarnings(symbol),
          ]);
          if (!pts.length) return;

          const dynamicName = isDynamicUniverse(symbol);
          const chartPoints = buildPickerChartPoints(pts);

          const positiveLastEarningsCandidate = computePositiveLastEarningsCandidate(earningsRows);
          if (positiveLastEarningsCandidate) {
            positiveLastEarnings.push({
              symbol,
              chartPoints,
              tone: positiveLastEarningsCandidate.tone,
              note: positiveLastEarningsCandidate.note,
              _score: positiveLastEarningsCandidate.score + dynamicBoost(symbol),
            });
          }

          const strongEarningsGrowthCandidate = computeStrongEarningsGrowthCandidate(earningsRows);
          if (strongEarningsGrowthCandidate) {
            strongEarningsGrowth.push({
              symbol,
              chartPoints,
              tone: strongEarningsGrowthCandidate.tone,
              note: strongEarningsGrowthCandidate.note,
              _score: strongEarningsGrowthCandidate.score + dynamicBoost(symbol),
            });
          }

          const comp = buildCompositeFromHistory(pts);
          const trendScore = buildTrendScoreFromHistory(pts);

          if (comp) {
            const hotSignals =
              (comp.oversold >= 2 ? 1 : 0) +
              (comp.overbought >= 2 ? 1 : 0) +
              (comp.spikes >= 1 ? 1 : 0);

            if (dynamicName && hotSignals > 0) {
              hotDynamicNames.push({
                symbol,
                chartPoints,
                tone: comp.tone,
                note: `${comp.tag} • ${comp.flagged}/${comp.total} checks`,
                _score: hotSignals * 100 + comp.flagged * 10 + dynamicBoost(symbol),
              });
            }
          }

          const oversoldCandidate = computeOversoldCandidate(pts, comp, trendScore);
          if (oversoldCandidate) {
            green.push({
              symbol,
              chartPoints,
              tone: "green",
              note: oversoldCandidate.note,
              _score: oversoldCandidate.score + dynamicBoost(symbol),
            });
          }

          const overboughtCandidate = computeOverboughtCandidate(pts, comp, trendScore);
          if (overboughtCandidate) {
            red.push({
              symbol,
              chartPoints,
              tone: "red",
              note: overboughtCandidate.note,
              _score: overboughtCandidate.score + dynamicBoost(symbol),
            });
          }

          if (trendScore && trendScore.passed >= 3) {
            const liqScore = liquidityScore(pts);
            const score =
              trendScore.passed * 20 +
              (trendScore.priceAboveMA200 ? 18 : 0) +
              (trendScore.priceAboveMA50 ? 12 : 0) +
              (trendScore.ma50AboveMA200 ? 18 : 0) +
              (trendScore.macdBullish ? 12 : 0) +
              liqScore * 0.2 +
              dynamicBoost(symbol);

            trendLeaders.push({
              symbol,
              chartPoints,
              tone: trendScore.passed === 4 ? "green" : "yellow",
              note: `${trendScore.passed}/${trendScore.total} trend checks`,
              _score: score,
            });
          }

          const athPullback = computeAthPullback(pts);
          if (athPullback) {
            dips.push({
              symbol,
              chartPoints,
              tone: athPullback.drawdownPct <= 35 ? "yellow" : "orange",
              note: `Down ${athPullback.drawdownPct.toFixed(1)}% from ATH • liquid ${Math.round(liquidityScore(pts))}`,
              _score: athPullback.score + dynamicBoost(symbol),
            });
          }

          const athBo = computeAthBreakout(pts);
          if (athBo) {
            athBreakouts.push({
              symbol,
              chartPoints,
              tone: "orange",
              note: `ATH breakout • ${athBo.breakoutBarsAgo} bars ago`,
              _score: athBo.score + dynamicBoost(symbol),
            });
          }

          const threeMonthBo = computeThreeMonthBreakout(pts);
          if (threeMonthBo) {
            threeMonthBreakouts.push({
              symbol,
              chartPoints,
              tone: "orange",
              note: `3-month breakout • ${threeMonthBo.breakoutBarsAgo} bars ago`,
              _score: threeMonthBo.score + dynamicBoost(symbol),
            });
          }

          const dailyMa200Candidate = computeMa200Candidate(pts, "d");
          if (dailyMa200Candidate) {
            const side = dailyMa200Candidate.pctDistance >= 0 ? "above" : "below";

            ma200Proximity.push({
              symbol,
              chartPoints,
              tone: dailyMa200Candidate.pctDistance >= 0 ? "yellow" : "orange",
              note: `Near Daily MA200 • ${Math.abs(dailyMa200Candidate.pctDistance).toFixed(1)}% ${side} • deep-under ${dailyMa200Candidate.deepUnderPct.toFixed(0)}%`,
              timeframe: "D",
              indicator: "MA200",
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: "D",
                indicator: "MA200",
              }),
              _score: dailyMa200Candidate.score + dynamicBoost(symbol),
            });
          }

          const weeklyMa200Candidate = computeMa200Candidate(pts, "w");
          if (weeklyMa200Candidate) {
            const side = weeklyMa200Candidate.pctDistance >= 0 ? "above" : "below";

            ma200Proximity.push({
              symbol,
              chartPoints,
              tone: weeklyMa200Candidate.pctDistance >= 0 ? "yellow" : "orange",
              note: `Near Weekly MA200 • ${Math.abs(weeklyMa200Candidate.pctDistance).toFixed(1)}% ${side} • deep-under ${weeklyMa200Candidate.deepUnderPct.toFixed(0)}%`,
              timeframe: "W",
              indicator: "MA200",
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: "W",
                indicator: "MA200",
              }),
              _score: weeklyMa200Candidate.score + 12 + dynamicBoost(symbol),
            });
          }

          const hasDailyMa200Proximity = !!dailyMa200Candidate;
          const hasWeeklyMa200Proximity = !!weeklyMa200Candidate;

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

          const divergenceCandidates = [dailyDiv, weeklyDiv]
            .filter(Boolean)
            .map((div, idx) => {
              const timeframe = idx === 0 ? ("D" as const) : ("W" as const);
              const timeframeScore = timeframe === "W" ? 100 : 65;
              const durationScore = scoreLinear(div!.pivotSpanBars, timeframe === "W" ? 5 : 6, timeframe === "W" ? 20 : 30);
              const magnitudeScore = scoreLinear(Math.abs(div!.priceSwingPct), 2, 15);
              const structureScore = scoreLinear(div!.score, 20, 95);

              const closes = pts.map((p) => p.close).filter((x) => Number.isFinite(x));
              const ma200Arr = movingAverage(closes, 200);
              const lastClose = closes[closes.length - 1];
              const lastMA200 = lastNum(ma200Arr);
              const locationDist =
                typeof lastClose === "number" && typeof lastMA200 === "number" && lastMA200 > 0
                  ? Math.abs(((lastClose - lastMA200) / lastMA200) * 100)
                  : 999;
              const locationScore = scoreInverse(locationDist, 0, 12);

              const reactionLookback = timeframe === "W" ? Math.min(4, weeklyPts.length - 1) : Math.min(5, pts.length - 1);
              const reactionSeries = timeframe === "W" ? weeklyPts : pts;
              const latestClose = reactionSeries[reactionSeries.length - 1]?.close ?? 0;
              const oldClose = reactionSeries[reactionSeries.length - 1 - reactionLookback]?.close ?? latestClose;
              const recentReactionPct = oldClose > 0 ? ((latestClose - oldClose) / oldClose) * 100 : 0;

              let reactionScore = 50;
              if (div!.kind === "bullish") {
                reactionScore = scoreLinear(recentReactionPct, -2, 8);
              } else {
                reactionScore = scoreLinear(-recentReactionPct, -2, 8);
              }

              let penalties = 0;
              if (liquidityScore(pts) < 35) penalties += 20;
              if (Math.abs(div!.priceSwingPct) < 2.5) penalties += 10;
              if (div!.pivotSpanBars < 4) penalties += 8;

              const finalScore =
                timeframeScore * 0.3 +
                durationScore * 0.2 +
                structureScore * 0.2 +
                magnitudeScore * 0.15 +
                locationScore * 0.1 +
                reactionScore * 0.05 -
                penalties;

              return {
                div: div!,
                timeframe,
                score: finalScore,
              };
            });

          const bestDiv = divergenceCandidates.sort((a, b) => b.score - a.score)[0] ?? null;

          if (bestDiv) {
            const preferredIndicator =
              bestDiv.div.hasRsi && !bestDiv.div.hasMacd
                ? "RSI(14)"
                : !bestDiv.div.hasRsi && bestDiv.div.hasMacd
                  ? "MACD(12,26,9)"
                  : bestDiv.div.hasRsi && bestDiv.div.hasMacd
                    ? "MACD(12,26,9)"
                    : undefined;

            const timeframeLabel = bestDiv.timeframe === "W" ? "Weekly" : "Daily";

            divergences.push({
              symbol,
              chartPoints,
              tone: bestDiv.div.kind === "bullish" ? "green" : "red",
              note: `${timeframeLabel} ${bestDiv.div.note} • ${bestDiv.div.priceSwingPct.toFixed(1)}% • ${bestDiv.div.pivotSpanBars} bars`,
              timeframe: bestDiv.timeframe,
              indicator: preferredIndicator,
              dashboardHref: buildDashboardHref({
                symbol,
                timeframe: bestDiv.timeframe,
                indicator: preferredIndicator,
              }),
              _score: bestDiv.score + dynamicBoost(symbol),
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

          const oversold = !!oversoldCandidate;
          const overbought = !!overboughtCandidate;
          const buyTheDip = !!athPullback;
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

          const chosenDiv = bestDiv?.div ?? null;

          const bullishRsiDivergence = !!chosenDiv && chosenDiv.kind === "bullish" && chosenDiv.hasRsi;
          const bearishRsiDivergence = !!chosenDiv && chosenDiv.kind === "bearish" && chosenDiv.hasRsi;
          const bullishMacdDivergence = !!chosenDiv && chosenDiv.kind === "bullish" && chosenDiv.hasMacd;
          const bearishMacdDivergence = !!chosenDiv && chosenDiv.kind === "bearish" && chosenDiv.hasMacd;

          const preferredDivergenceIndicator =
            bullishRsiDivergence || bearishRsiDivergence
              ? bullishMacdDivergence || bearishMacdDivergence
                ? "MACD(12,26,9)"
                : "RSI(14)"
              : bullishMacdDivergence || bearishMacdDivergence
                ? "MACD(12,26,9)"
                : undefined;

          const preferredTimeframe: "D" | "W" | undefined =
            preferredDivergenceIndicator && bestDiv ? bestDiv.timeframe : undefined;

          signalRecords.push({
            symbol,
            chartPoints,
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
            isDynamicUniverse: dynamicName,
          });
        } catch {
          // ignore per-symbol failures
        }
      })
    )
  );

  const takeTop = (arr: PickerItem[], n: number) => {
    const sorted = [...arr].sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    return sorted
      .slice(0, n)
      .map(({ symbol, note, tone, timeframe, indicator, dashboardHref, chartPoints }) => ({
        symbol,
        note,
        tone,
        timeframe,
        indicator,
        dashboardHref,
        chartPoints,
      }));
  };

  const buildSection = (args: {
    title: string;
    description?: string;
    source: PickerItem[];
    take: number;
  }): PickerSection => {
    const items = takeTop(args.source, args.take);

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
        "Oversold setups ranked by signal strength, liquidity, move exhaustion and short-term stretch rather than simple raw matches.",
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
      title: "Stocks With Positive Last Earnings",
      description:
        "Stocks ranked by the latest reported earnings beat, using EPS surprise, revenue surprise, positive EPS and report freshness.",
      source: positiveLastEarnings,
      take: 20,
    }),
    buildSection({
      title: "Stocks With Strong Earnings Growth",
      description:
        "Stocks ranked by year-over-year EPS and revenue growth, recent positive earnings consistency and beat history.",
      source: strongEarningsGrowth,
      take: 20,
    }),
    buildSection({
      title: "MA200 Proximity",
      description:
        "Stocks trading close to their Daily or Weekly MA200, with ranking favouring constructive MA200 behaviour over messy long-term weakness.",
      source: ma200Proximity,
      take: 20,
    }),
    buildSection({
      title: "Overbought Stocks Today (Potential Pullback Setups)",
      description:
        "Overbought setups ranked by signal strength, liquidity, extension and short-term stretch rather than simple raw matches.",
      source: red,
      take: 20,
    }),
    buildSection({
      title: "Bullish & Bearish Divergence Stocks (RSI & MACD Signals)",
      description:
        "Divergences ranked by timeframe, duration, structure quality, magnitude and location context. Clicking a result opens the strongest divergence view.",
      source: divergences,
      take: 20,
    }),
    buildSection({
      title: "Stocks Down 20% From All-Time Highs",
      description:
        "Stocks at least 20% below their all-time highs, ranked to favour liquid, tradable pullbacks over weak broken charts.",
      source: dips,
      take: 20,
    }),
    buildSection({
      title: "All-Time High Breakout Stocks",
      description:
        "Stocks trading at or very near all-time closing highs, ranked by breakout recency, liquidity and breakout quality.",
      source: athBreakouts,
      take: 20,
    }),
    buildSection({
      title: "3-Month High Breakout Stocks",
      description:
        "Stocks breaking above their highest closing level from the last 3 months, ranked by breakout recency, liquidity and breakout quality.",
      source: threeMonthBreakouts,
      take: 20,
    }),
  ];

  const displayedSymbols = new Set(
    sections.flatMap((section) => section.items.map((item) => item.symbol))
  );

  const filteredSignalRecords = signalRecords.filter((record) =>
    displayedSymbols.has(record.symbol)
  );

  return {
    updatedAt: new Date().toISOString(),
    universeSize: universe.length,
    dynamicUniverseCount:
      typeof market?.dynamicUniverseSize === "number"
        ? market.dynamicUniverseSize
        : dynamicUniverse.length,
    dynamicUniversePreview: dynamicUniverse.slice(0, 20),
    dynamicSymbols: dynamicUniverse,
    estimatedApiCalls: process.env.FMP_API_KEY ? universe.length * 2 + 1 : universe.length + 1,
    sections,
    signalRecords: filteredSignalRecords,
  };
}

/* -------------------------------- GET -------------------------------- */

export async function GET(req: NextRequest) {
  const now = Date.now();
  const forceRefresh = req.nextUrl.searchParams.get("force") === "1";

  if (!forceRefresh && memo && now - memo.ts < MEMORY_CACHE_MS) {
    return NextResponse.json(memo.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  const cached = forceRefresh ? null : await readPickersCache();

  if (!forceRefresh && cached?.data) {
    memo = { ts: now, data: cached.data };

    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  const lockToken = await acquirePickersLock();

  if (!lockToken && cached?.data) {
    memo = { ts: now, data: cached.data };

    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  }

  try {
    const origin = originFromReq(req);
    const data = await buildPickersPayload(origin, forceRefresh);

    memo = { ts: now, data };
    await writePickersCache(data);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": forceRefresh
          ? "no-store"
          : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });
  } catch (error) {
    if (cached?.data) {
      memo = { ts: now, data: cached.data };

      return NextResponse.json(cached.data, {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
        },
      });
    }

    const message =
      error instanceof Error ? error.message : "Unknown pickers error";

    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        universeSize: 0,
        dynamicUniverseCount: 0,
        dynamicUniversePreview: [],
        dynamicSymbols: [],
        estimatedApiCalls: 0,
        sections: [],
        signalRecords: [],
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } finally {
    await releasePickersLock(lockToken);
  }
}
