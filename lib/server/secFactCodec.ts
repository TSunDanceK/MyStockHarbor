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
import type { FxConversion } from "./secCurrency";

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
  /**
   * THE CURRENCY THE FILER REPORTS IN. Absent means USD — every set written
   * before currencies were admitted was, by construction, a USD reader.
   *
   * NOT in contentHashOf, for the reason `tx` is not: it describes the SOURCE.
   * A filer does not restate by being Irish.
   */
  cur?: string;
  /**
   * HOW THIS SET WAS CONVERTED INTO USD, or absent if it never was.
   *
   * ── THE RATES ARE STORED, AND THAT IS THE POINT ──────────────────────────
   * `applied` carries the rate used for every period end. Two things depend on
   * it and neither is decoration:
   *
   *   1. GROWTH IS COMPUTED IN THE REPORTING CURRENCY, which means dividing
   *      the stored USD figure back out by the rate its period was converted
   *      at. Without the rate here that recovery is impossible and growth
   *      would silently become "business result compounded with FX move".
   *   2. A HISTORICAL FIGURE MUST NOT MOVE. The rate travels with the set, so
   *      re-reading tomorrow reproduces today's number rather than reconverting
   *      at tomorrow's rate.
   *
   * NOT in contentHashOf. The hash exists to catch a RESTATEMENT — the filer
   * changing a number — and a rate revision is not the filer doing anything.
   * Including it would make every FX tick look like a silent restatement and
   * drown the log that exists to surface real ones.
   */
  fx?: {
    from: string;
    source: string;
    applied: { end: string; usdPerUnit: number; basis: "average" | "spot" }[];
    refused: string[];
  };
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
  /**
   * Fiscal-year basic shares, every year in the payload: `[yearEnd, shares]`.
   * See ExtractResult.annualShares. Optional; not in contentHashOf, since it
   * duplicates a field the hashed years already carry for the retained span.
   */
  as?: [string, number][];
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

export function encodeFactSet(
  result: ExtractResult,
  /**
   * How `result` was converted, and WHAT THE FILER ACTUALLY PUBLISHED.
   *
   * ── WHY THE HASH IS TAKEN ON `reported` AND NOT ON THE STORED VALUES ─────
   * contentHash is Layer 2 of the corrections failsafe: a figure that moved
   * with no filing event behind it is a SILENT RESTATEMENT. That test is about
   * the FILER changing a number.
   *
   * An exchange rate is not the filer doing anything. If the hash were taken
   * on converted values, every rate revision would raise a restatement, and a
   * log that cries restatement on ordinary FX noise is a log nobody reads —
   * which is the same as not having one, for the real restatements it exists
   * to catch.
   *
   * So the hash is computed on the reporting-currency figures. A genuine
   * restatement still moves it; a rate move never does.
   */
  fx?: { conversion: FxConversion; reported: ExtractResult }
): StoredFactSet {
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
    ...(result.annualShares?.length ? { as: result.annualShares } : {}),
    w: SEC_QUARTER_WINDOW,
    y: SEC_YEAR_WINDOW,
    lv: SEC_LABEL_VERSION,
    cur: result.reportingCurrency,
    fx: fx?.conversion,
    notes: result.notes,
  };
  const hashInput = fx
    ? {
        ...base,
        quarters: fx.reported.quarters.map(encodePeriod),
        years: fx.reported.years.map(encodePeriod),
        instants: fx.reported.instants.map(encodePeriod),
      }
    : base;
  return { ...base, contentHash: contentHashOf(hashInput) };
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

/**
 * The label for each period end AS A RESULTS ANNOUNCEMENT covers it.
 *
 * ── TWO RULES, BOTH WITH A RENDERED DEFECT BEHIND THEM ────────────────────
 *
 * 1. THE QUARTER FRAME WINS WHERE BOTH EXIST. A 10-Q carries twelve-month
 *    comparatives, so `years` holds spans ending on QUARTER ends — AMZN's
 *    reaction card read "FY2025 (05/01) · FY2025 (07/31) · FY2025 (10/30)"
 *    because the annual entry overwrote the quarter's at every one of those
 *    ends, and then the collision-breaker stamped a date on each to tell them
 *    apart. The suffix is the tell: matched correctly, no two bars collide.
 *
 *    This is the year-end anchor's trap in a second place — a twelve-month
 *    duration is not a fiscal year, and nothing about treating one as a fiscal
 *    year fails.
 *
 * 2. AN ANNUAL PERIOD IS THE FOURTH QUARTER'S REPORT, where the filer reports
 *    quarters at all. A bar reading "FY2025" beside "Q3 FY2025" implies a
 *    different KIND of event; it is the same event, the quarter whose results
 *    the annual filing carried. A filer that publishes no quarters keeps
 *    "FY2025", because for it that is the whole story.
 *
 * SEPARATE FROM `periodLabel` ON PURPOSE. The snapshot and the five-year card
 * name a PERIOD and must keep saying "FY2025"; only the reaction card names an
 * ANNOUNCEMENT. One function doing both would have to be told which caller it
 * was serving, which is two functions wearing one name.
 */
export function reactionPeriodLabels(set: {
  quarters: StoredPeriod[];
  years: StoredPeriod[];
}): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of set.quarters) if (p.e) out.set(p.e, periodLabel(p));
  const reportsQuarters = set.quarters.length > 0;
  for (const p of set.years) {
    if (!p.e || out.has(p.e)) continue;
    out.set(p.e, reportsQuarters && p.fy ? `Q4 FY${p.fy}` : periodLabel(p));
  }
  return out;
}
