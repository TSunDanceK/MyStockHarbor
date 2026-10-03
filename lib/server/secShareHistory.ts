// The share-dilution chart's series, from the stored SEC fact set.
//
// ── WHAT THIS REPLACED ────────────────────────────────────────────────────
// fetchShareHistory in app/stock/[symbol]/page.tsx read FMP's
// stable/income-statement for `weightedAverageShsOut` — not a price, and so not
// something Tiingo takes over; it would simply have stopped when FMP went
// (brief 2026-09-22 §2.2). The stored set carries the same concept as
// `sharesBasic` (us-gaap WeightedAverageNumberOfSharesOutstandingBasic, or its
// ifrs-full equivalent), so the chart moves onto a read the page already makes.
//
// ── WHY THERE ARE FEWER POINTS THAN FMP GAVE ─────────────────────────────
// FMP returned up to 28 periods. The store retains SEC_QUARTER_WINDOW quarters
// (12) and SEC_YEAR_WINDOW years (6), and a derived Q4 carries NO share count:
// a weighted average is never differenced (FieldKind "duration-average"), so
// every fourth quarter is a gap rather than a point. A 10-Q filer therefore
// yields about nine quarterly points. So the extractor now stores ONE extra
// series, fiscal-year basic shares for every year in the payload
// (StoredFactSet.as). The chart COMBINES the two: yearly points up to the
// first stored quarter, then every stored quarter — retention itself is not
// widened (owner, #517, second decision; the first shape — years, then only
// the quarters after the last fiscal year-end — gave ONDS and ABVX fewer
// points than quarters alone, relay 35780595913).
//
// ── THE SERIES IS CORRECTED BEFORE IT IS DRAWN (#552 COWORK #88/#89) ──────
// The points are as filed, and CODE-A #94 measured 164 of 916 charted series
// mixing bases: AMZN 494M → 10,005M at its 20:1 split, PAC ×1000 from 2017
// ("+96,037%"), GDDY's 2013–2014 pre-listing points and a 7-year hole drawn as
// a straight "rise". The rulings, in the order applied:
//   1. SPLITS from the filer's own restated comparatives (StoredFactSet.asr):
//      a step at a whole split ratio is scaled away only when a restatement
//      by that ratio is on file. With none, the chart STARTS AFTER the step.
//   2. A STEP OVER 100× either way is never drawn across: the clean (latest)
//      segment is kept.
//   3. PRE-LISTING POINTS are dropped (before the first periodic report's own
//      period, data/sec/first-periodic.json via the caller).
//   4. GAPS over 15 months break the line ("no filing data"); never a straight
//      line across a hole.
//   5. THE TREND is the last 3 years: the base is the newest point at or
//      before the cut, and must lie within 6 months before it; otherwise
//      there is no 3-year figure ("Recent history too short").
//
// PURE — no I/O — so the check suite can run it on committed fixtures.
import type { StoredFactSet, StoredPeriod } from "./secFactCodec";
import { valueOf } from "./secFactCodec";

export type ShareHistoryPoint = { date: string; shares: number };

export type ShareHistory = {
  points: ShareHistoryPoint[];
  /**
   * Which series the points are. "annual+quarters" is the long history: the
   * fiscal years in the payload (StoredFactSet.as) that end before the first
   * stored quarter, then every stored quarter. "quarter" / "year" are the fallback for a
   * set written before `as` existed.
   */
  basis: "annual+quarters" | "quarter" | "year";
  /** The line breaks between these consecutive points (more than SHARE_GAP_MAX_DAYS apart). */
  gaps?: { from: string; to: string }[];
  /** Splits scaled away, from the filer's restated comparatives: points before `date` × `ratio`. */
  splits?: { date: string; ratio: number }[];
  /** The series starts later than the data because of an unexplained step, or the listing. */
  startedAfter?: { date: string; reason: "unexplained-split-step" | "scale-step" | "listing" };
  /** The 3-year change, or null with the reason (rule 5). */
  threeYear?: { pct: number; base: ShareHistoryPoint } | { pct: null; reason: "too-short" };
};

/** The chart needs a spread to draw a trend; fewer than this is no chart. */
export const MIN_SHARE_POINTS = 3;
/** Whole split ratios recognised, either way, within SHARE_SPLIT_TOLERANCE. */
export const SHARE_SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];
export const SHARE_SPLIT_TOLERANCE = 0.03;
/**
 * A STEP MATCHES A PROVEN SPLIT within this: the period the step crosses
 * mixes the split with that year's buybacks or issuance (AAPL 2017 -> 2018
 * reads 3.80 against its proven 4:1). The scale applied is the proven ratio.
 */
export const SHARE_PROVEN_SPLIT_TOLERANCE = 0.1;
/** How far from a step its restated comparatives may lie, either way (a 10-K restates up to three prior years). */
export const SHARE_PROVEN_SPLIT_YEARS = 3;
/** A step bigger than this either way is a unit or scale error, never dilution. */
export const SHARE_SCALE_MAX_STEP = 100;
/** Consecutive points further apart than this (15 months) break the line. */
export const SHARE_GAP_MAX_DAYS = 460;
/** The trend window, and how far before its cut the base may sit. */
export const SHARE_TREND_YEARS = 3;
export const SHARE_TREND_BASE_MAX_DAYS = 183;

const SHARE_DAY_MS = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / SHARE_DAY_MS;

/** The whole split ratio `r` matches (as k or 1/k), or null. */
export function splitRatioOf(r: number): number | null {
  if (!Number.isFinite(r) || r <= 0) return null;
  for (const k of SHARE_SPLIT_RATIOS) {
    if (Math.abs(r / k - 1) < SHARE_SPLIT_TOLERANCE) return k;
    if (Math.abs(r * k - 1) < SHARE_SPLIT_TOLERANCE) return 1 / k;
  }
  return null;
}

const seriesOf = (periods: StoredPeriod[]): ShareHistoryPoint[] =>
  periods
    .map((p) => ({ date: p.e, shares: valueOf(p, "sharesBasic") }))
    .filter((p): p is ShareHistoryPoint => typeof p.shares === "number" && p.shares > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

/** The raw series, as before: the long history where the set carries it, else quarters, else years. */
export function rawShareSeries(set: StoredFactSet): { points: ShareHistoryPoint[]; basis: ShareHistory["basis"] } | null {
  // ── THE LONG HISTORY, WHERE THE SET CARRIES IT ────────────────────────────
  // Yearly points back as far as companyfacts goes UP TO THE FIRST STORED
  // QUARTER, then every stored quarter — the owner's shape (2026-09-22, #517),
  // chosen over widening retention. A year that ends on or after the first
  // quarter is left to the quarters, so no stretch is drawn twice.
  if (set.as?.length) {
    const quarters = seriesOf(set.quarters ?? []);
    const firstQuarter = quarters[0]?.date ?? "9999-12-31";
    const years = set.as
      .filter(([date, v]) => typeof v === "number" && v > 0 && date < firstQuarter)
      .map(([date, shares]) => ({ date, shares }));
    const points = [...years, ...quarters];
    if (points.length >= MIN_SHARE_POINTS) return { points, basis: "annual+quarters" };
  }
  const quarters = seriesOf(set.quarters ?? []);
  if (quarters.length >= MIN_SHARE_POINTS) return { points: quarters, basis: "quarter" };
  const years = seriesOf(set.years ?? []);
  if (years.length >= MIN_SHARE_POINTS) return { points: years, basis: "year" };
  return null;
}

/**
 * Rules 1–3 on a raw series. Walks the steps NEWEST FIRST, so the latest
 * segment is the one kept: a split proven by the filer's restatements scales
 * every earlier point; an unproven split step or a >100× step cuts the series
 * there, and the walk stops.
 */
export function correctShareSeries(
  raw: ShareHistoryPoint[],
  restated: [string, number][] = [],
  listedFrom: string | null = null,
  /** Period ends re-filed unchanged (StoredFactSet.asf): a split-like step after one is real issuance. */
  refiled: string[] = [],
): { points: ShareHistoryPoint[]; splits: { date: string; ratio: number }[]; startedAfter?: ShareHistory["startedAfter"] } {
  let pts = raw.map((p) => ({ ...p }));
  const splits: { date: string; ratio: number }[] = [];
  let startedAfter: ShareHistory["startedAfter"];
  // Rule 3 first: nothing before the listing is this company's public record.
  if (listedFrom) {
    const kept = pts.filter((p) => p.date >= listedFrom);
    if (kept.length < pts.length) { startedAfter = { date: kept[0]?.date ?? listedFrom, reason: "listing" }; pts = kept; }
  }
  // A restatement proves a split AT A STEP only if the restated period lies
  // within SHARE_PROVEN_SPLIT_YEARS of the step either way: the comparatives
  // restated after a split can sit before the step's earlier point (a recent
  // split restates last year's same quarter) or after it (a 10-K restates its
  // prior years). An old split never explains a new step.
  const proven = restated
    .map(([e, r]) => ({ e, k: splitRatioOf(r) }))
    .filter((x): x is { e: string; k: number } => x.k !== null);
  const plusYears = (iso: string, n: number) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;
  const nearStep = (e: string, at: string) => e >= plusYears(at, -SHARE_PROVEN_SPLIT_YEARS) && e <= plusYears(at, SHARE_PROVEN_SPLIT_YEARS);
  for (let i = pts.length - 1; i >= 1; i--) {
    const r = pts[i].shares / pts[i - 1].shares;
    if (!Number.isFinite(r) || r <= 0) continue;
    if (r > SHARE_SCALE_MAX_STEP || r < 1 / SHARE_SCALE_MAX_STEP) {
      startedAfter = { date: pts[i].date, reason: "scale-step" };
      pts = pts.slice(i);
      break;
    }
    // A SPLIT THE FILER PROVED, matched loosely; scaled by the proven ratio.
    const p = proven.find((x) => nearStep(x.e, pts[i].date) && Math.abs(r / x.k - 1) < SHARE_PROVEN_SPLIT_TOLERANCE)?.k;
    if (p !== undefined) {
      for (let j = 0; j < i; j++) pts[j] = { ...pts[j], shares: pts[j].shares * p };
      splits.push({ date: pts[i].date, ratio: p });
      continue;
    }
    const k = splitRatioOf(r);
    if (k === null) continue;
    // RE-FILED UNCHANGED: the earlier period was reported again, as it was,
    // so no split restated it. The step is real issuance (or buybacks).
    if (refiled.includes(pts[i - 1].date)) continue;
    {
      startedAfter = { date: pts[i].date, reason: "unexplained-split-step" };
      pts = pts.slice(i);
      break;
    }
  }
  return { points: pts, splits: splits.reverse(), ...(startedAfter ? { startedAfter } : {}) };
}

/** Rule 4: the consecutive pairs more than SHARE_GAP_MAX_DAYS apart. */
export function shareGaps(points: ShareHistoryPoint[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let i = 1; i < points.length; i++) {
    if (days(points[i - 1].date, points[i].date) > SHARE_GAP_MAX_DAYS) out.push({ from: points[i - 1].date, to: points[i].date });
  }
  return out;
}

/** Rule 5: the change over the last SHARE_TREND_YEARS, from a base within SHARE_TREND_BASE_MAX_DAYS before the cut. */
export function threeYearChange(points: ShareHistoryPoint[]): NonNullable<ShareHistory["threeYear"]> {
  const last = points[points.length - 1];
  if (!last) return { pct: null, reason: "too-short" };
  // THE SAME CALENDAR DATE, SHARE_TREND_YEARS EARLIER: a day count (3 × 365.25)
  // lands a day short of a year-end and pushes the base back a whole year.
  const cut = `${Number(last.date.slice(0, 4)) - SHARE_TREND_YEARS}${last.date.slice(4)}`;
  const base = [...points].reverse().find((p) => p.date <= cut);
  if (!base || days(base.date, cut) > SHARE_TREND_BASE_MAX_DAYS || base.shares <= 0) return { pct: null, reason: "too-short" };
  return { pct: ((last.shares - base.shares) / base.shares) * 100, base };
}

/**
 * Quarters first (finer-grained), fiscal years when quarters give too few
 * points — the same preference fetchShareHistory had against FMP — then the
 * corrections above. `listedFrom`: the first periodic report's own period end
 * (data/sec/first-periodic.json), or null when unknown.
 */
export function buildShareHistory(set: StoredFactSet | null, opts: { listedFrom?: string | null } = {}): ShareHistory | null {
  if (!set) return null;
  const raw = rawShareSeries(set);
  if (!raw) return null;
  const fixed = correctShareSeries(raw.points, set.asr ?? [], opts.listedFrom ?? null, set.asf ?? []);
  if (fixed.points.length < MIN_SHARE_POINTS) return null;
  const gaps = shareGaps(fixed.points);
  return {
    points: fixed.points,
    basis: raw.basis,
    ...(gaps.length ? { gaps } : {}),
    ...(fixed.splits.length ? { splits: fixed.splits } : {}),
    ...(fixed.startedAfter ? { startedAfter: fixed.startedAfter } : {}),
    threeYear: threeYearChange(fixed.points),
  };
}
