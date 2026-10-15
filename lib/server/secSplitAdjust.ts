// PER-SHARE FIGURES ON TODAY'S SHARE BASIS (#552 COWORK #187 §1).
//
// ── WHY THE STORED SERIES MIXES TWO BASES ─────────────────────────────────
// A stored period carries the NEWEST filed value. After a split, the filer
// restates the comparatives it re-reports -- three years in the next 10-K, the
// year-ago quarter in each 10-Q -- so those periods arrive on the new basis,
// while every period older than that window keeps the value it was first filed
// at. DECK (6:1, Sep 2024): FY2023 reads $3.23 restated beside FY2022's $16.26
// as first filed, and the table printed a false -80.1%. BKNG (25:1) mixes them
// quarter by quarter, because its newest quarter was filed before the split.
//
// ── ONLY A SPLIT THE FILER PROVED ─────────────────────────────────────────
// The evidence is the filer's own restatement (StoredFactSet.asr: restated ÷
// first-filed share counts), matched to a whole split ratio the same way the
// dilution chart matches it (secShareHistory). A share-count step with no
// restatement behind it is NOT adjusted: IPOs, SPAC mergers, reverse mergers
// and the ×1,000 unit slips all make steps, and dividing a figure by one of
// those would invent a number. A filer whose set predates the share-series
// read (no `asr`) is left as filed until it is re-read.
//
// ── WHICH PERIODS ARE ON THE OLD BASIS ────────────────────────────────────
// Each period's own share count (diluted, else basic; else net income ÷ EPS)
// is compared with the nearest period the filer restated: the side of the
// split it sits on is the one whose scale it matches. A period with no way to
// tell is left as filed, never guessed.
//
// PURE, AND IDEMPOTENT: the result is stamped (`spa`) so a set adjusted twice
// is adjusted once. Called at the entry of the readers that print per-share
// figures (the earnings view, valuation, the dividend profile); the cron's
// stored sets and their change detection never see it.
import { cell, type StoredFactSet, type StoredPeriod } from "./secFactCodec";
import { SEC_FIELD_KEYS } from "./secFields";
import { splitRatioOf, SHARE_PROVEN_SPLIT_YEARS } from "./secShareHistory";

/** Divided by the factor: a per-share figure. */
export const SPLIT_PER_SHARE_KEYS = ["epsBasic", "epsDiluted", "dividendsDeclaredPerShare"] as const;
/** Multiplied by the factor: a share count. */
export const SPLIT_SHARE_COUNT_KEYS = ["sharesBasic", "sharesDiluted"] as const;

export type SplitAdjustment = {
  /** The proven splits applied, newest first. */
  splits: { ratio: number; restated: string }[];
  /** Period ends that were moved onto today's basis. */
  adjusted: string[];
};

type ProvenSplit = { k: number; refs: string[] };

const splitPlusYears = (iso: string, n: number) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;
const splitNum = (p: StoredPeriod, key: string): number | null => {
  const v = cell(p, key)?.val;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** A period's share count, or what net income ÷ EPS implies. */
function splitSharesOf(p: StoredPeriod): number | null {
  const s = splitNum(p, "sharesDiluted") ?? splitNum(p, "sharesBasic");
  if (s !== null && s > 0) return s;
  const ni = splitNum(p, "netIncome"), eps = splitNum(p, "epsDiluted") ?? splitNum(p, "epsBasic");
  if (ni !== null && eps !== null && Math.abs(eps) >= 0.01 && Math.abs(ni) >= 1e6) {
    const implied = ni / eps;
    return implied > 0 ? implied : null;
  }
  return null;
}

/**
 * How far a pre-split period's share count times the split ratio may sit from
 * the reference post-split period's and still corroborate a filed split fact
 * (#552 COWORK #245). Wider than SHARE_SPLIT_TOLERANCE because the two periods
 * are months apart and carry that span's buybacks or issuance; the split
 * itself is the filer's own fact, the share counts only confirm and orient it.
 */
export const SPLIT_FACT_CORROBORATION = 0.15;

/**
 * A SPLIT THE FILER STATED, CONFIRMED BY ITS OWN SHARE COUNTS (#552 COWORK #245).
 *
 * CVNA's 5-for-1 (8 May 2026) never reached `asr`: companyfacts holds no
 * first-filed undimensioned share count for the restated quarter, so there is
 * no restated ÷ first-filed ratio, and Q1 FY2026 ($1.69, filed before the
 * split) sat beside Q2 FY2026 ($0.42, after it). The filer's split fact names
 * the ratio but not, reliably, the direction (CVNA files 0.2 for a forward
 * split). So: the newest period ending after the split date is the reference
 * (its count is on today's basis), and some period ending before the date
 * must sit within SPLIT_FACT_CORROBORATION of it once moved by the ratio --
 * that period proves the split and its direction. A ratio that is not a whole
 * split (CVNA's 0.0556 exchange-ratio facts of 2022-23) is never considered.
 */
function splitsFromFacts(set: Pick<StoredFactSet, "quarters" | "years" | "ssf">): ProvenSplit[] {
  const out: ProvenSplit[] = [];
  const all = [...(set.quarters ?? []), ...(set.years ?? [])].filter((p) => p?.e);
  for (const [date, r] of Array.isArray(set.ssf) ? set.ssf : []) {
    const whole = splitRatioOf(r);
    if (whole === null) continue;
    const after = all.filter((p) => p.e > date && splitSharesOf(p) !== null).sort((a, b) => b.e.localeCompare(a.e))[0];
    if (!after) continue;
    const base = splitSharesOf(after)!;
    for (const K of [whole, 1 / whole]) {
      const proves = all.some((p) => p.e < date && splitSharesOf(p) !== null && Math.abs((splitSharesOf(p)! * K) / base - 1) <= SPLIT_FACT_CORROBORATION);
      if (proves && !out.some((s) => s.k === K)) { out.push({ k: K, refs: [after.e] }); break; }
    }
  }
  return out;
}

/** The filer's proven splits (forward or reverse), one per ratio and SHARE_PROVEN_SPLIT_YEARS window. */
export function provenSplits(set: Pick<StoredFactSet, "asr"> & Partial<Pick<StoredFactSet, "quarters" | "years" | "ssf">>): ProvenSplit[] {
  const out: ProvenSplit[] = [];
  for (const [e, r] of Array.isArray(set.asr) ? set.asr : []) {
    const k = splitRatioOf(r);
    if (k === null) continue;
    const near = out.find((s) => s.k === k && s.refs.some((x) => x >= splitPlusYears(e, -SHARE_PROVEN_SPLIT_YEARS) && x <= splitPlusYears(e, SHARE_PROVEN_SPLIT_YEARS)));
    if (near) near.refs.push(e);
    else out.push({ k, refs: [e] });
  }
  if (set.quarters && set.years) {
    for (const f of splitsFromFacts(set as Pick<StoredFactSet, "quarters" | "years" | "ssf">)) if (!out.some((s) => s.k === f.k)) out.push(f);
  }
  return out;
}

/** Period end -> the factor that puts it on today's basis (1 = already there). */
export function splitFactors(set: Pick<StoredFactSet, "quarters" | "years" | "asr"> & Partial<Pick<StoredFactSet, "ssf">>): Map<string, number> {
  const splits = provenSplits(set);
  const all = [...set.quarters, ...set.years].filter((p) => p?.e);
  const factors = new Map<string, number>();
  if (!splits.length) return factors;
  for (const p of all) {
    const s = splitSharesOf(p);
    if (s === null) continue;
    let f = 1;
    for (const split of splits) {
      // THE NEAREST RESTATED PERIOD is on the new basis (its stored value is the
      // restatement). Compare on the same footing: its shares scaled by what
      // has been applied for the other splits.
      const ref = split.refs
        .map((e) => all.find((q) => q.e === e))
        .filter((q): q is StoredPeriod => Boolean(q) && splitSharesOf(q!) !== null)
        .sort((a, b) => Math.abs(Date.parse(a.e) - Date.parse(p.e)) - Math.abs(Date.parse(b.e) - Date.parse(p.e)))[0];
      if (!ref) continue;
      const base = splitSharesOf(ref)!;
      const asIs = Math.abs(Math.log((s * f) / base));
      const moved = Math.abs(Math.log((s * f * split.k) / base));
      if (moved < asIs) f *= split.k;
    }
    if (f !== 1) factors.set(p.e, f);
  }
  return factors;
}

function adjustPeriod(p: StoredPeriod, f: number): StoredPeriod {
  const v = [...p.v];
  for (const key of SPLIT_PER_SHARE_KEYS) {
    const i = SEC_FIELD_KEYS.indexOf(key);
    if (i >= 0 && typeof v[i] === "number") v[i] = (v[i] as number) / f;
  }
  for (const key of SPLIT_SHARE_COUNT_KEYS) {
    const i = SEC_FIELD_KEYS.indexOf(key);
    if (i >= 0 && typeof v[i] === "number") v[i] = (v[i] as number) * f;
  }
  return { ...p, v };
}

/**
 * The set with every old-basis period moved onto today's share basis, and a
 * record of what moved (`spa`); then the dividend-basis pass below (`dvr`). A
 * set with nothing to move or withhold comes back as it was, unstamped; a set
 * already adjusted is returned untouched.
 */
export function splitAdjusted<T extends StoredFactSet>(set: T): T & { spa?: SplitAdjustment; dvr?: DividendBasis } {
  return dividendBasisApplied(splitMoved(set));
}

function splitMoved<T extends StoredFactSet>(set: T): T & { spa?: SplitAdjustment } {
  const already = (set as { spa?: SplitAdjustment }).spa;
  if (already) return set;
  const factors = splitFactors(set);
  if (!factors.size) return set;
  const move = (ps: StoredPeriod[]) => ps.map((p) => (factors.has(p.e) ? adjustPeriod(p, factors.get(p.e)!) : p));
  return {
    ...set,
    quarters: move(set.quarters),
    years: move(set.years),
    spa: {
      splits: provenSplits(set).map((s) => ({ ratio: s.k, restated: [...s.refs].sort()[0] })).sort((a, b) => (a.restated < b.restated ? 1 : -1)),
      adjusted: [...factors.keys()].sort(),
    },
  };
}

// ── DIVIDENDS FILED AS A PER-QUARTER RATE (#552 COWORK #208) ───────────────
//
// Most filers state dividends per share as a running total: the 10-K's year
// is the four quarters summed, a 10-Q's six months is two. Differencing those
// frames (year − nine months, six months − three) gives a quarter. A RATE
// filer states the quarter's rate in every frame instead: BKNG's FY2025 reads
// $9.60 pre-split, one quarter, and the same subtraction gives $0 quarters and
// a "year" that is a quarter (CODE-A #225/#226).
//
//   RATE FILER: in the newest fiscal year with both an as-filed year and an
//   as-filed Q1, the year is 0.8–1.25× that Q1 (a running total reads ≈ 4×),
//   and 0.8–1.25× each Q2/Q3 it filed directly as well (see dividendRateFiler).
//   1. Its differenced quarters are withheld: only quarters it filed directly
//      are shown.
//   2. Its years are withheld: the filed "year" is a per-quarter rate, not a
//      full-year total.
//   3. ANY filer: a quarter differenced from a quarter on the other side of a
//      proven split (one moved by the split pass above, the other not) is
//      withheld -- the subtraction mixes two share bases.
//
// Withheld = value null, derivation "W", as the derived-Q4 revenue rule
// stores it. A READ-TIME pass, here, because every dividend reader (the
// profile row, the pickers row, valuation, the earnings view) already enters
// through splitAdjusted: no stored set changes and nothing is re-read.
// Stamped (`dvr`) so a set passed twice is judged once; a set with nothing
// withheld is returned as it was.

export const DIVIDEND_RATE_MIN = 0.8;
export const DIVIDEND_RATE_MAX = 1.25;
const DIVIDEND_BASIS_KEY = "dividendsDeclaredPerShare";

export type DividendBasis = {
  /** The year that classed the filer as a rate filer, and its year ÷ Q1 ratio; null if it is not one. */
  rate: { fy: number; ratio: number } | null;
  /** Period ends withheld, by array (a Q4 and its year share an end). */
  quarters: string[];
  years: string[];
};

/** A rate filer's classing year and ratio, or null. Pure; read on today's share basis. */
export function dividendRateFiler(set: Pick<StoredFactSet, "quarters" | "years">): DividendBasis["rate"] {
  const years = [...set.years].filter((y) => y?.e).sort((a, b) => (a.e < b.e ? 1 : a.e > b.e ? -1 : 0));
  for (const y of years) {
    const fy = cell(y, DIVIDEND_BASIS_KEY);
    if (fy.derived !== "as-filed" || !(typeof fy.val === "number" && fy.val > 0) || y.fy == null) continue;
    const q1 = cell(set.quarters.find((p) => p.fy === y.fy && p.fp === "Q1"), DIVIDEND_BASIS_KEY);
    if (q1.derived !== "as-filed" || !(typeof q1.val === "number" && q1.val > 0)) continue;
    const ratio = fy.val / q1.val;
    const inBand = (r: number) => r >= DIVIDEND_RATE_MIN && r <= DIVIDEND_RATE_MAX;
    if (!inBand(ratio)) return null;
    // AND EVERY OTHER QUARTER IT FILED DIRECTLY (Q2, Q3) MATCHES THE YEAR TOO.
    // The year ≈ Q1 alone also fits two filers whose year IS a real total
    // (CODE-A #227 census): one that declares the whole year in Q1 and files
    // $0 after it (WMT, WTM), and a running total whose Q1 carried a special
    // or preceded a cut (IIIN $1.03 then $0.03s, OGN $0.28 then $0.02s). A rate
    // filer's filed quarters each read the rate. Q4 is left out: a "Q4" filed
    // on its own is rare, and MTH's reads the year's sum.
    const offRate = set.quarters.some((p) => {
      if (p.fy !== y.fy || (p.fp !== "Q2" && p.fp !== "Q3")) return false;
      const c = cell(p, DIVIDEND_BASIS_KEY);
      return c.derived === "as-filed" && typeof c.val === "number" && !(c.val > 0 && inBand(fy.val! / c.val));
    });
    return offRate ? null : { fy: y.fy, ratio };
  }
  return null;
}

function dividendWithheld(p: StoredPeriod, i: number): StoredPeriod {
  const v = [...p.v];
  v[i] = null;
  const d = p.d.padEnd(i + 1, "-");
  return { ...p, v, d: `${d.slice(0, i)}W${d.slice(i + 1)}` };
}

function dividendBasisApplied<T extends StoredFactSet & { spa?: SplitAdjustment }>(set: T): T & { dvr?: DividendBasis } {
  if ((set as { dvr?: DividendBasis }).dvr) return set;
  const i = SEC_FIELD_KEYS.indexOf(DIVIDEND_BASIS_KEY);
  if (i < 0) return set;
  const rate = dividendRateFiler(set);
  const moved = new Set(set.spa?.adjusted ?? []);
  const quarters: string[] = [];
  const nextQuarters = set.quarters.map((p) => {
    const c = cell(p, DIVIDEND_BASIS_KEY);
    if (c.derived !== "differenced" || c.val === null) return p;
    // Rule 3: the quarter before it in the same fiscal year, on the other basis.
    const prior = p.fy == null ? undefined : set.quarters
      .filter((x) => x.fy === p.fy && x.e < p.e)
      .sort((a, b) => (a.e < b.e ? 1 : -1))[0];
    const acrossSplit = Boolean(prior) && moved.has(prior!.e) !== moved.has(p.e);
    if (!rate && !acrossSplit) return p;
    quarters.push(p.e);
    return dividendWithheld(p, i);
  });
  const years: string[] = [];
  const nextYears = !rate ? set.years : set.years.map((y) => {
    if (cell(y, DIVIDEND_BASIS_KEY).val === null) return y;
    years.push(y.e);
    return dividendWithheld(y, i);
  });
  if (!quarters.length && !years.length) return set;
  return { ...set, quarters: nextQuarters, years: nextYears, dvr: { rate, quarters: quarters.sort(), years: years.sort() } };
}
