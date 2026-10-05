// THE STRENGTH BADGE (#563 COWORK #99 §5, #102, #104, #105): one word for
// how a stock's recent price and results read, from five published inputs,
// each worth a few points. A description, never a recommendation.
//
// THE RULE (ruled on the census, scripts/strength-badge-census.mjs, CODE-C #88):
//   Trend         checks passed (close > MA50, close > MA200, MA50 > MA200):
//                 0 → −2, 1 → −1, 2 → +1, 3 → +2
//   3-month RS    the stock's 63-session price change minus the S&P 500's (SPY)
//                 over the same two dates: > +5 points → +1, < −5 → −1, else 0
//   12-month RS   the same over 252 sessions, at ±10 points
//   RSI(14)       stretched pulls toward Neutral: ≥ 70 with a positive price
//                 total → −1, ≤ 30 with a negative price total → +1, else 0
//                 (the price total is trend + RS, before earnings, as censused)
//   Earnings      A's earningsBadgeInput (lib/earningsBadge.ts): Good +1 ·
//                 Mixed 0 · Weak −1. No read, or a partial one: not counted,
//                 0 points (COWORK #105: ship on the 4 price inputs meanwhile)
//   Words         Strong ≥ 4 · Firm 2–3 · Neutral −1…+1 · Soft −2…−3 · Weak ≤ −4
//   Missing       an input with too little history is left out; fewer than 2
//                 inputs counted → "Not enough data"
//   Hold          the word shown changes only after a new word has read for 3
//                 sessions in a row; the note gives the date of the last change
//
// COMPLETED SESSIONS ONLY: today's partial bar is never scored. Earnings are
// the current snapshot's, held fixed across the hold window (they change
// quarterly). Pure: the page passes the bars it already reads; no fetch here.
import type { EarningsBadgeInput } from "./earningsBadge";
import { closeOnOrBefore } from "./ta/performance";
import { closedBars, dateWords, type KeyBar } from "./ta/keyLevels";

export type StrengthWord = "Strong" | "Firm" | "Neutral" | "Soft" | "Weak";
export const STRENGTH_WORDS: readonly StrengthWord[] = ["Strong", "Firm", "Neutral", "Soft", "Weak"];
export const HOLD_SESSIONS = 3;
/** How far back the hold looks for the last change. */
export const HOLD_WINDOW = 120;
export const RS_INPUTS = [
  { key: "rs3m", sessions: 63, cut: 5, label: "3-month vs S&P 500" },
  { key: "rs12m", sessions: 252, cut: 10, label: "12-month vs S&P 500" },
] as const;
export const TREND_POINTS = [-2, -1, 1, 2] as const;
export const EARNINGS_POINTS: Record<"Good" | "Mixed" | "Weak", number> = { Good: 1, Mixed: 0, Weak: -1 };
export const CUTOFFS_WORDS = "Strong +4 or more · Firm +2 to +3 · Neutral −1 to +1 · Soft −2 to −3 · Weak −4 or less. RSI(14) at 70 or more pulls a positive total one point toward Neutral, and at 30 or less a negative one.";
export const NOT_ADVICE = "A description of recent price and results, not a recommendation.";

export function wordFor(total: number): StrengthWord {
  return total >= 4 ? "Strong" : total >= 2 ? "Firm" : total >= -1 ? "Neutral" : total >= -3 ? "Soft" : "Weak";
}

export type StrengthLine = {
  key: "trend" | "rs3m" | "rs12m" | "rsi" | "earnings";
  label: string;
  /** What was read, in words; or why it isn't counted. */
  reading: string;
  /** Points added; 0 when not counted. */
  points: number;
  counted: boolean;
};
export type StrengthBadge = {
  /** The word shown (after the hold), or null: "Not enough data". */
  word: StrengthWord | null;
  /** The latest completed session scored. */
  asOf: string | null;
  asOfWords: string | null;
  /** The latest session's total and its own word (before the hold). */
  total: number | null;
  latestWord: StrengthWord | null;
  inputs: number;
  lines: StrengthLine[];
  /** The session the shown word took effect, or null when unchanged across the window. */
  since: string | null;
  /** The window's first scored session (for "unchanged since at least …"). */
  windowStart: string | null;
  /** A new word reading but not yet held for HOLD_SESSIONS: the word and its run so far. */
  pending: { word: StrengthWord; sessions: number } | null;
  /** The hold sentence for the note. */
  hold: string;
};

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const pts1 = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

/** Wilder's RSI(14) over closes; null until n + 1 closes. */
export function rsiSeries(c: readonly number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

type Ctx = { bars: KeyBar[]; c: number[]; sums: number[]; rsi: (number | null)[]; spy: KeyBar[] };
const sma = (x: Ctx, i: number, n: number) => (i + 1 < n ? null : (x.sums[i + 1] - x.sums[i + 1 - n]) / n);

/** One session's lines and total; total null below 2 inputs. */
export function scoreSession(x: Ctx, i: number, earnings: EarningsBadgeInput): { lines: StrengthLine[]; total: number | null; inputs: number } {
  const lines: StrengthLine[] = [];
  const close = x.c[i];
  let price = 0, inputs = 0;

  const m50 = sma(x, i, 50), m200 = sma(x, i, 200);
  if (m50 !== null && m200 !== null) {
    const checks = [close > m50, close > m200, m50 > m200];
    const passed = checks.filter(Boolean).length;
    const p = TREND_POINTS[passed];
    price += p; inputs++;
    lines.push({ key: "trend", label: "Trend", counted: true, points: p,
      reading: `${passed} of 3 checks: close ${checks[0] ? "above" : "below"} its 50-day average, ${checks[1] ? "above" : "below"} its 200-day; 50-day ${checks[2] ? "above" : "below"} the 200-day` });
  } else {
    lines.push({ key: "trend", label: "Trend", counted: false, points: 0, reading: `not counted (needs 200 sessions; ${i + 1} on file)` });
  }

  for (const r of RS_INPUTS) {
    const from = i >= r.sessions ? x.bars[i - r.sessions] : null;
    const spyEnd = closeOnOrBefore(x.spy, x.bars[i].date), spyFrom = from ? closeOnOrBefore(x.spy, from.date) : null;
    if (!from) { lines.push({ key: r.key, label: r.label, counted: false, points: 0, reading: `not counted (needs ${r.sessions + 1} sessions; ${i + 1} on file)` }); continue; }
    if (!spyEnd || !spyFrom || spyEnd.date !== x.bars[i].date || spyFrom.date !== from.date || !(spyFrom.close > 0) || !(from.close > 0)) {
      lines.push({ key: r.key, label: r.label, counted: false, points: 0, reading: "not counted (the S&P 500's closes for the same dates aren't on file)" });
      continue;
    }
    const stock = (close / from.close - 1) * 100, index = (spyEnd.close / spyFrom.close - 1) * 100, diff = stock - index;
    const p = diff > r.cut ? 1 : diff < -r.cut ? -1 : 0;
    price += p; inputs++;
    lines.push({ key: r.key, label: r.label, counted: true, points: p,
      reading: `${pts1(diff)} pts over ${r.sessions} sessions (stock ${pts1(stock)}%, S&P 500 ${pts1(index)}%; ±${r.cut} pts counts)` });
  }

  const rsi = x.rsi[i];
  let rsiPts = 0;
  if (rsi !== null) {
    inputs++;
    rsiPts = rsi >= 70 && price > 0 ? -1 : rsi <= 30 && price < 0 ? 1 : 0;
    const v = Math.round(rsi);
    lines.push({ key: "rsi", label: "RSI(14)", counted: true, points: rsiPts,
      // SHORT (#563 COWORK #106): the reading and why it counted; the rule itself
      // is in CUTOFFS_WORDS, under the list.
      reading: rsiPts < 0 ? `${v} (70 or more, with a positive total)`
        : rsiPts > 0 ? `${v} (30 or less, with a negative total)`
        : `${v}` });
  } else {
    lines.push({ key: "rsi", label: "RSI(14)", counted: false, points: 0, reading: `not counted (needs 15 sessions; ${i + 1} on file)` });
  }

  let earnPts = 0;
  if (earnings.word) {
    earnPts = EARNINGS_POINTS[earnings.word]; inputs++;
    lines.push({ key: "earnings", label: "Earnings", counted: true, points: earnPts,
      reading: `${earnings.word} (${earnings.score}/100${earnings.period ? `, ${earnings.period}` : ""})` });
  } else {
    lines.push({ key: "earnings", label: "Earnings", counted: false, points: 0,
      reading: earnings.why === "partial" ? "not counted (partial results)" : "not counted (no results read yet)" });
  }

  return { lines, total: inputs >= 2 ? price + rsiPts + earnPts : null, inputs };
}

/**
 * THE HOLD over a run of sessions' words, oldest first: the word shown starts as
 * the first; a different word takes over only once it has read HOLD_SESSIONS
 * sessions in a row (`since` is that third session). `pending` is a new word
 * still short of the hold on the latest session.
 */
export function applyHold(seq: readonly { date: string; word: StrengthWord }[]): { shown: StrengthWord; since: string | null; pending: { word: StrengthWord; sessions: number } | null } {
  let shown = seq[0].word, since: string | null = null, cand: StrengthWord | null = null, run = 0;
  for (const s of seq.slice(1)) {
    if (s.word === shown) { cand = null; run = 0; continue; }
    if (s.word === cand) run++; else { cand = s.word; run = 1; }
    if (run >= HOLD_SESSIONS) { shown = s.word; since = s.date; cand = null; run = 0; }
  }
  return { shown, since, pending: cand && run > 0 ? { word: cand, sessions: run } : null };
}

/** The badge from a stock's daily bars, SPY's, and the earnings input. */
export function strengthBadge(barsIn: readonly KeyBar[] | null | undefined, spyIn: readonly KeyBar[] | null | undefined, earnings: EarningsBadgeInput): StrengthBadge {
  const bars = closedBars(barsIn);
  const spy = closedBars(spyIn);
  const c = bars.map((b) => b.close);
  const sums = [0];
  for (const v of c) sums.push(sums[sums.length - 1] + v);
  const x: Ctx = { bars, c, sums, rsi: rsiSeries(c), spy };
  const empty = (hold: string): StrengthBadge => ({ word: null, asOf: null, asOfWords: null, total: null, latestWord: null, inputs: 0, lines: [], since: null, windowStart: null, pending: null, hold });
  if (!bars.length) return empty("No completed sessions on file.");

  const last = bars.length - 1;
  const latest = scoreSession(x, last, earnings);
  const asOf = bars[last].date;
  const base = { asOf, asOfWords: dateWords(asOf), total: latest.total, latestWord: latest.total === null ? null : wordFor(latest.total), inputs: latest.inputs, lines: latest.lines };
  if (latest.total === null) {
    return { ...base, word: null, since: null, windowStart: null, pending: null, hold: `Fewer than 2 inputs can be counted on ${dateWords(asOf)}, so no word is shown.` };
  }

  // THE HOLD over the window's scored sessions (sessions below 2 inputs skipped).
  const seq: { date: string; word: StrengthWord }[] = [];
  for (let i = Math.max(0, bars.length - HOLD_WINDOW); i <= last; i++) {
    const t = i === last ? latest.total : scoreSession(x, i, earnings).total;
    if (t !== null) seq.push({ date: bars[i].date, word: wordFor(t) });
  }
  const { shown, since, pending } = applyHold(seq);
  const windowStart = seq[0].date;
  const rule = `The word changes only after a new reading holds for ${HOLD_SESSIONS} sessions in a row.`;
  const when = since ? `${shown} since ${dateWords(since)}.` : `${shown} since at least ${dateWords(windowStart)} (the last ${seq.length} sessions).`;
  const wait = pending ? ` The latest ${pending.sessions === 1 ? "session reads" : `${pending.sessions} sessions read`} ${pending.word}; it shows if that holds for ${HOLD_SESSIONS - pending.sessions} more.` : "";
  return { ...base, word: shown, since, windowStart, pending, hold: `${rule} ${when}${wait}` };
}
