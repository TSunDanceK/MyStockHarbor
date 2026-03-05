// lib/ta/divergence.ts

export type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type DivKind = "bullish" | "bearish";

export type DivergencePivot = {
  idx: number; // index within the lookback slice (0..lookbackBars-1)
  date: string;
  price: number;
  rsi: number | null;
  macd: number | null;
};

export type DivLinePoint = {
  index: number; // index within FULL series (0..n-1)
  value: number;
};

export type DivergenceLines = {
  // always available if we return a result
  price: { a: DivLinePoint; b: DivLinePoint };

  // only present if that indicator confirmed
  rsi?: { a: DivLinePoint; b: DivLinePoint };
  macd?: { a: DivLinePoint; b: DivLinePoint };
};

export type DivResult = {
  kind: DivKind;
  hasRsi: boolean;
  hasMacd: boolean;
  note: string;
  score: number;

  // for verification / UI
  lookbackBars: number;
  leftRight: number;
  minPriceSwingPct: number;
  minRsiSwing: number;

  priceSwingPct: number;
  rsiSwing: number | null;
  macdSwing: number | null;

  p1: DivergencePivot;
  p2: DivergencePivot;

  // NEW: points for drawing divergence lines on charts
  lines: DivergenceLines;
};

export type DivergenceOptions = {
  lookbackBars?: number; // default 40
  leftRight?: number; // default 3 (pivot strength)
  minPriceSwingPct?: number; // default 2.5 (filters tiny divergences)
  minRsiSwing?: number; // default 6 (RSI points)
  macdStdMult?: number; // default 0.6 (MACD must move vs its own volatility)

  // NEW: prevents "already played out" / too-old divergences
  // (how many bars ago the newest pivot (p2) is allowed to be)
  maxBarsSincePivot?: number; // default 15
};

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (!values.length) return out;

  if (period <= 1) {
    for (let i = 0; i < values.length; i++) out[i] = values[i];
    return out;
  }

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

function macdLine(values: number[], fast = 12, slow = 26): (number | null)[] {
  const eFast = ema(values, fast);
  const eSlow = ema(values, slow);

  return values.map((_, i) => {
    const f = eFast[i];
    const s = eSlow[i];
    if (!isFiniteNum(f) || !isFiniteNum(s)) return null;
    return f - s;
  });
}

function mean(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let v = 0;
  for (const x of arr) v += (x - m) * (x - m);
  v /= arr.length;
  return Math.sqrt(v);
}

// Pivot detection: pivot must be strictly lowest/highest in a neighborhood
function findPivotLows(values: number[], leftRight: number) {
  const pivots: number[] = [];
  const L = Math.max(1, leftRight);

  for (let i = L; i < values.length - L; i++) {
    const v = values[i];
    let ok = true;

    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue;
      if (values[j] <= v) {
        ok = false;
        break;
      }
    }

    if (ok) pivots.push(i);
  }

  return pivots;
}

function findPivotHighs(values: number[], leftRight: number) {
  const pivots: number[] = [];
  const L = Math.max(1, leftRight);

  for (let i = L; i < values.length - L; i++) {
    const v = values[i];
    let ok = true;

    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue;
      if (values[j] >= v) {
        ok = false;
        break;
      }
    }

    if (ok) pivots.push(i);
  }

  return pivots;
}

function lastTwo(pivots: number[]) {
  if (pivots.length < 2) return null;
  return [pivots[pivots.length - 2], pivots[pivots.length - 1]] as const;
}

export function detectDivergenceFromHistory(points: Point[], opts?: DivergenceOptions): DivResult | null {
  const lookbackBars = clamp(opts?.lookbackBars ?? 40, 20, 140);
  const leftRight = clamp(opts?.leftRight ?? 3, 1, 8);
  const minPriceSwingPct = clamp(opts?.minPriceSwingPct ?? 2.5, 0.2, 15);
  const minRsiSwing = clamp(opts?.minRsiSwing ?? 6, 1, 25);
  const macdStdMult = clamp(opts?.macdStdMult ?? 0.6, 0.05, 5);

  const maxBarsSincePivot = clamp(opts?.maxBarsSincePivot ?? 15, 3, 60);

  const clean = points
    .map((p) => ({
      date: String(p?.date ?? ""),
      close: Number(p?.close),
    }))
    .filter((p) => p.date && isFiniteNum(p.close));

  // Need enough history for RSI/MACD stabilization + pivots
  if (clean.length < Math.max(lookbackBars + 30, 80)) return null;

  const nAll = clean.length;
  const start = Math.max(0, nAll - lookbackBars);

  const slice = clean.slice(start);
  const closes = slice.map((p) => p.close);
  const dates = slice.map((p) => p.date);

  // Oscillators computed over full history, then sliced to align with the lookback slice
  const allCloses = clean.map((p) => p.close);
  const rsiAll = rsiWilder(allCloses, 14);
  const macdAll = macdLine(allCloses, 12, 26);

  const rsi = rsiAll.slice(start);
  const macd = macdAll.slice(start);

  // MACD volatility baseline (avoid microscopic calls)
  const macdNums = macd.filter(isFiniteNum);
  const macdSd = stddev(macdNums);
  const macdMinMove = Math.max(1e-12, macdSd * macdStdMult);

  const candidates: DivResult[] = [];

  // Helper: freshness check (p2 must be recent)
  const isFresh = (i2InSlice: number) => {
    const i2Global = start + i2InSlice;
    const barsAgo = (nAll - 1) - i2Global;
    return barsAgo <= maxBarsSincePivot;
  };

  // ---------- Bullish divergence (pivot lows) ----------
  {
    const lowPivots = findPivotLows(closes, leftRight);
    const two = lastTwo(lowPivots);
    if (two) {
      const [i1, i2] = two;
      const p1 = closes[i1];
      const p2 = closes[i2];

      // price lower low by enough %
      const priceSwingPct = p1 > 0 ? ((p1 - p2) / p1) * 100 : 0;

      if (p2 < p1 && priceSwingPct >= minPriceSwingPct && isFresh(i2)) {
        const r1 = rsi[i1];
        const r2 = rsi[i2];
        const m1 = macd[i1];
        const m2 = macd[i2];

        const hasRsi = isFiniteNum(r1) && isFiniteNum(r2) && (r2 - r1) >= minRsiSwing;

        const macdSwing = isFiniteNum(m1) && isFiniteNum(m2) ? m2 - m1 : null;
        const hasMacd = isFiniteNum(macdSwing) && macdSwing >= macdMinMove;

        if (hasRsi || hasMacd) {
          const rsiSwing = isFiniteNum(r1) && isFiniteNum(r2) ? r2 - r1 : null;

          // Score: big price divergence matters most; then confirmation strength
          const score =
            priceSwingPct * 12 +
            (isFiniteNum(rsiSwing) ? rsiSwing * 2 : 0) +
            (isFiniteNum(macdSwing) ? Math.abs(macdSwing) * 220 : 0);

          const parts: string[] = [];
          if (hasRsi) parts.push("Bullish RSI div");
          if (hasMacd) parts.push("Bullish MACD div");

          const i1Global = start + i1;
          const i2Global = start + i2;

          candidates.push({
            kind: "bullish",
            hasRsi,
            hasMacd,
            note: parts.join(" • "),
            score,

            lookbackBars,
            leftRight,
            minPriceSwingPct,
            minRsiSwing,

            priceSwingPct,
            rsiSwing,
            macdSwing,

            p1: {
              idx: i1,
              date: dates[i1],
              price: p1,
              rsi: isFiniteNum(r1) ? r1 : null,
              macd: isFiniteNum(m1) ? m1 : null,
            },
            p2: {
              idx: i2,
              date: dates[i2],
              price: p2,
              rsi: isFiniteNum(r2) ? r2 : null,
              macd: isFiniteNum(m2) ? m2 : null,
            },

            lines: {
              price: { a: { index: i1Global, value: p1 }, b: { index: i2Global, value: p2 } },
              rsi: hasRsi
                ? { a: { index: i1Global, value: r1 as number }, b: { index: i2Global, value: r2 as number } }
                : undefined,
              macd: hasMacd
                ? { a: { index: i1Global, value: m1 as number }, b: { index: i2Global, value: m2 as number } }
                : undefined,
            },
          });
        }
      }
    }
  }

  // ---------- Bearish divergence (pivot highs) ----------
  {
    const highPivots = findPivotHighs(closes, leftRight);
    const two = lastTwo(highPivots);
    if (two) {
      const [i1, i2] = two;
      const p1 = closes[i1];
      const p2 = closes[i2];

      // price higher high by enough %
      const priceSwingPct = p1 > 0 ? ((p2 - p1) / p1) * 100 : 0;

      if (p2 > p1 && priceSwingPct >= minPriceSwingPct && isFresh(i2)) {
        const r1 = rsi[i1];
        const r2 = rsi[i2];
        const m1 = macd[i1];
        const m2 = macd[i2];

        const hasRsi = isFiniteNum(r1) && isFiniteNum(r2) && (r1 - r2) >= minRsiSwing;

        const macdSwing = isFiniteNum(m1) && isFiniteNum(m2) ? m2 - m1 : null;
        const hasMacd = isFiniteNum(macdSwing) && (-macdSwing) >= macdMinMove;

        if (hasRsi || hasMacd) {
          const rsiSwing = isFiniteNum(r1) && isFiniteNum(r2) ? r2 - r1 : null;

          const score =
            priceSwingPct * 12 +
            (isFiniteNum(rsiSwing) ? Math.abs(rsiSwing) * 2 : 0) +
            (isFiniteNum(macdSwing) ? Math.abs(macdSwing) * 220 : 0);

          const parts: string[] = [];
          if (hasRsi) parts.push("Bearish RSI div");
          if (hasMacd) parts.push("Bearish MACD div");

          const i1Global = start + i1;
          const i2Global = start + i2;

          candidates.push({
            kind: "bearish",
            hasRsi,
            hasMacd,
            note: parts.join(" • "),
            score,

            lookbackBars,
            leftRight,
            minPriceSwingPct,
            minRsiSwing,

            priceSwingPct,
            rsiSwing,
            macdSwing,

            p1: {
              idx: i1,
              date: dates[i1],
              price: p1,
              rsi: isFiniteNum(r1) ? r1 : null,
              macd: isFiniteNum(m1) ? m1 : null,
            },
            p2: {
              idx: i2,
              date: dates[i2],
              price: p2,
              rsi: isFiniteNum(r2) ? r2 : null,
              macd: isFiniteNum(m2) ? m2 : null,
            },

            lines: {
              price: { a: { index: i1Global, value: p1 }, b: { index: i2Global, value: p2 } },
              rsi: hasRsi
                ? { a: { index: i1Global, value: r1 as number }, b: { index: i2Global, value: r2 as number } }
                : undefined,
              macd: hasMacd
                ? { a: { index: i1Global, value: m1 as number }, b: { index: i2Global, value: m2 as number } }
                : undefined,
            },
          });
        }
      }
    }
  }

  if (!candidates.length) return null;

  // Prefer strongest
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}
