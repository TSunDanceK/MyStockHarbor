import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Tone = "green" | "yellow" | "orange" | "red";

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: Tone;
  score?: number; // for sorting
};

type PickerSection = {
  title: string;
  description?: string;
  items: PickerItem[];
};

type MarketRow = {
  symbol: string;
  volume: number | null;
};

type MarketPayload = {
  topTraded: MarketRow[];
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

/* --------------------- small math helpers (server) --------------------- */

function sma(values: number[], window: number): (number | null)[] {
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
  const mid = sma(values, window);
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

function stochastic(points: Point[], kPeriod = 14) {
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

  return k;
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

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
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

/* -------------------------- composite scoring -------------------------- */

type CompositeScore = {
  overbought: number;
  oversold: number;
  spikes: number;
  total: number;
};

function buildCompositeScore(points: Point[]): CompositeScore | null {
  if (!points.length) return null;

  const closes = points.map((p) => p.close);
  const lastClose = closes[closes.length - 1];
  if (!Number.isFinite(lastClose)) return null;

  const ma50 = lastNum(sma(closes, 50));
  const ma200 = lastNum(sma(closes, 200));
  const ema20v = lastNum(ema(closes, 20));
  const bb = bollinger(closes, 20, 2);
  const bbUpper = lastNum(bb.upper);
  const bbLower = lastNum(bb.lower);

  const rsi14 = lastNum(rsiWilder(closes, 14));
  const stochK = lastNum(stochastic(points, 14));
  const macdHist = lastNum(macd(closes, 12, 26, 9).hist);

  const vwap = lastNum(vwapFromPoints(points));

  const volumeFull = points.map((p) => (typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null));
  const volSma20 = lastNum(smaNullable(volumeFull, 20));
  const vol = lastNum(volumeFull);

  const atr14Arr = atr(points, 14);
  const atr14v = lastNum(atr14Arr);
  const atrSma20 = lastNum(smaNullable(atr14Arr, 20));

  let overbought = 0;
  let oversold = 0;
  let spikes = 0;

  // RSI
  if (typeof rsi14 === "number") {
    if (rsi14 >= 70) overbought++;
    else if (rsi14 <= 30) oversold++;
  }

  // Stoch
  if (typeof stochK === "number") {
    if (stochK >= 80) overbought++;
    else if (stochK <= 20) oversold++;
  }

  // Bollinger extremes
  if (typeof bbUpper === "number" && lastClose > bbUpper) overbought++;
  else if (typeof bbLower === "number" && lastClose < bbLower) oversold++;

  // VWAP distance (2%)
  if (typeof vwap === "number" && vwap > 0) {
    const pct = (lastClose - vwap) / vwap;
    if (pct >= 0.02) overbought++;
    else if (pct <= -0.02) oversold++;
  }

  // EMA20 distance (5%)
  if (typeof ema20v === "number" && ema20v > 0) {
    const pct = (lastClose - ema20v) / ema20v;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  // MA50 distance (5%)
  if (typeof ma50 === "number" && ma50 > 0) {
    const pct = (lastClose - ma50) / ma50;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  // MA200 distance (5%)
  if (typeof ma200 === "number" && ma200 > 0) {
    const pct = (lastClose - ma200) / ma200;
    if (pct >= 0.05) overbought++;
    else if (pct <= -0.05) oversold++;
  }

  // MACD hist vs price (0.2%)
  if (typeof macdHist === "number") {
    const thresh = Math.abs(lastClose) * 0.002;
    if (macdHist >= thresh) overbought++;
    else if (macdHist <= -thresh) oversold++;
  }

  // Volume spike (1.8x)
  if (typeof vol === "number" && typeof volSma20 === "number" && volSma20 > 0) {
    if (vol >= volSma20 * 1.8) spikes++;
  }

  // ATR spike (1.5x)
  if (typeof atr14v === "number" && typeof atrSma20 === "number" && atrSma20 > 0) {
    if (atr14v >= atrSma20 * 1.5) spikes++;
  }

  return { overbought, oversold, spikes, total: 10 };
}

/* ------------------------------ criteria ------------------------------ */

function isBuyTheDip(points: Point[]): { ok: boolean; note?: string } {
  // "Recently ATH within 4 months, but now down 20%+ from that ATH"
  // Use last ~120 bars as 4 months-ish (daily bars)
  if (points.length < 130) return { ok: false };

  const closes = points.map((p) => p.close);
  const last = closes[closes.length - 1];

  const lookback = 120;
  const start = Math.max(0, closes.length - lookback);
  const recent = closes.slice(start);

  const recentHigh = Math.max(...recent);
  const recentHighIdx = recent.lastIndexOf(recentHigh); // within recent window

  // ATH must have happened within the last 4 months window
  if (!Number.isFinite(recentHigh) || recentHigh <= 0) return { ok: false };

  const dropPct = ((last - recentHigh) / recentHigh) * 100;

  if (dropPct <= -20) {
    return { ok: true, note: `${dropPct.toFixed(1)}% off 4M high` };
  }

  // also require that the high was "near the top" of the 4M window (not ancient)
  // (This keeps it aligned with your description)
  if (recentHighIdx < recent.length - 120) return { ok: false };

  return { ok: false };
}

function isBreakout(points: Point[]): { ok: boolean; note?: string } {
  // "Hit ATH within last month"
  if (points.length < 60) return { ok: false };

  const closes = points.map((p) => p.close);
  const last = closes[closes.length - 1];

  const allTimeHigh = Math.max(...closes);
  if (!Number.isFinite(allTimeHigh) || allTimeHigh <= 0) return { ok: false };

  // must be basically at ATH (within 0.3%)
  const distPct = ((last - allTimeHigh) / allTimeHigh) * 100;
  if (distPct < -0.3) return { ok: false };

  // ATH must have happened within last ~22 trading days (1 month-ish)
  const lookback = 22;
  const recent = closes.slice(-lookback);
  const recentHigh = Math.max(...recent);

  if (Math.abs((recentHigh - allTimeHigh) / allTimeHigh) <= 0.00001) {
    return { ok: true, note: "New high (1M)" };
  }

  return { ok: false };
}

/* -------------------------- concurrency limiter -------------------------- */

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/* -------------------------------- route -------------------------------- */

export async function GET(req: Request) {
  // Build a base URL so this works on Vercel + locally
const host =
  req.headers.get("x-forwarded-host") ??
  req.headers.get("host") ??
  process.env.VERCEL_URL ??
  "localhost:3000";

const proto =
  req.headers.get("x-forwarded-proto") ??
  (host.includes("localhost") ? "http" : "https");

const baseUrl = host.startsWith("http") ? host : `${proto}://${host}`;

  // 1) Get Top Traded 50
  let topTraded: string[] = [];
  try {
    const mRes = await fetch(`${baseUrl}/api/market`, { cache: "no-store" });
    if (mRes.ok) {
      const m = (await mRes.json()) as MarketPayload;
      topTraded = (m?.topTraded ?? [])
        .map((x) => String(x?.symbol ?? "").toUpperCase())
        .filter(Boolean)
        .slice(0, 50);
    }
  } catch {
    topTraded = [];
  }

  // If market API fails, fall back to a small (but non-empty) set
  if (!topTraded.length) {
    topTraded = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "BRK.B", "JPM"];
  }

  // 2) Fetch history for each ticker and score it
  const historyDays = 2600; // like your dashboard (enough for MA200 etc.)

  const scored = await mapLimit(
    topTraded,
    8,
    async (symbol): Promise<{
      symbol: string;
      comp: CompositeScore | null;
      dip: { ok: boolean; note?: string };
      breakout: { ok: boolean; note?: string };
    }> => {
      try {
        const hRes = await fetch(`${baseUrl}/api/history?symbol=${encodeURIComponent(symbol)}&days=${historyDays}`, {
          cache: "no-store",
        });
        if (!hRes.ok) throw new Error("history failed");

        const h = (await hRes.json()) as { points?: any[] };
        const ptsRaw = Array.isArray(h?.points) ? h.points : [];

        const pts: Point[] = ptsRaw
          .map((p: any) => ({
            date: String(p?.date ?? ""),
            close: Number(p?.close),
            high: p?.high == null ? undefined : Number(p.high),
            low: p?.low == null ? undefined : Number(p.low),
            volume: p?.volume == null ? undefined : Number(p.volume),
          }))
          .filter((p) => p.date && Number.isFinite(p.close));

        const comp = buildCompositeScore(pts);
        const dip = isBuyTheDip(pts);
        const breakout = isBreakout(pts);

        return { symbol, comp, dip, breakout };
      } catch {
        return { symbol, comp: null, dip: { ok: false }, breakout: { ok: false } };
      }
    }
  );

  // 3) Build sections
  const green: PickerItem[] = [];
  const red: PickerItem[] = [];
  const dips: PickerItem[] = [];
  const breakouts: PickerItem[] = [];

  for (const s of scored) {
    const c = s.comp;
    if (c) {
      const net = c.oversold - c.overbought;

      // Green Composite criteria (oversold-leaning)
      if (net >= 2) {
        green.push({
          symbol: s.symbol,
          tone: "green",
          score: c.oversold * 10 + c.spikes, // most green markers first
          note: `${c.oversold} oversold / ${c.overbought} overbought`,
        });
      }

      // Red Composite criteria (overbought-leaning)
      if (-net >= 2) {
        red.push({
          symbol: s.symbol,
          tone: "red",
          score: c.overbought * 10 + c.spikes, // most red markers first
          note: `${c.overbought} overbought / ${c.oversold} oversold`,
        });
      }
    }

    // Buy the Dip
    if (s.dip.ok) {
      dips.push({
        symbol: s.symbol,
        tone: "yellow",
        score: 1,
        note: s.dip.note,
      });
    }

    // Breakouts
    if (s.breakout.ok) {
      breakouts.push({
        symbol: s.symbol,
        tone: "orange",
        score: 1,
        note: s.breakout.note,
      });
    }
  }

  // Sort & limit to 20 each
  green.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  red.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const sections: PickerSection[] = [
    {
      title: "Green Composite (Oversold-leaning)",
      description: "Top traded stocks skewing oversold across multiple indicators.",
      items: green.slice(0, 20),
    },
    {
      title: "Red Composite (Overbought-leaning)",
      description: "Top traded stocks skewing overbought / extended across multiple indicators.",
      items: red.slice(0, 20),
    },
    {
      title: "Buy The Dip",
      description: "Top traded stocks down 20%+ from a recent 4-month high.",
      items: dips.slice(0, 20),
    },
    {
      title: "Breakouts",
      description: "Top traded stocks printing / matching an all-time high within the last month.",
      items: breakouts.slice(0, 20),
    },
  ];

  return NextResponse.json({ sections, universe: topTraded.length });
}
