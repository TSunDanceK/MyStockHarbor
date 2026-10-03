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
  /**
   * Single filings left out as mis-scaled (off by more than SHARE_SCALE_MAX_STEP
   * from both neighbours). A hole they leave is not a gap: a figure was filed.
   */
  dropped?: string[];
  /** The series starts later than the data because of an unexplained step, or the listing. */
  startedAfter?: { date: string; reason: "unexplained-split-step" | "scale-step" | "listing" | "unmatched-split"; ratio?: number };
  /**
   * NOT DRAWN, AND WHY (#552 COWORK #121): the kept counts disagree with the
   * cover page by more than SHARE_UNITS_MAX_FACTOR, or a >100× step was cut
   * with no cover count to say which side is right. `points` is empty.
   */
  withheld?: { reason: "units-unconfirmed"; factor: number | null };
  /** The 3-year change, or null with the reason (rule 5). */
  threeYear?: { pct: number; base: ShareHistoryPoint; end: ShareHistoryPoint } | { pct: null; reason: "too-short" };
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
/** A step at least this big either way, next to an unmatched split, is not drawn across. */
export const SHARE_UNMATCHED_SPLIT_STEP = 1.5;
/** The kept counts must agree with the cover page within this factor either way. */
export const SHARE_UNITS_MAX_FACTOR = 10;
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
): { points: ShareHistoryPoint[]; splits: { date: string; ratio: number }[]; dropped: string[]; startedAfter?: ShareHistory["startedAfter"] } {
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
  // AN ISOLATED MIS-SCALED FILING (ONDS 2025-03-31 = 105,005 between
  // 70.7M and 150.7M): one point more than SHARE_SCALE_MAX_STEP off BOTH
  // neighbours, the same way, while the neighbours agree with each other, is a
  // units slip on that one filing, not a segment, so rule 2 does not cut there.
  // The point is dropped and the series runs on. Only interior points: the
  // first and last have one neighbour, and a run of two or more is a segment.
  const off = (a: number, b: number) => a / b > SHARE_SCALE_MAX_STEP ? 1 : b / a > SHARE_SCALE_MAX_STEP ? -1 : 0;
  const slips: string[] = [];
  pts = pts.filter((p, i, a) => {
    if (i === 0 || i === a.length - 1) return true;
    const up = off(p.shares, a[i - 1].shares);
    const slip = up !== 0 && up === off(p.shares, a[i + 1].shares) && off(a[i + 1].shares, a[i - 1].shares) === 0;
    if (slip) slips.push(p.date);
    return !slip;
  });
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
      // ONLY THE POINTS STILL AT THE PRE-SPLIT SCALE. Stored quarters carry
      // the newest filed value, so a quarter re-reported as a comparative after
      // the split is already restated while a later one may not be yet (BKNG:
      // Q2 2025 restated ×25, Q3 2025 as first filed). Scaling stops at the
      // inverse step that marks an already-restated point.
      let j0 = i - 1;
      while (j0 > 0 && Math.abs((pts[j0].shares / pts[j0 - 1].shares) * p - 1) >= SHARE_PROVEN_SPLIT_TOLERANCE) j0--;
      for (let j = j0; j < i; j++) pts[j] = { ...pts[j], shares: pts[j].shares * p };
      if (!splits.some((x) => x.ratio === p && nearStep(x.date, pts[i].date))) splits.push({ date: pts[i].date, ratio: p });
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
  // A SPLIT ON FILE THAT NO STEP MATCHED (#552 COWORK #121 follow-up 1). The
  // filer restated its counts for a split, so from the earliest restated
  // period on the counts are on the new basis; the point before it, if it
  // sits a real step away (more than SHARE_UNMATCHED_SPLIT_STEP either way)
  // and no step was matched to that split, is on the OLD basis and mixed with
  // real issuance, so it can be neither scaled nor drawn as it stands (ONDS
  // 2018: 28.5M before its 2020 1-for-3, a 0.62× step). The chart starts at
  // the earliest restated period. Real dilution elsewhere is untouched: this
  // needs restatement evidence for a split, next to the step.
  const byRatio = new Map<number, string[]>();
  for (const x of proven) byRatio.set(x.k, [...(byRatio.get(x.k) ?? []), x.e]);
  for (const [k, dates] of byRatio) {
    const sorted = [...dates].sort();
    const clusters: string[] = [];
    for (const d of sorted) if (!clusters.length || d > plusYears(clusters[clusters.length - 1], SHARE_PROVEN_SPLIT_YEARS)) clusters.push(d);
    for (const eMin of clusters) {
      if (splits.some((x) => x.ratio === k && nearStep(x.date, eMin))) continue;
      const j = pts.findIndex((p) => p.date >= eMin);
      if (j < 1) continue;
      const r = pts[j].shares / pts[j - 1].shares;
      if (Math.abs(Math.log(r)) <= Math.log(SHARE_UNMATCHED_SPLIT_STEP)) continue;
      startedAfter = { date: pts[j].date, reason: "unmatched-split", ratio: k };
      pts = pts.slice(j);
    }
  }
  // Only the slips inside the series as drawn: one before a later cut is moot.
  const dropped = slips.filter((d) => pts.length > 0 && d > pts[0].date);
  return { points: pts, splits: splits.reverse(), dropped, ...(startedAfter ? { startedAfter } : {}) };
}

/**
 * Rule 4: the consecutive pairs more than SHARE_GAP_MAX_DAYS apart. A pair
 * straddling a `dropped` filing is not a gap: the figure was filed, only
 * mis-scaled, so "no filing data" would be false there.
 */
export function shareGaps(points: ShareHistoryPoint[], dropped: string[] = []): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1].date, to = points[i].date;
    if (dropped.some((d) => d > from && d < to)) continue;
    if (days(from, to) > SHARE_GAP_MAX_DAYS) out.push({ from, to });
  }
  return out;
}

/**
 * Rule 5: the change over the last SHARE_TREND_YEARS, from a base within
 * SHARE_TREND_BASE_MAX_DAYS before the cut.
 *
 * THE END MAY STEP BACK BY THE SAME TOLERANCE. Stored quarters skip each fiscal
 * Q4 and the long history's years stop at the first stored quarter, so a cut
 * taken from the latest quarter can fall in a year-wide hole with no base near
 * it (AAPL, MSFT: "too short" with 19 years on file). When it does, the next
 * newer end within SHARE_TREND_BASE_MAX_DAYS of the latest is tried, newest
 * first: both ends stay within the rule's own 6 months, and the span is still
 * three calendar years.
 */
export function threeYearChange(points: ShareHistoryPoint[]): NonNullable<ShareHistory["threeYear"]> {
  const last = points[points.length - 1];
  if (!last) return { pct: null, reason: "too-short" };
  for (let i = points.length - 1; i >= 0 && days(points[i].date, last.date) <= SHARE_TREND_BASE_MAX_DAYS; i--) {
    const end = points[i];
    // THE SAME CALENDAR DATE, SHARE_TREND_YEARS EARLIER: a day count (3 × 365.25)
    // lands a day short of a year-end and pushes the base back a whole year.
    const cut = `${Number(end.date.slice(0, 4)) - SHARE_TREND_YEARS}${end.date.slice(4)}`;
    const base = points.slice(0, i).reverse().find((p) => p.date <= cut);
    if (!base || days(base.date, cut) > SHARE_TREND_BASE_MAX_DAYS || base.shares <= 0) continue;
    return { pct: ((end.shares - base.shares) / base.shares) * 100, base, end };
  }
  return { pct: null, reason: "too-short" };
}

/** The units check: null when the counts can be drawn, else why not. */
export function sharesUnconfirmed(
  fixed: { points: ShareHistoryPoint[]; startedAfter?: ShareHistory["startedAfter"] },
  cover: number | null,
): ShareHistory["withheld"] | null {
  const last = fixed.points[fixed.points.length - 1];
  if (!last) return null;
  if (typeof cover === "number" && cover > 0) {
    const f = last.shares / cover;
    return f > SHARE_UNITS_MAX_FACTOR || f < 1 / SHARE_UNITS_MAX_FACTOR ? { reason: "units-unconfirmed", factor: f } : null;
  }
  return fixed.startedAfter?.reason === "scale-step" ? { reason: "units-unconfirmed", factor: null } : null;
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
  // THE UNITS CHECK (#552 COWORK #121). PAC's kept segment read 505.28B
  // shares; the cover page says 505.28M. The newest counts must agree with the
  // cover-page count within SHARE_UNITS_MAX_FACTOR (wide enough for a class
  // or two the cover leaves out); where they don't, or where a >100× step was
  // cut and no cover count can say which side is right, nothing is drawn and
  // the reason is shown. A count we can't confirm is never charted.
  const withheld = sharesUnconfirmed(fixed, set.cover?.val ?? null);
  if (withheld) return { points: [], basis: raw.basis, withheld };
  if (fixed.points.length < MIN_SHARE_POINTS) return null;
  const gaps = shareGaps(fixed.points, fixed.dropped);
  return {
    points: fixed.points,
    basis: raw.basis,
    ...(gaps.length ? { gaps } : {}),
    ...(fixed.splits.length ? { splits: fixed.splits } : {}),
    ...(fixed.dropped.length ? { dropped: fixed.dropped } : {}),
    ...(fixed.startedAfter ? { startedAfter: fixed.startedAfter } : {}),
    threeYear: threeYearChange(fixed.points),
  };
}
