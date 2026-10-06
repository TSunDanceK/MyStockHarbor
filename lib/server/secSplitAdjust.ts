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

/** The filer's proven splits (forward or reverse), one per ratio and SHARE_PROVEN_SPLIT_YEARS window. */
export function provenSplits(set: Pick<StoredFactSet, "asr">): ProvenSplit[] {
  const out: ProvenSplit[] = [];
  for (const [e, r] of Array.isArray(set.asr) ? set.asr : []) {
    const k = splitRatioOf(r);
    if (k === null) continue;
    const near = out.find((s) => s.k === k && s.refs.some((x) => x >= splitPlusYears(e, -SHARE_PROVEN_SPLIT_YEARS) && x <= splitPlusYears(e, SHARE_PROVEN_SPLIT_YEARS)));
    if (near) near.refs.push(e);
    else out.push({ k, refs: [e] });
  }
  return out;
}

/** Period end -> the factor that puts it on today's basis (1 = already there). */
export function splitFactors(set: Pick<StoredFactSet, "quarters" | "years" | "asr">): Map<string, number> {
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
 * record of what moved (`spa`). A set with no proven split comes back as it
 * was, unstamped; a set already adjusted is returned untouched.
 */
export function splitAdjusted<T extends StoredFactSet>(set: T): T & { spa?: SplitAdjustment } {
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
