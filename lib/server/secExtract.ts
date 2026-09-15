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
  COVER_SHARES_FIELD,
  SEC_FIELDS,
  SEC_FIELD_KEYS,
  SEC_FIELD_INDEX,
  asFiledOnlyFields,
  cumulativeFields,
  instantFields,
  secFieldsHash,
  type FieldDef,
} from "./secFields";

/** One row as companyfacts publishes it, narrowed to what is read here. */
/**
 * ── THE STORED WINDOW IS WIDER THAN THE RENDERED ONE, DELIBERATELY ─────────
 *
 * THE DEFECT THIS FIXES, AND IT WAS ON EVERY SYMBOL. Eight quarters were
 * stored and eight rendered, so the oldest four rows had no prior-year quarter
 * INSIDE THE WINDOW and showed a permanent "not on file" — measured 4 of 8 on
 * AAPL and on AZN alike (relay 35001474265). Nothing was missing from SEC: the
 * window was too small to contain its own comparison.
 *
 * Twelve stored, eight rendered, so every rendered row can reach four back.
 * companyfacts carries the full history in the payload already fetched, so
 * this costs no extra request — only bytes: AAPL 15,509 -> 17,605 (+13.5%),
 * AZN 10,759 -> 12,405 (+15.3%), KGC 6,411 -> 6,411 (annual-only, unchanged).
 *
 * A ROW WITH NO PRIOR YEAR STILL SAYS SO. Widening the window does not
 * manufacture a comparator; priorYearOf still matches by fiscal label and
 * still returns null. See secEarningsView.RENDERED_QUARTERS.
 */
export const SEC_QUARTER_WINDOW = 12;

/** Balance-sheet dates retained. NOT tied to the quarter window; see above. */
export const SEC_INSTANT_WINDOW = 8;

/**
 * Fiscal years retained — SIX, so the five-year card can reach its own FY-1.
 *
 * ── THE SAME DEFECT AS THE QUARTER WINDOW, ONE TABLE OVER ─────────────────
 * The five-year card renders five rows and compares each with the year before
 * it, and exactly five years were stored — so the OLDEST rendered row could
 * never find its comparator and read "not on file" on every symbol, forever.
 * Owner found it on TSLA: FY2021 blank on a filer with two decades of 10-Ks.
 *
 * Six stored, five rendered. Same shape as the quarter window, same reason,
 * and the same non-promise: a filer that genuinely has not filed six years
 * still shows "not on file" on its oldest row. Widening the window does not
 * manufacture a comparator.
 *
 * ITS OWN CONSTANT, NOT keepQuarters. Slicing years by the quarter window is
 * how `instants` doubled as a side effect of an unrelated change — the same
 * coupling, caught once already. See SEC_INSTANT_WINDOW.
 */
export const SEC_YEAR_WINDOW = 6;

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
  /** Computed from two other fields of the SAME period. See FieldDef.ratioSource. */
  | "computed"
  /** Several values for one period and no way to choose. Value is null. */
  | "ambiguous";

export type FieldValue = {
  val: number | null;
  /** The tag that won the chain FOR THIS PERIOD. */
  tag: string | null;
  /**
   * The TAXONOMY NAMESPACE that tag came from — and it is not redundant with
   * `tag`, which is what the first IFRS probe assumed and was wrong about.
   *
   * IFRS and us-gaap SHARE SPELLINGS. `GrossProfit`, `Goodwill`, `Assets`,
   * `Liabilities`, `ResearchAndDevelopmentExpense`, `InterestExpense` and
   * `ProfitLoss` all exist in both. A probe attributing a hit by tag name alone
   * reported 71 "ifrs cells" for AAPL — a us-gaap-only filer whose payload has
   * no ifrs-full namespace at all — and the same artefact showed for BIDU and
   * ZTO. The extraction was right; the instrument measuring it was not, and the
   * control is what caught it.
   *
   * In memory only: StoredPeriod holds values and derivations, so this costs
   * nothing stored.
   */
  ns: string | null;
  /** companyfacts units key the value was read from. Stored per period. */
  unit: string | null;
  derived: Derivation;
  /** Only on "differenced": the two cumulative ends that produced it. */
  from?: [string, string];
  /** Only on "ambiguous": the distinct values that could not be separated. */
  candidates?: number[];
  /** Only on "computed": the two field keys it was computed from. */
  computedFrom?: [string, string];
};

/**
 * The cover-page share count: ONE reading per symbol, not a period row.
 * See secFields.COVER_SHARES_FIELD for why it is not in the period grid.
 */
export type CoverShares = {
  /** The cover date the filer stated it as of. */
  asOf: string;
  accession: string | null;
  filed: string | null;
  val: number | null;
  derived: Derivation;
  /** Present when the filer is multi-class and companyfacts cannot name them. */
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
  /**
   * BALANCE-SHEET DATES ONLY. The cover-page date used to land here and made
   * every other row near-empty; it is `coverShares` now.
   */
  instants: PeriodRecord[];
  /** Filer-level, with its own asOf. Null when the filer published none. */
  coverShares: CoverShares | null;
  /**
   * EVERY TAXONOMY NAMESPACE THE PAYLOAD CARRIED, read rather than assumed.
   *
   * WHY THIS EXISTS: without it an empty extraction is indistinguishable from a
   * filer who published nothing, and the page said the second about companies
   * for whom the first was true. companyfacts namespaces facts by taxonomy --
   * `dei`, `us-gaap`, `ifrs-full`, and others -- so a foreign private issuer's
   * complete financial statements sit in the payload under a namespace the
   * field definitions did not read. Telling a reader that Ryanair "does not
   * file the financial data this page is built from" is a false claim about
   * Ryanair; the true one is about this page.
   *
   * With the census stored, the page can say which of the two it is, and name
   * the namespace when it is the first.
   */
  taxonomies: string[];
  /**
   * Units a tag this page maps was published in and refused — the currency
   * evidence. Empty for a USD reporter. See rowsForField.
   */
  refusedUnits: string[];
  notes: string[];
};

/**
 * Namespaces that are not financial statements, so their presence alone never
 * means a filer has data this page could read.
 *
 * `dei` is the cover page -- entity name, share count, document type. A payload
 * carrying ONLY dei is a filer with no financial XBRL at all, which is the
 * genuinely-untagged case the "does not file" wording was written for.
 * `srt` is the SEC's reporting taxonomy: axes and members, not facts.
 */
export const NON_FINANCIAL_TAXONOMIES = new Set(["dei", "srt", "invest"]);

/** Financial namespaces SEC_FIELDS actually reads. Derived, not listed. */
export function readableTaxonomies(): Set<string> {
  const out = new Set<string>();
  for (const f of SEC_FIELDS) {
    if (!NON_FINANCIAL_TAXONOMIES.has(f.taxonomy)) out.add(f.taxonomy);
    if (f.ifrsChain?.length) out.add("ifrs-full");
  }
  return out;
}

/**
 * Why an extraction came back with nothing — the PAGE's limit or the FILER's.
 *
 * Returns one of three, and only the last may ever be worded to a reader as a
 * fact about the company:
 *
 *   "unread-taxonomy"  financial facts exist, ALL under namespaces these field
 *                      definitions do not read. `taxonomies` names them.
 *   "unread-detail"    a namespace we DO read is present and we still got
 *                      nothing — the filer reports in a non-USD currency (the
 *                      unit guard refuses those deliberately) or tags lines
 *                      nothing maps. Still the page's gap, so it must not be
 *                      named after a taxonomy we can in fact read.
 *   "none"             no financial namespace at all — a cover-page-only
 *                      payload. THE ONLY fact-about-the-filer case.
 *
 * ── THE MIDDLE CASE IS NOT HYPOTHETICAL ─────────────────────────────────────
 * The first version had two branches, and AEG fell through the crack: its
 * payload carries `ffd`, `ifrs-full` AND `us-gaap`, so two readable namespaces
 * are present, yet nothing extracts. The two-branch version reported
 * "filed under ffd" — naming the one namespace that is NOT the reason, while
 * the actual cause (units) went unmentioned. Measured, relay 34970388423.
 */
export function unreadableReason(
  taxonomies: string[],
  refusedUnits: string[] = []
):
  | { kind: "unread-taxonomy"; taxonomies: string[] }
  | { kind: "currency"; currencies: string[] }
  | { kind: "unread-detail" }
  | { kind: "none" } {
  const readable = readableTaxonomies();
  const financial = taxonomies.filter((t) => !NON_FINANCIAL_TAXONOMIES.has(t));
  if (!financial.length) return { kind: "none" };
  // CURRENCY FIRST AMONG THE READABLE CASES, because it is the specific answer
  // and "we could not read it" is the vague one. A filer whose mapped tags were
  // all published in EUR is not a mapping gap.
  const currencies = refusedUnits.filter((u) => /^[A-Z]{3}$/.test(u) && u !== "USD");
  if (currencies.length) return { kind: "currency", currencies };
  // ORDER MATTERS: a readable namespace present means we looked in the right
  // place and came back empty, whatever else the payload also carries.
  if (financial.some((t) => readable.has(t))) return { kind: "unread-detail" };
  return { kind: "unread-taxonomy", taxonomies: financial };
}

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
function rowsForField(facts: CompanyFacts, field: FieldDef, refusedUnits?: Set<string>) {
  const out: { row: FactRow; tag: string; ns: string; rank: number; unit: string }[] = [];

  // TWO NAMESPACES, ONE RANKED LIST. The primary chain first, then the same
  // line under `ifrs-full` at ranks continuing from where it left off -- so a
  // dual-tagging filer keeps its us-gaap reading and an IFRS filer falls
  // through, with no new rule in resolve(). See FieldDef.ifrsChain.
  const sources: { ns: string; chain: string[] }[] = [
    { ns: field.taxonomy, chain: field.chain },
  ];
  if (field.ifrsChain?.length) sources.push({ ns: "ifrs-full", chain: field.ifrsChain });

  let rank = 0;
  for (const { ns, chain } of sources) {
    const taxonomy = facts.facts?.[ns];
    for (const tag of chain) {
      const thisRank = rank++;
      const units = taxonomy?.[tag]?.units;
      if (!units) continue;
      // The declared unit, plus the singular spelling SEC also publishes. Not a
      // scan of every unit key: reading a JPY series into a USD field is exactly
      // the plausible-wrong-number failure this file is built against.
      //
      // AND IT IS WHY IFRS SUPPORT DOES NOT BRING CURRENCY RISK WITH IT. An
      // IFRS filer reporting in EUR or GBP publishes those units under the same
      // tag; this reads only the declared one, so a non-USD reporter yields
      // NULL rather than a euro figure rendered with a dollar sign. That is the
      // honest failure and it is structural, not a rule anyone has to remember.
      const keys =
        field.unit === "USD/shares" ? ["USD/shares", "USD/share"] : [field.unit];
      let took = 0;
      for (const unit of keys) {
        for (const row of units[unit] ?? []) {
          if (typeof row?.val !== "number" || !Number.isFinite(row.val)) continue;
          if (!row.end) continue;
          out.push({ row, tag, ns, rank: thisRank, unit });
          took++;
        }
      }
      // A TAG WE MAP, PUBLISHED, IN A CURRENCY WE REFUSE. Recorded rather than
      // silently dropped, because it is the difference between "we have no
      // mapping for this filer" and "this filer reports in euros" -- and the
      // page has to be able to say which. Measured: after the IFRS chains
      // landed, five of the ten formerly-empty filers still came back with one
      // or two populated fields, and every one of them reports in a home
      // currency (AEG EUR, NWG GBP, MFC CAD, RYAAY EUR, VIV BRL).
      if (!took && refusedUnits) {
        for (const u of Object.keys(units)) {
          if (!keys.includes(u) && (units[u]?.length ?? 0) > 0) refusedUnits.add(u);
        }
      }
    }
  }
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
  candidates: { row: FactRow; tag: string; ns: string; rank: number; unit: string }[]
) {
  let best: { row: FactRow; tag: string; ns: string; rank: number; unit: string } | null = null;
  for (const c of candidates) {
    if (!best || c.rank < best.rank) { best = c; continue; }
    if (c.rank === best.rank && newer(c.row, best.row) === c.row) best = c;
  }
  return best;
}


/**
 * THE FISCAL PERIOD, DERIVED FROM THE DATES — NOT READ OFF THE ROW.
 *
 * companyfacts' `fy` and `fp` describe the FILING, not the period the row
 * covers: a 10-K carries fy 2026 on every comparative it restates. Reading them
 * put "Q1 FY2027" on ARM's June 2025 quarter (nine months out) and gave AAPL
 * TWO ROWS LABELLED "Q3 FY2026" — 2026-06-27 and 2025-06-28 — in the same
 * eight-row table. Caught by rendering the page's own output, not by a check.
 *
 * So the label is computed from one anchor: the filer's fiscal year-end date.
 * For a period ending E, the fiscal year is the one whose end falls on or after
 * E, and the quarter is how many ~91-day steps E sits before that end.
 *
 * THE TOLERANCE IS NOT SLOPPINESS. 52/53-week filers move their year-end by a
 * few days annually — AAPL's ran 2025-09-27 against a 2026-09-26 anchor — so an
 * exact match would push every year-end quarter into the NEXT fiscal year and
 * label Q4 as Q1. Ten days is wider than any calendar drift and far narrower
 * than a quarter.
 */
export function fiscalLabel(
  end: string,
  yearEndAnchor: string | null
): { fp: string | null; fy: number | null } {
  if (!yearEndAnchor) return { fp: null, fy: null };
  const e = Date.parse(end);
  const anchor = new Date(yearEndAnchor);
  if (!Number.isFinite(e)) return { fp: null, fy: null };

  const endYear = new Date(end).getUTCFullYear();
  let best: { at: number; year: number } | null = null;
  // The candidate year-ends either side, so a December filer's January quarter
  // and a March filer's April quarter both resolve.
  for (const y of [endYear - 1, endYear, endYear + 1]) {
    const cand = Date.UTC(y, anchor.getUTCMonth(), anchor.getUTCDate());
    const gap = (cand - e) / DAY;
    if (gap >= -10 && (best === null || cand < best.at)) best = { at: cand, year: y };
  }
  if (!best) return { fp: null, fy: null };

  const daysBefore = Math.max(0, (best.at - e) / DAY);
  // ROUNDED, NOT FLOORED, and the divisor is a real quarter (365.25/4). A
  // quarter runs 90-92 days, so floor(90/91) is 0 and labelled AAPL's June 2025
  // quarter Q4 and ARM's December 2025 quarter Q4. Rounding puts a 90-, 91- or
  // 92-day gap at exactly one step, which is what it is.
  const q = 4 - Math.round(daysBefore / 91.3125);
  return { fp: `Q${Math.min(4, Math.max(1, q))}`, fy: best.year };
}

// ── extraction ──────────────────────────────────────────────────────────────

type Bucket = Map<string, { row: FactRow; tag: string; ns: string; rank: number; unit: string }[]>;

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
  opts: { quarters?: number; years?: number; instants?: number } = {}
): ExtractResult {
  const keepQuarters = opts.quarters ?? SEC_QUARTER_WINDOW;
  const keepYears = opts.years ?? SEC_YEAR_WINDOW;
  // DECOUPLED FROM keepQuarters, and the decoupling is worth 12 percentage
  // points. `instants` used to be sliced by keepQuarters, so raising the
  // quarter window to 12 doubled the balance-sheet series as a side effect:
  // AAPL 15,509 B -> 19,556 B coupled against 17,605 B decoupled
  // (relay 35001474265). The balance sheet needs no more dates than it had.
  const keepInstants = opts.instants ?? SEC_INSTANT_WINDOW;
  const notes: string[] = [];

  // Units a mapped, published tag was refused in. See rowsForField.
  const refusedUnits = new Set<string>();

  // One pass per field, bucketed by period key.
  const buckets = new Map<string, Bucket>();
  for (const field of SEC_FIELDS) {
    const bucket: Bucket = new Map();
    for (const c of rowsForField(facts, field, refusedUnits)) {
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
            val: f.best.row.val!, tag: f.best.tag, ns: f.best.ns, unit: f.best.unit, derived: "as-filed",
          });
        }

        if (f.n === 1) {
          // Q1, as filed. The only quarter that needs no differencing.
          cell(quarterCells, quarterMeta).set(field.key, {
            val: f.best.row.val!, tag: f.best.tag, ns: f.best.ns, unit: f.best.unit, derived: "as-filed",
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
          ns: f.best.ns,
          unit: f.best.unit,
          derived: "differenced",
          from: [prior.end, f.end],
        });
      }
    }
  }

  // ── durations that do NOT add: as filed, or not at all ─────────────────────
  //
  // A SEPARATE LOOP, NOT A BRANCH INSIDE THE ONE ABOVE. The differencing loop
  // cannot see these fields at all, which is the same structural guarantee the
  // balance sheet gets. A frame the filer did not publish produces NOTHING here;
  // there is no assembly step to get it wrong.
  for (const field of asFiledOnlyFields()) {
    const bucket = buckets.get(field.key)!;
    for (const [, cands] of bucket) {
      const best = resolve(cands);
      if (!best?.row.start || !best.row.end) continue;
      const n = quartersCovered(spanDays(best.row.start, best.row.end));
      if (n !== 1 && n !== 4) continue; // a 6M or 9M average belongs to no quarter

      const target = n === 1 ? quarterCells : yearCells;
      const meta = n === 1 ? quarterMeta : yearMeta;
      let m = target.get(best.row.end);
      if (!m) { m = new Map(); target.set(best.row.end, m); }
      if (!meta.has(best.row.end)) meta.set(best.row.end, { start: best.row.start, row: best.row });
      m.set(field.key, {
        val: best.row.val!, tag: best.tag, ns: best.ns, unit: best.unit, derived: "as-filed",
      });
    }
  }

  // The ratio fallback, AFTER both loops because it reads their output.
  //
  // BOTH OPERANDS OR NEITHER. A quarter's earnings over a year's share count is
  // a wrong number that looks like a right one, so a missing denominator leaves
  // the cell null rather than reaching for the nearest available one. Q4 has no
  // filed three-month average, so Q4 EPS comes out null -- that is the cost of
  // refusing to derive the average, stated rather than hidden.
  for (const field of asFiledOnlyFields()) {
    if (!field.ratioSource) continue;
    const { numerator, denominator } = field.ratioSource;
    for (const cells of [quarterCells, yearCells]) {
      for (const [, m] of cells) {
        if (m.get(field.key)) continue; // filed; nothing to compute
        const num = m.get(numerator)?.val ?? null;
        const den = m.get(denominator)?.val ?? null;
        if (num === null || den === null || den === 0) continue;
        m.set(field.key, {
          val: num / den,
          tag: null,
          // A computed ratio comes from two OTHER fields, not from a tag, so it
          // has no namespace of its own. Null rather than inherited: inheriting
          // one would attribute a derivation to a filing that never made it.
          ns: null,
          unit: field.unit,
          derived: "computed",
          computedFrom: [numerator, denominator],
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
      const best = resolve(cands);
      if (!best?.row.end || best.row.start) continue; // a duration is not an instant
      const end = best.row.end;

      let m = instantCells.get(end);
      if (!m) { m = new Map(); instantCells.set(end, m); }
      const prior = instantMeta.get(end);
      if (!prior || newer(best.row, prior) === best.row) instantMeta.set(end, best.row);
      m.set(field.key, {
        val: best.row.val!, tag: best.tag, ns: best.ns, unit: best.unit, derived: "as-filed",
      });
    }
  }

  // ── the cover page, read ONCE for the symbol ────────────────────────────────
  const coverShares = readCoverShares(facts);

  // THE ANCHOR: the newest twelve-month frame's end is the filer's fiscal
  // year-end. Falling back to the newest quarter end is wrong by up to three
  // quarters, so it is only used when the filer has published no annual frame
  // at all — and then everything it labels is equally uncertain.
  const yearEnds = [...yearCells.keys()].sort();
  const yearEndAnchor = yearEnds[yearEnds.length - 1] ?? null;

  const pack = (
    cells: Map<string, Map<string, FieldValue>>,
    meta: (end: string) => { start: string | null; row: FactRow | undefined },
    annual = false
  ): PeriodRecord[] =>
    [...cells.entries()]
      .map(([end, m]) => {
        const { start, row } = meta(end);
        const fiscal = fiscalLabel(end, yearEndAnchor);
        return {
          end,
          start,
          // NOT row.fp / row.fy — those describe the FILING. See fiscalLabel.
          fp: annual ? "FY" : fiscal.fp,
          fy: fiscal.fy,
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
  }), true).slice(0, keepYears);

  const instants = pack(instantCells, (e) => ({ start: null, row: instantMeta.get(e) })).slice(
    0,
    keepInstants
  );

  return {
    symbol,
    cik: typeof facts.cik === "number" ? facts.cik : null,
    entityName: facts.entityName ?? null,
    fieldsHash: secFieldsHash(),
    quarters,
    years,
    instants,
    coverShares,
    // THE CENSUS, from the payload itself rather than from a list of filers we
    // think are IFRS. Sorted so a stored set's value is stable across fetches.
    taxonomies: Object.keys(facts.facts ?? {}).sort(),
    refusedUnits: [...refusedUnits].sort(),
    notes,
  };
}

/**
 * The newest cover-page share count, or null.
 *
 * REFUSES TO CHOOSE between classes. A multi-class filer reports this once per
 * class and companyfacts strips the axis that names them, so several values
 * arrive under the same end and the same accession. Returning one of them is
 * the BRK.B bug; this returns `ambiguous` with the candidates and lets the
 * caller decide what to render.
 */
export function readCoverShares(facts: CompanyFacts): CoverShares | null {
  const rows = (facts.facts?.dei?.[COVER_SHARES_FIELD.chain[0]]?.units?.shares ?? []).filter(
    (r) => typeof r?.val === "number" && Number.isFinite(r.val) && r.end
  );
  if (!rows.length) return null;

  const newestRow = rows.reduce((a, b) => (newer(a, b) === a ? a : b));
  const asOf = newestRow.end!;
  // Same filing AND same date: two readings a month apart are a re-statement,
  // two in one filing at one date are two classes.
  const sameReading = rows.filter(
    (r) => r.end === asOf && String(r.accn ?? "") === String(newestRow.accn ?? "")
  );
  const distinct = [...new Set(sameReading.map((r) => r.val!))].sort((a, b) => b - a);

  return {
    asOf,
    accession: newestRow.accn ?? null,
    filed: newestRow.filed ?? null,
    val: distinct.length > 1 ? null : distinct[0]!,
    derived: distinct.length > 1 ? "ambiguous" : "as-filed",
    ...(distinct.length > 1 ? { candidates: distinct } : {}),
  };
}

/**
 * INTERNAL IDENTITIES — the only check 35 of the 43 fields will ever get.
 *
 * The frozen FMP dump holds four numbers per report and six TTM aggregates; it
 * never held a balance sheet. So most of this list has NO external ground truth
 * and never will. What it has instead is that the fields constrain each other,
 * and a constraint the data must satisfy is a real test even with nothing to
 * compare against.
 *
 * THREE STATES, NOT TWO. A missing operand is `skipped`, never `pass` -- an
 * identity over two nulls is vacuously true and would report a filer with no
 * balance sheet as fully consistent. Pass RATES are reported, not just failures.
 *
 * `tolerance` is relative: filers round to thousands and exact equality would
 * flag every one of them.
 */
export type IdentityResult = {
  identity: string;
  end: string;
  status: "pass" | "fail" | "skipped";
  /** Present on pass and fail. */
  lhs?: number;
  rhs?: number;
  relative?: number;
  /** Present on skipped: the field keys that were null. */
  missing?: string[];
};

type IdentitySpec = {
  name: string;
  /** Field keys read from the period itself. ALL must be present or it skips. */
  needs: string[];
  /** At least ONE of these must be present. Absent = skipped, never pass. */
  optional?: string[];
  lhs: (v: (k: string) => number | null) => number;
  rhs: (v: (k: string) => number | null) => number;
};

const PERIOD_IDENTITIES: Record<"duration" | "instant", IdentitySpec[]> = {
  instant: [
    {
      name: "assets = liabilities + equity",
      // TOTAL equity, not the parent-only figure -- the identity does not hold
      // against the latter for any filer with a noncontrolling interest. The
      // fallback is for filers that publish no including-NCI tag because they
      // have no NCI, where the two are the same number.
      needs: ["totalAssets", "totalLiabilities"],
      optional: ["totalEquity", "stockholdersEquity"],
      lhs: (v) => v("totalAssets")!,
      rhs: (v) => v("totalLiabilities")! + (v("totalEquity") ?? v("stockholdersEquity"))!,
    },
  ],
  duration: [
    {
      // THE FILER'S GrossProfit AGAINST THE SUBTRACTION. Both sides are filed
      // numbers, so a disagreement is a real one -- most often a filer whose
      // cost of revenue tag covers something the gross-profit line does not.
      name: "grossProfit = revenue - costOfRevenue",
      needs: ["grossProfit", "revenue", "costOfRevenue"],
      lhs: (v) => v("grossProfit")!,
      rhs: (v) => v("revenue")! - v("costOfRevenue")!,
    },
    {
      name: "operatingIncome = grossProfit - operatingExpenses",
      needs: [
        "revenue", "costOfRevenue", "researchAndDevelopment",
        "sellingGeneralAndAdministrative", "operatingIncome",
      ],
      lhs: (v) => v("operatingIncome")!,
      rhs: (v) =>
        (v("grossProfit") ?? v("revenue")! - v("costOfRevenue")!) -
        v("researchAndDevelopment")! - v("sellingGeneralAndAdministrative")! -
        (v("otherOperatingExpense") ?? 0),
    },
    {
      // THE FOURTH LEG IS NOT OPTIONAL. Without fxEffectOnCash this reported
      // breaks on ARM, MU and PLAB that were entirely exchange-rate movement.
      name: "operating + investing + financing + fx = netChangeInCash",
      needs: [
        "operatingCashFlow", "investingCashFlow", "financingCashFlow", "netChangeInCash",
      ],
      lhs: (v) =>
        v("operatingCashFlow")! + v("investingCashFlow")! + v("financingCashFlow")! +
        (v("fxEffectOnCash") ?? 0),
      rhs: (v) => v("netChangeInCash")!,
    },
  ],
};

function runIdentities(
  specs: IdentitySpec[],
  p: PeriodRecord,
  tolerance: number
): IdentityResult[] {
  const read = (k: string) => {
    const i = SEC_FIELD_INDEX[k];
    return i === undefined ? null : p.values[i]?.val ?? null;
  };
  return specs.map((spec) => {
    const missing = spec.needs.filter((k) => read(k) === null);
    if (spec.optional && spec.optional.every((k) => read(k) === null)) {
      missing.push(spec.optional.join(" or "));
    }
    if (missing.length) {
      return { identity: spec.name, end: p.end, status: "skipped" as const, missing };
    }
    const lhs = spec.lhs(read);
    const rhs = spec.rhs(read);
    const scale = Math.max(Math.abs(lhs), Math.abs(rhs), 1);
    const relative = Math.abs(lhs - rhs) / scale;
    return {
      identity: spec.name,
      end: p.end,
      status: relative <= tolerance ? ("pass" as const) : ("fail" as const),
      lhs, rhs, relative,
    };
  });
}

/**
 * Every identity over every period, plus the one that spans two periods.
 *
 * `cashEnd - cashStart = netChangeInCash` needs consecutive instants AND the
 * quarter between them, so it cannot be expressed as a per-period spec and is
 * run separately.
 */
export function checkIdentities(
  result: ExtractResult,
  tolerance = 0.01
): IdentityResult[] {
  const out: IdentityResult[] = [];
  for (const p of result.instants) out.push(...runIdentities(PERIOD_IDENTITIES.instant, p, tolerance));
  for (const p of result.quarters) out.push(...runIdentities(PERIOD_IDENTITIES.duration, p, tolerance));

  // LIKE FOR LIKE. netChangeInCash is filed against one of two cash concepts,
  // and which one it is, is recorded on the cell: the first chain entry names
  // restricted cash, the second does not. Comparing a change measured on one
  // against a balance measured on the other is a definition mismatch that shows
  // up as a plausible few percent -- and once, for ASTS, as 27.5%.
  const iCash = SEC_FIELD_INDEX.cash;
  const iCashR = SEC_FIELD_INDEX.cashIncludingRestricted;
  const iNet = SEC_FIELD_INDEX.netChangeInCash;
  const balanceAt = (end: string, restricted: boolean) => {
    const row = result.instants.find((p) => p.end === end);
    if (!row) return null;
    const first = restricted ? iCashR : iCash;
    const second = restricted ? iCash : iCashR;
    return row.values[first]?.val ?? row.values[second]?.val ?? null;
  };
  for (const q of result.quarters) {
    const name = "cashEnd - cashStart = netChangeInCash";
    const netCell = q.values[iNet];
    const net = netCell?.val ?? null;
    const restricted = /RestrictedCash/.test(netCell?.tag ?? "");
    const end = balanceAt(q.end, restricted);
    // THE OPENING BALANCE IS DATED THE DAY BEFORE, NOT ON, THE PERIOD START.
    // A quarter running 2026-01-01..2026-03-31 opens with the balance sheet
    // dated 2025-12-31 -- filers date a balance sheet at a period END, and the
    // period that ends is the one before this one. Matching on q.start alone
    // skipped every real filer. This is the ONE-DAY predecessor, not a fuzzy
    // window: a tolerance wide enough to reach a different quarter would pair a
    // cash flow with the wrong opening balance and still report `pass`.
    const start =
      q.start === null
        ? null
        : balanceAt(q.start, restricted) ??
          balanceAt(new Date(Date.parse(q.start) - DAY).toISOString().slice(0, 10), restricted);
    if (net === null || end === null || start === null) {
      out.push({
        identity: name, end: q.end, status: "skipped",
        missing: [
          ...(net === null ? ["netChangeInCash"] : []),
          ...(end === null ? [`cash@${q.end}`] : []),
          ...(start === null ? [`cash@${q.start ?? "?"} (or the day before)`] : []),
        ],
      });
      continue;
    }
    const lhs = end - start;
    const scale = Math.max(Math.abs(lhs), Math.abs(net), 1);
    const relative = Math.abs(lhs - net) / scale;
    out.push({
      identity: name, end: q.end,
      status: relative <= tolerance ? "pass" : "fail",
      lhs, rhs: net, relative,
    });
  }
  return out;
}

/** Pass rates per identity: {identity: {pass, fail, skipped}}. */
export function identityRates(results: IdentityResult[]) {
  const out: Record<string, { pass: number; fail: number; skipped: number }> = {};
  for (const r of results) {
    out[r.identity] ??= { pass: 0, fail: 0, skipped: 0 };
    out[r.identity][r.status]++;
  }
  return out;
}
