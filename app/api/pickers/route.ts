import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Pickers API
 * - Builds a larger universe of symbols
 * - Always prioritises Top Traded 50 inside each section
 * - Caps each section to 20 symbols
 * - Returns debug so you can verify what it did
 */

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

type PickerItem = { symbol: string; note?: string; tone?: "green" | "yellow" | "orange" | "red" };
type PickerSection = { title: string; description?: string; items: PickerItem[] };

function uniqStrings(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const x = s.trim().toUpperCase();
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function last<T>(arr: T[]) {
  return arr.length ? arr[arr.length - 1] : null;
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

  return { k };
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

function computeCompositeCounts(points: Point[]) {
  if (!points.length) return null;

  const closes = points.map((p) => p.close);
  const lastClose = last(closes);
  if (typeof lastClose !== "number") return null;

  const ma50 = last(movingAverage(closes, 50));
  const ma200 = last(movingAverage(closes, 200));
  const ema20 = last(ema(closes, 20));
  const rsi14 = last(rsiWilder(closes, 14));
  const macdHist = last(macd(closes, 12, 26, 9).hist);
  const stochK = last(stochastic(points, 14).k);
  const vwap = last(vwapFromPoints(points));

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

  // VWAP distance (2%)
  if (typeof vwap === "number" && vwap > 0) {
    const pct = (lastClose - vwap) / vwap;
    if (pct >= 0.02) overbought++;
    else if (pct <= -0.02) oversold++;
  }

  // EMA20 distance (5%)
  if (typeof ema20 === "number" && ema20 > 0) {
    const pct = (lastClose - ema20) / ema20;
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

  // MACD hist magnitude vs price (0.2%)
  if (typeof macdHist === "number" && Number.isFinite(macdHist)) {
    const thresh = Math.abs(lastClose) * 0.002;
    if (macdHist >= thresh) overbought++;
    else if (macdHist <= -thresh) oversold++;
  }

  // We keep spikes at 0 here to keep API light (you can add vol/atr spikes later).
  const total = 7;
  const flagged = overbought + oversold + spikes;

  return { total, flagged, overbought, oversold, spikes };
}

/**
 * Buy the Dip:
 * - "Recently at ATH" (ATH set within last ~120 bars)
 * - Now down 20% or more from that ATH
 */
function isBuyTheDip(points: Point[]) {
  if (points.length < 60) return false;
  const closes = points.map((p) => p.close);
  const cur = last(closes);
  if (typeof cur !== "number") return false;

  let max = -Infinity;
  let maxIdx = -1;
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i];
    if (v > max) {
      max = v;
      maxIdx = i;
    }
  }
  if (!Number.isFinite(max) || maxIdx < 0) return false;

  const barsSinceHigh = closes.length - 1 - maxIdx;
  if (barsSinceHigh > 120) return false; // “within ~4 months”
  return cur <= max * 0.8;
}

/**
 * Breakouts:
 * - Printed an all-time high within last ~30 bars
 */
function isBreakout(points: Point[]) {
  if (points.length < 30) return false;
  const closes = points.map((p) => p.close);

  let max = -Infinity;
  let maxIdx = -1;
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i];
    if (v > max) {
      max = v;
      maxIdx = i;
    }
  }
  if (!Number.isFinite(max) || maxIdx < 0) return false;

  const barsSinceHigh = closes.length - 1 - maxIdx;
  return barsSinceHigh <= 30;
}

/**
 * Promise pool so we don’t smash the API.
 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>) {
  const out: R[] = new Array(items.length) as any;
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return out;
}

/**
 * A bigger fallback universe so the page isn’t empty even when market API is small.
 * (You can expand this list anytime.)
 */
const FALLBACK_UNIVERSE = uniqStrings([
  "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","BRK.B","JPM","V","MA","UNH","XOM","AVGO","LLY","HD","COST","MRK","PEP",
  "KO","ABBV","CRM","NFLX","AMD","ADBE","QCOM","INTC","CSCO","WMT","T","VZ","ORCL","MCD","NKE","DIS","BAC","WFC","PM","IBM",
  "GE","CAT","BA","PFE","TMO","TXN","LIN","DHR","RTX","HON","LOW","UPS","SBUX","AMGN","GS","MS","SPY","QQQ","DIA","IWM",
  "PLTR","SNOW","SHOP","UBER","ABT","CVX","COP","NEE","SO","DUK","SCHW","BLK","C","AXP","DE","LMT","NOW","INTU","BKNG","MU",
  "PANW","CRWD","TSM","ASML","BABA","JD","PDD","NVO","SAP","SONY",
]);

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  const debug: any = {
    origin,
    universe: { priorityCount: 0, fallbackCount: FALLBACK_UNIVERSE.length, totalCount: 0 },
    fetches: { marketOk: false, historyOk: 0, historyFail: 0 },
    notes: [] as string[],
  };

  // 1) Get market (top traded / movers / ranges)
  let market: MarketPayload | null = null;
  try {
    const mRes = await fetch(`${origin}/api/market`, { cache: "no-store" });
    if (mRes.ok) {
      market = (await mRes.json()) as MarketPayload;
      debug.fetches.marketOk = true;
    } else {
      debug.notes.push(`/api/market not ok (${mRes.status})`);
    }
  } catch {
    debug.notes.push("Failed to fetch /api/market (using fallback universe)");
  }

  const topTraded = (market?.topTraded ?? []).map((r) => r.symbol).slice(0, 50);
  const movers = (market?.topMovers ?? []).map((r) => r.symbol);
  const ranges = (market?.topRanges ?? []).map((r) => r.symbol);

  const prioritySymbols = uniqStrings([...topTraded]);
  const extraMarket = uniqStrings([...movers, ...ranges]);

  // 2) Universe = priority first, then other market lists, then fallback list
  const universe = uniqStrings([...prioritySymbols, ...extraMarket, ...FALLBACK_UNIVERSE]);

  debug.universe.priorityCount = prioritySymbols.length;
  debug.universe.totalCount = universe.length;

  // 3) Fetch history for each symbol (pool limited)
  // NOTE: keep this reasonable; 1200 bars is enough for MA200 + “dip/breakout-ish” on free data.
  const DAYS = 1200;

  const histories = await mapPool(
    universe,
    6,
    async (symbol) => {
      try {
        const hRes = await fetch(`${origin}/api/history?symbol=${encodeURIComponent(symbol)}&days=${DAYS}`, {
          cache: "no-store",
        });
        if (!hRes.ok) {
          debug.fetches.historyFail++;
          return { symbol, points: null as Point[] | null };
        }
        const h = (await hRes.json()) as { symbol: string; points: any[] };
        const ptsRaw = Array.isArray(h.points) ? h.points : [];
        const points: Point[] = ptsRaw
          .map((p: any) => ({
            date: String(p?.date ?? ""),
            close: Number(p?.close),
            high: p?.high == null ? undefined : Number(p.high),
            low: p?.low == null ? undefined : Number(p.low),
            volume: p?.volume == null ? undefined : Number(p.volume),
          }))
          .filter((p) => p.date && Number.isFinite(p.close));

        if (points.length < 60) {
          debug.fetches.historyFail++;
          return { symbol, points: null as Point[] | null };
        }

        debug.fetches.historyOk++;
        return { symbol, points };
      } catch {
        debug.fetches.historyFail++;
        return { symbol, points: null as Point[] | null };
      }
    }
  );

  // 4) Compute signals per symbol
  const rows = histories
    .filter((x) => x.points && x.points.length)
    .map((x) => {
      const composite = computeCompositeCounts(x.points!);
      const dip = isBuyTheDip(x.points!);
      const breakout = isBreakout(x.points!);

      return {
        symbol: x.symbol,
        composite,
        dip,
        breakout,
        isPriority: prioritySymbols.includes(x.symbol),
      };
    })
    .filter((r) => r.composite); // require composite available

  function takeTop20(matches: typeof rows, sorter: (a: any, b: any) => number) {
    const pri = matches.filter((m) => m.isPriority).sort(sorter);
    const oth = matches.filter((m) => !m.isPriority).sort(sorter);
    return [...pri, ...oth].slice(0, 20);
  }

  // GREEN: oversold leaning, most oversold markers first
  const greenMatches = rows.filter((r) => {
    const c = r.composite!;
    return c.oversold >= 2 && c.oversold > c.overbought;
  });

  const greenFinal = takeTop20(greenMatches, (a, b) => {
    const ao = a.composite!.oversold - a.composite!.overbought;
    const bo = b.composite!.oversold - b.composite!.overbought;
    if (bo !== ao) return bo - ao;
    return (b.composite!.oversold ?? 0) - (a.composite!.oversold ?? 0);
  });

  // RED: overbought leaning, most overbought markers first
  const redMatches = rows.filter((r) => {
    const c = r.composite!;
    return c.overbought >= 2 && c.overbought > c.oversold;
  });

  const redFinal = takeTop20(redMatches, (a, b) => {
    const ao = a.composite!.overbought - a.composite!.oversold;
    const bo = b.composite!.overbought - b.composite!.oversold;
    if (bo !== ao) return bo - ao;
    return (b.composite!.overbought ?? 0) - (a.composite!.overbought ?? 0);
  });

  // DIP: use dip rule, prioritise top traded first
  const dipMatches = rows.filter((r) => r.dip);
  const dipFinal = takeTop20(dipMatches, (a, b) => {
    // modest sort: more oversold markers first
    return (b.composite!.oversold ?? 0) - (a.composite!.oversold ?? 0);
  });

  // BREAKOUTS: use breakout rule, prioritise top traded first
  const breakoutMatches = rows.filter((r) => r.breakout);
  const breakoutFinal = takeTop20(breakoutMatches, (a, b) => {
    // modest sort: more overbought markers first (strength)
    return (b.composite!.overbought ?? 0) - (a.composite!.overbought ?? 0);
  });

  const sections: PickerSection[] = [
    {
      title: "Green Composite (Oversold-leaning)",
      description: "Stocks flashing multiple oversold / dip-style signals.",
      items: greenFinal.map((r) => ({
        symbol: r.symbol,
        tone: "green",
        note: `${r.composite!.oversold} oversold`,
      })),
    },
    {
      title: "Red Composite (Overbought-leaning)",
      description: "Stocks looking stretched / extended / euphoric.",
      items: redFinal.map((r) => ({
        symbol: r.symbol,
        tone: "red",
        note: `${r.composite!.overbought} overbought`,
      })),
    },
    {
      title: "Buy The Dip",
      description: "Recently printed a high, then dropped 20%+ within ~4 months.",
      items: dipFinal.map((r) => ({
        symbol: r.symbol,
        tone: "yellow",
        note: "Dip setup",
      })),
    },
    {
      title: "Breakouts",
      description: "Printed a new high within the last month.",
      items: breakoutFinal.map((r) => ({
        symbol: r.symbol,
        tone: "orange",
        note: "New high",
      })),
    },
  ];

  // Extra debug so you can validate quickly
  debug.sections = sections.map((s) => ({ title: s.title, count: s.items.length }));
  debug.prioritySample = prioritySymbols.slice(0, 10);
  debug.universeSample = universe.slice(0, 15);

  return NextResponse.json({ updatedAt: new Date().toISOString(), sections, debug });
}
