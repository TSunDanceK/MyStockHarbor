// Turn one companyfacts document into the stored periods.
//
// THE FOUR TRAPS THIS FILE EXISTS TO NOT FALL INTO, all four of which render as
// a plausible number rather than an error (claude/BRIEF-step3-extraction-and-
// retention-2026-09-14.md):
//
//   1. Cash flow is filed YEAR-TO-DATE. Every quarter but Q1 must be
//      differenced, and a Q3 figure read straight is ~3x too large.
//   2. The tag chain resolves PER PERIOD, not per symbol. Resolve once and
//      AAPL's revenue goes empty before 2018 rather than falling through to the
//      legacy `Revenues` tag.
//   3. A period can carry an original and a restatement. Newest accession wins.
//   4. Fiscal years are not calendar years, and Q4 is NEVER FILED.
//
// AND THE FIFTH, WHICH IS STRUCTURAL RATHER THAN ARITHMETIC: differencing a
// BALANCE-SHEET item yields a change-in-balance where a balance was asked for.
// That is prevented here by construction rather than by care -- the differencing
// walks `cumulativeFields()` and there is no code path from it to an instant
// field. See secFields.ts for why the flag lives on the definition.
import {
  SEC_FIELDS,
  SEC_FIELD_KEYS,
  cumulativeFields,
  instantFields,
  secFieldsHash,
  type FieldDef,
} from "./secFields";

/** One row as companyfacts publishes it, narrowed to what is read here. */
export type FactRow = {
  start?: string;
  end?: string;
  val?: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
};

export type CompanyFacts = {
  cik?: number;
  entityName?: string;
  facts?: Record<string, Record<string, { units?: Record<string, FactRow[]> }>>;
};

/** Why a stored number is the number it is. Carried so a diff can be explained. */
export type Derivation =
  /** The filer published this exact period. */
  | "as-filed"
  /** Cumulative-minus-cumulative within one fiscal year. */
  | "differenced"
  /** Several values for one period and no way to choose. Value is null. */
  | "ambiguous";

export type FieldValue = {
  val: number | null;
  /** The tag that won the chain FOR THIS PERIOD. */
  tag: string | null;
  /** companyfacts units key the value was read from. Stored per period. */
  unit: string | null;
  derived: Derivation;
  /** Only on "differenced": the two cumulative ends that produced it. */
  from?: [string, string];
  /** Only on "ambiguous": the distinct values that could not be separated. */
  candidates?: number[];
};

export type PeriodRecord = {
  /** Period end, YYYY-MM-DD. The identity of the period. */
  end: string;
  /** Period start for a duration; absent for an instant. */
  start: string | null;
  /** "Q1".."Q4" for a quarter, "FY" for a fiscal year, null for an instant. */
  fp: string | null;
  fy: number | null;
  /**
   * The newest accession contributing to this period, and when it was filed.
   * Per PERIOD, not per field: it is the restatement handle, and a per-field
   * copy would be 43 duplicates of the same string.
   */
  accession: string | null;
  filed: string | null;
  /** Positional, indexed by SEC_FIELD_KEYS. */
  values: (FieldValue | null)[];
};

export type ExtractResult = {
  symbol: string;
  cik: number | null;
  entityName: string | null;
  /** The fail-safe for positional decoding. See secFields.secFieldsHash. */
  fieldsHash: string;
  quarters: PeriodRecord[];
  years: PeriodRecord[];
  /** Instant fields hang off the period end they were measured at. */
  instants: PeriodRecord[];
  notes: string[];
};

// ── period arithmetic ───────────────────────────────────────────────────────

const DAY = 86400000;

function spanDays(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / DAY;
}

/**
 * How many fiscal quarters a duration covers, or null if it covers none cleanly.
 *
 * WIDE BANDS ON PURPOSE. A 4-4-5 retail calendar makes a "quarter" anywhere from
 * 84 to 98 days, and a 53-week year stretches the annual frame past 370. A tight
 * band silently drops those filers rather than failing, which is the same
 * fail-open shape as reading a cumulative figure straight.
 */
export function quartersCovered(days: number): 1 | 2 | 3 | 4 | null {
  if (days >= 80 && days <= 105) return 1;
  if (days >= 170 && days <= 200) return 2;
  if (days >= 260 && days <= 290) return 3;
  if (days >= 350 && days <= 380) return 4;
  return null;
}

/** Newest filing wins; `filed` first because an accession does not sort by date. */
function newer(a: FactRow, b: FactRow): FactRow {
  const af = String(a.filed ?? "");
  const bf = String(b.filed ?? "");
  if (af !== bf) return af > bf ? a : b;
  return String(a.accn ?? "") >= String(b.accn ?? "") ? a : b;
}

/**
 * Every row for one field, in the unit the definition asks for, from whichever
 * chain entry has it -- WITHOUT collapsing the chain to one tag.
 *
 * Returns rows tagged with which chain entry produced them and at what rank, so
 * the per-period resolution below can prefer the earlier entry FOR THAT PERIOD.
 * Collapsing here is trap 2: AAPL's revenue is `RevenueFromContractWith...`
 * from 2018 and `Revenues` before it, and one tag for the symbol loses half.
 */
function rowsForField(facts: CompanyFacts, field: FieldDef) {
  const out: { row: FactRow; tag: string; rank: number; unit: string }[] = [];
  const taxonomy = facts.facts?.[field.taxonomy];
  if (!taxonomy) return out;

  field.chain.forEach((tag, rank) => {
    const units = taxonomy[tag]?.units;
    if (!units) return;
    // The declared unit, plus the singular spelling SEC also publishes. Not a
    // scan of every unit key: reading a JPY series into a USD field is exactly
    // the plausible-wrong-number failure this file is built against.
    const keys =
      field.unit === "USD/shares" ? ["USD/shares", "USD/share"] : [field.unit];
    for (const unit of keys) {
      for (const row of units[unit] ?? []) {
        if (typeof row?.val !== "number" || !Number.isFinite(row.val)) continue;
        if (!row.end) continue;
        out.push({ row, tag, rank, unit });
      }
    }
  });
  return out;
}

/**
 * Resolve one period key to one value, applying trap 2 and trap 3 IN THAT ORDER.
 *
 * Chain rank first: the earliest chain entry that covers this period wins,
 * whatever it was filed in. Only within one rank does the newest accession win.
 * The other order would let a 10-K's legacy `Revenues` restatement beat the
 * current tag because it was filed later.
 */
function resolve(
  candidates: { row: FactRow; tag: string; rank: number; unit: string }[]
) {
  let best: { row: FactRow; tag: string; rank: number; unit: string } | null = null;
  for (const c of candidates) {
    if (!best || c.rank < best.rank) { best = c; continue; }
    if (c.rank === best.rank && newer(c.row, best.row) === c.row) best = c;
  }
  return best;
}

// ── extraction ──────────────────────────────────────────────────────────────

type Bucket = Map<string, { row: FactRow; tag: string; rank: number; unit: string }[]>;

const periodKey = (r: FactRow) => `${r.start ?? ""}..${r.end}`;

/**
 * The stored periods for one symbol.
 *
 * `asOf` exists so a check can pin the window; it does not change what is read,
 * only which periods survive the retention slice.
 */
export function extractCompanyFacts(
  symbol: string,
  facts: CompanyFacts,
  opts: { quarters?: number; years?: number } = {}
): ExtractResult {
  const keepQuarters = opts.quarters ?? 8;
  const keepYears = opts.years ?? 5;
  const notes: string[] = [];

  // One pass per field, bucketed by period key.
  const buckets = new Map<string, Bucket>();
  for (const field of SEC_FIELDS) {
    const bucket: Bucket = new Map();
    for (const c of rowsForField(facts, field)) {
      const k = periodKey(c.row);
      const list = bucket.get(k);
      if (list) list.push(c);
      else bucket.set(k, [c]);
    }
    buckets.set(field.key, bucket);
  }

  // ── durations: cumulative frames, then the differencing ────────────────────
  //
  // THE DIFFERENCING WALKS cumulativeFields() AND NOTHING ELSE. There is no
  // branch here that can reach a balance-sheet field, which is the whole point
  // of putting `kind` on the definition.
  const quarterCells = new Map<string, Map<string, FieldValue>>(); // end -> key -> value
  const yearCells = new Map<string, Map<string, FieldValue>>();
  const quarterMeta = new Map<string, { start: string; row: FactRow }>();
  const yearMeta = new Map<string, { start: string; row: FactRow }>();

  for (const field of cumulativeFields()) {
    const bucket = buckets.get(field.key)!;

    // Cumulative frames grouped by the fiscal year they start: a 3M, 6M, 9M and
    // FY row for one year all share a `start`. Q4 = FY - 9M falls out of this
    // with no special case, which is trap 4 handled structurally.
    const byStart = new Map<string, { end: string; n: number; best: NonNullable<ReturnType<typeof resolve>> }[]>();

    for (const [, cands] of bucket) {
      const best = resolve(cands);
      if (!best?.row.start || !best.row.end) continue;
      const n = quartersCovered(spanDays(best.row.start, best.row.end));
      if (n === null) continue;
      const list = byStart.get(best.row.start);
      const entry = { end: best.row.end, n, best };
      if (list) list.push(entry);
      else byStart.set(best.row.start, [entry]);
    }

    for (const [start, framesRaw] of byStart) {
      // One frame per length. A year can carry both a 10-Q's 9M and a 10-K's
      // restated 9M; resolve() already chose, this only de-duplicates lengths.
      const byLen = new Map<number, (typeof framesRaw)[number]>();
      for (const f of framesRaw) {
        const prev = byLen.get(f.n);
        if (!prev || newer(f.best.row, prev.best.row) === f.best.row) byLen.set(f.n, f);
      }
      const frames = [...byLen.values()].sort((a, b) => a.n - b.n);

      for (const f of frames) {
        const cell = (map: typeof quarterCells, meta: typeof quarterMeta) => {
          let m = map.get(f.end);
          if (!m) { m = new Map(); map.set(f.end, m); }
          if (!meta.has(f.end)) meta.set(f.end, { start, row: f.best.row });
          return m;
        };

        if (f.n === 4) {
          cell(yearCells, yearMeta).set(field.key, {
            val: f.best.row.val!, tag: f.best.tag, unit: f.best.unit, derived: "as-filed",
          });
        }

        if (f.n === 1) {
          // Q1, as filed. The only quarter that needs no differencing.
          cell(quarterCells, quarterMeta).set(field.key, {
            val: f.best.row.val!, tag: f.best.tag, unit: f.best.unit, derived: "as-filed",
          });
          continue;
        }

        const prior = byLen.get(f.n - 1);
        if (!prior) continue;
        // SAME TAG ON BOTH SIDES, or the difference is between two different
        // concepts and is arithmetic on unrelated numbers. An ASC 606 boundary
        // falling mid-year is exactly where this happens.
        if (prior.best.tag !== f.best.tag) {
          notes.push(
            `${field.key} ${start}..${f.end}: tag changed mid-year ` +
              `(${prior.best.tag} -> ${f.best.tag}), not differenced`
          );
          continue;
        }
        const m = cell(quarterCells, quarterMeta);
        // The quarter's own start is the prior frame's end, not the year's.
        quarterMeta.set(f.end, { start: prior.end, row: f.best.row });
        m.set(field.key, {
          val: f.best.row.val! - prior.best.row.val!,
          tag: f.best.tag,
          unit: f.best.unit,
          derived: "differenced",
          from: [prior.end, f.end],
        });
      }
    }
  }

  // ── instants: NEVER differenced, and there is no code above that could ─────
  const instantCells = new Map<string, Map<string, FieldValue>>();
  const instantMeta = new Map<string, FactRow>();

  for (const field of instantFields()) {
    const bucket = buckets.get(field.key)!;
    for (const [, cands] of bucket) {
      const end = cands[0]?.row.end;
      if (!end) continue;

      let value: FieldValue;
      if (!field.singleValued) {
        // The multi-class cover page. Distinct values for one period key are
        // classes companyfacts cannot name, and picking one IS the BRK.B bug.
        const newestFiled = cands.reduce((a, b) => (newer(a.row, b.row) === a.row ? a : b));
        const sameFiling = cands.filter(
          (c) => String(c.row.accn ?? "") === String(newestFiled.row.accn ?? "")
        );
        const distinct = [...new Set(sameFiling.map((c) => c.row.val!))];
        value =
          distinct.length > 1
            ? { val: null, tag: newestFiled.tag, unit: newestFiled.unit, derived: "ambiguous", candidates: distinct.sort((a, b) => b - a) }
            : { val: distinct[0]!, tag: newestFiled.tag, unit: newestFiled.unit, derived: "as-filed" };
      } else {
        const best = resolve(cands);
        if (!best) continue;
        value = { val: best.row.val!, tag: best.tag, unit: best.unit, derived: "as-filed" };
      }

      let m = instantCells.get(end);
      if (!m) { m = new Map(); instantCells.set(end, m); }
      const prior = instantMeta.get(end);
      const rep = cands.reduce((a, b) => (newer(a.row, b.row) === a.row ? a : b)).row;
      if (!prior || newer(rep, prior) === rep) instantMeta.set(end, rep);
      m.set(field.key, value);
    }
  }

  const pack = (
    cells: Map<string, Map<string, FieldValue>>,
    meta: (end: string) => { start: string | null; row: FactRow | undefined }
  ): PeriodRecord[] =>
    [...cells.entries()]
      .map(([end, m]) => {
        const { start, row } = meta(end);
        return {
          end,
          start,
          fp: row?.fp ?? null,
          fy: typeof row?.fy === "number" ? row.fy : null,
          accession: row?.accn ?? null,
          filed: row?.filed ?? null,
          values: SEC_FIELD_KEYS.map((k) => m.get(k) ?? null),
        };
      })
      .sort((a, b) => (a.end < b.end ? 1 : -1));

  const quarters = pack(quarterCells, (e) => ({
    start: quarterMeta.get(e)?.start ?? null,
    row: quarterMeta.get(e)?.row,
  })).slice(0, keepQuarters);

  const years = pack(yearCells, (e) => ({
    start: yearMeta.get(e)?.start ?? null,
    row: yearMeta.get(e)?.row,
  })).slice(0, keepYears);

  const instants = pack(instantCells, (e) => ({ start: null, row: instantMeta.get(e) })).slice(
    0,
    keepQuarters
  );

  return {
    symbol,
    cik: typeof facts.cik === "number" ? facts.cik : null,
    entityName: facts.entityName ?? null,
    fieldsHash: secFieldsHash(),
    quarters,
    years,
    instants,
    notes,
  };
}

/**
 * The arithmetic assertion the brief names: operating + investing + financing
 * must reconcile to the net change in cash. It is free, it is per period, and it
 * tests the DIFFERENCING rather than the tags -- a quarter assembled from the
 * wrong pair of cumulative frames fails it.
 *
 * Returns the periods that do NOT reconcile. `tolerance` is relative: filers
 * round to thousands and an exact equality would flag every one of them.
 */
export function cashFlowReconciliation(
  periods: PeriodRecord[],
  tolerance = 0.01
): { end: string; sum: number; stated: number; relative: number }[] {
  const idx = (k: string) => SEC_FIELD_KEYS.indexOf(k);
  const iOp = idx("operatingCashFlow");
  const iIn = idx("investingCashFlow");
  const iFi = idx("financingCashFlow");
  const iNet = idx("netChangeInCash");
  const bad: { end: string; sum: number; stated: number; relative: number }[] = [];

  for (const p of periods) {
    const parts = [iOp, iIn, iFi].map((i) => p.values[i]?.val ?? null);
    const stated = p.values[iNet]?.val ?? null;
    if (stated === null || parts.some((v) => v === null)) continue;
    const sum = (parts as number[]).reduce((a, b) => a + b, 0);
    const scale = Math.max(Math.abs(stated), Math.abs(sum), 1);
    const relative = Math.abs(sum - stated) / scale;
    if (relative > tolerance) bad.push({ end: p.end, sum, stated, relative });
  }
  return bad;
}
