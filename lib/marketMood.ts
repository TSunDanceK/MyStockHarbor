// MARKET MOOD (#563 COWORK #95/#96): the owner's own fear ↔ greed reading,
// from the same kinds of public market measures CNN's index uses, computed on
// our own data (the Tiingo daily bars the nightly job already holds).
//
//   momentum     SPY's close vs its 125-day average
//   strength     net 52-week highs minus lows across the stocks we track (% of names)
//   breadth      up-volume vs down-volume, a McClellan-style summation
//   volatility   SPY's 20-day realised volatility vs its 50-day average, inverted
//                (ruling 1: no VIX from FRED or anywhere else)
//   safeHaven    SPY's 20-day return minus TLT's (ruling 2: TLT, no IEF)
//   junk         HYG's 20-day return minus LQD's (joins once LQD has 200 sessions)
//
// Put/call is left out (ruling 4, Cboe's terms): "Option-market data isn't included."
//
// SCORING: each input is its percentile over the trailing WINDOW sessions
// (MIN_PCTL values at least); the reading is the PLAIN equal-weight average of
// the inputs available that day (ruling 3: no re-percentiling, so the extremes
// only show at real extremes), shown only when MOOD_MIN_INPUTS of the
// MOOD_INPUTS are available.
//
// STORED: computed scores only (0–100 integers by date), never a price, bar or
// volume (Tiingo contract: computed indicators, no raw export). Pure: no
// Redis, no fetch; the nightly route and the checks both call it.

/** One daily bar: [date, open, high, low, close, volume] (marketData/types.ts EodBar). */
export type MoodBar = readonly [string, number, number, number, number, number];

export const MOOD_INPUTS = [
  { key: "momentum", line: "Momentum: SPY vs its 125-day average" },
  { key: "strength", line: "Price strength: 52-week highs vs lows across the stocks we track" },
  { key: "breadth", line: "Breadth: volume in rising vs falling stocks" },
  { key: "volatility", line: "Volatility (from SPY's own price swings)" },
  { key: "safeHaven", line: "Safe-haven demand: stocks vs Treasuries (SPY vs TLT)" },
  { key: "junk", line: "Junk-bond demand: high-yield vs investment-grade bonds (HYG vs LQD)" },
] as const;
export type MoodInput = (typeof MOOD_INPUTS)[number]["key"];

/** A reading needs at least this many inputs (ruling 2: ≥ 5 of 6). */
export const MOOD_MIN_INPUTS = 5;
/** The trailing window each input is ranked over, in sessions. */
export const WINDOW = 252;
/** An input is scored only once its window holds this many values. */
export const MIN_PCTL = 200;
/** How many days the stored series keeps. */
export const KEEP_DAYS = 300;
/** The ETFs the inputs read; kept out of the stock tallies. */
export const MOOD_ETFS = ["SPY", "TLT", "HYG", "LQD"] as const;

export const MOOD_LABELS = [
  { max: 24, label: "Extreme fear" },
  { max: 44, label: "Fear" },
  { max: 55, label: "Neutral" },
  { max: 75, label: "Greed" },
  { max: 100, label: "Extreme greed" },
] as const;
export type MoodLabel = (typeof MOOD_LABELS)[number]["label"];

/** The band a whole-number reading falls in: ≤24 · ≤44 · ≤55 · ≤75 · above. */
export function moodLabel(score: number): MoodLabel {
  const s = Math.round(score);
  return (MOOD_LABELS.find((b) => s <= b.max) ?? MOOD_LABELS[MOOD_LABELS.length - 1]).label;
}

/**
 * x's percentile among the finite values of its trailing window (ties count
 * half), 0–100; NaN when x isn't finite or the window holds fewer than MIN_PCTL.
 */
export function percentileAt(values: readonly number[], i: number, window = WINDOW, min = MIN_PCTL): number {
  const x = values[i];
  if (!Number.isFinite(x)) return NaN;
  let n = 0, below = 0, equal = 0;
  for (let q = Math.max(0, i - window + 1); q <= i; q++) {
    const y = values[q];
    if (!Number.isFinite(y)) continue;
    n++;
    if (y < x) below++;
    else if (y === x) equal++;
  }
  if (n < min) return NaN;
  return (100 * (below + 0.5 * (equal - 1))) / (n - 1);
}

/** The plain average of the available scores, or null below `min` of them (ruling 3). */
export function blend(scores: readonly number[], min = MOOD_MIN_INPUTS): { v: number; n: number } | null {
  const xs = scores.filter(Number.isFinite);
  return xs.length >= min ? { v: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length } : null;
}

export type MoodDay = { d: string; r: number | null; n: number; s: Partial<Record<MoodInput, number>> };
export type StoredMood = { v: 1; asOf: string; days: MoodDay[] };

const closeMap = (b: readonly MoodBar[] | undefined) => (b ? new Map(b.map((x) => [x[0], x[4]])) : null);
const ret20 = (c: readonly number[]) => c.map((x, i) => (i >= 20 && c[i - 20] > 0 ? x / c[i - 20] - 1 : NaN));

/**
 * The raw inputs by SPY session (the calendar), before scoring. `exclude`
 * keeps ETFs out of the stock tallies (the MOOD_ETFS always are).
 */
export function moodInputs(bars: ReadonlyMap<string, readonly MoodBar[]>, exclude: Iterable<string> = []): { dates: string[]; inputs: Record<MoodInput, number[]> } | null {
  const spy = bars.get("SPY");
  if (!spy || spy.length < WINDOW) return null;
  const dates = spy.map((b) => b[0]);
  const at = new Map(dates.map((d, i) => [d, i]));
  const N = dates.length;
  const H = new Float64Array(N), L = new Float64Array(N), E = new Float64Array(N), UP = new Float64Array(N), DN = new Float64Array(N);
  const skip = new Set<string>([...MOOD_ETFS, ...exclude]);
  for (const [sym, b] of bars) {
    if (skip.has(sym) || b.length < 30) continue;
    // Monotonic deques of indices: the trailing WINDOW's highest high and lowest low.
    const hq: number[] = [], lq: number[] = [];
    let hh = 0, lh = 0;
    for (let k = 0; k < b.length; k++) {
      while (hq.length > hh && b[hq[hq.length - 1]][2] <= b[k][2]) hq.pop();
      hq.push(k);
      while (lq.length > lh && b[lq[lq.length - 1]][3] >= b[k][3]) lq.pop();
      lq.push(k);
      while (hq[hh] <= k - WINDOW) hh++;
      while (lq[lh] <= k - WINDOW) lh++;
      if (k === 0) continue;
      const j = at.get(b[k][0]);
      if (j === undefined) continue;
      const v = b[k][5], c = b[k][4], pc = b[k - 1][4];
      if (Number.isFinite(v) && v > 0 && Number.isFinite(c) && Number.isFinite(pc)) { if (c > pc) UP[j] += v; else if (c < pc) DN[j] += v; }
      if (k < WINDOW) continue;
      E[j]++;
      if (b[k][2] >= b[hq[hh]][2]) H[j]++;
      if (b[k][3] <= b[lq[lh]][3]) L[j]++;
    }
  }
  const sc = spy.map((b) => b[4]);
  const momentum = sc.map((x, g) => { if (g < 124) return NaN; let s = 0; for (let q = g - 124; q <= g; q++) s += sc[q]; return x / (s / 125) - 1; });
  const strength = dates.map((_, i) => (E[i] >= 100 ? (H[i] - L[i]) / E[i] : NaN));
  let e19: number | null = null, e39: number | null = null, sum = 0;
  const breadth = dates.map((_, i) => {
    const t = UP[i] + DN[i];
    if (!(t > 0)) return NaN;
    const r = ((UP[i] - DN[i]) / t) * 1000;
    e19 = e19 === null ? r : e19 + 0.1 * (r - e19);
    e39 = e39 === null ? r : e39 + 0.05 * (r - e39);
    sum += e19 - e39;
    return i < 40 ? NaN : sum;
  });
  const lr = sc.map((x, g) => (g ? Math.log(x / sc[g - 1]) : NaN));
  const rv = sc.map((_, g) => {
    if (g < 21) return NaN;
    let m = 0;
    for (let q = g - 19; q <= g; q++) m += lr[q];
    m /= 20;
    let v = 0;
    for (let q = g - 19; q <= g; q++) v += (lr[q] - m) ** 2;
    return Math.sqrt(v / 19);
  });
  const volatility = sc.map((_, g) => { if (g < 71) return NaN; let s = 0; for (let q = g - 49; q <= g; q++) s += rv[q]; return -(rv[g] / (s / 50) - 1); });
  const on = (sym: string) => { const m = closeMap(bars.get(sym)); return m ? dates.map((d) => m.get(d) ?? NaN) : null; };
  const gap = (a: number[] | null, b: number[] | null) => { if (!a || !b) return dates.map(() => NaN); const x = ret20(a), y = ret20(b); return x.map((v, i) => v - y[i]); };
  return { dates, inputs: { momentum, strength, breadth, volatility, safeHaven: gap(sc, on("TLT")), junk: gap(on("HYG"), on("LQD")) } };
}

/** The stored series: the last KEEP_DAYS sessions' scores and readings. Null without SPY's year. */
export function computeMarketMood(bars: ReadonlyMap<string, readonly MoodBar[]>, exclude: Iterable<string> = [], keep = KEEP_DAYS): StoredMood | null {
  const got = moodInputs(bars, exclude);
  if (!got) return null;
  const { dates, inputs } = got;
  const keys = MOOD_INPUTS.map((x) => x.key);
  const days: MoodDay[] = [];
  for (let i = Math.max(0, dates.length - keep); i < dates.length; i++) {
    const s: Partial<Record<MoodInput, number>> = {};
    const raw: number[] = [];
    for (const k of keys) {
      // Rounded first, so the reading is exactly the average of the scores the tap note lists.
      const p = Math.round(percentileAt(inputs[k], i));
      raw.push(p);
      if (Number.isFinite(p)) s[k] = p;
    }
    const b = blend(raw);
    days.push({ d: dates[i], r: b ? Math.round(b.v) : null, n: b ? b.n : raw.filter(Number.isFinite).length, s });
  }
  return { v: 1, asOf: dates[dates.length - 1], days };
}

const isScore = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;

/** A stored value back, or null when absent or malformed (the card then shows nothing). */
export function parseStoredMood(raw: unknown): StoredMood | null {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  const o = v as { v?: unknown; asOf?: unknown; days?: unknown };
  if (o.v !== 1 || typeof o.asOf !== "string" || !Array.isArray(o.days)) return null;
  const keys = new Set<string>(MOOD_INPUTS.map((x) => x.key));
  const days: MoodDay[] = [];
  for (const d of o.days as unknown[]) {
    if (!d || typeof d !== "object") return null;
    const x = d as { d?: unknown; r?: unknown; n?: unknown; s?: unknown };
    if (typeof x.d !== "string" || !(x.r === null || isScore(x.r)) || typeof x.n !== "number" || !x.s || typeof x.s !== "object") return null;
    const s: Partial<Record<MoodInput, number>> = {};
    for (const [k, val] of Object.entries(x.s as Record<string, unknown>)) if (keys.has(k) && isScore(val)) s[k as MoodInput] = val;
    days.push({ d: x.d, r: x.r as number | null, n: x.n, s });
  }
  return { v: 1, asOf: o.asOf, days };
}

/** What the card shows: the newest day with a reading, and the last `span` readings for the sparkline. */
export function moodView(m: StoredMood | null, span = 90): { day: MoodDay & { r: number }; label: MoodLabel; spark: { d: string; r: number }[] } | null {
  if (!m) return null;
  const withReading = m.days.filter((d): d is MoodDay & { r: number } => d.r !== null);
  const day = withReading[withReading.length - 1];
  if (!day) return null;
  return { day, label: moodLabel(day.r), spark: withReading.slice(-span).map((d) => ({ d: d.d, r: d.r })) };
}
