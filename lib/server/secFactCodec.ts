// The positional codec for the stored fact set — PURE, no Redis.
//
// SPLIT OUT OF secFactStore SO IT CAN BE TESTED AGAINST REAL FILINGS. The store
// imports @upstash/redis, which a relay probe cannot resolve: the read-only job
// installs the TypeScript compiler and nothing else, on purpose. Everything here
// is arithmetic over arrays and is the half that can actually be wrong in a way
// a check would catch, so it lives where a check can reach it.
//
// POSITIONAL VALUES, GATED BY A HASH. Storing {revenue: 1, costOfRevenue: 2, ...}
// per period spends the field names 13 times over (8 quarters + 5 years).
// Measured: named 19.7 KB against positional 10.2 KB, 48% smaller, and it halves
// the growth of the append-only annual series. The cost is that a reader whose
// field ORDER differs from the writer's decodes 46 values shifted by one --
// silently, and plausibly. So the writer stores secFieldsHash() and a reader
// whose own hash differs treats the record as UNREADABLE and refetches. An order
// change becomes a cache miss instead of a wrong number.
import { SEC_FIELD_KEYS, secChainsHash, secFieldsHash } from "./secFields";
import { SEC_QUARTER_WINDOW, SEC_YEAR_WINDOW, SEC_LABEL_VERSION } from "./secExtract";
import type { CoverShares, ExtractResult, PeriodRecord } from "./secExtract";

/** One period as stored. Arrays are positional over SEC_FIELD_KEYS. */
export type StoredPeriod = {
  e: string;                       // end
  s: string | null;                // start
  fp: string | null;
  fy: number | null;
  a: string | null;                // accession
  f: string | null;                // filed
  /** Values, positional. null = not filed. */
  v: (number | null)[];
  /**
   * Derivation codes, positional, ONE CHARACTER EACH, joined into one string.
   * "F" as-filed · "D" differenced · "C" computed · "A" ambiguous · "-" absent.
   *
   * A STRING, NOT AN ARRAY: 46 one-character array entries cost ~230 bytes of
   * JSON per period against 46. The page needs this on every cell it renders --
   * the owner's rule is that a derived figure is LABELLED as derived, so it
   * cannot be dropped to save the bytes, only stored cheaply.
   */
  d: string;
};

export type StoredFactSet = {
  /** Schema/field-order gate. A reader whose hash differs must refetch. */
  h: string;
  symbol: string;
  cik: string | null;
  entityName: string | null;
  /** When the extraction ran, ms. */
  at: number;
  quarters: StoredPeriod[];
  years: StoredPeriod[];
  instants: StoredPeriod[];
  cover: CoverShares | null;
  /**
   * Taxonomy namespaces the payload carried. OPTIONAL, because sets written
   * before this existed do not have it -- absent is "unknown", not "none", and
   * every reader must treat it that way.
   *
   * NOT in contentHashOf: it describes the SOURCE, not a value, and a payload
   * that gains a namespace without changing a number is not a restatement.
   */
  tx?: string[];
  /**
   * Content hash of the TAG CHAINS that produced this set. Optional for the
   * same reason `tx` is: sets predate it, and absent means "older than the
   * chains", which is precisely when a retry is warranted.
   *
   * Read ONLY to decide whether an EMPTY set is worth re-reading; a set with
   * values is never invalidated by it. See secFields.secChainsHash.
   */
  c?: string;
  /** Currencies a mapped tag was published in and refused. See rowsForField. */
  cu?: string[];
  /**
   * The PERIOD LABELLING version this set was written under. Absent = 1, the
   * version that named a fiscal year by the calendar year of its end. See
   * SEC_LABEL_VERSION; `h` and `c` cannot see a labelling change.
   */
  lv?: number;
  /**
   * The QUARTER RETENTION WINDOW this set was written under.
   *
   * NOT a gate — `h` is the gate, and it does not move for a window change, so
   * a set written at 8 stays perfectly readable. This exists so the cron can
   * SELECT sets written under an older window without reading every one of
   * them: the manifest entry carries the same number, so the queue is picked
   * from one key. Absent means 8, the window before this field existed.
   */
  w?: number;
  /**
   * The YEAR retention window this set was written under. Same job as `w`, same
   * absence rule: missing means 5, the window before this field existed, and 5
   * is one short of what the five-year card needs to reach its own FY-1.
   *
   * TWO FIELDS, ONE QUEUE. Both feed the same rewindow selection rather than a
   * second one — a set is stale if EITHER window is behind, and two queues over
   * the same symbols would be two allowances competing for the same re-read.
   */
  y?: number;
  /**
   * THE ONE CONCEPT THIS FILER'S COLUMN USES, per field marked
   * `oneConceptPerFiler` — `ns|tag`, keyed by field key.
   *
   * OPTIONAL, and absent means "written before the rule", not "no choice made".
   * A reader must not infer the primary concept from its absence: the whole
   * point is that some filers are on the broader one, and guessing would put
   * the wrong heading on exactly those.
   *
   * NOT in contentHashOf. It is provenance, not a value — a set whose numbers
   * are identical is not a restatement because it now records which concept
   * produced them. `c` (secChainsHash) is what makes such a set eligible for
   * re-read, and it moves with the policy.
   */
  cc?: Record<string, string>;
  /** Content hash of the values only — the restatement tripwire (spec §3 L2). */
  contentHash: string;
  notes: string[];
};

const CODE: Record<string, string> = {
  "as-filed": "F", differenced: "D", computed: "C", ambiguous: "A",
};
export const DERIVATION_OF: Record<string, "as-filed" | "differenced" | "computed" | "ambiguous" | null> = {
  F: "as-filed", D: "differenced", C: "computed", A: "ambiguous", "-": null,
};

function encodePeriod(p: PeriodRecord): StoredPeriod {
  return {
    e: p.end, s: p.start, fp: p.fp, fy: p.fy, a: p.accession, f: p.filed,
    v: p.values.map((c) => c?.val ?? null),
    d: p.values.map((c) => (c ? CODE[c.derived] ?? "-" : "-")).join(""),
  };
}

/** FNV-1a over every stored value, in order. The Layer 2 tripwire. */
export function contentHashOf(set: Omit<StoredFactSet, "contentHash">): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const list of [set.quarters, set.years, set.instants]) {
    for (const p of list) {
      feed(p.e);
      feed(p.a ?? "");
      // THE VALUES, NOT THE PROVENANCE ALONE. A restatement that changes a
      // number without changing the accession is exactly the case Layer 1
      // cannot see, and hashing only the accession would miss it.
      for (const v of p.v) feed(v === null ? "~" : String(v));
      feed(p.d);
    }
  }
  feed(String(set.cover?.val ?? "~"));
  return h.toString(16).padStart(8, "0");
}

export function encodeFactSet(result: ExtractResult): StoredFactSet {
  const base = {
    h: secFieldsHash(),
    symbol: result.symbol,
    cik: result.cik === null ? null : String(result.cik).padStart(10, "0"),
    entityName: result.entityName,
    at: Date.now(),
    quarters: result.quarters.map(encodePeriod),
    years: result.years.map(encodePeriod),
    instants: result.instants.map(encodePeriod),
    cover: result.coverShares,
    tx: result.taxonomies,
    c: secChainsHash(),
    cu: result.refusedUnits,
    cc: result.conceptChoice,
    w: SEC_QUARTER_WINDOW,
    y: SEC_YEAR_WINDOW,
    lv: SEC_LABEL_VERSION,
    notes: result.notes,
  };
  return { ...base, contentHash: contentHashOf(base) };
}


// ── reading a stored set, by field name rather than by position ─────────────

const INDEX_OF = new Map(SEC_FIELD_KEYS.map((k, i) => [k, i]));

/** One cell: the value and how it came to be. */
export type Cell = {
  val: number | null;
  derived: "as-filed" | "differenced" | "computed" | "ambiguous" | null;
};

/**
 * THE ONLY WAY THE PAGE READS A STORED VALUE.
 *
 * Positional decoding by hand at each call site is how a shifted array becomes
 * 46 wrong numbers, so there is one function and it looks the index up by name.
 */
export function cell(period: StoredPeriod | null | undefined, key: string): Cell {
  const i = INDEX_OF.get(key);
  if (!period || i === undefined) return { val: null, derived: null };
  return { val: period.v[i] ?? null, derived: DERIVATION_OF[period.d[i] ?? "-"] ?? null };
}

/** Convenience for the common case where only the number is wanted. */
export const valueOf = (period: StoredPeriod | null | undefined, key: string) =>
  cell(period, key).val;

/**
 * A trailing-twelve-month sum over the newest four quarters.
 *
 * ALL FOUR OR NULL. Three quarters summed and presented as a year understates
 * by a quarter and looks entirely plausible doing it -- and after D1b, Q4 EPS
 * and Q4 share counts are legitimately null, so the three-quarter case is now
 * the COMMON one rather than an edge. Returning a number there would put a
 * visibly wrong EPS on the page four times a year.
 */
export function ttm(quarters: StoredPeriod[], key: string): number | null {
  const four = quarters.slice(0, 4);
  if (four.length < 4) return null;
  const vals = four.map((q) => valueOf(q, key));
  if (vals.some((v) => v === null)) return null;
  return (vals as number[]).reduce((a, b) => a + b, 0);
}

/**
 * The filer's own label for a period: "Q3 FY2026", not "Q3 2026".
 *
 * FISCAL, NOT CALENDAR, and the FY prefix is not decoration. The five probe
 * symbols' year-ends are 31 Mar, 26 Sep, 3 Sep, 31 Oct and 31 Dec, so two
 * companies' "2026" can be nine months apart. Falls back to the end date rather
 * than inventing a quarter number.
 */
export function periodLabel(p: StoredPeriod | null | undefined): string {
  if (!p) return "—";
  // "FY2026" for an annual period, "Q3 FY2026" for a quarter. The first
  // version produced "FY FY2026".
  if (p.fp && p.fy) return p.fp === "FY" ? `FY${p.fy}` : `${p.fp} FY${p.fy}`;
  return p.e;
}
