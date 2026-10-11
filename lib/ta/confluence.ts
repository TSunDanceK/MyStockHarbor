// THE CONFLUENCE LADDER'S ZONES (#563 COWORK #83/#84): where several price
// levels sit close together, from the daily bars and indicators the page
// already holds. Pure: no fetch, no Redis, no new data.
//
// THE LEVELS (each with a name, a value and where it comes from):
//   on the page    MA50, MA200 and the macro support zone (handed in by the
//                  page, so they are its own figures); the day's, week's and
//                  month's open, high and low and the previous closes
//                  (lib/ta/keyLevels.ts, same session rule)
//   derived here   last week's and last month's high and low; the 52-week high
//                  and low; swing highs and lows (a bar whose high or low is the
//                  extreme of SWING_N bars either side, over the last
//                  SWING_LOOKBACK sessions); weekly pivots P, R1, S1 from last
//                  week's high, low and close
//   round numbers  only beside another level: they never make a zone alone
//   projections    the next close that would take RSI(14) to 70 or to 30, and
//                  the next close that would make MACD (12, 26, 9) meet its
//                  signal line. One-session projections, marked "≈" and kept
//                  only within MAX_PROJECTION_PCT of the price.
//
//   price gaps     an unfilled fair value gap (B's lib/ta/fairValueGaps.ts at
//                  its defaults: ≥ 0.5 × ATR(14), the last 250 bars, closed
//                  bars only) joins a SHOWN zone as one structural member when
//                  it OVERLAPS the zone (#563 COWORK #108: owner ruling (a)).
//                  It never makes a zone, never moves one and never changes
//                  which zones are shown: the zone's count rises by 1 and its
//                  note gains a dated line
//
// THE ZONES:
//   dedupe     one bar's one price counts once (on 2 Oct the week's low and the
//              month's low are both Mon 28 Sep's low): every name is listed,
//              one is counted
//   band       sorted by price, levels within K_ATR × ATR(14) of the zone's
//              lowest member join it; the zone is shown as its lowest–highest
//              member, never one price
//   strength   the count of independent members; a zone needs ZONE_MIN of them
//              and at least one structural level (round numbers and
//              projections count, but never alone)
//   shown      the nearest SHOWN qualifying zones above and below the price; a
//              zone holding the price is "price inside zone", and the next ones
//              out are shown above and below it
//
// COPY IS DESCRIPTIVE: areas some traders watch, a description, not a
// forecast. Nothing here says a level will hold, or what a reader should do.
import { closedBars, dateWords, keyLevels, monthStart, isoWeekMonday, priceWords, type KeyBar, type PeriodKey } from "./keyLevels";
import { ESTIMATE_SIGN } from "../../app/components/estimateMark";
import { fairValueGaps, type FairValueGap } from "./fairValueGaps";
import { emaSeries } from "./macdSeries";
import { stackLabels } from "./priceLadder";
import { liveBars } from "./sessionBar";

/** Levels within K_ATR × ATR(14) of a zone's lowest member join it. */
export const K_ATR = 0.35;
/** A swing high or low is the extreme of this many bars either side. */
export const SWING_N = 5;
/** Swing highs and lows are looked for over this many sessions. */
export const SWING_LOOKBACK = 126;
/** Levels further than this from the price aren't clustered. */
export const WINDOW_PCT = 25;
/** A projection further than this from the price is left out, with the reason. */
export const MAX_PROJECTION_PCT = 20;
/** A zone needs this many independent members. */
export const ZONE_MIN = 2;
/** Zones shown on each side of the price. */
export const SHOWN = 2;

export const CONFLUENCE_NOTE =
  "Areas where several price levels sit close together. Some traders watch areas like this; a description, not a forecast.";

/** structural: from the bars or the page's indicators; round: a round number; projection: a one-session projection ("≈"). */
export type Tier = "structural" | "round" | "projection";

export type ConfLevel = {
  label: string;
  value: number;
  tier: Tier;
  /** Its source, for the dedupe: one bar's one price ("2026-09-28:low"), or the level's own name. */
  src: string;
  /** The session it comes from, when it is one bar's price. */
  date: string | null;
  /** 0 monthly, 52-week or MA200; 1 weekly; 2 daily and the rest. Listed first in a zone's note. */
  rank: number;
  /** For a projection: what the next close would do ("take RSI(14) to 70"). */
  derived?: string;
};

/** One independent member of a zone: every name that shares its source. */
export type Member = {
  labels: string[]; value: number; tier: Tier; date: string | null; rank: number; derived?: string;
  /** An unfilled price gap's own range (its member's value is the gap's midpoint). */
  gap?: { lower: number; upper: number };
};

export type Zone = {
  lo: number;
  hi: number;
  members: Member[];
  /** The count of independent members. */
  count: number;
};

export type Confluence = {
  price: number | null;
  atr: number | null;
  /** K_ATR × ATR(14), in dollars. */
  band: number | null;
  /** Nearest first. */
  above: Zone[];
  below: Zone[];
  /** A zone holding the price, or null. */
  inside: Zone | null;
  /** The ladder's fixed scale: the lowest to the highest shown zone and the price, padded; null with nothing to show. */
  scale: { lo: number; hi: number } | null;
  /** Every level considered (after the dedupe), for the census and the checks. */
  levels: Member[];
  /** Projections left out, each with its reason. */
  omitted: string[];
  /** Why nothing is shown, or null. */
  reason: string | null;
};

const isPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ── indicators ──────────────────────────────────────────────────────────────

/** ATR(14), Wilder's: the first value the average of 14 true ranges, then smoothed. Null without enough highs and lows. */
export function atr(bars: readonly KeyBar[], period = 14): number | null {
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].close;
    if (!isPrice(b.high) || !isPrice(b.low) || !isPrice(pc)) return null;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  if (tr.length < period) return null;
  let a = tr.slice(0, period).reduce((s, x) => s + x, 0) / period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

/** The page's RSI (StockSymbolPageClient's rsiWilder), line for line, ending with its averages. */
export function rsiState(closes: readonly number[], period = 14): { rsi: number; avgGain: number; avgLoss: number } | null {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss += -d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  return { rsi: 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss)), avgGain, avgLoss };
}

/**
 * The next close at which RSI(14) would read `target`: Wilder's smoothing run
 * backwards. Up to the target, the next change d > 0 makes
 *   avgGain' = (13·avgGain + d) / 14, avgLoss' = 13·avgLoss / 14
 * so RS' = target / (100 − target) gives d = 13·(RS'·avgLoss − avgGain).
 * Down to it, d = 13·(avgGain / RS' − avgLoss), taken off the last close.
 */
export function reverseRsi(closes: readonly number[], target: number, period = 14): number | null {
  const s = rsiState(closes, period);
  if (!s || !(target > 0 && target < 100)) return null;
  const last = closes[closes.length - 1], rs = target / (100 - target), m = period - 1;
  if (s.rsi === target) return last;
  const price = target > s.rsi ? last + m * (rs * s.avgLoss - s.avgGain) : last - m * (s.avgGain / rs - s.avgLoss);
  return isPrice(price) && price > 0 ? price : null;
}

/**
 * The next close at which MACD (12, 26, 9) would equal its signal line. With
 * a = 2/(n+1), the next EMAs are e + a(x − e), so MACD' = A + Bx with
 *   A = e12(1 − a12) − e26(1 − a26),  B = a12 − a26,
 * and signal' = s + a9(MACD' − s) equals MACD' exactly when MACD' = s:
 *   x = (s − A) / B.
 * Same EMAs as the page (lib/ta/macdSeries.ts emaSeries: seeded by the average).
 */
export function reverseMacd(closes: readonly number[]): number | null {
  if (closes.length < 35) return null;
  const v = [...closes];
  const e12 = emaSeries(v, 12), e26 = emaSeries(v, 26);
  const line = v.map((_, i) => (e12[i] !== null && e26[i] !== null ? (e12[i] as number) - (e26[i] as number) : null));
  const first = line.findIndex((x) => x !== null);
  if (first < 0) return null;
  const sig = emaSeries(line.slice(first) as number[], 9);
  const s = sig[sig.length - 1], f = e12[v.length - 1], g = e26[v.length - 1];
  if (s === null || f === null || g === null) return null;
  const a12 = 2 / 13, a26 = 2 / 27;
  const x = (s - (f * (1 - a12) - g * (1 - a26))) / (a12 - a26);
  return isPrice(x) && x > 0 ? x : null;
}

// ── the levels ──────────────────────────────────────────────────────────────

type Range = { high: number; highDate: string; low: number; lowDate: string; close: number; closeDate: string };

/** The bars grouped by a period key, oldest first, each with its high, low and close and where each came from. */
function groups(bars: readonly KeyBar[], keyOf: (date: string) => string): { key: string; r: Range }[] {
  const out: { key: string; r: Range }[] = [];
  for (const b of bars) {
    if (!isPrice(b.high) || !isPrice(b.low) || !isPrice(b.close)) continue;
    const k = keyOf(b.date), g = out[out.length - 1];
    if (!g || g.key !== k) { out.push({ key: k, r: { high: b.high, highDate: b.date, low: b.low, lowDate: b.date, close: b.close, closeDate: b.date } }); continue; }
    if (b.high > g.r.high) { g.r.high = b.high; g.r.highDate = b.date; }
    if (b.low < g.r.low) { g.r.low = b.low; g.r.lowDate = b.date; }
    g.r.close = b.close; g.r.closeDate = b.date;
  }
  return out;
}

/** Swing highs and lows: a bar whose high (low) beats the N bars before it and is not beaten by the N after. */
export function swings(bars: readonly KeyBar[], n = SWING_N, lookback = SWING_LOOKBACK): { kind: "high" | "low"; value: number; date: string }[] {
  const out: { kind: "high" | "low"; value: number; date: string }[] = [];
  const from = Math.max(n, bars.length - lookback);
  for (let i = from; i < bars.length - n; i++) {
    const b = bars[i];
    if (!isPrice(b.high) || !isPrice(b.low)) continue;
    let hi = true, lo = true;
    for (let j = i - n; j <= i + n && (hi || lo); j++) {
      if (j === i) continue;
      const o = bars[j];
      if (!isPrice(o.high) || !isPrice(o.low)) { hi = lo = false; break; }
      if (j < i ? o.high >= b.high : o.high > b.high) hi = false;
      if (j < i ? o.low <= b.low : o.low < b.low) lo = false;
    }
    if (hi) out.push({ kind: "high", value: b.high, date: b.date });
    if (lo) out.push({ kind: "low", value: b.low, date: b.date });
  }
  return out;
}

/** A round-number step for the price: 1 under $10, 5 under $50, 10 under $200, 50 under $1,000, then 100. */
export function roundStep(price: number): number {
  return price < 10 ? 1 : price < 50 ? 5 : price < 200 ? 10 : price < 1000 ? 50 : 100;
}

const RANK: Record<PeriodKey, number> = { day: 2, week: 1, month: 0 };
const TITLE: Record<PeriodKey, string> = { day: "Day", week: "Week", month: "Month" };

export type ConfluenceInput = {
  bars: readonly KeyBar[];
  /** The page's render time: the session rule of lib/ta/sessionBar.ts (#563 COWORK #75/#76). */
  nowMs?: number;
  /** The page's last price; the latest close stands in. */
  lastPrice?: number | null;
  ma50?: number | null;
  ma200?: number | null;
  /** The page's macro support zone. */
  macro?: { lower: number; upper: number } | null;
  /** The swing rule's N; SWING_N unless a census sweeps it. */
  swingN?: number;
};

/** Every level, before the dedupe, with projections out of range listed in `omitted`. */
export function confluenceLevels(inp: ConfluenceInput): { price: number | null; levels: ConfLevel[]; omitted: string[]; bars: KeyBar[] } {
  const all = inp.bars ?? [];
  // NOW figures: completed sessions plus today's partial bar while it counts (in session, or after the close until EOD).
  const live = inp.nowMs === undefined ? { bars: closedBars(all), live: null, phase: null } : liveBars(closedOrPartial(all), inp.nowMs);
  const bars = live.bars.filter((b) => isPrice(b.close));
  const closed = closedBars(all);
  const lastBar = bars[bars.length - 1];
  const price = isPrice(inp.lastPrice) && inp.lastPrice > 0 ? inp.lastPrice : lastBar ? lastBar.close : null;
  const levels: ConfLevel[] = [];
  const omitted: string[] = [];
  if (!lastBar || price === null) return { price, levels, omitted, bars };
  const add = (label: string, value: number | null | undefined, tier: Tier, src: string, date: string | null, rank: number, derived?: string) => {
    if (isPrice(value) && value > 0) levels.push({ label, value, tier, src, date, rank, ...(derived ? { derived } : {}) });
  };

  // On the page: MA50, MA200, the macro support zone.
  add("MA50", inp.ma50, "structural", "MA50", null, 2);
  add("MA200", inp.ma200, "structural", "MA200", null, 0);
  if (inp.macro) {
    add("Macro support (low)", inp.macro.lower, "structural", "macro:lower", null, 0);
    if (inp.macro.upper !== inp.macro.lower) add("Macro support (high)", inp.macro.upper, "structural", "macro:upper", null, 0);
  }

  // The day's, week's and month's open, high and low, and the previous closes: Key levels' own.
  const k = keyLevels(all, { nowMs: inp.nowMs });
  for (const p of k.periods) {
    if (!p.from) continue;
    const span = bars.filter((b) => b.date >= p.from!);
    const at = (field: "high" | "low", v: number | null) => span.find((b) => b[field] === v)?.date ?? null;
    const o = p.levels.open.value, h = p.levels.high.value, l = p.levels.low.value;
    add(`${TITLE[p.key]} open`, o, "structural", `${span[0]?.date}:open`, span[0]?.date ?? null, RANK[p.key]);
    const hd = at("high", h), ld = at("low", l);
    add(`${TITLE[p.key]} high`, h, "structural", hd ? `${hd}:high` : `${p.key}:high`, hd, RANK[p.key]);
    add(`${TITLE[p.key]} low`, l, "structural", ld ? `${ld}:low` : `${p.key}:low`, ld, RANK[p.key]);
    if (p.prevClose) add(PREV_LABEL[p.key], p.prevClose.value, "structural", `${p.prevClose.date}:close`, p.prevClose.date, RANK[p.key]);
  }

  // Last week's and last month's high and low (completed periods), and the weekly pivots.
  for (const [key, keyOf] of [["week", isoWeekMonday], ["month", monthStart]] as const) {
    const g = groups(closed, keyOf), cur = keyOf(lastBar.date);
    const prev = [...g].reverse().find((x) => x.key < cur);
    if (!prev) continue;
    add(`Last ${key}'s high`, prev.r.high, "structural", `${prev.r.highDate}:high`, prev.r.highDate, RANK[key]);
    add(`Last ${key}'s low`, prev.r.low, "structural", `${prev.r.lowDate}:low`, prev.r.lowDate, RANK[key]);
    if (key === "week") {
      const P = (prev.r.high + prev.r.low + prev.r.close) / 3;
      add("Weekly pivot P", P, "structural", "pivot:P", null, 1);
      add("Weekly pivot R1", 2 * P - prev.r.low, "structural", "pivot:R1", null, 1);
      add("Weekly pivot S1", 2 * P - prev.r.high, "structural", "pivot:S1", null, 1);
    }
  }

  // The 52-week high and low (to the latest price's bar).
  const yearAgo = new Date(Date.parse(`${lastBar.date}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const year = bars.filter((b) => b.date > yearAgo && isPrice(b.high) && isPrice(b.low));
  if (year.length) {
    const hi = year.reduce((a, b) => (b.high! > a.high! ? b : a)), lo = year.reduce((a, b) => (b.low! < a.low! ? b : a));
    add("52-week high", hi.high, "structural", `${hi.date}:high`, hi.date, 0);
    add("52-week low", lo.low, "structural", `${lo.date}:low`, lo.date, 0);
  }

  // Swing highs and lows over completed sessions.
  for (const s of swings(closed, inp.swingN ?? SWING_N)) add(`Swing ${s.kind}`, s.value, "structural", `${s.date}:${s.kind}`, s.date, 2);

  // Projections: the next close. In session today's close is the next one, so they run on completed sessions;
  // after the close (today's final bar on file) and out of session, on every session to the latest.
  const base = (live.phase === "session" ? closed : bars).map((b) => b.close);
  const proj = (label: string, value: number | null, derived: string, src: string) => {
    if (value === null) { omitted.push(`${label}: not reachable from the prices on file.`); return; }
    const pct = Math.abs(value - price) / price * 100;
    if (pct > MAX_PROJECTION_PCT) { omitted.push(`${label}: ${pct.toFixed(0)}% from the price, beyond ${MAX_PROJECTION_PCT}%.`); return; }
    add(label, value, "projection", src, null, 2, derived);
  };
  proj("RSI(14) 70", reverseRsi(base, 70), "the next close that would take RSI(14) to 70", "proj:rsi70");
  proj("RSI(14) 30", reverseRsi(base, 30), "the next close that would take RSI(14) to 30", "proj:rsi30");
  proj("MACD cross", reverseMacd(base), "the next close that would bring MACD (12, 26, 9) to its signal line", "proj:macd");
  return { price, levels, omitted, bars };
}

/** Bars that are closed, or a labelled partial (liveBars keeps the partial only while it counts). */
const closedOrPartial = (bars: readonly KeyBar[]) => bars.filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && isPrice(b.close));

const PREV_LABEL: Record<PeriodKey, string> = { day: "Previous close", week: "Last week's close", month: "Last month's close" };

/** One member per source: the same bar's same price counts once, under every name. */
export function dedupe(levels: readonly ConfLevel[]): Member[] {
  const by = new Map<string, Member>();
  for (const l of levels) {
    const m = by.get(l.src);
    if (m) {
      if (!m.labels.includes(l.label)) m.labels.push(l.label);
      m.rank = Math.min(m.rank, l.rank);
    } else by.set(l.src, { labels: [l.label], value: l.value, tier: l.tier, date: l.date, rank: l.rank, ...(l.derived ? { derived: l.derived } : {}) });
  }
  return [...by.values()].sort((a, b) => a.value - b.value || a.rank - b.rank);
}

/** Members within `band` of a zone's lowest member join it (members sorted by value). Round numbers are added afterwards. */
export function bandMerge(members: readonly Member[], band: number): Member[][] {
  const out: Member[][] = [];
  for (const m of members) {
    const z = out[out.length - 1];
    if (z && m.value - z[0].value <= band) z.push(m); else out.push([m]);
  }
  return out;
}

const structural = (ms: readonly Member[]) => ms.some((m) => m.tier === "structural");

/** A cluster made a zone: a round number beside a structural level joins it if it keeps the zone within the band. */
function withRound(ms: Member[], band: number, step: number): Member[] {
  if (!structural(ms)) return ms;
  const lo = ms[0].value, hi = ms[ms.length - 1].value;
  const mid = (lo + hi) / 2;
  const r = Math.round(mid / step) * step;
  if (r <= 0 || r < hi - band || r > lo + band) return ms;
  return [...ms, { labels: [`Round number ${priceWords(r)}`], value: r, tier: "round" as Tier, date: null, rank: 3 }].sort((a, b) => a.value - b.value);
}

/** A zone qualifies with ZONE_MIN independent members, at least one structural. */
export const qualifies = (ms: readonly Member[]) => ms.length >= ZONE_MIN && structural(ms);

const toZone = (ms: Member[]): Zone => ({
  lo: ms[0].value,
  hi: ms[ms.length - 1].value,
  members: [...ms].sort((a, b) => a.rank - b.rank || a.value - b.value),
  count: ms.length,
});

/** Every qualifying zone within WINDOW_PCT of the price, lowest first. */
export function allZones(members: readonly Member[], band: number, price: number): Zone[] {
  const near = members.filter((m) => Math.abs(m.value - price) / price * 100 <= WINDOW_PCT);
  const step = roundStep(price);
  return bandMerge(near, band).map((ms) => withRound(ms, band, step)).filter(qualifies).map(toZone);
}

export const GAP_LABEL = "Unfilled price gap";
/** How a gap counts, for the card's "What are these?" note. */
export const GAP_WHAT = "An unfilled price gap (a jump of at least half the usual daily range that prices haven't gone back into, over the last 250 sessions) adds one level to a zone it overlaps; it never makes a zone on its own.";

/** Does an unfilled gap overlap a zone? Edges count: a gap ending on the zone's low touches it. */
export const gapOverlaps = (g: { lower: number; upper: number }, z: { lo: number; hi: number }) => g.lower <= z.hi && g.upper >= z.lo;

/**
 * A SHOWN zone with the unfilled gaps that overlap it, each one structural
 * member (#563 COWORK #108). Its range, and so its place on the ladder, stays.
 */
export function withGaps(z: Zone, gaps: readonly FairValueGap[]): Zone {
  const over = gaps.filter((g) => gapOverlaps(g, z));
  if (!over.length) return z;
  const added: Member[] = over.map((g) => ({ labels: [GAP_LABEL], value: (g.lower + g.upper) / 2, tier: "structural", date: g.date, rank: 2, gap: { lower: g.lower, upper: g.upper } }));
  return { ...z, members: [...z.members, ...added].sort((a, b) => a.rank - b.rank || a.value - b.value), count: z.count + added.length };
}

/** The unfilled gaps on completed sessions, at B's defaults (today's partial bar never counts). */
export function zoneGaps(bars: readonly KeyBar[] | null | undefined): FairValueGap[] {
  const closed = closedBars(bars).filter((b) => isPrice(b.high) && isPrice(b.low) && isPrice(b.close));
  return fairValueGaps(closed.map((b) => ({ date: b.date, high: b.high!, low: b.low!, close: b.close })));
}

/** The zones: nearest SHOWN above and below, and any holding the price. */
export function confluence(inp: ConfluenceInput, opts: { k?: number } = {}): Confluence {
  const { price, levels, omitted, bars } = confluenceLevels(inp);
  const empty = (reason: string, a: number | null = null): Confluence =>
    ({ price, atr: a, band: null, above: [], below: [], inside: null, scale: null, levels: dedupe(levels), omitted, reason });
  if (price === null) return empty("No daily prices are on file for this stock yet.");
  const a = atr(bars);
  if (a === null || a <= 0) return empty("Not enough daily highs and lows on file to measure the price's usual range.");
  const band = (opts.k ?? K_ATR) * a;
  const zones = allZones(dedupe(levels), band, price);
  // Gaps join only the zones already picked to show: they never change which are shown.
  const gaps = zoneGaps(inp.bars);
  const insideZone = zones.find((z) => z.lo <= price && price <= z.hi);
  const inside = insideZone ? withGaps(insideZone, gaps) : null;
  const above = zones.filter((z) => z.lo > price).sort((x, y) => x.lo - y.lo).slice(0, SHOWN).map((z) => withGaps(z, gaps));
  const below = zones.filter((z) => z.hi < price).sort((x, y) => y.hi - x.hi).slice(0, SHOWN).map((z) => withGaps(z, gaps));
  const shown = [...above, ...below, ...(inside ? [inside] : [])];
  if (!shown.length) return { ...empty("No areas where two or more levels sit close together near the price right now.", a), band };
  const lo = Math.min(price, ...shown.map((z) => z.lo)), hi = Math.max(price, ...shown.map((z) => z.hi));
  const pad = (hi - lo) * 0.08 || price * 0.01;
  return { price, atr: a, band, above, below, inside, scale: { lo: lo - pad, hi: hi + pad }, levels: dedupe(levels), omitted, reason: null };
}

// ── words ───────────────────────────────────────────────────────────────────

/** A price's height on the fixed scale, in % from the bottom. */
export function heightPct(v: number, scale: { lo: number; hi: number }): number {
  return scale.hi > scale.lo ? ((v - scale.lo) / (scale.hi - scale.lo)) * 100 : 50;
}

/** "3 levels" */
export const countWords = (z: Zone) => `${z.count} level${z.count === 1 ? "" : "s"}`;

/** A zone whose ends print the same at the usual precision: one price, not a range. */
export const onePrice = (z: Zone) => z.lo === z.hi || priceWords(z.lo) === priceWords(z.hi);

/**
 * "$325.81–$327.40". A zone that collapses to one price (both ends print the
 * same, e.g. a run of flat bars) reads "$11.24 (all at one price)", not
 * "$11.2370–$11.2400" (#563 COWORK #109).
 */
export function rangeWords(z: Zone): string {
  if (onePrice(z)) return `${priceWords(z.hi)}${z.count > 1 ? " (all at one price)" : ""}`;
  return `${priceWords(z.lo)}–${priceWords(z.hi)}`;
}

/**
 * "2.1% below" / "1.4% above", from the price to the zone's nearer edge; "price
 * inside zone". Under 0.05% it reads "just above" / "just below", not "0.0%" (#563 COWORK #94).
 */
export function zoneDistance(z: Zone, price: number): string {
  if (z.lo <= price && price <= z.hi) return "price inside zone";
  const edge = z.lo > price ? z.lo : z.hi, side = z.lo > price ? "above" : "below";
  const pct = (Math.abs(edge - price) / price * 100).toFixed(1);
  return pct === "0.0" ? `just ${side}` : `${pct}% ${side}`;
}

/** The tap note: each member, higher timeframes first, projections with "≈". */
export function zoneNote(z: Zone): string {
  const lines = z.members.map((m) => {
    const names = m.labels.join(" · ");
    if (m.tier === "projection") return `${ESTIMATE_SIGN} ${priceWords(m.value)}: ${m.derived} (a one-session projection).`;
    if (m.gap && m.date) return `${GAP_LABEL} from ${dateWords(m.date)}, ${priceWords(m.gap.lower)}–${priceWords(m.gap.upper)}.`;
    return `${names} ${priceWords(m.value)}${m.date ? ` (${dateWords(m.date).replace(/ \d{4}$/, "")})` : ""}.`;
  });
  const shared = z.members.filter((m) => m.labels.length > 1).length;
  return `${countWords(z)}${shared ? ", one bar's price counted once where names share it" : ""}: ${lines.join(" ")} ${CONFLUENCE_NOTE}`;
}

// ── the tap note, structured (#563 COWORK #88 §4) ───────────────────────────

/** The kinds a level is grouped by in a zone's note, in order, each with its dot colour (readable on the dark card). */
export const NOTE_KINDS = [
  { key: "hl", label: "Highs & lows", colour: "#fb923c" },
  { key: "oc", label: "Opens & closes", colour: "#60a5fa" },
  { key: "ma", label: "Moving averages", colour: "#34d399" },
  { key: "swing", label: "Swing points", colour: "#c084fc" },
  { key: "pivot", label: "Pivots", colour: "#f472b6" },
  { key: "gap", label: "Price gaps", colour: "#facc15" },
  { key: "round", label: "Round number", colour: "#cbd5e1" },
  { key: "proj", label: "Projections", colour: "#7dd3fc" },
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number]["key"];

/** One name's kind. Macro support (a cluster of weekly swing lows) counts as a swing point. */
export function kindOfLabel(label: string, tier: Tier): NoteKind {
  if (tier === "projection") return "proj";
  if (tier === "round") return "round";
  if (/^MA(50|200)$/.test(label)) return "ma";
  if (/^Weekly pivot/.test(label)) return "pivot";
  if (label === GAP_LABEL) return "gap";
  if (/^Swing |^Macro support/.test(label)) return "swing";
  if (/open$|close$/i.test(label)) return "oc";
  return "hl";
}

/** A member's kind: the first kind, in NOTE_KINDS order, among its names (a bar's low that is also a swing low reads as a low). */
export function kindOf(m: Member): NoteKind {
  const ks = m.labels.map((l) => kindOfLabel(l, m.tier));
  return NOTE_KINDS.find((k) => ks.includes(k.key))?.key ?? "hl";
}

export type NoteBullet = { kind: NoteKind; names: string[]; value: number; date: string | null; derived?: string; gap?: { lower: number; upper: number } };
export type ZoneNoteParts = {
  /** "3 levels", "$236.06–$237.88", "0.9% above" (or "price inside zone"), and the zone's side for its colour. */
  count: string;
  range: string;
  distance: string;
  side: "above" | "below" | "inside";
  /** One bullet per independent level, grouped by kind in NOTE_KINDS order; shared prices on one bullet. */
  bullets: NoteBullet[];
};
export const ZONE_NOTE_FOOTER = "One bar's price is counted once. A description, not a forecast.";

export function zoneNoteParts(z: Zone, price: number): ZoneNoteParts {
  const order = (k: NoteKind) => NOTE_KINDS.findIndex((x) => x.key === k);
  const bullets = z.members
    .map((m) => ({ kind: kindOf(m), names: m.labels, value: m.value, date: m.date, ...(m.derived ? { derived: m.derived } : {}), ...(m.gap ? { gap: m.gap } : {}) }))
    .sort((a, b) => order(a.kind) - order(b.kind) || b.value - a.value);
  const side = z.lo <= price && price <= z.hi ? "inside" : z.lo > price ? "above" : "below";
  return { count: countWords(z), range: rangeWords(z), distance: zoneDistance(z, price), side, bullets };
}

/** "Day high · Week high — $237.88 (Fri 2 Oct)"; a projection "≈ $273.14 — the next close that would …". */
export function bulletWords(b: NoteBullet): string {
  if (b.kind === "proj") return `${b.names.join(" · ")} — ${ESTIMATE_SIGN} ${priceWords(b.value)}, ${b.derived} (a one-session projection)`;
  // "Unfilled price gap from Tue 4 Aug 2026 — $298.40–$301.10" (#563 COWORK #108/#109): dated, with its
  // year, and its range like the other lines' prices, so it can be checked against the chart's gap toggle.
  if (b.kind === "gap" && b.date) return `${GAP_LABEL} from ${dateWords(b.date)}${b.gap ? ` — ${priceWords(b.gap.lower)}–${priceWords(b.gap.upper)}` : ""}`;
  return `${b.names.join(" · ")} — ${priceWords(b.value)}${b.date ? ` (${dateWords(b.date).replace(/ \d{4}$/, "")})` : ""}`;
}

// ── the ladder's layout ─────────────────────────────────────────────────────

/** The ladder's drawn height, in px (#88 §2: about 320 on desktop, at least 280 on phones; one height for both). */
export const ZONE_LADDER_HEIGHT = 320;
/**
 * The least room between two zone labels at the default text size (up to three
 * lines and a little air), in px. The card widens it to its labels' measured
 * height when larger text or a narrow card makes them taller (#563 COWORK #109).
 */
export const ZONE_LABEL_GAP = 42;
/**
 * The tallest a ladder grows when it fills its card (the SPX page's levels row,
 * #563 COWORK #129), in px: past this the zones spread too far apart to read as
 * one scale, so the card centres the ladder in the spare height instead.
 */
export const ZONE_LADDER_FILL_MAX = 520;

/** The ladder's height for `n` labels `gap` apart: ZONE_LADDER_HEIGHT, taller only when the labels need it. */
export const ladderHeight = (n: number, gap = ZONE_LABEL_GAP) => Math.max(ZONE_LADDER_HEIGHT, Math.ceil(n * gap));

export type ZoneMark = {
  zone: Zone;
  side: "above" | "below" | "inside";
  /** The band's top and bottom (its high and low) at true height, in px from the top. */
  top: number;
  bottom: number;
  /** Where its label sits after stacking, in px from the top. */
  labelY: number;
};

/** Height from the top of the ladder for a price on the fixed scale. */
export const ladderTop = (v: number, scale: { lo: number; hi: number }, height = ZONE_LADDER_HEIGHT) => height * (1 - heightPct(v, scale) / 100);

/**
 * The zones on the fixed scale (#83 §3): each band at its true price range,
 * the labels on one side, stacked at least ZONE_LABEL_GAP apart in price order
 * (the ladder's own stacking rule, lib/ta/priceLadder.ts stackLabels). The
 * price dot is placed by ladderTop(price): it moves, the scale doesn't.
 */
export function zoneLadder(c: Confluence, height = ZONE_LADDER_HEIGHT, gap = ZONE_LABEL_GAP): ZoneMark[] {
  if (!c.scale || c.price === null) return [];
  const sc = c.scale;
  const all = [
    ...c.above.map((z) => ({ zone: z, side: "above" as const })),
    ...(c.inside ? [{ zone: c.inside, side: "inside" as const }] : []),
    ...c.below.map((z) => ({ zone: z, side: "below" as const })),
  ].sort((a, b) => b.zone.hi - a.zone.hi);
  const marks = all.map((m) => {
    const top = ladderTop(m.zone.hi, sc, height), bottom = ladderTop(m.zone.lo, sc, height);
    return { ...m, top, bottom, labelY: (top + bottom) / 2 };
  });
  const ys = stackLabels(marks.map((m) => m.labelY), gap, height, gap / 2);
  return marks.map((m, i) => ({ ...m, labelY: ys[i] }));
}
