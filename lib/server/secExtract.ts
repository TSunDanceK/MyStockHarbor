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
  COVER_SHARES_FALLBACK,
  FORBIDDEN_COVER_TAGS,
  SEC_FIELDS,
  SEC_FIELD_KEYS,
  SEC_FIELD_INDEX,
  asFiledOnlyFields,
  cumulativeFields,
  instantFields,
  secFieldsHash,
  type FieldDef,
} from "./secFields";
// VALUE IMPORTS FROM secCurrency, WHICH IMPORTS ONLY TYPES BACK FROM HERE.
// `import type` is erased, so there is no runtime cycle — the currency decision
// genuinely has to happen before the first field is read, and it needs the same
// field definitions this file does.
import { reportingCurrency, unitKeysFor } from "./secCurrency";

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

/**
 * The version of how periods are LABELLED AND ADMITTED, bumped whenever the
 * same payload would produce a different `fy`/`fp` or a different set of rows.
 *
 * ── WHY THE CHAIN HASH CANNOT COVER THIS ─────────────────────────────────
 * `c` moves when a TAG CHAIN changes, and neither a labelling rule nor an
 * admission rule touches a tag. `h` moves when the FIELD ORDER changes, and
 * neither is a field. So a set written before any of this keeps its wrong
 * years on the page forever, and nothing selects it.
 *
 * 1 — fiscal year named by the calendar year of its END (AAP read "FY2027" for
 *     a year the company calls FY2026).
 * 2 — named by the filer's own DocumentFiscalYearFocus, calibrated per filer.
 * 3 — a period enters `years` only if it ENDS ON the fiscal year end. A 10-Q's
 *     twelve-month comparative is a trailing year, not a fiscal one, and six of
 *     AMZN's rendered on its five-year card as fiscal years.
 * 4 — a filer's own reporting currency is admitted instead of refused. Same
 *     payload, different set of rows: RYAAY's EUR lines were read as nothing
 *     and are now read as periods. THIS IS THE ADMISSION HALF OF THE NAME —
 *     no tag moved and no field order moved, so neither `c` nor `h` can see
 *     it, and a stored set written under 3 would keep its empty tables
 *     forever with nothing selecting it.
 * 5 — a cited per-filer naming exception (data/sec/fiscal-year-naming-
 *     overrides.json, via secExtractFor) replaces the vote where the two
 *     disagree. CRWD's quarters move a fiscal year; the same payload labels
 *     differently, so its stored set must be re-read.
 */
export const SEC_LABEL_VERSION = 5;

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
  /**
   * THE FRAME THIS CELL ACTUALLY COVERS — start..end, on every DURATION cell,
   * whatever its derivation. Absent on instants, which have no span.
   *
   * ── THE ROW'S OWN start CANNOT ANSWER THIS, AND THAT IS THE POINT ────────
   * `quarterMeta` keeps ONE start per period end, written by whichever field
   * reached that end first and overwritten by every differenced write after
   * it. So a PeriodRecord's `start` is one field's frame, not the row's, and
   * measuring a cell against it measures the wrong thing — the first frame
   * length probe did exactly that and could only ever see the as-filed half.
   *
   * With this, every cell carries its own span and "no quarter row mixes
   * periods" becomes a statement that can be CHECKED rather than argued from
   * the shape of the code. See scripts/check-sec-period-coherence.mjs.
   *
   * IN MEMORY ONLY. StoredPeriod holds `{val, derived}` per cell, so this adds
   * nothing to the stored set and nothing to contentHash — the same deal `ns`
   * and `unit` already have.
   */
  covers?: [string, string];
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
   * THE CURRENCY THE VALUES ABOVE ARE IN — always, including "USD".
   *
   * Stated rather than assumed, because the alternative is a number whose
   * units depend on which branch produced it. Extraction performs NO
   * conversion: it is network-free and a rate lookup is not, so it reports the
   * currency and the caller (the cron) converts. That also keeps the
   * conversion after differencing, which happens inside this function.
   */
  reportingCurrency: string;
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
  /**
   * THE ONE CONCEPT THIS FILER'S COLUMN USES, for each field marked
   * `oneConceptPerFiler` — `ns|tag`, keyed by field key.
   *
   * CARRIED OUT OF THE EXTRACTION BECAUSE THE PAGE NEEDS IT AND CANNOT
   * RECOVER IT. A stored Cell holds a value and a derivation, not a tag, so
   * once the set is encoded there is nothing left to say WHICH measure the
   * column is. The capex row has to read "Capital expenditure (incl. other
   * productive assets)" when the broader concept was chosen, and a heading
   * that cannot tell is a heading that will be wrong on some filers.
   *
   * One entry per marked field, not per cell: it is a decision about the
   * filer, and a per-cell copy would be the same string 12 times.
   */
  conceptChoice: Record<string, string>;
  /**
   * FISCAL-YEAR WEIGHTED-AVERAGE BASIC SHARES, EVERY YEAR IN THE PAYLOAD —
   * `[yearEnd, shares]`, oldest first.
   *
   * ── WHY A SEPARATE SERIES AND NOT A WIDER WINDOW ────────────────────────
   * The share-dilution chart had ~9 points from the stored quarters, against
   * FMP's 28. Widening SEC_YEAR_WINDOW would widen EVERY field's history (46
   * values a year) to buy one line. The owner's call (2026-09-22, #517): keep
   * retention as it is and store this one field on its own, back as far as
   * companyfacts goes (typically 2009–2011). About 20 bytes a year.
   *
   * Only twelve-month frames ending on the filer's own fiscal year-end are
   * kept, so a trailing-twelve-month comparative in a 10-Q is never mistaken
   * for a year. Optional: absent on older sets and hand-built results.
   */
  annualShares?: [string, number][];
  /**
   * FIELDS NO CONCEPT IN OUR CHAIN WAS PUBLISHED FOR, IN ANY PERIOD, IN ANY UNIT.
   *
   * ── WHY THIS IS RECORDED AT EXTRACTION AND NOT INFERRED AT RENDER ────────
   * A null cell has two causes that read identically in the stored set: the
   * filer tags the line under a concept we do not map (a coverage gap, fixed by
   * widening the chain), or the filer publishes nothing like it at all (a true
   * fact — ABVX is a clinical-stage biotech with no revenue line, measured on
   * relay 35764672279). Only the payload can tell them apart, and the payload
   * is gone once the set is encoded. So the extractor, which is holding it,
   * writes the answer down.
   *
   * WHAT IT DOES NOT CLAIM. "Untagged" is relative to OUR chains, not to the
   * company's accounts: a filer tagging revenue under a concept the table does
   * not list lands here too. That is why a blank is diagnosed with
   * scripts/sec-stored-set-probe.mjs before a chain is judged complete, and
   * why widening a chain removes the field from this list on the next read by
   * construction rather than by anyone remembering to.
   *
   * Optional so hand-built results in checks and probes stay valid; absent is
   * "unknown", exactly as on the stored set.
   */
  untagged?: string[];
  /**
   * HOW MANY STORED CELLS WERE READ FROM EACH NAMESPACE, keyed `us-gaap` /
   * `ifrs-full`. What `accountingOf` decides the filer's standard from.
   *
   * ── WHY NOT `tx`, AND WHY NOT `cc` ───────────────────────────────────────
   * `tx` lists every namespace the payload CARRIES, and 48 of 903 stored sets
   * carry both (relay 35771324089). Of those measured, 31 read every field
   * from ifrs-full — BBVA, SAN, SONY, TM, VALE, VOD among them — and 6 read
   * every field from us-gaap (TEAM, CLS, VS, ...). "us-gaap present" called
   * all 48 US GAAP. `cc` records ONE field's concept (capex), is empty for
   * filers with no capex line, and disagreed with the fields actually read on
   * SHG, TM, VS and AEM. The cells themselves carry `ns`; this counts them.
   *
   * Optional; absent on older sets and in hand-built results.
   */
  readNamespaces?: Record<string, number>;
  notes: string[];
};

/** Stored cells per namespace. See ExtractResult.readNamespaces. */
export function countReadNamespaces(periods: PeriodRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of periods) {
    for (const c of p.values) {
      if (c?.ns && c.val !== null) out[c.ns] = (out[c.ns] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * True when the payload publishes ANY concept in this field's chains, in any
 * unit and any period. A refused currency still counts as tagged: the line
 * exists, we just could not read it.
 */
export function fieldIsTagged(facts: CompanyFacts, field: FieldDef): boolean {
  const sources: { ns: string; chain: string[] }[] = [{ ns: field.taxonomy, chain: field.chain }];
  if (field.ifrsChain?.length) sources.push({ ns: "ifrs-full", chain: field.ifrsChain });
  return sources.some(({ ns, chain }) =>
    chain.some((tag) => {
      const units = facts.facts?.[ns]?.[tag]?.units;
      return Boolean(units && Object.values(units).some((rows) => (rows?.length ?? 0) > 0));
    })
  );
}

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

export function spanDays(start: string, end: string): number {
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

/**
 * How far two frames' starts may differ and still be the same reporting period.
 *
 * NOT ZERO, AND THE FILINGS ARE WHY. A filer's standalone three-month frame and
 * the ladder difference that covers the same quarter routinely disagree by a
 * day at the start: AAPL's Q3 FY2026 net income is filed on 2026-03-29..
 * 2026-06-27 while its operating cash flow differences out to 2026-03-28..
 * 2026-06-27, because the quarter's start is the PRIOR frame's END and the
 * filer's own frame starts the day after. Same quarter, two spellings of its
 * first day.
 *
 * A WEEK IS THE BAND, and it is deliberately far below the gap that matters. A
 * period mix is a 3M against a 6M — ninety days apart — so seven days cannot
 * hide one, and it comfortably covers both the off-by-one above and a 4-4-5
 * calendar's week-length wobble.
 */
export const SAME_FRAME_SLACK_DAYS = 7;

/**
 * Do these two cells cover the same reporting period?
 *
 * ENDS MUST MATCH EXACTLY — they are the key the cell is stored under, so a
 * disagreement here means something built a cell for the wrong row. Starts get
 * SAME_FRAME_SLACK_DAYS.
 */
export function sameFrame(
  a: [string, string] | undefined,
  b: [string, string] | undefined
): boolean {
  if (!a || !b) return false;
  if (a[1] !== b[1]) return false;
  return Math.abs(spanDays(a[0], b[0])) <= SAME_FRAME_SLACK_DAYS;
}

/**
 * Newest filing wins; `filed` first because an accession does not sort by date.
 *
 * EXPORTED so a probe collapsing restatements before comparing two concepts
 * uses this rule rather than a second one that agrees today. Comparing an old
 * filing of one concept against a new filing of the other reports a
 * restatement as a concept disagreement.
 */
export function newer(a: FactRow, b: FactRow): FactRow {
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
export function rowsForField(
  facts: CompanyFacts,
  field: FieldDef,
  refusedUnits?: Set<string>,
  /**
   * The filer's ONE reporting currency, decided before this is called.
   *
   * DEFAULTS TO USD, so every existing caller and every USD filer reads exactly
   * as it did. This parameter RETARGETS the unit guard; it does not widen it.
   * One currency is admitted and every other is still refused, so a filer
   * publishing both EUR and JPY lines yields nothing from the JPY ones — the
   * plausible-wrong-number failure the guard exists for is untouched.
   */
  currency: string = "USD"
) {
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
      const keys = unitKeysFor(field.unit, currency);
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
 * A CONCEPT IS A NAMESPACE AND A TAG, NEVER A TAG ALONE.
 *
 * Eight of the mapped lines are spelled identically under `us-gaap` and
 * `ifrs-full` — Assets, Goodwill, NetIncomeLoss and five more — so a preference
 * carried as a bare tag name matches a dual-tagging filer's IFRS row as well as
 * its us-gaap one. Both then tie at the preferred rank, the newest filing wins,
 * and the filer's us-gaap reading is replaced by its IFRS one.
 *
 * NOT HYPOTHETICAL. That is precisely what the first draft of the preferred-tag
 * rule did, and check-sec-extract's dual-tagging fixture caught it on the first
 * run: BOTH's totalAssets came back 222 from `ifrs-full` in place of 111 from
 * `us-gaap`. The namespace is what disambiguates; the tag name cannot.
 */
const conceptKey = (c: { tag: string; ns: string }) => `${c.ns}|${c.tag}`;

/**
 * Resolve one period key to one value, applying trap 2 and trap 3 IN THAT ORDER.
 *
 * Chain rank first: the earliest chain entry that covers this period wins,
 * whatever it was filed in. Only within one rank does the newest accession win.
 * The other order would let a 10-K's legacy `Revenues` restatement beat the
 * current tag because it was filed later.
 *
 * ── AND ABOVE RANK: THE CONCEPT THIS FILER IS CURRENTLY USING ─────────────
 * `preferred` is the tag that covers the filer's NEWEST period for this field
 * (see preferredTag). It outranks the chain because the chain is a ranking of
 * concepts IN GENERAL and this is a fact about ONE filer: GEV and KTOS publish
 * `PaymentsToAcquireProductiveAssets`, not `PaymentsToAcquirePropertyPlantAnd-
 * Equipment`, and on a filer that publishes the fallback today and the primary
 * in 2019, rank-first makes one capex column mean two different things down its
 * own length — the newest rows one concept, the oldest rows another.
 *
 * ONLY WHERE THE PREFERRED CONCEPT IS ABSENT does the chain get to choose, so
 * this never removes a value: it only decides which of two present readings to
 * take. A filer that publishes a single concept throughout — which is nearly
 * all of them — resolves identically either way, because the preferred tag IS
 * the rank-first tag.
 */
export function resolve(
  candidates: { row: FactRow; tag: string; ns: string; rank: number; unit: string }[],
  preferred?: string | null,
  /**
   * REFUSE every concept but `preferred`, rather than merely ranking it first.
   * Set for a field marked `oneConceptPerFiler`: a period the chosen concept
   * does not cover resolves to NOTHING and renders "Not reported", instead of
   * silently taking the other measure. See preferredTag and FieldDef.
   */
  restrict?: boolean
) {
  if (restrict && preferred) {
    candidates = candidates.filter((c) => conceptKey(c) === preferred);
    if (!candidates.length) return null;
  }
  // Ranks are >= 0, so -1 puts the filer's own current concept above every
  // chain entry without a second comparison branch to get wrong.
  const rankOf = (c: { tag: string; ns: string; rank: number }) =>
    preferred && conceptKey(c) === preferred ? -1 : c.rank;
  let best: { row: FactRow; tag: string; ns: string; rank: number; unit: string } | null = null;
  for (const c of candidates) {
    if (!best || rankOf(c) < rankOf(best)) { best = c; continue; }
    if (rankOf(c) === rankOf(best) && newer(c.row, best.row) === c.row) best = c;
  }
  return best;
}

/**
 * THE CONCEPT A FILER COVERS ITS NEWEST PERIOD WITH — one tag per field, per
 * filer, computed from the filer's own rows and nothing else.
 *
 * ── WHY "NEWEST PERIOD" AND NOT "MOST FREQUENT" ───────────────────────────
 * A filer that migrated concepts in 2021 has four years of the old tag and two
 * of the new, so the most frequent concept is the one it has STOPPED using, and
 * every column would be anchored on the past and drift as history rolls off.
 * The newest period is what the filer is doing now; the rest is history that
 * either matches it or predates it.
 *
 * Resolved by rank among the rows at that newest end, so a filer publishing
 * both concepts on its newest period keeps the chain's ranking and nothing
 * moves. Returns null when the field has no rows at all.
 */
/**
 * ── WHY A MARKED FIELD HAS NO SELECTOR OF ITS OWN ─────────────────────────
 *
 * There WAS a `stickyTag` here, choosing the highest-ranked chain entry the
 * filer files for any period in the retention window. The owner's ruling
 * replaced it: the concept is the one filed for the filer's NEWEST stored
 * period that carries a figure, with the PP&E concept winning ties.
 *
 * That is exactly what `preferredTag` already computes. rowsForField drops any
 * row whose `val` is not a finite number, so every candidate IS a filed figure
 * and "newest period carrying a figure" is just the newest candidate end; and
 * `resolve` with no preference is rank-first, so the earlier chain entry wins a
 * period that files both — PP&E is chain[0].
 *
 * So selection is now IDENTICAL for marked and unmarked fields, and the mark
 * changes exactly one thing: whether the other concepts are REFUSED for the
 * rest of the column (see `restrict` on resolve). One selector, one rule about
 * ties, and no second place for either to drift.
 *
 * WHAT THE OLD RULE COST, measured over 119 SYMBOLS: NVDA, PANW and GE file the
 * PP&E concept on a handful of periods and the broader one on their recent
 * quarters, so "highest-ranked filed anywhere" took PP&E for the whole column
 * and refused every quarterly frame — NVDA lost 17 cells, PANW 18, GE 15.
 * Anchoring on the newest period keeps those columns and still fixes one
 * measure per filer. It is now the mutation, not the rule.
 */
export function preferredTag(
  candidates: { row: FactRow; tag: string; ns: string; rank: number; unit: string }[]
): string | null {
  let newestEnd: string | null = null;
  for (const c of candidates) {
    if (c.row.end && (newestEnd === null || c.row.end > newestEnd)) newestEnd = c.row.end;
  }
  if (newestEnd === null) return null;
  const best = resolve(candidates.filter((c) => c.row.end === newestEnd));
  return best ? conceptKey(best) : null;
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
  yearEndAnchor: string | null,
  /**
   * The filer's OWN naming of its fiscal year, read from its filings by
   * `fiscalYearOffset`. NULL means it could not be read, and the label falls
   * back to naming the year by the calendar year its END falls in — which is
   * what shipped, is right for most filers, and is wrong for AAP.
   */
  naming: FiscalYearNaming | null = null
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
  const fp = `Q${Math.min(4, Math.max(1, q))}`;
  if (!naming || naming.basis === null) return { fp, fy: best.year };
  return { fp, fy: fiscalMidYear(best.at) + naming.offset };
}

/**
 * The calendar year the FISCAL YEAR MOSTLY SITS IN, from its end.
 *
 * ── WHY NOT THE END YEAR, WHICH IS WHAT A READER WOULD REACH FOR ─────────
 * Because for the filers this matters to it is not stable. AAP's fiscal year
 * ends on the Saturday nearest 31 December, which lands on 2 January one year
 * and 27 December the next — so an offset measured against the END year flips
 * between 0 and -1 for the SAME company with no change in how it names
 * anything. A calibration that oscillates is worse than none: it would rename
 * the whole page every few years.
 *
 * The midpoint does not move. Half a year back from either boundary is
 * comfortably mid-year, so the reading is the same on both sides of New Year.
 */
export function fiscalMidYear(fiscalYearEndMs: number): number {
  return new Date(fiscalYearEndMs - 182.5 * DAY).getUTCFullYear();
}

/**
 * ── WHICH YEAR THE FILER CALLS ITS FISCAL YEAR, AND WHY IT MUST BE READ ───
 *
 * There is no convention to apply. A fiscal year ending in early January is
 * called FY2026 by AAP and FY2027 by WMT, and both are right — the name is the
 * filer's, not a function of the date. Naming it by the calendar year its END
 * falls in is correct for WMT and one year out for AAP, and the page said "Q2
 * FY2027 (period ending 2026-07-18)" about a quarter AAP calls Q2 FY2026.
 *
 * NOTHING ABOUT THAT FAILS. The date beside it is right, the quarter number is
 * right, and only a reader who knows the company can see the year is wrong.
 *
 * So it is CALIBRATED, once per filer, from the filer's own filings. Each fact
 * row carries the `fy` and `fp` of the FILING it appeared in — which is that
 * document's DocumentFiscalYearFocus — so a 10-K's own annual period gives the
 * pairing directly: this twelve-month span ending on this date is the year the
 * company calls `fy`.
 *
 * THE PRIMARY PERIOD, NOT THE COMPARATIVES. A 10-K stamps its own fy on every
 * prior year it restates, so the pairing is only readable from the LATEST
 * period in that filing — hence the max end per accession, and durations only
 * (a cover-page instant is dated at the FILING date, weeks past the year end,
 * and would shift the pairing by a year on a January filer).
 *
 * 10-Q IS THE FALLBACK, not the preference: it needs the year-end anchor to say
 * which fiscal year its quarter belongs to, so it inherits any error in the
 * anchor, where the 10-K does not.
 *
 * MODE OVER RECENT FILINGS, newest breaking ties. One malformed filing should
 * not rename every period on the page.
 */
export type FiscalYearNaming = {
  offset: number;
  /** True when a cited override replaced the vote (applyNamingOverride). */
  overridden?: boolean;
  /** "annual" is a 10-K, 20-F or 40-F — the filing that states the year outright. */
  basis: "annual" | "10-Q" | null;
  /**
   * The end of the filer's most recent ANNUAL FILING period.
   *
   * ── WHY THIS IS A BETTER ANCHOR THAN THE ONE DERIVED FROM FRAMES ────────
   * The extraction's anchor is "the newest twelve-month frame's end", and not
   * every twelve-month frame is a fiscal year: a trailing-twelve-month
   * comparative in a 10-Q is twelve months and ends mid-year. The census found
   * exactly that — AMZN anchored on 30 June and BG on 31 March, both December
   * filers, so every quarter either one showed was labelled from the wrong
   * year-end and had been all along.
   *
   * A 10-K's own period end is the fiscal year end by definition. Null when no
   * annual filing was readable, and then the frame-derived anchor stands.
   */
  yearEnd: string | null;
  /** How many FILINGS agreed. 0 means nothing was readable and offset is 0. */
  agreeing: number;
  disagreeing: number;
};

/**
 * Does this duration end ON the filer's fiscal year end?
 *
 * ── A TWELVE-MONTH FRAME IS NOT A FISCAL YEAR ────────────────────────────
 * A 10-Q carries twelve-month comparatives. AMZN's payload holds
 * `2025-07-01..2026-06-30`, 364 days, filed in a 10-Q for Q2 — a trailing year,
 * ending mid-year, indistinguishable from an annual period by LENGTH alone.
 * Six of them reached AMZN's `years` list and rendered on the five-year card as
 * fiscal years, and on the reaction card they took every quarter's label.
 *
 * Length cannot tell them apart. The END can: a fiscal year ends on the fiscal
 * year end, and nothing else does.
 *
 * ── AND THE TOLERANCE IS NOT SLACK ───────────────────────────────────────
 * TEN DAYS, the same figure and the same reason as `fiscalLabel`'s: a
 * 52/53-week filer's year end moves a few days annually — AAP's lands on
 * 2 January one year and 27 December the next — so an exact match would drop
 * every year but the newest. The band is fixed, not cumulative: the year end
 * oscillates around a weekday, it does not drift away. Ten days is wider than
 * that oscillation and far narrower than a quarter, so a trailing year ending
 * three months off is never admitted.
 *
 * The candidate years either side are what let a December/January filer match
 * across the New Year, exactly as in `fiscalLabel`.
 */
export const FISCAL_YEAR_END_SLACK_DAYS = 10;

export function onFiscalYearEnd(end: string, yearEndAnchor: string | null): boolean {
  if (!yearEndAnchor) return true; // nothing to measure against; admit, as before
  const e = Date.parse(`${end}T00:00:00Z`);
  const anchor = new Date(`${yearEndAnchor}T00:00:00Z`);
  if (!Number.isFinite(e) || Number.isNaN(anchor.getTime())) return true;
  const y = new Date(e).getUTCFullYear();
  for (const cand of [y - 1, y, y + 1]) {
    const at = Date.UTC(cand, anchor.getUTCMonth(), anchor.getUTCDate());
    if (Math.abs((at - e) / DAY) <= FISCAL_YEAR_END_SLACK_DAYS) return true;
  }
  return false;
}

export function fiscalYearOffset(
  facts: CompanyFacts,
  yearEndAnchor: string | null
): FiscalYearNaming {
  type Primary = { form: string; fy: number; fp: string; end: string; days: number };
  const byAccn = new Map<string, Primary>();
  for (const ns of Object.values(facts.facts ?? {})) {
    for (const tag of Object.values(ns)) {
      for (const rows of Object.values(tag.units ?? {})) {
        for (const r of rows) {
          if (!r.accn || !r.end || !r.start || !r.form || !r.fp) continue;
          if (typeof r.fy !== "number" || !Number.isFinite(r.fy)) continue;
          const days = (Date.parse(r.end) - Date.parse(r.start)) / DAY;
          if (!Number.isFinite(days)) continue;
          const cur = byAccn.get(r.accn);
          if (!cur || r.end > cur.end) {
            byAccn.set(r.accn, { form: r.form, fy: r.fy, fp: r.fp, end: r.end, days });
          }
        }
      }
    }
  }

  const readings: { end: string; offset: number }[] = [];
  // ── THE ANNUAL REPORT, WHATEVER IT IS CALLED ────────────────────────────
  // 10-K is the domestic form. A foreign private issuer files a 20-F and a
  // Canadian one a 40-F, and the census found eleven of them — BABA, SONY,
  // RYAAY, MUFG and the rest — reading as "naming unreadable" purely because
  // the filter named one form. All three carry `fp: "FY"` and the filing's own
  // fiscal year focus, so all three answer the question.
  const ANNUAL_FORMS = ["10-K", "20-F", "40-F"];
  const annual = [...byAccn.values()]
    .filter((p) => ANNUAL_FORMS.some((f) => p.form.startsWith(f)) &&
      p.fp === "FY" && p.days >= 330 && p.days <= 400)
    // A TOTAL ORDER, not a two-way comparator. Returning -1 for equal keys is
    // inconsistent and lets the sort reorder ties differently run to run, which
    // on a tie-break-by-newest rule is a naming that flips at random.
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
  for (const p of annual) {
    readings.push({ end: p.end, offset: p.fy - fiscalMidYear(Date.parse(`${p.end}T00:00:00Z`)) });
  }
  let readFrom: "annual" | "10-Q" | null = readings.length ? "annual" : null;

  if (!readings.length && yearEndAnchor) {
    const quarterly = [...byAccn.values()]
      .filter((p) => p.form.startsWith("10-Q") && /^Q[1-4]$/.test(p.fp) && p.days >= 80 && p.days <= 100)
      .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
    for (const p of quarterly) {
      // The UNCALIBRATED year this quarter belongs to — which is exactly what
      // the offset corrects.
      // The quarter's own fiscal-year END, which is what the offset is
      // measured against — found by labelling it with no naming at all, which
      // returns the end year, and stepping back to the midpoint.
      const naive = fiscalLabel(p.end, yearEndAnchor, null);
      if (naive.fy === null) continue;
      const anchorDate = new Date(`${yearEndAnchor}T00:00:00Z`);
      const fyEnd = Date.UTC(naive.fy, anchorDate.getUTCMonth(), anchorDate.getUTCDate());
      readings.push({ end: p.end, offset: p.fy - fiscalMidYear(fyEnd) });
    }
    if (readings.length) readFrom = "10-Q";
  }

  if (!readings.length) return { offset: 0, basis: null, agreeing: 0, disagreeing: 0, yearEnd: null };

  // ── ONLY 0 AND +1 ARE NAMING CONVENTIONS ────────────────────────────────
  // Measured from the midpoint year, a filer either names its fiscal year for
  // the calendar year it mostly occupies (AAP, AAPL: 0) or for the year it ends
  // in (WMT, ARM: +1). Nothing else is a convention — it is a malformed filing,
  // and admitting one would rename every period on the page by whatever
  // nonsense it carried.
  const recent = readings.slice(0, 4).filter((r) => r.offset === 0 || r.offset === 1);
  if (!recent.length) return { offset: 0, basis: null, agreeing: 0, disagreeing: readings.length, yearEnd: null };
  const counts = new Map<number, number>();
  for (const r of recent) counts.set(r.offset, (counts.get(r.offset) ?? 0) + 1);
  let best = recent[0].offset;
  for (const [off, n] of counts) {
    if (n > (counts.get(best) ?? 0)) best = off;
  }
  return {
    offset: best,
    basis: readFrom,
    agreeing: counts.get(best) ?? 0,
    disagreeing: recent.length - (counts.get(best) ?? 0),
    // ONLY FROM AN ANNUAL FILING. A 10-Q's period end is a quarter end, and
    // offering one here as a "year end" would move every label by a quarter.
    yearEnd: readFrom === "annual" ? (annual[0]?.end ?? null) : null,
  };
}

/**
 * A CITED EXCEPTION TO THE VOTE, applied only where the two disagree (#535
 * COWORK #12 on #2). Every automatic source was measured and each breaks more
 * filers than it fixes — SEC's fy vote is wrong on CRWD alone, the newest
 * reading on 3, the filer's own DEI on 2 (AAP, CRM) — so the one remaining
 * error is corrected by a reviewed, cited entry rather than by a fourth rule.
 * PURE; the list lives in data/sec/fiscal-year-naming-overrides.json and
 * reaches here through secExtractFor, so this module stays import-free.
 */
export function applyNamingOverride(vote: FiscalYearNaming, override: number | undefined): FiscalYearNaming {
  if (override === undefined || (override !== 0 && override !== 1) || override === vote.offset) return vote;
  return { ...vote, offset: override, overridden: true };
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
  opts: {
    quarters?: number; years?: number; instants?: number;
    /** A cited naming exception (data/sec/fiscal-year-naming-overrides.json), via secExtractFor. */
    namingOffset?: number;
  } = {}
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

  // ── THE CURRENCY, DECIDED BEFORE THE FIRST FIELD IS READ ─────────────────
  //
  // It is a property of the FILER, not of a field, so it cannot be decided
  // inside the loop: a per-field decision is how one column ends up in euros
  // and the next in dollars. Falling back to USD when the payload is ambiguous
  // keeps today's behaviour exactly — the foreign units are then refused and
  // recorded, and unreadableReason says so, as it does now.
  const currency = reportingCurrency(facts) ?? "USD";

  // One pass per field, bucketed by period key.
  //
  // ── AND ONE PREFERRED CONCEPT PER FIELD, FOR THIS FILER ──────────────────
  // Computed over ALL of the field's rows before any period is resolved,
  // because it is a property of the filer rather than of a period: see
  // preferredTag. Every resolve() below is handed it, so one column cannot
  // resolve to the filer's current concept on its newest rows and to a
  // superseded one on its oldest.
  const buckets = new Map<string, Bucket>();
  const preferred = new Map<string, string | null>();
  for (const field of SEC_FIELDS) {
    const bucket: Bucket = new Map();
    const all = rowsForField(facts, field, refusedUnits, currency);
    for (const c of all) {
      const k = periodKey(c.row);
      const list = bucket.get(k);
      if (list) list.push(c);
      else bucket.set(k, [c]);
    }
    buckets.set(field.key, bucket);
    // TWO POLICIES, CHOSEN BY THE FIELD. Marked fields fix one concept by
    // chain rank over the retention window and refuse the rest; everything
    // else keeps the newest-period preference with its fallback intact.
    preferred.set(
      field.key,
      // SAME SELECTOR EITHER WAY. The mark changes what happens to the OTHER
      // concepts (see `restrict`), not which one is chosen — the ruling
      // anchors both on the filer's newest period carrying a figure.
      preferredTag(all)
    );
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
      const best = resolve(cands, preferred.get(field.key), field.oneConceptPerFiler);
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
            covers: [start, f.end],
          });
        }

        if (f.n === 1) {
          // Q1, as filed. The only quarter that needs no differencing.
          cell(quarterCells, quarterMeta).set(field.key, {
            val: f.best.row.val!, tag: f.best.tag, ns: f.best.ns, unit: f.best.unit, derived: "as-filed",
            covers: [start, f.end],
          });
          continue;
        }

        const prior = byLen.get(f.n - 1);
        if (!prior) continue;
        // SAME CONCEPT ON BOTH SIDES, or the difference is between two
        // different concepts and is arithmetic on unrelated numbers. An ASC 606
        // boundary falling mid-year is exactly where this happens.
        //
        // conceptKey, NOT `tag`. This compared bare tag names and the namespace
        // defeated it: eight mapped lines are spelled identically under
        // `us-gaap` and `ifrs-full` — GrossProfit, ProfitLoss, Assets and five
        // more — so a dual-tagging filer whose 6M frame resolved to
        // `ifrs-full|GrossProfit` and whose 3M frame resolved to
        // `us-gaap|GrossProfit` compared EQUAL and was differenced. Measured:
        // 900 − 400 = 500 written as one cell, stamped `ns: "ifrs-full"` while
        // one of its operands came from us-gaap, and NO refusal note, because
        // nothing had noticed a change. That is the same bare-tag mistake this
        // file's own conceptKey comment records catching in preferredTag — the
        // guard here had not followed it.
        if (conceptKey(prior.best) !== conceptKey(f.best)) {
          notes.push(
            `${field.key} ${start}..${f.end}: concept changed mid-year ` +
              `(${conceptKey(prior.best)} -> ${conceptKey(f.best)}), not differenced`
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
          covers: [prior.end, f.end],
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
      const best = resolve(cands, preferred.get(field.key), field.oneConceptPerFiler);
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
        covers: [best.row.start, best.row.end],
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
      for (const [end, m] of cells) {
        if (m.get(field.key)) continue; // filed; nothing to compute
        const numCell = m.get(numerator);
        const denCell = m.get(denominator);
        const num = numCell?.val ?? null;
        const den = denCell?.val ?? null;
        if (num === null || den === null || den === 0) continue;
        // ── BOTH OPERANDS FROM THE SAME FRAME, OR NO RATIO AT ALL ──────────
        // The comment above says a quarter's earnings over a year's share
        // count is a wrong number that looks like a right one; until `covers`
        // existed, nothing said so in code — the two operands shared a map key
        // and that was taken as proof they shared a period. They share an END.
        // A cell whose start disagrees by more than a week is a different
        // frame, and dividing across it is the period mix in one line.
        if (!sameFrame(numCell?.covers, denCell?.covers)) {
          notes.push(
            `${field.key} ${end}: ${numerator} covers ${numCell?.covers?.join("..") ?? "?"} ` +
              `but ${denominator} covers ${denCell?.covers?.join("..") ?? "?"}, not computed`
          );
          continue;
        }
        m.set(field.key, {
          val: num / den,
          covers: numCell!.covers,
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
      const best = resolve(cands, preferred.get(field.key), field.oneConceptPerFiler);
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
  // READ ONCE PER FILER, from its own filings. Not a convention, not a guess.
  const naming = applyNamingOverride(fiscalYearOffset(facts, yearEndAnchor), opts.namingOffset);
  // ── AND THE ANNUAL FILING'S OWN PERIOD END BEATS THE FRAME-DERIVED ONE ──
  // `yearEndAnchor` is the newest twelve-month frame, and a trailing-twelve-
  // month comparative in a 10-Q is twelve months long without being a fiscal
  // year. AMZN anchored on 30 June and BG on 31 March that way — both December
  // filers, every quarter labelled off the wrong year-end. A 10-K's own period
  // end is the fiscal year end by definition, so it wins where it exists.
  const labelAnchor = naming.yearEnd ?? yearEndAnchor;

  const pack = (
    cells: Map<string, Map<string, FieldValue>>,
    meta: (end: string) => { start: string | null; row: FactRow | undefined },
    annual = false
  ): PeriodRecord[] =>
    [...cells.entries()]
      .map(([end, m]) => {
        const { start, row } = meta(end);
        const fiscal = fiscalLabel(end, labelAnchor, naming);
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

  // ── ONLY PERIODS THAT END ON THE FISCAL YEAR END ARE FISCAL YEARS ───────
  //
  // Applied ONCE, HERE, so every consumer of `years` gets the same list: the
  // five-year card, the snapshot anchor, tableBasis and its 548-day gate, the
  // annual cash-flow fallback, and the period ends the report-date matcher is
  // given. Filtering at any one of those would leave the others reading
  // trailing years as fiscal ones.
  //
  // THE ANCHOR IS THE ANNUAL FILING'S OWN PERIOD END, not the newest twelve-
  // month frame — using the frame-derived anchor here would ask a list to
  // validate itself, and on AMZN that anchor WAS one of the trailing years.
  // Where no annual filing could be read there is nothing to measure against
  // and nothing is dropped, which is exactly what shipped before this.
  const years = pack(
    new Map([...yearCells].filter(([e]) => onFiscalYearEnd(e, naming.yearEnd))),
    (e) => ({ start: yearMeta.get(e)?.start ?? null, row: yearMeta.get(e)?.row }),
    true
  ).slice(0, keepYears);

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
    reportingCurrency: currency,
    // THE CENSUS, from the payload itself rather than from a list of filers we
    // think are IFRS. Sorted so a stored set's value is stable across fetches.
    taxonomies: Object.keys(facts.facts ?? {}).sort(),
    refusedUnits: [...refusedUnits].sort(),
    conceptChoice: Object.fromEntries(
      SEC_FIELDS.filter((f) => f.oneConceptPerFiler)
        .map((f) => [f.key, preferred.get(f.key) ?? null])
        .filter((e): e is [string, string] => e[1] !== null)
    ),
    annualShares: annualShareSeries(buckets.get("sharesBasic"), preferred.get("sharesBasic") ?? null, naming.yearEnd),
    untagged: SEC_FIELDS.filter((f) => !fieldIsTagged(facts, f)).map((f) => f.key),
    readNamespaces: countReadNamespaces([...quarters, ...years, ...instants]),
    notes,
  };
}

/**
 * See ExtractResult.annualShares. Resolved with the SAME resolve() and the
 * same preferred concept the stored years use, so a year that appears in both
 * reads the same number in both.
 */
function annualShareSeries(
  bucket: Bucket | undefined,
  preferred: string | null,
  yearEnd: string | null
): [string, number][] {
  if (!bucket) return [];
  const out = new Map<string, number>();
  for (const [, cands] of bucket) {
    const best = resolve(cands, preferred);
    if (!best?.row.start || !best.row.end || typeof best.row.val !== "number" || best.row.val <= 0) continue;
    if (quartersCovered(spanDays(best.row.start, best.row.end)) !== 4) continue;
    if (!onFiscalYearEnd(best.row.end, yearEnd)) continue;
    out.set(best.row.end, best.row.val);
  }
  return [...out].sort((a, b) => a[0].localeCompare(b[0]));
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
  // ── THE CHAIN, WALKED, RATHER THAN chain[0] UNDER dei ────────────────────
  //
  // This read exactly one tag in one namespace. MEASURED (relay 35620148960):
  // Alphabet and Under Armour publish NO dei:EntityCommonStockSharesOutstanding
  // at all, so they had no share count and no market cap for a reason that was
  // a gap in the read rather than a gap in the filing.
  //
  // PREFERENCE, NOT A MERGE. Each source is tried in order and the FIRST that
  // yields rows wins outright; rows from two namespaces are never pooled. They
  // are as-of different dates -- the cover page is the filer's most recent
  // statement, the balance-sheet line is as of the period end weeks earlier --
  // and mixing them would make the ambiguity test below compare a cover reading
  // against a balance-sheet one and call two dates two share classes.
  const sources: { ns: string; chain: readonly string[] }[] = [
    { ns: COVER_SHARES_FIELD.taxonomy, chain: COVER_SHARES_FIELD.chain },
    { ns: COVER_SHARES_FALLBACK.taxonomy, chain: COVER_SHARES_FALLBACK.chain },
  ];

  // THE DENYLIST IS CHECKED HERE TOO, not only at module load. The load-time
  // assertion covers the shipped constants; this covers a chain reaching this
  // function by any other route, and costs one array scan on a cold read.
  let rows: FactRow[] = [];
  for (const { ns, chain } of sources) {
    for (const tag of chain) {
      if (FORBIDDEN_COVER_TAGS.includes(tag)) continue;
      const found = (facts.facts?.[ns]?.[tag]?.units?.shares ?? []).filter(
        (r) => typeof r?.val === "number" && Number.isFinite(r.val) && r.end
      );
      if (found.length) { rows = found; break; }
    }
    if (rows.length) break;
  }
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
