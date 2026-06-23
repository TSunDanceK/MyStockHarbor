// lib/indicators.ts
// Pure indicator functions shared between the server component (for SSR
// metadata + seed props) and the client component (for interactive chart).
// No browser APIs — safe to import in both environments.

export type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

// ── Moving average ───────────────────────────────────────────────────────────
export function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

// ── RSI (Wilder smoothing) ───────────────────────────────────────────────────
export function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff; else loss += -diff;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  }
  return out;
}

// ── EMA ──────────────────────────────────────────────────────────────────────
function avgArr(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let current = avgArr(values.slice(0, period));
  out[period - 1] = current;
  for (let i = period; i < values.length; i++) {
    current = (values[i] - current) * multiplier + current;
    out[i] = current;
  }
  return out;
}

// ── MACD ─────────────────────────────────────────────────────────────────────
export type MacdResult = {
  macd: number;
  signal: number;
  histogram: number;
  label: "Bullish" | "Bearish" | "Mixed";
  tone: "green" | "yellow" | "red";
  meta: string;
};

export function buildMacd(values: number[]): MacdResult | null {
  if (values.length < 35) return null;
  const ema12 = ema(values, 12), ema26 = ema(values, 26);
  const macdLine = values.map((_, i) => {
    const fast = ema12[i], slow = ema26[i];
    return typeof fast === "number" && typeof slow === "number" ? fast - slow : null;
  });
  const firstIdx = macdLine.findIndex((v) => typeof v === "number");
  if (firstIdx < 0) return null;
  const macdValues = macdLine.slice(firstIdx).filter((v): v is number => typeof v === "number");
  const signalValues = ema(macdValues, 9);
  const lastSignal = signalValues[signalValues.length - 1];
  const lastMacd = macdValues[macdValues.length - 1];
  if (typeof lastMacd !== "number" || typeof lastSignal !== "number") return null;
  const histogram = lastMacd - lastSignal;
  const quietThreshold = Math.max(values[values.length - 1] * 0.001, 0.03);
  if (Math.abs(histogram) <= quietThreshold)
    return { macd: lastMacd, signal: lastSignal, histogram, label: "Mixed", tone: "yellow", meta: "MACD near signal line" };
  if (histogram > 0)
    return { macd: lastMacd, signal: lastSignal, histogram, label: "Bullish", tone: "green", meta: "Momentum above signal" };
  return { macd: lastMacd, signal: lastSignal, histogram, label: "Bearish", tone: "red", meta: "Momentum below signal" };
}

// ── Trend helpers ─────────────────────────────────────────────────────────────
export function buildTrendScore(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { lastClose, ma50, ma200 } = args;
  const checks = [
    typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : null,
    typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : null,
    typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : null,
  ];
  const passed = checks.reduce((acc, v) => acc + (v === true ? 1 : 0), 0);
  return { passed, total: 3 };
}

export function trendLabel(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
}): "Uptrend" | "Downtrend" | "Range / Mixed" {
  const { lastClose, ma50, ma200 } = args;
  if (typeof lastClose === "number" && typeof ma50 === "number" && typeof ma200 === "number") {
    if (lastClose > ma50 && ma50 > ma200) return "Uptrend";
    if (lastClose < ma50 && ma50 < ma200) return "Downtrend";
  }
  return "Range / Mixed";
}

export function lastNum(arr: (number | null)[]): number | null {
  return arr.length ? arr[arr.length - 1] : null;
}

// ── Percent from base ────────────────────────────────────────────────────────
export function pctFromBase(last: number | null, base: number | null): number | null {
  if (
    typeof last !== "number" || typeof base !== "number" ||
    !Number.isFinite(last) || !Number.isFinite(base) || base === 0
  ) return null;
  return ((last - base) / base) * 100;
}

// ── Derived seed type (passed from server → client) ──────────────────────────
export type IndicatorSeed = {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi: number | null;
  trendScore: { passed: number; total: number };
  trend: "Uptrend" | "Downtrend" | "Range / Mixed";
  macdLabel: "Bullish" | "Bearish" | "Mixed" | null;
  companyName: string;
  price: number | null;
  priceDate: string | null;
};

// ── Compute seed from raw history points ─────────────────────────────────────
export function computeIndicatorSeed(
  points: Point[],
  companyName: string,
  price: number | null,
  priceDate: string | null,
): IndicatorSeed {
  const closes = points.map((p) => p.close);
  const ma50arr = movingAverage(closes, 50);
  const ma200arr = movingAverage(closes, 200);
  const rsi14arr = rsiWilder(closes, 14);
  const lastClose = points.length ? points[points.length - 1].close : null;
  const ma50 = lastNum(ma50arr);
  const ma200 = lastNum(ma200arr);
  const rsi = lastNum(rsi14arr);
  const ts = buildTrendScore({ lastClose, ma50, ma200 });
  const trend = trendLabel({ lastClose, ma50, ma200 });
  const macd = buildMacd(closes);
  return {
    lastClose,
    ma50,
    ma200,
    rsi,
    trendScore: ts,
    trend,
    macdLabel: macd?.label ?? null,
    companyName,
    price,
    priceDate,
  };
}

// ── Build live meta strings from a seed ──────────────────────────────────────
export function buildSeoTitle(symbol: string, seed: IndicatorSeed): string {
  const { trend, rsi, ma50, ma200, lastClose } = seed;

  // MA position phrase
  let maPhrase = "";
  if (typeof lastClose === "number" && typeof ma50 === "number" && typeof ma200 === "number") {
    const aboveMa50 = lastClose > ma50;
    const aboveMa200 = lastClose > ma200;
    if (aboveMa50 && aboveMa200) maPhrase = "above MA50 & MA200";
    else if (!aboveMa50 && !aboveMa200) maPhrase = "below MA50 & MA200";
    else if (aboveMa200 && !aboveMa50) maPhrase = "above MA200, below MA50";
    else maPhrase = "above MA50, below MA200";
  }

  // RSI phrase
  let rsiPhrase = "";
  if (typeof rsi === "number") {
    if (rsi >= 70) rsiPhrase = `RSI ${rsi.toFixed(0)} overbought`;
    else if (rsi <= 30) rsiPhrase = `RSI ${rsi.toFixed(0)} oversold`;
    else rsiPhrase = `RSI ${rsi.toFixed(0)}`;
  }

  const parts = [maPhrase, rsiPhrase].filter(Boolean).join(", ");
  const trendPart = trend === "Range / Mixed" ? "Range/Mixed trend" : trend;

  if (parts) {
    return `${symbol} Stock Analysis: ${trendPart}, ${parts} | MyStockHarbor`;
  }
  return `${symbol} Stock Analysis: Chart, RSI, MACD & Trend | MyStockHarbor`;
}

export function buildSeoDescription(symbol: string, seed: IndicatorSeed): string {
  const { trend, rsi, ma50, ma200, lastClose, macdLabel, trendScore } = seed;

  const trendText = trend === "Range / Mixed"
    ? `${symbol} is in a range/mixed trend`
    : `${symbol} is in a ${trend.toLowerCase()}`;

  const maLine = (() => {
    if (typeof lastClose !== "number" || typeof ma50 !== "number" || typeof ma200 !== "number")
      return "";
    const aboveMa50 = lastClose > ma50;
    const aboveMa200 = lastClose > ma200;
    if (aboveMa50 && aboveMa200) return "trading above both the 50-day and 200-day moving averages";
    if (!aboveMa50 && !aboveMa200) return "trading below both the 50-day and 200-day moving averages";
    if (aboveMa200) return "above the 200-day MA but below the 50-day MA";
    return "above the 50-day MA but below the 200-day MA";
  })();

  const rsiLine = typeof rsi === "number"
    ? `RSI is at ${rsi.toFixed(1)}${rsi >= 70 ? " (overbought)" : rsi <= 30 ? " (oversold)" : ""}`
    : "";

  const macdLine = macdLabel ? `MACD is ${macdLabel.toLowerCase()}` : "";

  const passLine = `${trendScore.passed}/${trendScore.total} trend checks passing.`;

  const sentences = [
    `${trendText}${maLine ? ", " + maLine : ""}.`,
    [rsiLine, macdLine].filter(Boolean).join(". ") + (rsiLine || macdLine ? "." : ""),
    passLine,
    "Chart context, macro support levels and AI outlook on MyStockHarbor.",
  ].filter((s) => s.trim().length > 1);

  return sentences.join(" ").slice(0, 160);
}
