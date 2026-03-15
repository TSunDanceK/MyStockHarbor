// app/api/pickers/route.ts
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { detectDivergenceFromHistory } from "../../../lib/ta/divergence";

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
};

type PickerTone = "green" | "yellow" | "orange" | "red";

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
  // internal sorting helpers (not returned)
  _score?: number;
};

type PickerSection = {
  title: string;
  description?: string;
  items: { symbol: string; note?: string; tone?: PickerTone }[];
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

/* ----------------------------- caching ------------------------------ */

let memo:
  | {
      ts: number;
      data: any;
    }
  | null = null;

const CACHE_SECONDS = 3600; // 1 hour CDN cache
const STALE_SECONDS = 7200; // allow stale for 2 hours while revalidating
const MEMORY_CACHE_MS = 3_600_000; // 1 hour in-memory cache

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

function computeBreakout(points: Point[]) {
  /**
   * Stricter breakout:
   * - Must have made (or effectively matched) ATH VERY recently (last ~10 trading bars)
   * - AND current close must still be near ATH (within 1%)
   *
   * This avoids "old" breakouts that happened weeks/months ago.
   */
  const pts = points.filter((p) => p?.date && Number.isFinite(p.close));
  if (pts.length < 80) return null;

  const closes = pts.map((p) => p.close);
  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

  const allTimeHigh = Math.max(...closes);
  if (!Number.isFinite(allTimeHigh) || allTimeHigh <= 0) return null;

  // how close counts as "at ATH"
  const epsAth = 0.002; // 0.2% of ATH
  const athFloor = allTimeHigh * (1 - epsAth);

  // find the most recent bar that matched ATH (within eps)
  let lastAthIdx = -1;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] >= athFloor) {
      lastAthIdx = i;
      break;
    }
  }
  if (lastAthIdx === -1) return null;

  // MUST be very recent (last 10 trading bars)
  const RECENT_BARS = 5;
  if (lastAthIdx < closes.length - RECENT_BARS) return null;

  // current price must still be close to ATH (within 1%)
  const nearNow = lastClose >= allTimeHigh * 0.99;
  if (!nearNow) return null;

  const when = pts[lastAthIdx]?.date ?? null;
  return { ath: allTimeHigh, when };
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

async function fetchHistory(origin: string, symbol: string, days: number) {
  const u = `${origin}/api/history?symbol=${encodeURIComponent(symbol)}&days=${days}`;
  const data = await fetchJSON<{ symbol: string; points: any[] }>(u);

  const ptsRaw = Array.isArray(data.points) ? data.points : [];
  const pts: Point[] = ptsRaw
    .map((p: any) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
      high: p?.high == null ? undefined : Number(p.high),
      low: p?.low == null ? undefined : Number(p.low),
      volume: p?.volume == null ? undefined : Number(p.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close));

  return pts;
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
  const topTraded = (market?.topTraded ?? []).map((x) => x.symbol).filter(Boolean);

  // Top 100 always prioritized first
  const top100 = Array.from(new Set(topTraded)).slice(0, 100);

  // Wider universe to fill remaining slots
  const universe = Array.from(new Set([...top100, ...PRESET_UNIVERSE]));

  const limit = pLimit(8); // concurrency cap
  const days = 2600; // enough history for MA200-ish signals

  const green: PickerItem[] = [];
  const red: PickerItem[] = [];
  const dips: PickerItem[] = [];
  const breakouts: PickerItem[] = [];
  const divergences: PickerItem[] = [];

  // helper for “top100 first” scoring
  const isTop100 = (sym: string) => top100.includes(sym);
  const top100Boost = (sym: string) => (isTop100(sym) ? 1000 : 0);

  await Promise.all(
    universe.map((symbol) =>
      limit(async () => {
        try {
          const pts = await fetchHistory(origin, symbol, days);
          if (!pts.length) return;

          const comp = buildCompositeFromHistory(pts);

          if (comp) {
            // green/red composite
            if (pickIsGreenOverallSignal(comp)) {
              green.push({
                symbol,
                tone: "green",
                note: `${comp.oversold} oversold • ${comp.flagged}/${comp.total} checks`,
               _score: top100Boost(symbol) + comp.oversold * 50 + comp.flagged * 10,
              });
            }

            if (pickIsRedOverallSignal(comp)) {
              red.push({
                symbol,
                tone: "red",
                note: `${comp.overbought} overbought • ${comp.flagged}/${comp.total} checks`,
                _score: top100Boost(symbol) + comp.overbought * 50 + comp.flagged * 10,
              });
            }
          }

          // Buy the Dip
          const dip = computeBuyTheDip(pts);
          if (dip) {
            dips.push({
              symbol,
              tone: "yellow",
              note: `Down ${dip.drawdownPct.toFixed(1)}% from recent ATH`,
              _score: top100Boost(symbol) + dip.drawdownPct,
            });
          }

// Breakouts
const bo = computeBreakout(pts);
if (bo) {
  const volSpike = typeof (bo as any).volumeSpike === "number" ? (bo as any).volumeSpike : 0;

  breakouts.push({
    symbol,
    tone: "orange",
    note: `ATH + vol ${volSpike ? `${volSpike.toFixed(2)}×` : "—"}`,
    // Score: top50 boost + volume spike dominates + tiny recency nudge
    _score: top100Boost(symbol) + volSpike * 1000 + 1,
  });
}

const div = detectDivergenceFromHistory(pts, {
  lookbackBars: 60,
  leftRight: 2,
  minPriceSwingPct: 1.2,
  minRsiSwing: 4,
  macdStdMult: 0.35,
  maxPivot2AgeBars: 12,
});
          if (div) {
            divergences.push({
              symbol,
              tone: div.kind === "bullish" ? "green" : "red",
              note: div.note,
              _score: top100Boost(symbol) + div.score,
            });
          }
        } catch {
          // ignore per-symbol failures
        }
      })
    )
  );

const takeTop = (arr: PickerItem[], n: number, opts?: { volumeFirstIfMany?: boolean }) => {
  const volumeFirst = opts?.volumeFirstIfMany === true && arr.length > 10;

  const sorted = [...arr].sort((a, b) => {
    // If many breakouts: volume spike dominates (we encoded it into _score already)
    if (volumeFirst) return (b._score ?? 0) - (a._score ?? 0);

    // Default: still use _score (works for all other lists)
    return (b._score ?? 0) - (a._score ?? 0);
  });

  return sorted.slice(0, n).map(({ symbol, note, tone }) => ({ symbol, note, tone }));
};

  const sections: PickerSection[] = [
    {
      title: "Green Overall Signal (Oversold-leaning)",
      description: 'Stocks flashing multiple "oversold / dip-style" signals. Top traded are prioritised.',
      items: takeTop(green, 20),
    },
    {
      title: "Red Overall Signal (Overbought-leaning)",
      description: "Stocks looking stretched / extended. Top traded are prioritised.",
      items: takeTop(red, 20),
    },
    {
      title: "Divergences (Last ~40 bars)",
      description: "RSI / MACD divergences (bullish or bearish). Strongest signals first.",
      items: takeTop(divergences, 20),
    },
    {
      title: "Buy The Dip",
      description: "Recently at ATH, but down 20%+ within ~4 months. Top traded are prioritised.",
      items: takeTop(dips, 20),
    },
{
  title: "Breakouts",
  description: "Fresh ATH breakouts. If >10, ranked by volume spike first. Top traded are prioritised.",
  items: takeTop(breakouts, 20, { volumeFirstIfMany: true }),
},
  ];

  return {
    updatedAt: new Date().toISOString(),
    universeSize: universe.length,
    top100Count: top100.length,
    estimatedApiCalls: universe.length + 1,
    sections,
  };
}

/* -------------------------------- GET -------------------------------- */

export async function GET(req: NextRequest) {
  const now = Date.now();

  // 1) in-memory warm cache
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
