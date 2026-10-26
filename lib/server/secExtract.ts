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
import type { InstanceEps } from "./secFactCodec";
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
  revenueLineIncompleteValues,
  REVENUE_FALLBACK_CHAIN,
  REVENUE_TOTAL_OVER_CONTRACT,
  REVENUE_GAP_CONCEPTS,
  REVENUE_GAP_TOLERANCE_ABS,
  SHARE_UNIT_SLIP_CORROBORATION,
  SHARE_UNIT_SLIP_FACTORS,
  SHARE_UNIT_SLIP_TOLERANCE,
  secFieldsHash,
  SELLING_TAGS,
  SUMMED_SGA_TAG,
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

/**
 * THE SHARE-SERIES SHAPE a stored set was written under (#552 COWORK #132).
 *
 * 1 (absent) — before #706: no `asr` (restated comparatives) or `asf`
 *     (re-filed periods), so a split cannot be proven and the dilution chart
 *     cuts at it (BKNG drew nothing).
 * 2 — `as`/`asr`/`asf` as #706 reads them.
 *
 * ITS OWN STAMP, because nothing else could see it: none of the three share
 * fields is in contentHash (they are not restatement evidence about a filed
 * figure), so a re-read that changed only them was counted "unchanged" and
 * never written, while the manifest stamped the symbol current. Absent selects,
 * so every set written before this stamp existed is re-read once.
 */
export const SEC_SHARE_VERSION = 2;

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

/**
 * WHAT A companyfacts 404 MEANS: SEC publishes no XBRL company facts for this
 * CIK — a unit investment trust (SPY, QQQ, DIA) or a filer that has never
 * filed XBRL. A permanent answer, not a failure: measured 2026-09-23, those
 * three return 404 while every operating filer returns 200. Read as an EMPTY
 * payload, so an empty set is stored and the pages render "no financial
 * taxonomy" with `index`, instead of "not yet read" and `noindex` forever
 * (#535 COWORK #21). Only 404: a 403, 429 or 5xx stays a failure and retries.
 */
export const companyFactsAbsent = (status: number): boolean => status === 404;

/** Why a stored number is the number it is. Carried so a diff can be explained. */
export type Derivation =
  /** The filer published this exact period. */
  | "as-filed"
  /** Cumulative-minus-cumulative within one fiscal year. */
  | "differenced"
  /** Computed from two other fields of the SAME period. See FieldDef.ratioSource. */
  | "computed"
  /** Several values for one period and no way to choose. Value is null. */
  | "ambiguous"
  /**
   * A differenced Q4 the filer's own figures show crosses scopes (#552 COWORK
   * #196/#200, see q4RevenueScope). Value is null; the page reads "Not
   * reported" with the reason on tap.
   */
  | "withheld";

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
  /**
   * Only on "differenced": the cumulative frame it was subtracted from (the
   * 9M under a Q4), value and span, so the same-basis pass can compare it
   * with the quarters shown for that span. In memory only, like `covers`.
   */
  operand?: { val: number; covers: [string, string] };
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
  /**
   * The filing's own sentence stating the classes convert one-for-one, when
   * the count is two classes summed on that basis (secCoverAuto). The citation
   * travels with the number.
   */
  basis?: string;
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
  /**
   * `start|end` of every period whose SG&A is the synthesized sales &
   * marketing + G&A sum (SUMMED_SGA_TAG), so the card can label it. Optional:
   * absent on results built before it existed, and on filers with none.
   */
  summedSga?: string[];
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
   * Set by the READERS, never by extraction (it needs two filings' XBRL):
   * twelve months of EPS from the filings, where the periods cannot give it.
   * See secInstanceEps.
   */
  ttmEps?: InstanceEps;
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
   * THE FILER'S OWN SPLIT EVIDENCE (#552 COWORK #89 §1): for each year or
   * quarter whose basic share count was RESTATED by a later filing, `[periodEnd,
   * newest ÷ originally filed]`, kept only when the two differ by at least 1.5×
   * either way. A 20-for-1 split restates the prior years' comparatives in the
   * next 10-K, so the restated year carries ~20. The chart builder decides which
   * ratios are whole splits (secShareHistory); this records them raw.
   * Optional; absent = none, or written before it existed.
   */
  shareRestated?: [string, number][];
  /**
   * THE FILER'S OWN STOCK-SPLIT FACTS (#552 COWORK #245): `[date, ratio]` from
   * StockholdersEquityNoteStockSplitConversionRatio1, undimensioned, as filed
   * (CVNA's 5-for-1 of 8 May 2026 is filed as 0.2). Raw: which ones are whole
   * splits, and in which direction, is decided by the reader against the
   * share counts (secSplitAdjust). Optional; absent = none filed.
   */
  splitFacts?: [string, number][];
  /**
   * PERIODS RE-FILED UNCHANGED (#552 COWORK #89 §1): year and recent-quarter
   * ends whose basic share count a later filing reported again within 1%.
   * The other half of the split evidence: a doubling between two periods
   * whose earlier one was re-reported unchanged AFTER it is real issuance, not
   * a split (a split restates the comparatives). Optional.
   */
  shareRefiled?: string[];
  /**
   * THE BALANCE-SHEET NONCONTROLLING INTEREST (us-gaap MinorityInterest) on the
   * stored instants' dates, `[date, USD]`, newest first. An extra, not a field:
   * see minorityInterestAt (below). Absent when the filer tags none, or
   * reports in another currency.
   */
  nci?: [string, number][];
  /**
   * THE NEWEST QUARTER'S YEAR-TO-DATE FRAME, WHEN ITS OWN CASH FLOW CANNOT BE
   * DERIVED (#552 COWORK #37). A first-time filer's Q2 10-Q carries cash flow
   * for six months only: there is no Q1 frame to difference against, so the
   * quarter's cash cells are null and the page said the filings "do not carry
   * a cash-flow statement". They do, over six months. This keeps that frame,
   * as filed, and ONLY then: a quarter whose three months could be derived
   * never carries it, so an established filer's set is unchanged.
   * fp/fy null: a year-to-date span is not a fiscal period.
   */
  ytd?: PeriodRecord;
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
/** How far a differenced quarter's operand may sit from the quarters shown for its span (audit r5). */
export const SAME_BASIS_TOLERANCE = 0.005;

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
export function quartersCovered(days: number, calendar: QuarterCalendar = "standard"): 1 | 2 | 3 | 4 | null {
  // A 12/12/12/16-WEEK FILER ONLY (#552 COWORK #240 (c)): its 16-week quarter
  // (~112 days), 24-week half (~168) and 36-week nine months (~252) sit just
  // outside the standard bands, so COST's Q4 (FY less 36 weeks) and AZO's Q1
  // were never admitted. Widened for a filer sixteenWeekCalendar() detects,
  // and for no one else.
  if (calendar === "sixteen-week") {
    if (days >= 80 && days <= 119) return 1;
    if (days >= 160 && days <= 200) return 2;
    if (days >= 245 && days <= 290) return 3;
  }
  if (days >= 80 && days <= 105) return 1;
  if (days >= 170 && days <= 200) return 2;
  if (days >= 260 && days <= 290) return 3;
  if (days >= 350 && days <= 380) return 4;
  return null;
}

export type QuarterCalendar = "standard" | "sixteen-week";

/**
 * IS THIS A 12/12/12/16-WEEK FILER? (#552 COWORK #240 (c); #239 item 3.)
 *
 * Read from the filer's own frames, never from a symbol list: some fiscal year
 * (frames sharing one start, ending inside a 52/53-week year) carries a
 * 12-week first frame and a 36-week year-to-date (the 16-week quarter is Q4:
 * COST, PEP, DPZ), or a 16-week first frame and a 28-week year-to-date (the
 * 16-week quarter is Q1: AZO, KR, ACI). A 13-week (4-4-5) filer's frames are
 * 91/182/273 days and match neither, so it keeps the standard bands.
 */
export function sixteenWeekCalendar(facts: CompanyFacts): boolean {
  const near = (d: number, target: number) => Math.abs(d - target) <= 2;
  const byStart = new Map<string, number[]>();
  for (const tag of ["NetIncomeLoss", "ProfitLoss", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"]) {
    for (const r of facts.facts?.["us-gaap"]?.[tag]?.units?.USD ?? []) {
      if (!r.start || !r.end) continue;
      const list = byStart.get(r.start) ?? [];
      list.push(spanDays(r.start, r.end));
      byStart.set(r.start, list);
    }
  }
  for (const spans of byStart.values()) {
    const has = (t: number) => spans.some((d) => near(d, t));
    const year = spans.some((d) => (d >= 362 && d <= 365) || (d >= 369 && d <= 372));
    if (!year) continue;
    if (has(83) && has(251)) return true; // 12, 24, 36, 52 weeks: Q4 is 16 weeks
    if (has(111) && has(195)) return true; // 16, 28, 40, 52 weeks: Q1 is 16 weeks
  }
  return false;
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
/**
 * A FULL YEAR'S VALUE FILED ON A QUARTER'S DATES (earnings audit r2).
 *
 * LHX's FY2025 10-K tags its FY2024 revenue, $21,325M, on a 97-day context
 * (2024-09-28..2025-01-03) as well as on the year, under one accession; NI's
 * 10-Ks do it for Q4 2024 and Q4 2025, DINO's for Q4 2024, and VICR's FY2025
 * 10-K puts $407.7M on 2025-07-01..09-30 beside its 10-Q's $110.4M. Read as
 * filed, each became a quarter equal to its whole year, and the year fell 40%+
 * below the sum of its quarters.
 *
 * Refused: a quarter-length row whose value equals a year-length row of the
 * SAME concept and SAME accession that contains it, while another row of that
 * concept inside the year (a six- or nine-month figure) is smaller than the
 * year — so a real quarter exists to be found. Q4 then comes from FY − 9M as
 * for any filer, and a mid-year quarter from the 10-Q that stated it.
 *
 * READ AS THE YEAR: an annual filing's quarter-length row with NO year row
 * ending on its date (LHX's FY2025 10-K tags $21,865M on 2025-10-04..2026-01-02
 * and no 2025 year at all) whose value is the nine months just before it plus
 * about one more of its average quarters: $16,217M + $5,648M against a $5,406M
 * average. That is the year's value on the quarter's dates, so it is re-dated
 * to the year (the nine months' start to its end) and Q4 = FY − 9M: $5,648M,
 * the Q4 and the $21,865M year L3Harris reported. A real fourth quarter is
 * near the average, not three and a half times it, and one beside its own
 * year row (HHH's lumpy Q4 2024) is never touched.
 *
 * Returns each such row mapped to what is read instead: null (refused) or the
 * re-dated year row. PURE.
 */
export function fullYearOnQuarterFrame(rows: readonly FactRow[]): Map<FactRow, FactRow | null> {
  const out = new Map<FactRow, FactRow | null>();
  const days = (r: FactRow) => (r.start && r.end ? (Date.parse(r.end) - Date.parse(r.start)) / DAY : NaN);
  const years = rows.filter((r) => typeof r.val === "number" && days(r) >= 350 && days(r) <= 380);
  if (!years.length) return out;
  for (const q of rows) {
    if (typeof q.val !== "number" || q.val === 0 || !q.start || !q.accn) continue;
    const d = days(q);
    if (!(d >= 80 && d <= 100)) continue;
    const y = years.find((y) => y.accn === q.accn && y.val === q.val && y.start! <= q.start! && y.end! >= q.end!);
    if (!y) {
      if (!/^(10-K|20-F|40-F)/.test(q.form ?? "")) continue;
      // NO YEAR ROW AT ALL, not merely none of equal value: HHH's FY2025 10-K
      // files a real 983.6M Q4 2024 beside its 1,750.7M year, and that Q4 is
      // the nine months plus about one average quarter too (lumpy land sales).
      if (years.some((r) => Math.abs(Date.parse(r.end!) - Date.parse(q.end!)) <= 8 * DAY)) continue;
      const before = (r: FactRow) => (Date.parse(q.start!) - Date.parse(r.end!)) / DAY;
      const nine = rows.find((r) => typeof r.val === "number" && r.val > 0 && r.start && days(r) >= 255 && days(r) <= 290
        && before(r) >= 0 && before(r) <= 8);
      if (!nine) continue;
      const avg = nine.val! / 3, rest = q.val - nine.val!;
      if (q.val > 2 * avg && rest >= 0.5 * avg && rest <= 1.5 * avg) out.set(q, { ...q, start: nine.start, fp: "FY" });
      continue;
    }
    const smaller = rows.some((r) => r !== q && r !== y && typeof r.val === "number" && r.start && r.start >= y.start! && r.end! <= y.end!
      && days(r) > d && days(r) < 350 && Math.abs(r.val) < Math.abs(y.val!));
    if (smaller) out.set(q, null);
  }
  return out;
}

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
        const misdated = fullYearOnQuarterFrame(units[unit] ?? []);
        for (const row of units[unit] ?? []) {
          if (typeof row?.val !== "number" || !Number.isFinite(row.val)) continue;
          if (!row.end) continue;
          const asRead = misdated.has(row) ? misdated.get(row) : row;
          if (!asRead) continue;
          out.push({ row: asRead, tag, ns, rank: thisRank, unit });
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
          // A PERIOD CANNOT END AFTER THE FILING THAT REPORTS IT. QXO's FY2023
          // 10-K (filed 2024-03-14) tags an OperatingLeaseExpense row for
          // 2025-05-01..2026-04-30 -- a future commitment, not the filing's
          // period -- and as the accession's latest end it became the "fiscal
          // year end": every quarter was labelled off 30 April and every
          // December year was filtered out (#552 COWORK #30).
          if (r.filed && r.end > r.filed) continue;
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
type ExtractOpts = {
  quarters?: number; years?: number; instants?: number;
  /** A cited naming exception (data/sec/fiscal-year-naming-overrides.json), via secExtractFor. */
  namingOffset?: number;
};

/**
 * THE UNIT-SLIP FACTOR, OR NULL (#552 COWORK #192): the power of ten that
 * makes net income ÷ (EPS × shares) ~1, when it is within
 * SHARE_UNIT_SLIP_TOLERANCE of one of SHARE_UNIT_SLIP_FACTORS. Anything else
 * -- an ADS ratio, a preferred-dividend gap, a mismatched period -- is null.
 */
export function unitSlipFactor(netIncome: number, eps: number, shares: number): number | null {
  if (!Number.isFinite(netIncome) || !Number.isFinite(eps) || !Number.isFinite(shares) || eps === 0 || shares <= 0) return null;
  const u = netIncome / (eps * shares);
  for (const f of SHARE_UNIT_SLIP_FACTORS) if (Math.abs(u / f - 1) <= SHARE_UNIT_SLIP_TOLERANCE) return f;
  return null;
}

/**
 * A DERIVED Q4 REVENUE THAT CROSSES SCOPES (#552 COWORK #196/#200; census
 * CODE-A #205). Q4 is FY − 9M, and where the year's line and the quarters'
 * line cover different scopes the difference is arithmetic on unlike numbers:
 * OXY's FY2025 Q4 read $1.66B against $5–7B in its other quarters.
 *
 * A LOW Q4 ALONE PROVES NOTHING. The plain ratio flagged 27 filers, most of
 * them small biotechs whose Q4 really was small (milestone revenue), so the
 * test needs the filer's own second opinion. Withheld when:
 *   1. the derived Q4 is NEGATIVE — revenue cannot be below zero (FIX, AMLX);
 *   2. it is under DERIVED_Q4_FLOOR of the mean of the same year's other three
 *      quarters, AND the filer's own `Revenues` total (or
 *      `RevenuesNetOfInterestExpense`), differenced the same way, gives a Q4
 *      at or above that floor of ITS quarters' mean — the total says the year
 *      had a normal fourth quarter, so the line's collapse is a scope artefact;
 *   3. it is under that floor AND the nine months it was differenced from do
 *      not add up to the three quarters shown beside it (off by more than
 *      NINE_MONTHS_TOLERANCE) — the quarters were restated to a different
 *      scope than the year-to-date figure, so FY − 9M is not this year's Q4
 *      on the quarters' basis. OXY FY2025: the census found no `Revenues`
 *      total, and its nine months disagree with its own three quarters.
 * With no such proof, the Q4 stands as filed arithmetic: that keeps the true
 * small quarters and the seasonal ones (MTN, SR, SMG, BATRA in the census).
 *
 * PURE, so check-q4-revenue-scope can drive it with plain numbers.
 */
export const DERIVED_Q4_FLOOR = 0.4;
export const NINE_MONTHS_TOLERANCE = 0.02;
export type Q4ScopeVerdict = "negative" | "scope" | "quarters" | null;
export function q4RevenueScope(
  q4: number,
  siblings: number[],
  total?: { q4: number; siblings: number[] } | null,
  /** The nine-month figure Q4 was differenced from (FY − Q4), or null. */
  nine?: number | null,
): Q4ScopeVerdict {
  if (!Number.isFinite(q4)) return null;
  if (q4 < 0) return "negative";
  const mean = (xs: number[]) => (xs.length === 3 && xs.every(Number.isFinite) ? (xs[0] + xs[1] + xs[2]) / 3 : null);
  const m = mean(siblings);
  if (m == null || !(m > 0) || q4 >= DERIVED_Q4_FLOOR * m) return null;
  if (total && Number.isFinite(total.q4)) {
    const tm = mean(total.siblings);
    if (tm != null && tm > 0 && total.q4 >= DERIVED_Q4_FLOOR * tm) return "scope";
  }
  if (nine != null && Number.isFinite(nine) && nine > 0 && Math.abs(nine - 3 * m) > NINE_MONTHS_TOLERANCE * nine) return "quarters";
  return null;
}

/** The contract-revenue tag the total-over-contract rule compares against. */
const CONTRACT_REVENUE_TAG = "RevenueFromContractWithCustomerExcludingAssessedTax";
/** The last-resort revenue concept (#552 COWORK #240 (b)); see its block in extractCompanyFactsWith. */
export const LAST_RESORT_REVENUE_TAG = "RevenuesNetOfInterestExpense";
/**
 * A UTILITY'S TOTAL OPERATING REVENUE, on the same per-series last-resort rule
 * (earnings audit r1). XEL tags it and none of the chain's concepts, so every
 * revenue cell read "Not captured". NOT a chain entry: DUK and TLN file it
 * beside a contract line on a few periods, and as a chain fallback it mixed
 * two measures into their series (relay scan, write-earnings-audit-r1-scan).
 */
export const UTILITY_REVENUE_TAG = "RegulatedAndUnregulatedOperatingRevenue";
/**
 * THE OWNER'S RULING ON A FILER'S HEADLINE TOTAL (earnings audit r2), by symbol:
 * the concept that is its revenue for every year and quarter, as filed.
 *   WMT: `Revenues` (total revenues, net sales plus membership and other
 *        income): 713,163M for FY2026 against a 706,413M contract line. The
 *        gap is under REVENUE_TOTAL_OVER_CONTRACT and is no listed gap concept,
 *        so the total-over-contract rule kept the contract line.
 *   DUK: total operating revenues, RegulatedAndUnregulatedOperatingRevenue:
 *        32,237M for FY2025 against a 31,741M contract line (including tax).
 *        Not a chain entry (see UTILITY_REVENUE_TAG): only this filer moves.
 * A period without the ruled concept reads Not reported rather than keep the
 * contract line beside the total, so the series stays on one basis.
 */
export const REVENUE_TOTAL_RULINGS: Readonly<Record<string, string>> = {
  WMT: "Revenues",
  DUK: UTILITY_REVENUE_TAG,
};
/** EPS ratio fallback gate (#552 COWORK #240 (a)): the filer's own filed EPS must close on NI / shares within this, */
export const RATIO_CLOSE_TOLERANCE = 0.1;
/** How close a closure ratio must sit to one of the filer's split ratios to read as a split, not a wrong count. */
export const SPLIT_SHAPED_TOLERANCE = 0.05;
/** The split-ratio concept the filer states its splits under. */
export const SPLIT_FACT_TAGS = ["StockholdersEquityNoteStockSplitConversionRatio1"] as const;

/** The filer's split facts, `[date, ratio]`, undimensioned rows only, de-duplicated. See ExtractResult.splitFacts. */
export function readSplitFacts(facts: CompanyFacts): [string, number][] {
  const out = new Map<string, number>();
  for (const tag of SPLIT_FACT_TAGS) {
    for (const rows of Object.values(facts.facts?.["us-gaap"]?.[tag]?.units ?? {})) {
      for (const r of rows) {
        const d = r.end ?? r.start;
        if (!d || typeof r.val !== "number" || !Number.isFinite(r.val) || r.val <= 0) continue;
        out.set(`${d}|${r.val}`, r.val);
      }
    }
  }
  return [...out].map(([k, v]) => [k.split("|")[0], v] as [string, number]).sort((a, b) => a[0].localeCompare(b[0]));
}
/** ...over its newest this-many quarters and years. */
const RATIO_CLOSE_QUARTERS = 8;
const RATIO_CLOSE_YEARS = 4;
/** How many of the newest years must carry no revenue before the last resort fills the years. */
const LAST_RESORT_YEARS = 4;
/** A bank's two revenue halves (#552 COWORK #241): summed, marked computed, only where no total is tagged. */
export const BANK_REVENUE_HALVES = ["InterestIncomeExpenseNet", "NoninterestIncome"] as const;
/**
 * HOW CLOSE A BANK'S FILED TOTAL MUST SIT TO ITS NET REVENUE (earnings audit
 * r2): net interest income plus noninterest income for the same frame. A
 * `Revenues` outside this is a sub-line (ZION's $662M of $3,385M), a zero
 * (UVSP, CBSH, OFG) or a gross figure before interest expense (BBT +13%, BFH
 * +37%), and is not taken. See the bank net-basis block in extractCompanyFactsWith.
 */
export const BANK_NET_TOLERANCE = 0.02;
/**
 * A FILED NET TOTAL KEEPS ITS SECURITIES GAINS AND LOSSES (earnings audit r2,
 * owner ruling on STT). A bank's own total revenue counts a securities-sale
 * loss that its NoninterestIncome line may leave out: STT's 2023 `Revenues`
 * $11,945M is net of a $294M loss, 2.4% under the halves' $12,239M, and it is
 * the figure STT reports. A filed RevenuesNetOfInterestExpense, or a filed
 * `Revenues` at or above net interest income, within this of the halves is
 * that net total and is kept; a sub-line sits below NII and a gross figure
 * further off (BBT +13%, GABC +35%, BANC +62%).
 */
export const BANK_NET_GAINS_TOLERANCE = 0.08;
/** The in-memory tag of a derived contract + not-from-contract total (option G, LUNR). Never stored. */
const DERIVED_TOTAL_TAG = "RevenueFromContractWithCustomerPlusGapConcept";

/**
 * DOES THE FILER TAG EXCISE AT ALL (#552 COWORK #192 ruling A)? Any us-gaap
 * concept naming excise -- the filers whose `Revenues` is gross of excise or
 * carries other income, which the total-over-contract rule must not reach.
 */
export function filerTagsExcise(facts: CompanyFacts): boolean {
  // NOT THE BUYBACK EXCISE (earnings audit r1). The 1% excise on share
  // repurchases (ShareRepurchaseProgramExciseTax, tagged by many filers since
  // 2023) says nothing about revenue, and it kept KEY's $1.44B contract line
  // beside its $6.41B total.
  //
  // NOR A BALANCE-SHEET EXCISE (earnings audit r2): SalesAndExciseTaxPayable
  // is a liability, and says nothing about how revenue is presented (APLD,
  // PRCH, VIPS). NOR, AT A FINANCIAL FILER, "taxes other than income and
  // excise" (TaxesExcludingIncomeAndExciseTaxes): a lender's or broker's
  // non-income tax line, beside a `Revenues` that is its total net revenue
  // (ALLY's $7.9B against a $1.2B contract line). A financial filer is one
  // that tags NoninterestIncome. COP and CEG tag that concept too, and no
  // NoninterestIncome, so their "revenues and other income" stay excluded.
  const gaap = facts.facts?.["us-gaap"] ?? {};
  const financial = Boolean(gaap.NoninterestIncome);
  return Object.keys(gaap).some((k) => /Excise/.test(k) && !/Repurchase|Buyback|TreasuryStock/.test(k)
    && !/Payable|Receivable/.test(k) && !(financial && k === "TaxesExcludingIncomeAndExciseTaxes"));
}

/** Names of other income and gains: a gap one of these also equals is not called revenue. */
const OTHER_INCOME_NAME = /OtherIncome|Nonoperating|EquityMethod|Gain|Loss|InvestmentIncome|OtherOperatingIncome|Derivative/;

/**
 * WHICH REVENUE CONCEPT FILLS THE GAP (#552 COWORK #219, option G), or null.
 *
 * The newest quarter (a filed 10-Q/10-K frame of about 91 days) that carries
 * both `Revenues` and the contract line; the gap between them; and the one
 * REVENUE_GAP_CONCEPTS concept whose value for that same quarter equals it,
 * within the larger of REVENUE_GAP_TOLERANCE_ABS and 1%. NULL when no listed
 * concept equals it, when the gap is not positive, or when an other-income or
 * gain concept equals it as well (MDU, PACS, ENSG, SPHR, RYN in the census:
 * too close to call). The same measurement CODE-A #235's census made.
 */
export function revenueGapConcept(facts: CompanyFacts, currency = "USD"): string | null {
  const g = facts.facts?.["us-gaap"] ?? {};
  type Row = { start?: string; end: string; val: number; form?: string; filed?: string };
  const quarterRows = (k: string): Row[] => ((g[k]?.units?.[currency] ?? []) as Row[]).filter((r) =>
    r.start && /^10-[KQ]/.test(r.form ?? "") && Math.abs((Date.parse(r.end) - Date.parse(r.start!)) / 86_400_000 - 91) <= 10);
  const rv = quarterRows("Revenues"), ct = quarterRows(CONTRACT_REVENUE_TAG);
  const end = rv.map((r) => r.end).filter((e) => ct.some((c) => c.end === e)).sort().at(-1);
  if (!end) return null;
  const at = (rows: Row[]) => rows.filter((r) => r.end === end).sort((x, y) => String(x.filed).localeCompare(String(y.filed))).at(-1)?.val ?? null;
  const total = at(rv), contract = at(ct);
  if (total == null || contract == null) return null;
  const gap = total - contract;
  if (!(gap > 0)) return null;
  const tol = Math.max(REVENUE_GAP_TOLERANCE_ABS, gap * 0.01);
  const equals = (k: string) => { const x = at(quarterRows(k)); return x != null && Math.abs(x - gap) <= tol; };
  const hit = REVENUE_GAP_CONCEPTS.find(equals) ?? null;
  if (!hit) return null;
  const otherToo = Object.keys(g).some((k) => k !== "Revenues" && k !== CONTRACT_REVENUE_TAG && OTHER_INCOME_NAME.test(k) && equals(k));
  return otherToo ? null : hit;
}

/**
 * THE EXTRACTION, WITH rankPerPeriod FILL-BACK (#552 COWORK #58, JD).
 *
 * A rankPerPeriod field (a total ahead of its component) resolves each period
 * by chain rank, so the total wins wherever it is tagged. Measured over all
 * 2,532 registrants, that alone EMPTIED 37 cells in 25 filers (FIGR, UBER,
 * RCL…): a quarter derived by differencing now met the total on one frame and
 * the component on the other, and a mixed-concept difference is refused. So a
 * second reading with the old newest-concept preference fills exactly those
 * empty cells and nothing else: never a cell the per-period rule filled. Run
 * only for a filer that tags two or more concepts of such a field -- the only
 * case where the two readings can differ.
 */
// ── A PROXY STATEMENT DOES NOT OVERRIDE A FINANCIAL STATEMENT (earnings audit r2) ──
// Since 2023 the pay-versus-performance table puts NetIncomeLoss (and
// sometimes revenue) in DEF 14A / PRE 14A. companyfacts carries those rows, and
// a proxy is filed AFTER the 10-K, so newest-filed made it win the frame:
//   SCHW FY2021-25 read 5.9M .. 8.9M (the proxy tagged millions as units),
//   against the 10-K's 5,855M .. 8,852M;
//   MET FY2022 read 2,354M (the proxy's net income to common), against the
//   10-K's 5,284M (restated); DELL FY2022-25 read the proxy's figures too;
//   ONTO's proxy rows on calendar-year dates (0.1M) displaced its 52/53-week
//   fiscal years, 2-5 days off, so FY2020-23 read blank.
// So a proxy row is dropped wherever the same concept has a statement row
// (any other form) for that frame, within FRAME_SLACK_DAYS at both ends. A
// frame ONLY a proxy carries is kept: BLK's FY2021 and PNFP's FY2021-22 are
// filed under their former CIKs, and the proxy is the one source here (BLK's
// proxy matches its 10-K on every year both carry). Dropped once, here, so
// every reader below sees the same rows.
const PROXY_FORM = /^(PRE|DEF|DEFA|DEFR|DEFM|PREM|DEFC|PREC)\s?14[AC]/i;
const FRAME_SLACK_DAYS = 10;

export function withoutProxyRows(facts: CompanyFacts): CompanyFacts {
  const src = facts?.facts;
  if (!src) return facts;
  type R = { form?: string; start?: string; end?: string };
  const day = (d?: string) => (d ? Date.parse(d) / 86_400_000 : NaN);
  const near = (a?: string, b?: string) => (!a && !b) || Math.abs(day(a) - day(b)) <= FRAME_SLACK_DAYS;
  let touched = false;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [ns, concepts] of Object.entries(src)) {
    const nsOut: Record<string, unknown> = {};
    for (const [tag, def] of Object.entries(concepts ?? {})) {
      const units = (def as { units?: Record<string, R[]> })?.units;
      if (!units) { nsOut[tag] = def; continue; }
      const statements = Object.values(units).flat().filter((r) => !PROXY_FORM.test(r?.form ?? ""));
      let changed = false;
      const kept: Record<string, unknown[]> = {};
      for (const [u, rows] of Object.entries(units)) {
        const k = (rows ?? []).filter((r) => !PROXY_FORM.test(r?.form ?? "")
          || !statements.some((t) => near(t.start, r.start) && near(t.end, r.end)));
        if (k.length !== (rows ?? []).length) changed = true;
        if (k.length) kept[u] = k;
      }
      if (!changed) { nsOut[tag] = def; continue; }
      touched = true;
      if (Object.keys(kept).length) nsOut[tag] = { ...(def as object), units: kept };
    }
    out[ns] = nsOut;
  }
  return touched ? ({ ...facts, facts: out } as CompanyFacts) : facts;
}

export function extractCompanyFacts(symbol: string, factsIn: CompanyFacts, opts: ExtractOpts = {}): ExtractResult {
  const facts = withoutProxyRows(factsIn);
  const primary = extractCompanyFactsWith(symbol, facts, opts, false);
  const ranked = SEC_FIELDS.filter((f) => f.rankPerPeriod && taggedConcepts(facts, f) > 1);
  if (!ranked.length) return primary;
  const fallback = extractCompanyFactsWith(symbol, facts, opts, true);
  const idx = ranked.map((f) => SEC_FIELD_INDEX[f.key]);
  for (const key of ["quarters", "years"] as const) {
    const byPeriod = new Map(fallback[key].map((p) => [`${p.start}|${p.end}`, p]));
    for (const p of primary[key]) {
      const alt = byPeriod.get(`${p.start}|${p.end}`);
      if (!alt) continue;
      for (const i of idx) if (p.values[i] == null && alt.values[i] != null) p.values[i] = alt.values[i];
    }
  }
  return primary;
}

/** How many of a field's chain concepts this payload publishes, either namespace. */
function taggedConcepts(facts: CompanyFacts, field: FieldDef): number {
  const sources: { ns: string; chain: string[] }[] = [{ ns: field.taxonomy, chain: field.chain }];
  if (field.ifrsChain?.length) sources.push({ ns: "ifrs-full", chain: field.ifrsChain });
  let n = 0;
  for (const { ns, chain } of sources) for (const tag of chain) if (facts.facts?.[ns]?.[tag]) n++;
  return n;
}

function extractCompanyFactsWith(
  symbol: string,
  facts: CompanyFacts,
  opts: ExtractOpts,
  /** The fallback reading: a rankPerPeriod field keeps the newest-concept preference. */
  ignoreRankPerPeriod: boolean
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

  const splitFacts = readSplitFacts(facts);
  // The filer's quarter calendar, decided once like the currency. See sixteenWeekCalendar.
  const calendar: QuarterCalendar = sixteenWeekCalendar(facts) ? "sixteen-week" : "standard";

  // SPLIT SG&A, SUMMED BEFORE ANY FIELD IS READ, so the YTD differencing and
  // the chain ranking treat it like any other row. See withSummedSga.
  facts = withSummedSga(facts);

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
      // A rankPerPeriod field (a total ahead of its component) takes no
      // preference: chain rank decides each period. See FieldDef.rankPerPeriod.
      field.rankPerPeriod && !ignoreRankPerPeriod ? null : preferredTag(all)
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

  // ONE DIFFERENCING ROUTINE, RUN TWICE: for the real fields, and for the
  // revenue fallback chain into cells of its own (see REVENUE_FALLBACK_CHAIN).
  // The parameters shadow the outer names on purpose, so the loop below reads
  // exactly as it did before it was wrapped.
  const runCumulative = (
    fields: FieldDef[],
    buckets: Map<string, Bucket>,
    preferred: Map<string, string | null>,
    quarterCells: Map<string, Map<string, FieldValue>>,
    yearCells: Map<string, Map<string, FieldValue>>,
    quarterMeta: Map<string, { start: string; row: FactRow }>,
    yearMeta: Map<string, { start: string; row: FactRow }>,
    notes: string[],
    ytdSink?: Map<string, { start: string; end: string; n: number; row: FactRow; cells: Map<string, FieldValue> }>,
  ) => {
  for (const field of fields) {
    const bucket = buckets.get(field.key)!;

    // Cumulative frames grouped by the fiscal year they start: a 3M, 6M, 9M and
    // FY row for one year all share a `start`. Q4 = FY - 9M falls out of this
    // with no special case, which is trap 4 handled structurally.
    type Cand = NonNullable<ReturnType<typeof resolve>>;
    const byStart = new Map<string, { end: string; n: number; best: Cand; cands: Cand[] }[]>();

    for (const [, cands] of bucket) {
      const best = resolve(cands, preferred.get(field.key), field.oneConceptPerFiler);
      if (!best?.row.start || !best.row.end) continue;
      const n = quartersCovered(spanDays(best.row.start, best.row.end), calendar);
      if (n === null) continue;
      const list = byStart.get(best.row.start);
      const entry = { end: best.row.end, n, best, cands };
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

        // A SIX- OR NINE-MONTH FRAME, AS FILED, kept aside for `ytd` only; it
        // never becomes a quarter or a year.
        if (ytdSink && (f.n === 2 || f.n === 3)) {
          const k = `${start}|${f.end}`;
          let y = ytdSink.get(k);
          if (!y) { y = { start, end: f.end, n: f.n, row: f.best.row, cells: new Map() }; ytdSink.set(k, y); }
          y.cells.set(field.key, {
            val: f.best.row.val!, tag: f.best.tag, ns: f.best.ns, unit: f.best.unit, derived: "as-filed",
            covers: [start, f.end],
          });
        }

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
        //
        // UNLESS ONE SIDE ALSO FILED THE OTHER'S CONCEPT (audit r4, FOXA): its
        // FY resolves to NetIncomeLoss while its 3M, 6M and 9M carry only
        // ProfitLoss, and the 10-K files ProfitLoss for the year too (1,727M).
        // The difference is then taken on that common concept, the later
        // frame's first (the quarters' own measure), so both operands are one
        // concept and the quarter reads 1,727 - 1,031 = 696M.
        let [hi, lo] = [f.best, prior.best];
        if (conceptKey(lo) !== conceptKey(hi)) {
          const sameAs = (cs: Cand[], k: string) => resolve(cs.filter((c) => conceptKey(c) === k));
          const altHi = sameAs(f.cands, conceptKey(lo));
          const altLo = altHi ? null : sameAs(prior.cands, conceptKey(hi));
          if (!altHi && !altLo) {
            notes.push(
              `${field.key} ${start}..${f.end}: concept changed mid-year ` +
                `(${conceptKey(prior.best)} -> ${conceptKey(f.best)}), not differenced`
            );
            continue;
          }
          if (altHi) hi = altHi;
          else lo = altLo!;
          notes.push(
            `${field.key} ${start}..${f.end}: concept changed mid-year ` +
              `(${conceptKey(prior.best)} -> ${conceptKey(f.best)}); differenced on ${conceptKey(hi)}, filed on both frames`
          );
        }
        const m = cell(quarterCells, quarterMeta);
        // The quarter's own start is the prior frame's end, not the year's.
        quarterMeta.set(f.end, { start: prior.end, row: hi.row });
        m.set(field.key, {
          val: hi.row.val! - lo.row.val!,
          tag: hi.tag,
          ns: hi.ns,
          unit: hi.unit,
          derived: "differenced",
          covers: [prior.end, f.end],
          from: [prior.end, f.end],
          operand: { val: lo.row.val!, covers: [start, prior.end] },
        });
      }
    }
  }

  };
  const ytdFrames = new Map<string, { start: string; end: string; n: number; row: FactRow; cells: Map<string, FieldValue> }>();
  runCumulative(cumulativeFields(), buckets, preferred, quarterCells, yearCells, quarterMeta, yearMeta, notes, ytdFrames);

  // ── THE REVENUE FALLBACK, ONLY WHERE THE LINE IS INCOMPLETE ──────────────
  // Same rows, same differencing, a different chain, and its own cells: a
  // period the predicate does not flag cannot be touched, by construction. A
  // fallback that still sits below operating (or pre-tax) income resolves
  // nothing, so the period keeps its own figure and the pages keep refusing it.
  {
    const revenueField = SEC_FIELDS.find((f) => f.key === "revenue")!;
    const fbField: FieldDef = { ...revenueField, chain: [...REVENUE_FALLBACK_CHAIN], ifrsChain: undefined };
    const fbRows = rowsForField(facts, fbField, new Set<string>(), currency);
    const fbBucket: Bucket = new Map();
    for (const c of fbRows) {
      const k = periodKey(c.row);
      const list = fbBucket.get(k);
      if (list) list.push(c);
      else fbBucket.set(k, [c]);
    }
    const fbQuarter = new Map<string, Map<string, FieldValue>>();
    const fbYear = new Map<string, Map<string, FieldValue>>();
    runCumulative(
      [fbField], new Map([["revenue", fbBucket]]), new Map([["revenue", preferredTag(fbRows)]]),
      fbQuarter, fbYear, new Map(), new Map(), [],
    );
    // THE LINE AS TAGGED, for each period this fallback rewrites. The
    // total-over-contract rule below judges the filer's concept on these, not
    // on the rescued cells: see `asTaggedRevenue`.
    const taggedBefore = new Map<Map<string, FieldValue>, FieldValue>();
    for (const [cells, fbCells] of [[quarterCells, fbQuarter], [yearCells, fbYear]] as const) {
      for (const [end, m] of cells) {
        const rev = m.get("revenue")?.val ?? null;
        const op = m.get("operatingIncome")?.val ?? null;
        const pre = m.get("preTaxIncome")?.val ?? null;
        if (!revenueLineIncompleteValues(rev, op, pre)) continue;
        const fb = fbCells.get(end)?.get("revenue");
        const bar = op ?? pre;
        if (!fb || fb.val == null || bar == null || fb.val < bar) continue;
        taggedBefore.set(m, m.get("revenue")!);
        m.set("revenue", fb);
        notes.push(`revenue ${end}: tagged line ${rev} is below ${op != null ? "operating" : "pre-tax"} income ${bar}; ${fb.tag} ${fb.val} used`);
      }
    }

    // ── THE FILER'S TOTAL OVER ITS CONTRACT LINE (#552 COWORK #192 ruling A) ──
    // AFRM's contract revenue ($1.11B FY2025) is one line of a $3.22B total,
    // complete by the predicate above (no income exceeds it), so the page
    // showed the sub-line. Where the filer's NEWEST period carries both and
    // `Revenues` is more than REVENUE_TOTAL_OVER_CONTRACT larger, `Revenues`
    // becomes the filer's ONE revenue concept: every period takes it, and a
    // period without it reads Not reported rather than mixing measures.
    // EXCISE-TAGGED FILERS ARE EXCLUDED: their `Revenues` carries other income
    // or derivative gains (COP, CEG, MELI in the #198 census). This knowingly
    // supersedes #535 COWORK #12 ruling A for this case only.
    // ── OPTION G: A GAP THAT IS ITSELF REVENUE (#552 COWORK #219) ──────────
    // Beside the shipped test above (no excise, and more than 5%), `Revenues`
    // also wins where the newest quarter's gap over the contract line equals
    // a concept tagged as revenue (revenueGapConcept): MELI's not-from-contract
    // revenue, CEG's, PAYX's operating interest. Excise-tagged and sub-5% filers
    // are reached ONLY through this, so CVX's and COP's "revenues and other
    // income" and DVN's hedging gains stay where they are.
    const excise = filerTagsExcise(facts);
    const gapConcept = revenueGapConcept(facts, currency);
    // ── THE DERIVED TOTAL (#552 COWORK #219, LUNR) ──────────────────────────
    // For a G filer whose gap is REVENUE NOT FROM CONTRACTS (the ruling's
    // words), a period with the contract line and that line filed for the
    // same frame but no `Revenues` takes their SUM as its total, marked
    // computed. Without it the floor kept LUNR on the contract line (older
    // quarters lack `Revenues`), understating its revenue by the gap. Not for a
    // lease-income or interest gap: AHR's floor still holds it. Built in
    // copies, so nothing outside this rule sees a derived total.
    const totalQuarter = new Map(fbQuarter), totalYear = new Map(fbYear);
    if (gapConcept && /^RevenueNotFromContractWithCustomer/.test(gapConcept)) {
      const kField: FieldDef = { ...revenueField, chain: [gapConcept], ifrsChain: undefined };
      const kRows = rowsForField(facts, kField, new Set<string>(), currency);
      const kBucket: Bucket = new Map();
      for (const c of kRows) {
        const k = periodKey(c.row);
        const list = kBucket.get(k);
        if (list) list.push(c);
        else kBucket.set(k, [c]);
      }
      const kQuarter = new Map<string, Map<string, FieldValue>>();
      const kYear = new Map<string, Map<string, FieldValue>>();
      runCumulative([kField], new Map([["revenue", kBucket]]), new Map([["revenue", gapConcept]]), kQuarter, kYear, new Map(), new Map(), []);
      for (const [cells, totals, kCells] of [[quarterCells, totalQuarter, kQuarter], [yearCells, totalYear, kYear]] as const) {
        for (const [end, m] of cells) {
          const t = totals.get(end)?.get("revenue");
          if (t?.tag === "Revenues" && t.val != null) continue;
          const c = m.get("revenue"), k = kCells.get(end)?.get("revenue");
          if (!c || c.tag !== CONTRACT_REVENUE_TAG || c.val == null || !k || k.val == null) continue;
          // THE SAME FRAME, never a quarter's contract line beside a year's gap.
          if (!c.covers || !k.covers || c.covers[0] !== k.covers[0] || c.covers[1] !== k.covers[1]) continue;
          const row = new Map(totals.get(end) ?? []);
          row.set("revenue", { val: c.val + k.val, tag: DERIVED_TOTAL_TAG, ns: c.ns, unit: c.unit, derived: "computed", covers: c.covers });
          totals.set(end, row);
        }
      }
    }
    const isTotal = (t: FieldValue | undefined) => Boolean(t && (t.tag === "Revenues" || t.tag === DERIVED_TOTAL_TAG) && t.val != null);
    // ── THE CONCEPT IS JUDGED ON THE LINE AS TAGGED (earnings audit r1) ─────
    // The fallback above has already replaced the contract line with
    // `Revenues` on every period whose operating (or pre-tax) income exceeds
    // it. Judged on those cells, a filer whose NEWEST period was rescued never
    // showed the contract line here, so the rule below never fired and every
    // period the fallback did not reach kept the sub-line: KEY's FY2023
    // ($1.44B) and FY2024 ($1.64B, a loss year) beside $7.3B and $7.5B; CRCL's
    // FY2025 ($109.8M of $2.75B), Q2 FY2025 and derived Q4 FY2024. One series,
    // two concepts. Reading the cell as tagged lets the rule see the filer's
    // own concept and move the whole series to the total.
    const asTaggedRevenue = (row: Map<string, FieldValue> | undefined) =>
      row ? taggedBefore.get(row) ?? row.get("revenue") : undefined;
    {
      const newest = [...quarterCells.keys(), ...yearCells.keys()].sort().at(-1);
      // LIKE FOR LIKE: a quarter against a quarter, else a year against a
      // year -- never one duration against the other (ADP's $21.9B fiscal
      // year against its $5.47B fourth quarter, caught by the round-2 census).
      const pairAt = (cells: typeof quarterCells, fbCells: typeof fbQuarter) => {
        const r = newest ? asTaggedRevenue(cells.get(newest)) : undefined;
        const f = newest ? fbCells.get(newest)?.get("revenue") : undefined;
        return r && f ? { rev: r, fb: f } : null;
      };
      const pair = pairAt(quarterCells, totalQuarter) ?? pairAt(yearCells, totalYear);
      const rev = pair?.rev;
      const fb = pair?.fb;
      // THE FLOOR (#552 COWORK #194): the total must cover at least as many of
      // the newest 8 quarters, AND of the newest 4 years, as the contract line
      // it would replace. Otherwise the one-concept rule would leave more
      // periods unreported than it fixes (BANC, GLP, HRI in the round-2
      // census), and the filer keeps its old concept. A derived total counts.
      const covers = (cells: typeof quarterCells, fbCells: typeof fbQuarter, n: number) => {
        const ends = [...cells.keys()].sort().reverse().slice(0, n);
        const total = ends.filter((e) => isTotal(fbCells.get(e)?.get("revenue"))).length;
        const contract = ends.filter((e) => { const c = asTaggedRevenue(cells.get(e)); return c?.tag === CONTRACT_REVENUE_TAG && c.val != null; }).length;
        return total >= contract;
      };
      const floorHolds = covers(quarterCells, totalQuarter, 8) && covers(yearCells, totalYear, 4);
      const shippedTest = !excise && fb?.tag === "Revenues" && fb.val != null && rev?.val != null && fb.val > rev.val * REVENUE_TOTAL_OVER_CONTRACT;
      const gapTest = gapConcept != null && fb?.val != null && rev?.val != null && fb.val > rev.val;
      const qualifies = Boolean(rev && rev.tag === CONTRACT_REVENUE_TAG && rev.val != null && rev.val > 0 && isTotal(fb) && (shippedTest || gapTest));
      if (qualifies && !floorHolds) {
        notes.push(`revenue: Revenues exceeds the contract line on ${newest} but covers fewer of the newest 8 quarters / 4 years; the contract line is kept (floor)`);
      } else if (qualifies) {
        let moved = 0, derived = 0, refused = 0;
        for (const [cells, fbCells] of [[quarterCells, totalQuarter], [yearCells, totalYear]] as const) {
          for (const [end, m] of cells) {
            const total = fbCells.get(end)?.get("revenue");
            if (total && isTotal(total)) { m.set("revenue", total); moved++; if (total.tag === DERIVED_TOTAL_TAG) derived++; }
            else if (m.has("revenue")) { m.delete("revenue"); refused++; }
          }
        }
        notes.push(shippedTest
          ? `revenue: Revenues ${fb!.val} exceeds the contract line ${rev!.val} by more than ${Math.round((REVENUE_TOTAL_OVER_CONTRACT - 1) * 100)}% on ${newest}; Revenues used for ${moved} period(s), ${refused} without it left unreported`
          : `revenue: the gap of Revenues ${fb!.val} over the contract line ${rev!.val} on ${newest} is ${gapConcept} (revenue); Revenues used for ${moved} period(s) (${derived} as contract + ${gapConcept}), ${refused} without it left unreported`);
      }
    }

    // ── A BANK'S QUARTERS: NO REVENUE LINE AT ALL (#552 COWORK #240 (b)) ────
    // JPM, WFC, BNY and most banks tag no contract-revenue line and no
    // quarterly `Revenues`; the quarter's total is filed only as
    // `RevenuesNetOfInterestExpense`. The fallback above needs a tagged line
    // to judge, so it never fired and every quarter read "Not captured" while
    // the 10-K's `Revenues` filled the years. LAST RESORT, PER SERIES: only
    // where none of the newest SEC_QUARTER_WINDOW quarters (or newest
    // LAST_RESORT_YEARS years) carries any revenue, and only into periods with
    // none -- a filer with a line keeps it, so no tagged figure moves. A value
    // below the period's own operating (or pre-tax) income is refused, as the
    // fallback refuses one.
    // The utility concept after it, under the same rule, so it fills only a
    // series the bank concept left empty.
    for (const lastResortTag of [LAST_RESORT_REVENUE_TAG, UTILITY_REVENUE_TAG]) {
      const lrField: FieldDef = { ...revenueField, chain: [lastResortTag], ifrsChain: undefined };
      const lrRows = rowsForField(facts, lrField, new Set<string>(), currency);
      if (lrRows.length) {
        const lrBucket: Bucket = new Map();
        for (const c of lrRows) {
          const k = periodKey(c.row);
          const list = lrBucket.get(k);
          if (list) list.push(c);
          else lrBucket.set(k, [c]);
        }
        const lrQuarter = new Map<string, Map<string, FieldValue>>();
        const lrYear = new Map<string, Map<string, FieldValue>>();
        runCumulative(
          [lrField], new Map([["revenue", lrBucket]]), new Map([["revenue", lastResortTag]]),
          lrQuarter, lrYear, new Map(), new Map(), [],
        );
        let filled = 0;
        for (const [cells, lrCells, window] of [[quarterCells, lrQuarter, SEC_QUARTER_WINDOW], [yearCells, lrYear, LAST_RESORT_YEARS]] as const) {
          const newest = [...cells.keys()].sort().reverse().slice(0, window);
          if (newest.some((e) => cells.get(e)?.get("revenue")?.val != null)) continue;
          for (const [end, m] of cells) {
            if (m.get("revenue")?.val != null) continue;
            const lr = lrCells.get(end)?.get("revenue");
            if (!lr || lr.val == null || lr.val <= 0) continue;
            const bar = m.get("operatingIncome")?.val ?? m.get("preTaxIncome")?.val ?? null;
            if (bar != null && lr.val < bar) continue;
            m.set("revenue", lr);
            filled++;
          }
        }
        if (filled) notes.push(`revenue: no revenue line tagged; ${lastResortTag} used for ${filled} period(s) (last resort)`);
      }
    }

    // ── A BANK WITH NO REVENUE TOTAL AT ALL (#552 COWORK #241) ──────────────
    // BNY, COLB, WSFS, UBSI, AX, FLG, TBBK tag no revenue total of any kind,
    // not even RevenuesNetOfInterestExpense: the income statement's two halves,
    // net interest income and noninterest income, are its revenue. Their SUM,
    // marked computed, from the SAME frame, under the same per-series rule as
    // the last resort above (none of the newest periods carries any revenue,
    // after that fill) and only into periods with none. Both halves or no cell.
    {
      const halves = BANK_REVENUE_HALVES.map((tag) => {
        const f: FieldDef = { ...revenueField, chain: [tag], ifrsChain: undefined };
        const rows = rowsForField(facts, f, new Set<string>(), currency);
        const bucket: Bucket = new Map();
        for (const c of rows) {
          const k = periodKey(c.row);
          const list = bucket.get(k);
          if (list) list.push(c);
          else bucket.set(k, [c]);
        }
        const qc = new Map<string, Map<string, FieldValue>>(), yc = new Map<string, Map<string, FieldValue>>();
        if (rows.length) runCumulative([f], new Map([["revenue", bucket]]), new Map([["revenue", tag]]), qc, yc, new Map(), new Map(), []);
        return { qc, yc };
      });
      let summed = 0;
      for (const [cells, kind, window] of [[quarterCells, "qc", SEC_QUARTER_WINDOW], [yearCells, "yc", LAST_RESORT_YEARS]] as const) {
        const newest = [...cells.keys()].sort().reverse().slice(0, window);
        if (newest.some((e) => cells.get(e)?.get("revenue")?.val != null)) continue;
        for (const [end, m] of cells) {
          if (m.get("revenue")?.val != null) continue;
          const [a, b] = halves.map((h) => h[kind].get(end)?.get("revenue"));
          if (!a || !b || a.val == null || b.val == null || !sameFrame(a.covers, b.covers)) continue;
          const sum = a.val + b.val;
          if (sum <= 0) continue;
          const bar = m.get("operatingIncome")?.val ?? m.get("preTaxIncome")?.val ?? null;
          if (bar != null && sum < bar) continue;
          m.set("revenue", {
            val: sum, tag: null, ns: a.ns, unit: a.unit, derived: "computed",
            covers: a.covers, computedFrom: [BANK_REVENUE_HALVES[0], BANK_REVENUE_HALVES[1]],
          });
          summed++;
        }
      }
      if (summed) notes.push(`revenue: no revenue total tagged; ${BANK_REVENUE_HALVES.join(" + ")} used for ${summed} period(s) (computed)`);
    }

    // ── A BANK'S REVENUE IS ITS NET REVENUE (earnings audit r2) ─────────────
    // HBAN's revenue read $1,562M, its 606 fee line, beside $5,991M of net
    // interest income; 55 filers sat below their own net interest income. The
    // block above only fills a bank whose newest periods carry NO revenue, and
    // these carry a fee line (or a `Revenues` that is itself a sub-line, a zero,
    // or gross of interest expense), so it never reached them.
    //
    // A NET TOTAL, for one frame, is a revenue within BANK_NET_TOLERANCE of
    // net interest income plus noninterest income, or a filed
    // RevenuesNetOfInterestExpense, or a filed `Revenues` at or above NII,
    // within BANK_NET_GAINS_TOLERANCE of them (it carries the securities gains
    // and losses the halves may not: STT, CASH, UCB, WSFS).
    //
    // A FILER THAT TAGS BOTH HALVES, with any period whose revenue (as every
    // rule above left it) is not a net total, moves its series to net revenue,
    // frame by frame. A period already on a net total keeps it, and so does
    // one with no halves to judge it by; any other takes:
    //   1. RevenuesNetOfInterestExpense as filed, when a net total (or the
    //      halves are not both filed for that frame);
    //   2. `Revenues` as filed, when a net total;
    //   3. the two halves' sum, marked computed.
    // A period with none of these reads Not reported rather than keep the fee
    // line beside net revenue, so a series cannot carry two bases. The halves
    // and both totals are differenced like any concept, so a derived Q4 is on
    // the same basis as its year.
    //
    // IT REPLACES; IT BACKFILLS ONLY AN EMPTY FRAME WITH BOTH HALVES FILED. A
    // period newer than every valued one is filled as before (FITB, OFG, UBSI:
    // the newest years blank). An older period is filled only when it has no
    // revenue cell at all and both halves are filed for its frame (MCHB's
    // FY2020-23 and its 2023-24 quarters, owner ruling 2026-10-20). A period
    // withheld upstream keeps its marker and stays blank (USB's 2020-21,
    // FCNCA's 2023 quarters), and a bank already on net revenue must not move
    // because one stray period somewhere tripped the test.
    //
    // USD FILERS ONLY. A 20-F bank's halves and its `Revenues` need not share a
    // unit or a presentation (HDB, MFG, MUFG), so the 2% test means nothing
    // there; like minorityInterestAt, the block reads US filers.
    //
    // AFTER #913's total-over-contract rule, and it cannot fight it: that rule
    // only chooses between the contract line and `Revenues`; this one checks
    // whatever was chosen against the bank's own net revenue and replaces it
    // only when it is off. A bank already on a net total (KEY's `Revenues`
    // within 0.5%, SYF's computed halves) is untouched.
    {
      const seriesOf = (tag: string) => {
        const f: FieldDef = { ...revenueField, chain: [tag], ifrsChain: undefined };
        const rows = rowsForField(facts, f, new Set<string>(), currency);
        const bucket: Bucket = new Map();
        for (const c of rows) {
          const k = periodKey(c.row);
          const list = bucket.get(k);
          if (list) list.push(c);
          else bucket.set(k, [c]);
        }
        const qc = new Map<string, Map<string, FieldValue>>(), yc = new Map<string, Map<string, FieldValue>>();
        if (rows.length) runCumulative([f], new Map([["revenue", bucket]]), new Map([["revenue", tag]]), qc, yc, new Map(), new Map(), []);
        return { qc, yc, n: rows.length };
      };
      const [nii, non] = BANK_REVENUE_HALVES.map(seriesOf);
      if (currency === "USD" && nii.n && non.n) {
        const rnoie = seriesOf(LAST_RESORT_REVENUE_TAG), rv = seriesOf("Revenues");
        const kinds = [[quarterCells, "qc"], [yearCells, "yc"]] as const;
        const halvesAt = (kind: "qc" | "yc", end: string) => {
          const a = nii[kind].get(end)?.get("revenue"), b = non[kind].get(end)?.get("revenue");
          return a && b && a.val != null && b.val != null && sameFrame(a.covers, b.covers) ? { a, sum: a.val + b.val } : null;
        };
        const filedHalvesAt = (kind: "qc" | "yc", end: string) => {
          const h = halvesAt(kind, end);
          const b = non[kind].get(end)?.get("revenue");
          return h && h.sum > 0 && h.a.derived === "as-filed" && b?.derived === "as-filed" ? h : null;
        };
        const within = (v: number, sum: number, tol: number) => Math.abs(v - sum) <= tol * Math.abs(sum);
        type Halves = NonNullable<ReturnType<typeof halvesAt>>;
        const netTotal = (c: FieldValue, h: Halves) => {
          const v = c.val as number;
          if (within(v, h.sum, BANK_NET_TOLERANCE)) return true;
          if (!within(v, h.sum, BANK_NET_GAINS_TOLERANCE)) return false;
          return c.tag === LAST_RESORT_REVENUE_TAG || (c.tag === "Revenues" && v >= (h.a.val as number));
        };
        // A QUARTER TAKES ITS YEAR'S VERDICT. A loss or gain lands in one
        // quarter (STT's 294M repositioning loss, all in Q3 2023: filed 2,691M
        // against halves of 2,985M), so a quarter on the same concept as a
        // fiscal year that is a net total is one too, filed or differenced
        // from that year; moving it alone would put the year and its quarters
        // on two bases. A quarter after the newest year is judged on its own.
        const yearIsNet = (c: FieldValue) => {
          const [qs, qe] = c.covers ?? [null, null];
          if (!qs || !qe) return false;
          for (const [end, m] of yearCells) {
            const y = m.get("revenue");
            if (y?.val == null || !y.covers || y.tag !== c.tag || y.ns !== c.ns) continue;
            if (!(y.covers[0] <= qs && qe <= y.covers[1])) continue;
            const h = halvesAt("yc", end);
            return !!h && sameFrame(y.covers, h.a.covers) && netTotal(y, h);
          }
          return false;
        };
        // Whether a valued period stays: no halves to judge it, a different
        // frame, a net total, or a quarter of a net-total year.
        const stays = (kind: "qc" | "yc", end: string, c: FieldValue) => {
          const h = halvesAt(kind, end);
          if (!h || !(h.sum > 0) || !sameFrame(c.covers, h.a.covers) || netTotal(c, h)) return true;
          return kind === "qc" && yearIsNet(c);
        };
        const netAt = (kind: "qc" | "yc", end: string): FieldValue | null => {
          const h = halvesAt(kind, end);
          const r = rnoie[kind].get(end)?.get("revenue");
          if (r?.val != null && r.val > 0 && (!h || netTotal(r, h))) return r;
          if (!h || !(h.sum > 0)) return null;
          const t = rv[kind].get(end)?.get("revenue");
          if (t?.val != null && netTotal(t, h) && sameFrame(t.covers, h.a.covers)) return t;
          return {
            val: h.sum, tag: null, ns: h.a.ns, unit: h.a.unit, derived: "computed",
            covers: h.a.covers, computedFrom: [BANK_REVENUE_HALVES[0], BANK_REVENUE_HALVES[1]],
          };
        };
        let off = 0;
        for (const [cells, kind] of kinds) {
          for (const [end, m] of cells) {
            const c = m.get("revenue");
            if (c?.val != null && !stays(kind, end, c)) off++;
          }
        }
        if (off) {
          let moved = 0, computed = 0, blanked = 0;
          for (const [cells, kind] of kinds) {
            let newestValued = "";
            for (const [end, m] of cells) if (m.get("revenue")?.val != null && end > newestValued) newestValued = end;
            for (const [end, m] of cells) {
              const c = m.get("revenue");
              // AN OLDER PERIOD WITH NO REVENUE CELL AT ALL takes net revenue when
              // both halves are FILED for its frame, as filed, not differenced
              // (MCHB FY2020-23, BPOP's 2024-25 Q2/Q3). A Q4 whose halves exist only
              // as year minus nine months stays blank (owner ruling 2026-10-20), and
              // so does one the rules above withheld: that cell exists, null-valued.
              if (c?.val == null && end <= newestValued && (m.has("revenue") || !filedHalvesAt(kind, end))) continue;
              if (c?.val != null && stays(kind, end, c)) continue;
              const t = netAt(kind, end);
              if (t) { m.set("revenue", t); moved++; if (t.derived === "computed") computed++; }
              else if (m.has("revenue")) { m.delete("revenue"); blanked++; }
            }
          }
          notes.push(`revenue: bank net basis — ${off} period(s) not a net total of ${BANK_REVENUE_HALVES.join(" + ")}; net revenue used for ${moved} period(s) (${computed} computed), ${blanked} without it left unreported`);
        }
      }
    }

    // ── THE OWNER'S TOTAL (REVENUE_TOTAL_RULINGS, earnings audit r2) ─────────
    // After every other revenue choice, so none of them can put the contract
    // line back; before the derived-Q4 check, which then judges the total.
    {
      const ruled = REVENUE_TOTAL_RULINGS[String(symbol ?? "").toUpperCase()];
      if (ruled) {
        const f: FieldDef = { ...revenueField, chain: [ruled], ifrsChain: undefined };
        const rows = rowsForField(facts, f, new Set<string>(), currency);
        const bucket: Bucket = new Map();
        for (const c of rows) {
          const k = periodKey(c.row);
          const list = bucket.get(k);
          if (list) list.push(c);
          else bucket.set(k, [c]);
        }
        const qc = new Map<string, Map<string, FieldValue>>(), yc = new Map<string, Map<string, FieldValue>>();
        if (rows.length) runCumulative([f], new Map([["revenue", bucket]]), new Map([["revenue", ruled]]), qc, yc, new Map(), new Map(), []);
        let moved = 0, blanked = 0;
        for (const [cells, ruledCells] of [[quarterCells, qc], [yearCells, yc]] as const) {
          for (const [end, m] of cells) {
            const t = ruledCells.get(end)?.get("revenue");
            if (t?.val != null && t.val > 0) {
              if (m.get("revenue")?.val !== t.val || m.get("revenue")?.tag !== t.tag) moved++;
              m.set("revenue", t);
            } else if (m.has("revenue")) { m.delete("revenue"); blanked++; }
          }
        }
        notes.push(`revenue: owner ruling — ${ruled} for every period; ${moved} period(s) moved, ${blanked} without it left unreported`);
      }
    }

    // ── A DERIVED Q4 THAT CROSSES SCOPES IS WITHHELD (#552 COWORK #196/#200) ──
    // AFTER every revenue choice above, so it judges the figure that would be
    // stored. Only a DIFFERENCED revenue cell can be judged: an as-filed
    // quarter is the filer's own number. Siblings are the quarters inside the
    // nine months the Q4 was differenced from (the 372-day window covers a
    // 53-week year). The second total is the fallback chain's own differenced
    // cells, and only when it is a DIFFERENT concept from the one judged.
    const siblingsOf = (cells: typeof quarterCells, q4: FieldValue) => {
      const [nineEnd, q4End] = q4.covers ?? [null, null];
      if (!nineEnd || !q4End) return [];
      const floor = new Date(Date.parse(q4End) - 372 * DAY).toISOString().slice(0, 10);
      const out: number[] = [];
      for (const m of cells.values()) {
        const c = m.get("revenue");
        if (!c?.covers || c.val == null) continue;
        if (c.covers[1] <= nineEnd && c.covers[0] >= floor) out.push(c.val);
      }
      return out;
    };
    for (const [end, m] of quarterCells) {
      const q4 = m.get("revenue");
      if (!q4 || q4.derived !== "differenced" || q4.val == null) continue;
      const fb = fbQuarter.get(end)?.get("revenue");
      const total = fb && fb.val != null && `${fb.ns}|${fb.tag}` !== `${q4.ns}|${q4.tag}`
        ? { q4: fb.val, siblings: siblingsOf(fbQuarter, fb) }
        : null;
      // The nine months, recovered from the year it was differenced against —
      // only when the year is the SAME concept, so it is the same subtraction.
      const fy = yearCells.get(end)?.get("revenue");
      const nine = fy && fy.val != null && `${fy.ns}|${fy.tag}` === `${q4.ns}|${q4.tag}` ? fy.val - q4.val : null;
      const siblings = siblingsOf(quarterCells, q4);
      const verdict = q4RevenueScope(q4.val, siblings, total, nine);
      if (!verdict) continue;
      m.set("revenue", { ...q4, val: null, derived: "withheld" });
      notes.push(
        verdict === "negative"
          ? `revenue ${end}: derived Q4 ${q4.val} is negative; withheld`
          : verdict === "scope"
            ? `revenue ${end}: derived Q4 ${q4.val} is under ${DERIVED_Q4_FLOOR * 100}% of the year's other quarters while ${fb!.tag} gives ${fb!.val}; withheld (scope mismatch)`
            : `revenue ${end}: derived Q4 ${q4.val} is under ${DERIVED_Q4_FLOOR * 100}% of the year's other quarters and the nine months ${nine} differ from those quarters' sum ${siblings.reduce((a, b) => a + b, 0)}; withheld (scope mismatch)`
      );
    }
  }

  // ── A DIFFERENCED QUARTER IS ON THE BASIS OF THE QUARTERS BESIDE IT (audit r5) ──
  // A later filing can restate the earlier quarters (BAC's FY2026 10-Qs
  // recast Q1 and Q2 FY2025 to 28,247M and 27,443M, and its FY2025 10-K is on
  // that basis at 113,097M), while the nine months the Q4 is differenced from
  // is still the original 10-Q's 81,917M. 113,097 - 81,917 = 31,180M is then
  // a residual of two bases, not a quarter. So every differenced quarter's
  // operand is compared with the quarters shown for its span: off by more
  // than SAME_BASIS_TOLERANCE of the larger side, the quarter is withheld
  // with a note. Judged on the values as they stand before any is withheld,
  // so one withholding cannot hide another; a span whose quarters are not
  // all shown cannot be judged and is left as is. EPS is never differenced;
  // a computed EPS needs its net income, so a withheld one goes with it.
  {
    const verdicts: [Map<string, FieldValue>, string, FieldValue, number, number][] = [];
    for (const field of cumulativeFields()) {
      const cells = [...quarterCells.values()].map((m) => m.get(field.key)).filter((c): c is FieldValue => c != null);
      for (const [end, m] of quarterCells) {
        const q = m.get(field.key);
        if (!q || q.derived !== "differenced" || q.val == null || !q.operand) continue;
        const [s0, e0] = q.operand.covers;
        const n = quartersCovered(spanDays(s0, e0), calendar);
        const lo = Date.parse(s0) - 7 * DAY;
        const shown = cells.filter((c) => c.covers && c.val != null && c.covers[1] > s0 && c.covers[1] <= e0 && Date.parse(c.covers[0]) >= lo);
        if (n == null || shown.length !== n) continue;
        const sum = shown.reduce((a, c) => a + c.val!, 0);
        const scale = Math.max(Math.abs(q.operand.val), shown.reduce((a, c) => a + Math.abs(c.val!), 0));
        if (scale > 0 && Math.abs(sum - q.operand.val) / scale > SAME_BASIS_TOLERANCE) verdicts.push([m, end, q, q.operand.val, sum]);
      }
    }
    for (const [m, end, q, operand, sum] of verdicts) {
      const key = [...m.entries()].find(([, c]) => c === q)![0];
      m.set(key, { ...q, val: null, derived: "withheld" });
      notes.push(`${key} ${end}: derived quarter withheld; the total it was differenced from (${operand}, ${q.operand!.covers.join("..")}) is not on the basis of the quarters shown for that span (${sum})`);
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
      const n = quartersCovered(spanDays(best.row.start, best.row.end), calendar);
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

  // ── SHARE COUNTS ON A UNIT SLIP (#552 COWORK #192; CODE-A #199 §1) ───────
  // 45 filers store some periods' weighted shares in thousands or millions
  // (MCD, NMR, BBVA, NVMI …): net income ÷ (EPS × shares) comes out ~1,000 or
  // ~1/1,000,000 instead of ~1. The filer's OWN three figures for the period
  // prove the factor, so the count is rescaled only where that arithmetic
  // lands within SHARE_UNIT_SLIP_TOLERANCE of a power in SHARE_UNIT_SLIP_FACTORS
  // -- against an AS-FILED EPS only, never one this file computed. A period
  // whose proof fails is left exactly as filed. Runs BEFORE the ratio
  // fallback, so no EPS is ever computed from a slipped count.
  //
  // ── AND CORROBORATED, BECAUSE THE RATIO CANNOT SAY WHICH FIGURE SLIPPED ──
  // ~1/1,000 says EPS × shares is 1,000× net income -- the shares may be in
  // units where they should be thousands, or the NET INCOME may be the figure
  // on the slip. Rescaling the shares in the second case would corrupt a
  // correct count. So the rescaled count must also land within
  // SHARE_UNIT_SLIP_CORROBORATION of an independent count: the cover share
  // count (dei), or the median of the filer's own periods whose arithmetic
  // already closes at ~1. With neither, nothing is rescaled.
  const cover = readCoverShares(facts)?.val ?? null;
  const cleanMedian = (shareKey: "sharesBasic" | "sharesDiluted", epsKey: "epsBasic" | "epsDiluted") => {
    const vals: number[] = [];
    for (const cells of [quarterCells, yearCells]) for (const m of cells.values()) {
      const ni = m.get("netIncome")?.val, sh = m.get(shareKey)?.val, eps = m.get(epsKey);
      if (ni == null || ni === 0 || sh == null || sh <= 0 || !eps || eps.val == null || eps.val === 0 || eps.derived !== "as-filed") continue;
      if (Math.abs(ni / (eps.val * sh) - 1) <= SHARE_UNIT_SLIP_TOLERANCE) vals.push(sh);
    }
    vals.sort((a, b) => a - b);
    return vals.length ? vals[vals.length >> 1] : null;
  };
  const near = (x: number, ref: number | null) => ref !== null && ref > 0 && x / ref <= SHARE_UNIT_SLIP_CORROBORATION && ref / x <= SHARE_UNIT_SLIP_CORROBORATION;
  const medians = { sharesBasic: cleanMedian("sharesBasic", "epsBasic"), sharesDiluted: cleanMedian("sharesDiluted", "epsDiluted") };
  for (const cells of [quarterCells, yearCells]) {
    for (const [end, m] of cells) {
      const ni = m.get("netIncome")?.val ?? null;
      if (ni === null || ni === 0) continue;
      for (const [shareKey, epsKey] of [["sharesBasic", "epsBasic"], ["sharesDiluted", "epsDiluted"]] as const) {
        const sh = m.get(shareKey), eps = m.get(epsKey);
        if (!sh || sh.val == null || sh.val <= 0 || !eps || eps.val == null || eps.val === 0 || eps.derived !== "as-filed") continue;
        const f = unitSlipFactor(ni, eps.val, sh.val);
        if (f === null) continue;
        if (!near(sh.val * f, cover) && !near(sh.val * f, medians[shareKey])) {
          notes.push(`${shareKey} ${end}: ratio says x${f} but no independent count corroborates it; left as filed`);
          continue;
        }
        m.set(shareKey, { ...sh, val: sh.val * f });
        notes.push(`${shareKey} ${end}: ${sh.val} rescaled x${f} (net income ${ni} / (EPS ${eps.val} x shares) = ${(ni / (eps.val * sh.val)).toPrecision(4)})`);
      }
    }
  }

  // The ratio fallback, AFTER both loops because it reads their output.
  //
  // BOTH OPERANDS OR NEITHER. A quarter's earnings over a year's share count is
  // a wrong number that looks like a right one, so a missing denominator leaves
  // the cell null rather than reaching for the nearest available one. Q4 has no
  // filed three-month average, so Q4 EPS comes out null -- that is the cost of
  // refusing to derive the average, stated rather than hidden.
  // ── ONLY WHERE THE FILER'S OWN EPS CLOSES ON THAT RATIO (#552 COWORK #240 (a)) ──
  // CVNA (Up-C) files its per-Class-A EPS on the class axis, which companyfacts
  // drops, and an undimensioned weighted count of ~716M that is not that EPS's
  // basis: $183M / 716M rendered $0.26 against a filed $1.28. The filer's own
  // periods say so -- wherever it files EPS, net income / (EPS x shares) is far
  // from 1 (FY2025: 0.74). So the ratio is computed only for a filer whose every
  // filed EPS in the newest RATIO_CLOSE_QUARTERS quarters and RATIO_CLOSE_YEARS
  // years closes within RATIO_CLOSE_TOLERANCE; otherwise the QUARTER cells stay
  // null ("Not reported"). A filer that files no EPS at all keeps the ratio, as before.
  // ── A SPLIT CANNOT TRIP IT (#552 COWORK #245) ──────────────────────────
  // Where a period's EPS and share count were filed on two sides of a split,
  // net income / (EPS x shares) lands on the split ratio, not near 1. A ratio
  // within SPLIT_SHAPED_TOLERANCE of one of the FILER'S OWN split ratios (its
  // split facts, or its restated ÷ first-filed share counts), either way up,
  // is a basis difference, not a wrong share count, and does not trip the gate.
  const filerSplitRatios = [...splitFacts.map(([, r]) => r), ...shareRestatements(buckets.get("sharesBasic"), preferred.get("sharesBasic") ?? null).map(([, r]) => r)]
    .filter((r) => Number.isFinite(r) && r > 0 && Math.abs(Math.log(r)) > Math.log(1.2));
  const splitShaped = (r: number) => r > 0 && filerSplitRatios.some((k) => [k, 1 / k].some((x) => Math.abs(r / x - 1) <= SPLIT_SHAPED_TOLERANCE));
  const ratioCloses = (epsKey: string, numerator: string, denominator: string): boolean => {
    const recent = (cells: typeof quarterCells, n: number) =>
      [...cells.keys()].sort().reverse().slice(0, n).map((e) => cells.get(e)!);
    for (const m of [...recent(quarterCells, RATIO_CLOSE_QUARTERS), ...recent(yearCells, RATIO_CLOSE_YEARS)]) {
      const eps = m.get(epsKey), ni = m.get(numerator)?.val ?? null, sh = m.get(denominator)?.val ?? null;
      if (!eps || eps.derived !== "as-filed" || eps.val == null || eps.val === 0 || ni == null || ni === 0 || sh == null || sh <= 0) continue;
      const r = ni / (eps.val * sh);
      if (Math.abs(r - 1) > RATIO_CLOSE_TOLERANCE && !splitShaped(r)) return false;
    }
    return true;
  };
  // QUARTERS ONLY (#552 COWORK #240 (a) is scoped to the quarterly figure): a
  // year's computed EPS is left as it was -- FCX's computed years match its
  // reported EPS, and refusing them would remove right numbers.
  for (const field of asFiledOnlyFields()) {
    if (!field.ratioSource) continue;
    const { numerator, denominator } = field.ratioSource;
    const closes = ratioCloses(field.key, numerator, denominator);
    if (!closes) notes.push(`${field.key}: the filer's filed ${field.key} does not close on ${numerator} / ${denominator} within ${RATIO_CLOSE_TOLERANCE * 100}%; quarters not computed`);
    for (const cells of closes ? [quarterCells, yearCells] : [yearCells]) {
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

  // See ExtractResult.ytd: only where the newest quarter's own cash flow is
  // missing, and only a frame ending on that quarter's end that carries it.
  const ocfAt = SEC_FIELD_KEYS.indexOf("operatingCashFlow");
  const newestQ = quarters[0];
  const ytdFrame = newestQ && newestQ.values[ocfAt] == null
    ? [...ytdFrames.values()]
        .filter((y) => y.end === newestQ.end && y.cells.get("operatingCashFlow") != null)
        .sort((a, b) => b.n - a.n)[0] ?? null
    : null;
  const ytd: PeriodRecord | null = ytdFrame
    ? {
        end: ytdFrame.end, start: ytdFrame.start, fp: null, fy: null,
        accession: ytdFrame.row.accn ?? null, filed: ytdFrame.row.filed ?? null,
        values: SEC_FIELD_KEYS.map((k) => ytdFrame.cells.get(k) ?? null),
      }
    : null;

  const instants = pack(instantCells, (e) => ({ start: null, row: instantMeta.get(e) })).slice(
    0,
    keepInstants
  );

  const nci = minorityInterestAt(facts, instants.map((i) => i.end), currency);

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
    ...(() => { const r = shareRestatements(buckets.get("sharesBasic"), preferred.get("sharesBasic") ?? null); return r.length ? { shareRestated: r } : {}; })(),
    ...(splitFacts.length ? { splitFacts } : {}),
    ...(() => { const r = shareRefiledUnchanged(buckets.get("sharesBasic"), preferred.get("sharesBasic") ?? null); return r.length ? { shareRefiled: r } : {}; })(),
    ...(ytd ? { ytd } : {}),
    ...(nci.length ? { nci } : {}),
    untagged: SEC_FIELDS.filter((f) => !fieldIsTagged(facts, f)).map((f) => f.key),
    readNamespaces: countReadNamespaces([...quarters, ...years, ...instants]),
    summedSga: summedSgaPeriods([...quarters, ...years]),
    notes,
  };
}

/**
 * THE BALANCE-SHEET NCI, for the derived P/B (lib/server/secEstimates, M6a):
 * us-gaap MinorityInterest (the balance-sheet noncontrolling
 * interest) on the given balance-sheet dates, newest filing wins, USD only.
 *
 * STORED AS AN EXTRA, NOT A FIELD. A new field moves secFieldsHash, which makes
 * every stored set unreadable at once; an extra fills in as each set is next
 * refreshed. A non-USD reporter gets none: its instants are converted by the
 * cron after extraction and this would not be, so it is left out rather than
 * mixed (its P/B keeps today's refusal).
 */
export function minorityInterestAt(facts: CompanyFacts, dates: string[], currency: string): [string, number][] {
  if (currency !== "USD" || !dates.length) return [];
  const rows = facts.facts?.["us-gaap"]?.["MinorityInterest"]?.units?.USD ?? [];
  const want = new Set(dates);
  const best = new Map<string, { val: number; filed: string }>();
  for (const r of rows) {
    if (r.start || !r.end || !want.has(r.end) || typeof r.val !== "number" || !Number.isFinite(r.val)) continue;
    const prior = best.get(r.end);
    if (!prior || (r.filed ?? "") > prior.filed) best.set(r.end, { val: r.val, filed: r.filed ?? "" });
  }
  return [...best].map(([e, x]) => [e, x.val] as [string, number]).sort((a, b) => b[0].localeCompare(a[0]));
}

/**
 * See ExtractResult.shareRestated. Per period (year or quarter), the resolved
 * value (resolve(): the newest filing) against the ORIGINALLY filed value of
 * the same concept, kept where they differ by 1.5× or more either way.
 */
export const SHARE_RESTATED_MIN_RATIO = 1.5;
function shareRestatements(bucket: Bucket | undefined, preferred: string | null): [string, number][] {
  if (!bucket) return [];
  const out = new Map<string, number>();
  for (const [, cands] of bucket) {
    const best = resolve(cands, preferred);
    if (!best?.row.start || !best.row.end || typeof best.row.val !== "number" || best.row.val <= 0) continue;
    const q = quartersCovered(spanDays(best.row.start, best.row.end));
    if (q !== 1 && q !== 4) continue;
    let original: FactRow | null = null;
    for (const c of cands) {
      if (conceptKey(c) !== conceptKey(best) || typeof c.row.val !== "number" || c.row.val <= 0) continue;
      if (!original || newer(original, c.row) === original) original = c.row;
    }
    if (!original || typeof original.val !== "number") continue;
    const ratio = best.row.val / original.val;
    if (ratio >= SHARE_RESTATED_MIN_RATIO || ratio <= 1 / SHARE_RESTATED_MIN_RATIO) out.set(best.row.end, ratio);
  }
  return [...out].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * See ExtractResult.shareRefiled. Fiscal years, and quarters ending within
 * SHARE_REFILED_QUARTER_YEARS of the newest quarter (the span the chart draws
 * as quarters), whose concept was filed by two or more accessions all within
 * 1% of one another.
 */
export const SHARE_REFILED_QUARTER_YEARS = 4;
function shareRefiledUnchanged(bucket: Bucket | undefined, preferred: string | null): string[] {
  if (!bucket) return [];
  const found: { end: string; q: number }[] = [];
  for (const [, cands] of bucket) {
    const best = resolve(cands, preferred);
    if (!best?.row.start || !best.row.end || typeof best.row.val !== "number" || best.row.val <= 0) continue;
    const q = quartersCovered(spanDays(best.row.start, best.row.end));
    if (q !== 1 && q !== 4) continue;
    const same = cands.filter((c) => conceptKey(c) === conceptKey(best) && typeof c.row.val === "number" && c.row.val > 0);
    if (new Set(same.map((c) => c.row.accn)).size < 2) continue;
    if (!same.every((c) => Math.abs((c.row.val as number) / (best.row.val as number) - 1) <= 0.01)) continue;
    found.push({ end: best.row.end, q });
  }
  const newestQuarter = found.filter((f) => f.q === 1).map((f) => f.end).sort().at(-1) ?? null;
  const floor = newestQuarter ? `${Number(newestQuarter.slice(0, 4)) - SHARE_REFILED_QUARTER_YEARS}${newestQuarter.slice(4)}` : "";
  return [...new Set(found.filter((f) => f.q === 4 || f.end >= floor).map((f) => f.end))].sort();
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

// ── SPLIT SG&A (#552 COWORK #40) ──────────────────────────────────────────

/**
 * Where a filer files G&A and a selling/marketing line for the SAME period in
 * the SAME filing and unit, and no combined SG&A for that period in any filing,
 * add a row under SUMMED_SGA_TAG carrying their sum. Pure; the input is not
 * touched. The combined tag always wins: a period that has one is never summed,
 * so the 18 filers that file both the parts and the total are not double counted.
 */
export function withSummedSga(facts: CompanyFacts): CompanyFacts {
  const g = facts.facts?.["us-gaap"];
  const ga = g?.GeneralAndAdministrativeExpense?.units;
  if (!g || !ga) return facts;
  const combined = new Set<string>();
  for (const rows of Object.values(g.SellingGeneralAndAdministrativeExpense?.units ?? {})) {
    for (const r of rows ?? []) combined.add(`${r.start ?? ""}|${r.end ?? ""}`);
  }
  const out: Record<string, FactRow[]> = {};
  let added = 0;
  for (const [unit, gaRows] of Object.entries(ga)) {
    for (const r of gaRows ?? []) {
      if (!r.start || !r.end || typeof r.val !== "number") continue;
      if (combined.has(`${r.start}|${r.end}`)) continue;
      // The first selling tag with a row for the same period, filing and unit.
      let sell: FactRow | undefined;
      for (const tag of SELLING_TAGS) {
        sell = (g[tag]?.units?.[unit] ?? []).find((x) =>
          x.start === r.start && x.end === r.end && x.accn === r.accn && typeof x.val === "number");
        if (sell) break;
      }
      if (!sell) continue;
      (out[unit] ??= []).push({ ...r, val: r.val + (sell.val as number) });
      added++;
    }
  }
  if (!added) return facts;
  return {
    ...facts,
    facts: { ...facts.facts, "us-gaap": { ...g, [SUMMED_SGA_TAG]: { units: out } } },
  };
}

/** `start|end` of the periods whose SG&A cell came from the synthesized sum. */
export function summedSgaPeriods(periods: PeriodRecord[]): string[] {
  const i = SEC_FIELD_KEYS.indexOf("sellingGeneralAndAdministrative");
  return periods
    .filter((p) => p.values[i]?.tag === SUMMED_SGA_TAG)
    .map((p) => `${p.start ?? ""}|${p.end}`);
}
