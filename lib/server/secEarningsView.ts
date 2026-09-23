// What the earnings page renders, derived from one stored fact set.
//
// SEPARATE FROM THE PAGE ON PURPOSE. The page is 1,300 lines of JSX; the rules
// about which number is which, what is derived, and what has no source any more
// are the part that has to be checkable. scripts/check-sec-earnings-page.mjs
// asserts against this file, not against the markup.
import {
  cell, periodLabel, ttm, valueOf,
  type Cell, type FilingRef, type StoredFactSet, type StoredPeriod,
} from "./secFactCodec";
import { storedInReportingCurrency } from "./secCurrency";
import { SEC_FIELDS, type Statement } from "./secFields";

// ── the hide registry ───────────────────────────────────────────────────────

/**
 * COLUMNS THAT LOST THEIR SOURCE ARE HIDDEN, NOT REMOVED.
 *
 * The owner's standing rule. Deleting the code loses the record of WHY, and the
 * next person to look at a gap in the layout re-adds the column, wires it to
 * whatever is nearest, and ships an empty one. Every entry here names the source
 * that went away and when, and the card renders the reason instead of a blank
 * space or a zero.
 *
 * A zero is the specific thing to avoid: "EPS surprise: 0.00" reads as "came in
 * exactly in line", which is a claim, and a false one.
 */
export type RetiredSource = {
  id: string;
  label: string;
  /** What used to supply it. */
  source: string;
  /** When it stopped being available to this site. */
  retiredOn: string;
  /** Shown to the reader. One short sentence, no jargon. */
  reason: string;
};

export const RETIRED_SOURCES: RetiredSource[] = [
  {
    id: "eps-estimate",
    label: "EPS estimate and surprise",
    source: "FMP /earnings epsEstimated + /analyst-estimates",
    retiredOn: "2026-09-15",
    reason:
      "Analyst estimates are not published by the SEC and no free source covers them, " +
      "so beat-or-miss against consensus is no longer shown.",
  },
  {
    id: "revenue-estimate",
    label: "Revenue estimate and surprise",
    source: "FMP /earnings revenueEstimated",
    retiredOn: "2026-09-15",
    reason:
      "Analyst estimates are not published by the SEC and no free source covers them, " +
      "so beat-or-miss against consensus is no longer shown.",
  },
  {
    id: "forward-consensus",
    label: "Forward full-year consensus",
    source: "FMP /analyst-estimates?period=annual",
    retiredOn: "2026-09-15",
    reason:
      "Forward analyst consensus is not in SEC filings. Company guidance appears in " +
      "8-K exhibits as prose, not as structured data.",
  },
  {
    id: "quarter-estimate-columns",
    label: "Estimate columns in the recent-quarters table",
    source: "FMP /earnings epsEstimated + revenueEstimated",
    retiredOn: "2026-09-15",
    reason: "Same source as the estimate cards above. The reported actuals are unchanged.",
  },
  {
    id: "revenue-by-segment",
    label: "Revenue by product and by region",
    source: "FMP /revenue-product-segmentation + /revenue-geographic-segmentation",
    retiredOn: "2026-09-15",
    reason:
      // READER-SAFE EVEN THOUGH NOTHING RENDERS IT. These strings were written
      // for a card that no longer exists, and "see hide-list-verdict §6" was
      // live on the page for two weeks. If A5 is ever reversed the text ships
      // again, so the internal citation comes out now rather than being left
      // as a trap for whoever reverses it.
      "Segment revenue is filed against a breakdown the SEC's own bulk data does not " +
      "publish — only the company-wide totals are in it. No free source covers the split.",
  },
];

export const retiredSource = (id: string): RetiredSource => {
  const found = RETIRED_SOURCES.find((r) => r.id === id);
  // A THROW, NOT A FALLBACK. A card asking for a reason that is not in the
  // registry is the exact "switched back on with nothing behind it" case the
  // registry exists to prevent, and a soft fallback would let it ship.
  if (!found) throw new Error(`no retired-source entry for "${id}" — add one before hiding a card`);
  return found;
};

// ── attribution ─────────────────────────────────────────────────────────────

/** Named once. Every card that states its source reads this. */
export const SEC_ATTRIBUTION = "SEC EDGAR filings";

/**
 * THE CONVERSION LABEL — one sentence, always visible, never a tooltip.
 *
 * A reader holding Ryanair's own results announcement sees euros; this page
 * shows dollars. Without a visible statement of that, the honest conclusion
 * available to them is that the page is wrong. So the label names the source
 * currency, the rate actually applied to the period on screen, and whether
 * that rate was the period's average or its closing spot — because those are
 * different numbers and which one was used is the first thing anyone checking
 * the arithmetic needs.
 *
 * GROWTH IS EXEMPTED IN SO MANY WORDS. Percentages on this page are computed
 * before conversion, and a reader who assumes otherwise would "correct" them
 * back by the FX move and get the wrong answer.
 */
export function conversionNote(c: NonNullable<SecEarningsView["currency"]>): string {
  const rate =
    c.latestRate === null
      ? null
      : `1 ${c.reporting} = $${c.latestRate.toFixed(4)}`;
  const basis =
    c.latestBasis === "average" ? "the average rate across the period"
    : c.latestBasis === "spot" ? "the rate on the period end date"
    : null;
  return [
    `Figures converted from ${c.reporting} to US dollars`,
    rate && basis ? ` at ${rate}, ${basis}` : "",
    `. Each period uses its own rate, so historical figures do not move with today's.`,
    ` Growth percentages are calculated in ${c.reporting} before conversion, so they show the business result rather than the currency move.`,
    c.refused.length
      ? ` ${c.refused.length} earlier period${c.refused.length === 1 ? "" : "s"} omitted: no exchange rate on file.`
      : "",
  ].join("");
}

/**
 * EPS IS GAAP, AND THE PAGE SAYS SO.
 *
 * SEC gives GAAP; FMP gave adjusted; on a charge-heavy quarter they are far
 * apart. Measured on the five-symbol run: AAPL's FQ4-2024 reads $0.97 GAAP
 * against FMP's $1.64 — the EU State Aid charge, visible in the same quarter's
 * income tax line at 14,874.0M against ~5,000M either side. Labelling it is
 * accurate whichever way the adjusted question later goes.
 */
export function epsBasisNote(accounting: "IFRS" | "US GAAP" | null): string {
  const lead = accounting === "IFRS"
    ? "EPS is IFRS, as filed with the SEC."
    : accounting === "US GAAP"
      ? "EPS is GAAP, as filed with the SEC."
      : "EPS is as filed with the SEC.";
  return `${lead} Companies often headline an adjusted ` +
    "figure that excludes one-off charges; the two can differ substantially.";
}

/** The US GAAP wording — what every stock used to get, IFRS filers included. */
export const GAAP_EPS_NOTE = epsBasisNote("US GAAP");

/**
 * The standard's word inside an EPS label: "Diluted EPS (GAAP)", "(IFRS)".
 *
 * THE LABEL SAID GAAP ON EVERY STOCK, including AZN, KGC and ABVX, which file
 * under IFRS (owner, #514). Null — a set that predates the namespace census —
 * names no standard rather than guess one.
 */
export function epsStandardWord(accounting: "IFRS" | "US GAAP" | null): string {
  return accounting === "IFRS" ? "IFRS" : accounting === "US GAAP" ? "GAAP" : "as filed";
}

/**
 * The label for a figure the filer did not publish for that period.
 *
 * Q4 is NEVER FILED as a standalone quarter, and every cash-flow quarter but Q1
 * is filed year-to-date, so a large share of what this page shows is arithmetic
 * on filed numbers rather than a filed number. Saying which is which is the
 * difference between a figure a reader can check against the 10-Q and one they
 * cannot.
 */
export function derivationNote(
  derived: Cell["derived"],
  /**
   * WHERE THE CELL CAME FROM — only "differenced" reads it.
   *
   * ONE SENTENCE WAS DESCRIBING TWO DIFFERENT SUBTRACTIONS. Cash flow is filed
   * year-to-date, so its Q2 and Q3 are differences; that is what the original
   * wording said, and it is still true for cash-flow lines. But the same
   * "differenced" tag lands on INCOME-STATEMENT lines on a Q4, where the
   * arithmetic is the full year minus the first nine months, and the old note
   * told ABVX's reader its Q4 net income was a cash-flow figure (brief
   * 2026-09-22 §1.2 item 4). Omitted context keeps the cash-flow wording, which
   * is what every caller got before this parameter existed.
   */
  context: { statement?: Statement | null; fp?: string | null } = {}
): string | null {
  switch (derived) {
    case "differenced":
      if (context.statement === "income") {
        return context.fp === "Q4"
          ? "Derived: Q4 is not filed on its own, so this is the full-year figure minus the first nine months."
          : "Derived: this period minus the previous year-to-date figure, because the filer reports this line year-to-date.";
      }
      return "Derived: this period minus the previous year-to-date figure, because the filer reports cash flow cumulatively.";
    case "computed":
      return "Derived: net income divided by this quarter's weighted average share count.";
    case "ambiguous":
      return "The filer reports this separately for each share class and the filing does not say which is which, so no single figure is shown.";
    default:
      return null;
  }
}

/** See SecEarningsView.accounting. */
/**
 * See SecEarningsView.accounting.
 *
 * THE NAMESPACE THE CELLS WERE READ FROM, NOT THE ONES THE PAYLOAD CARRIES.
 * The first version said "US GAAP" whenever `us-gaap` was in `tx`, and 48
 * stored sets carry both namespaces — most of them IFRS filers with a handful
 * of stray us-gaap tags (relay 35771324089; see ExtractResult.readNamespaces).
 *
 *   1. `rns` present → whichever namespace supplied more stored cells.
 *   2. otherwise `tx` carrying exactly one of the two → that one.
 *   3. otherwise (both, neither, or no census) → null. The page then names no
 *      standard at all rather than guess; a re-read writes `rns` and settles it.
 */
export function accountingOf(set: Pick<StoredFactSet, "tx" | "rns">): "IFRS" | "US GAAP" | null {
  if (set.rns) {
    const us = set.rns["us-gaap"] ?? 0;
    const ifrs = set.rns["ifrs-full"] ?? 0;
    if (us > ifrs) return "US GAAP";
    if (ifrs > us) return "IFRS";
    return null;
  }
  if (!set.tx) return null;
  const us = set.tx.includes("us-gaap");
  const ifrs = set.tx.includes("ifrs-full");
  if (us && !ifrs) return "US GAAP";
  if (ifrs && !us) return "IFRS";
  return null;
}

/** See SecEarningsView.snapshot.fyEpsDiluted. */
function fiscalYearEps(set: StoredFactSet, latest: StoredPeriod, epsStd: string): { label: string; cell: ViewCell } | null {
  if (latest.fp !== "Q4" || valueOf(latest, "epsDiluted") !== null) return null;
  const year = set.years.find((y) => y.e === latest.e) ?? null;
  if (!year || valueOf(year, "epsDiluted") === null) return null;
  return { label: periodLabel(year), cell: view(year, "epsDiluted", `Diluted EPS (${epsStd})`) };
}

export const isDerived = (c: Cell) => c.derived === "differenced" || c.derived === "computed";

// ── the period basis, and the words that follow from it ─────────────────────

/**
 * WHICH KIND OF PERIOD THIS WHOLE VIEW IS ANCHORED ON.
 *
 * A normal filer's anchor is a QUARTER; an annual-only filer's is a fiscal
 * YEAR. Everything the reader is told about "the period" — the eyebrow, the
 * lede, the score narrative, the table intros, the P&L heading — has to follow
 * from this one field.
 *
 * WHY A FIELD AND NOT A BOOLEAN PER SENTENCE. The first version of the annual
 * fallback shipped with `annualOnly` used only for STRUCTURE (which card
 * renders) and the NOUNS left as literals. The result was measured on the
 * preview: /stock/KGC/earnings said "Latest reported quarter", "Most recent
 * quarter filed: FY2025", "The latest filed quarter reads constructive",
 * "Quarters are labelled by the company's own fiscal calendar" and carried a
 * "Recent reported quarters" table — on a page whose own five-year card said
 * "there is no quarterly table below". Six sentences, six places to forget.
 * There is one place now.
 */
export type PeriodBasis = "quarter" | "year";

/**
 * The noun set for a basis. Every period word on the page comes from here.
 *
 * NOT a general pluraliser: this is the page's whole vocabulary for its own
 * anchor, written out so a reader of this file can see exactly which words
 * change with the basis and a check can assert on them.
 */
export const PERIOD_WORDS: Record<PeriodBasis, {
  /** "quarter" / "year" */
  one: string;
  /** "quarters" / "years" */
  many: string;
  /** "Quarter" / "Fiscal year" — a table heading. */
  One: string;
  /** "quarterly" / "annual" */
  adj: string;
  /** "Latest reported quarter" / "Latest reported year" — the card eyebrow. */
  latest: string;
  /** How the filer's own fiscal labelling is described. */
  labelled: string;
  /**
   * What a year-over-year figure is measured against, as a phrase.
   *
   * NOT built by substitution. "against the same ${one} a year earlier" reads
   * correctly for a quarter and comes out as "the same year a year earlier"
   * for a year — grammatical, and nonsense. A basis that changes the SHAPE of
   * a sentence needs its own sentence, not a slot in someone else's.
   */
  yoyPhrase: string;
}> = {
  quarter: {
    one: "quarter",
    many: "quarters",
    One: "Quarter",
    adj: "quarterly",
    latest: "Latest reported quarter",
    labelled: "Quarters are labelled by the company's own fiscal calendar, which often differs from the calendar year.",
    yoyPhrase: "the same quarter a year earlier",
  },
  year: {
    one: "year",
    many: "years",
    One: "Fiscal year",
    adj: "annual",
    latest: "Latest reported year",
    labelled: "Fiscal years are labelled by the company's own year-end, which often differs from the calendar year.",
    yoyPhrase: "the prior fiscal year",
  },
};

/** The words for a view's own basis. One call site per card. */
export const periodWords = (basis: PeriodBasis) => PERIOD_WORDS[basis];

// ── percentage change, and when it has no meaning ───────────────────────────

/**
 * A PERCENTAGE CHANGE THAT MAY HAVE NO MEANING, and says so rather than
 * printing a number.
 *
 * `null`  — one of the two figures is not on file. Renders "—".
 * `"n/m"` — both are on file and the arithmetic still says nothing.
 *
 * ── WHAT THIS PRINTED BEFORE ──────────────────────────────────────────────
 * Measured on the #465 preview, /stock/KGC/earnings, five-year card:
 *
 *   FY2022  EPS $0.17 -> -$0.47   rendered  -376.5%
 *   FY2023  EPS -$0.47 -> $0.34   rendered  +172.3%
 *
 * Both are arithmetically correct and both are meaningless. A percentage
 * change measures a proportion of the base, and a base of -$0.47 has no
 * proportion to be a share of: the second number says a company swinging from
 * a loss to a profit "grew 172%", which is not a growth rate at all — it is an
 * artefact of dividing by a negative. Worse, -376.5% and +172.3% are the SAME
 * event described twice, once as a collapse and once as a boom.
 *
 * ── AND IT REACHED THE SCORE ──────────────────────────────────────────────
 * scoreFromSec feeds epsYoY into clamp(v * 0.30, -20, 20), so a sign flip out
 * of a loss was worth the full +20 — the maximum any component can contribute
 * — for an arithmetic artefact. A value that cannot be rendered must not be
 * scored either, which is why this is a type the score has to narrow rather
 * than a formatting decision in the card.
 */
/**
 * ── THE THREE CROSSINGS, NAMED IN PLAIN WORDS ─────────────────────────────
 *
 * This was one marker, "n/m", and the owner did not know what it meant — which
 * is the whole verdict on it. An abbreviation from a financial-analysis
 * textbook is not a word; it tells a reader that something is being withheld
 * without saying what, and the reader has to take it on trust.
 *
 * The three cases are genuinely different events and each has an ordinary
 * English name, so the cell says which one happened:
 *
 *   earlier < 0, later >= 0   "Turned profitable"
 *   earlier >= 0, later < 0   "Swung to loss"
 *   both < 0                  "Loss both periods"
 *
 * None of them is a percentage, for the same reason as before: a change
 * measured against a negative base is an artefact of the division, not a rate
 * of growth. What changed is that the page now says what DID happen instead of
 * only refusing to say a number.
 */
export type PctCrossing = "turned-profitable" | "swung-to-loss" | "loss-both";

export type Pct = number | PctCrossing | null;

/** The reader-facing words for each crossing. One place; cards and checks share it. */
export const CROSSING_WORDS: Record<PctCrossing, string> = {
  "turned-profitable": "Turned profitable",
  "swung-to-loss": "Swung to loss",
  "loss-both": "Loss both periods",
};

/** The legend, rendered wherever a table can produce one of these. */
export const CROSSING_NOTE =
  "Where a period crosses between profit and loss, this shows what happened " +
  "rather than a percentage: a change measured against a loss is an artefact " +
  "of the arithmetic, not a rate of growth.";

/**
 * THE REASONS, AS WORDS THE CARD PRINTS. One place, so the check can assert
 * which one a tile got without matching prose scattered through a function.
 *
 * NOT_CAPTURED is the honest remainder: the stored set has no value for this
 * period and nothing recorded says the filer lacks the line. It claims only
 * that WE did not capture it — never "not reported", and never "not in the
 * filing", both statements about the company.
 *
 * ── WHY IT IS NOT "Not in this period's filed figures" ───────────────────
 * That wording was used for exactly the cases we cannot tell apart: a set
 * written before the `nt` marker, where "not captured" (a chain gap) and "not
 * filed" look identical. It was false for AVAV, whose FY2022/FY2023 revenue IS
 * in its 10-Ks under a concept the chain did not list (owner review, #522).
 * "No revenue line in this filing" stays, and only where the marker confirms it.
 */
export const EMPTY_REASONS = {
  q4NotFiled: "Q4 is not filed on its own",
  noRevenueLine: "No revenue line in this filing",
  needsRevenue: "Needs revenue",
  notCaptured: "Not captured from this filing",
} as const;
/** "3 Jul 2026" — the same format the stock page's earnings card prints. */
export function plainDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);

/**
 * THE CREDIT, when the newest period came from the filing rather than the
 * feed. Filed facts only: which form, filed when. One sentence, shared by the
 * stock page tile and the earnings card so the two cannot drift.
 */
export function filingCreditText(ref: FilingRef): string {
  return `From the ${ref.form} filed ${plainDate(ref.filed)}. SEC's data feed has not published ` +
    `these figures yet, so they were read from the filing itself.`;
}

/**
 * THE NOTICE, when a newer filing exists that neither source could read.
 * Dated from the filing's own period (EDGAR's reportDate), never from a
 * cadence guess — the guess named 26 Jun for KO's quarter to 3 Jul.
 */
export function filingNoticeText(ref: FilingRef): string {
  const what = ANNUAL_FORMS.has(ref.form) ? "fiscal year" : "quarter";
  return `Results for the ${what} ended ${plainDate(ref.reportDate)} were filed with the SEC on ` +
    `${plainDate(ref.filed)} (${ref.form}); the figures are not in SEC's data feed yet, so this ` +
    `page still shows the previous period.`;
}

/** Is this a figure, as opposed to absent or a crossing? */
export const isPct = (v: Pct): v is number => typeof v === "number" && Number.isFinite(v);

/** Is this one of the three crossings? */
export const isCrossing = (v: Pct): v is PctCrossing =>
  typeof v === "string" && v in CROSSING_WORDS;

// ── the view ────────────────────────────────────────────────────────────────

export type ViewCell = Cell & {
  /**
   * The SEC_FIELD_KEYS name this cell came from.
   *
   * CARRIED SO A CONSUMER CAN INDEX BY NAME. The P&L waterfall needs revenue,
   * cost of revenue and the opex lines out of `incomeStatement`, and the two
   * ways to get them without this are matching on the display LABEL (which is
   * prose, and changes) or on POSITION in the PL array (which is the shifted-
   * array failure secFactCodec's `cell()` exists to prevent, one layer up).
   */
  key: string;
  label: string;
  derivedNote: string | null;
  /**
   * A PER-SHARE FIGURE, which is formatted to two decimals wherever it renders.
   *
   * ── WHY THE CELL CARRIES THIS AND NOT THE CALL SITE ──────────────────────
   * The money formatter used maximumFractionDigits: 2, which drops a trailing
   * zero — so a filed EPS of 4.30 rendered "$4.3" and 4.50 rendered "$4.5".
   * Owner found both: TSLA FY2023 and AZN FY2024. A price-like figure printed
   * to one decimal reads as a different number, and "$4.3" is not how anyone
   * writes money.
   *
   * EPS renders in four places — the snapshot tile, the five-year card, the
   * earnings-history table and the full P&L — so a `perShare` prop at each
   * call site is four chances to forget one, and the fourth is the P&L, where
   * the cells are produced by a loop over field keys and no human writes them
   * out at all. Marking the CELL means every renderer gets it right by
   * construction, including one added later.
   */
  perShare: boolean;
};

/**
 * PER-SHARE FIELDS, BY KEY. The keys are the extractor's own, so this cannot
 * drift from a label someone rewords.
 */
const PER_SHARE_KEYS = new Set(["epsBasic", "epsDiluted"]);

/** Which statement each stored field sits on, from the field table itself. */
const STATEMENT_OF = new Map<string, Statement>(SEC_FIELDS.map((f) => [f.key, f.statement]));

const view = (p: StoredPeriod | null | undefined, key: string, label: string): ViewCell => {
  const c = cell(p, key);
  return {
    ...c, key, label,
    derivedNote: derivationNote(c.derived, { statement: STATEMENT_OF.get(key) ?? null, fp: p?.fp ?? null }),
    perShare: PER_SHARE_KEYS.has(key),
  };
};

export type SecEarningsView = {
  symbol: string;
  entityName: string | null;
  /** The newest quarter, fiscal-labelled. */
  latestLabel: string;
  latestEnd: string;
  latestAccession: string | null;
  latestFiled: string | null;
  /**
   * SET WHEN THE NEWEST PERIOD WAS READ FROM THE FILING ITSELF because SEC's
   * data feed had not published it (StoredFactSet.ff). Null otherwise —
   * including after companyfacts catches up, when the period is its own.
   */
  latestFromFiling: FilingRef | null;
  /**
   * A NEWER FILING NEITHER SOURCE COULD READ (StoredFactSet.lg), and only
   * while it is newer than what the page shows. Null otherwise.
   */
  filedNotInFeed: FilingRef | null;
  snapshot: {
    revenue: ViewCell;
    revenueYoY: Pct;
    epsDiluted: ViewCell;
    epsYoY: Pct;
    netIncome: ViewCell;
    operatingIncome: ViewCell;
    comparedWith: string | null;
    /**
     * THE FISCAL YEAR'S DILUTED EPS, when the anchor is a Q4 with none of its own.
     *
     * Q4 EPS is null BY DESIGN: EPS is a ratio and FY minus 9M of a ratio is
     * not the fourth quarter's ratio (see FieldKind "duration-ratio"). So on a
     * derived Q4 the EPS tile is always blank, and the filing that produced the
     * rest of the quarter DID state an EPS — for the year. This carries that
     * figure, labelled with its own year, for a tile that prints it as a
     * clearly marked full-year line rather than a quarter's (brief 2026-09-22
     * §1.2 item 2, flagged there as an owner-veto departure).
     *
     * Null unless the anchor is a Q4, its own EPS is null, and a fiscal year
     * ending on the same date carries one.
     */
    fyEpsDiluted: { label: string; cell: ViewCell } | null;
  };
  /**
   * WHICH ACCOUNTING STANDARD THE FIGURES WERE READ UNDER — see accountingOf
   * for the rule. Null is "unknown": the page then names no standard.
   *
   * THE SIDEBAR'S FOOTER SAID "US GAAP" ON EVERY STOCK, ABVX and AZN included,
   * because it was a constant. Both file IFRS.
   */
  accounting: "IFRS" | "US GAAP" | null;
  /**
   * Fields the filer publishes no chain concept for at all. See
   * StoredFactSet.nt. Null when the set predates the marker — unknown.
   */
  untagged: string[] | null;
  /**
   * WHAT CURRENCY THE FIGURES ON THIS PAGE ARE IN, AND HOW THEY GOT THERE.
   *
   * Null for a USD filer — there is nothing to say and no label to render.
   * Present means every money figure shown was CONVERTED, and the page must
   * say so: a reader comparing a converted revenue against a headline in the
   * filer's own press release will otherwise conclude the page is wrong.
   *
   * A set whose currency could NOT be converted never reaches here — the
   * builder refuses it, because those figures are not dollars and this page
   * renders dollars. See the guard at the top of buildSecEarningsView.
   */
  currency: {
    /** The filer's own reporting currency, e.g. "EUR". */
    reporting: string;
    /** Which rate source produced the conversion. */
    source: string;
    /** Rate applied to the anchor period, for the label to quote. */
    latestRate: number | null;
    /** Whether that rate was a period average or a balance-sheet-date spot. */
    latestBasis: "average" | "spot" | null;
    /** Period ends dropped for want of an honest rate. */
    refused: string[];
  } | null;
  margins: {
    label: string;
    /** True when the NEXT row down (older) is not the immediately preceding fiscal quarter. */
    gapAfter: boolean;
    gross: number | null;
    operating: number | null;
    net: number | null;
  }[];
  /**
   * THE ANCHOR'S OWN KIND: "quarter" normally, "year" for a filer that
   * publishes no quarterly periods at all.
   *
   * ONE FIELD, TWO JOBS, AND BOTH MATTER. Structure reads it to hide
   * quarterly-only ideas (the gap badge, the recent-periods table) rather than
   * compute them for a series that has no quarters; PROSE reads it through
   * periodWords() so no card writes the noun "quarter" as a literal. It
   * replaced a boolean `annualOnly` that only ever did the first job, which is
   * how KGC shipped with six quarterly sentences over annual figures.
   *
   * NOT the same field as cashQuality.basis. That one is the period the CASH
   * card reads, which can be a year on a filer whose anchor is a quarter (AZN
   * publishes cash flow only on 6- and 12-month frames). This one is what the
   * page as a whole is about.
   */
  basis: PeriodBasis;
  /**
   * The kind of period the growth/margins and earnings-history TABLES walk.
   *
   * NOT ALWAYS `basis`. A filer can have a newer annual period than its newest
   * quarter (AZN: FY2025 ended 2025-12-31 against Q2 FY2025 ended 2025-06-30),
   * and then the snapshot is annual while the quarterly table below it is
   * still a table of quarters. Cards that describe the TABLE take their nouns
   * from this; cards that describe THE LATEST PERIOD take them from `basis`.
   */
  tableBasis: PeriodBasis;
  /**
   * Up to five fiscal years, oldest first. Rendered on EVERY stock as its own
   * card, and it is the only growth table an annual-only filer has.
   */
  annual: {
    label: string;
    end: string;
    comparedWith: string | null;
    revenue: ViewCell;
    revenueYoY: Pct;
    epsDiluted: ViewCell;
    epsYoY: Pct;
    gross: number | null;
    operating: number | null;
    net: number | null;
  }[];
  growth: {
    label: string;
    /** The period the percentages are measured against, or null when none is on file. */
    comparedWith: string | null;
    revenueYoY: Pct;
    epsYoY: Pct;
  }[];
  cashQuality: {
    operatingCashFlow: ViewCell;
    capex: ViewCell;
    freeCashFlow: number | null;
    freeCashFlowDerived: boolean;
    /** Which input is absent, for the card to name. Null when nothing is. */
    freeCashFlowMissing: string | null;
    accrualsMissing: string | null;
    netIncome: ViewCell;
    shareBasedCompensation: ViewCell;
    accruals: number | null;
    /**
     * Whether every figure on the card is the latest QUARTER or the latest
     * YEAR. One period for the whole card; see the comment at cashBasis for the
     * mixed-period trap this exists to prevent.
     */
    basis: "quarter" | "year";
    /** That period's own label, for the card heading and the score narrative. */
    period: string;
  };
  balance: {
    asOf: string;
    cash: ViewCell;
    /**
     * TRUE when `cash` is the RESTRICTED-INCLUSIVE figure because the filer
     * published no plain one. Restricted cash cannot be freely spent, so every
     * card showing this must say so — including net cash, which is built on it.
     */
    cashIncludesRestricted: boolean;
    shortTermInvestments: ViewCell;
    totalDebt: number | null;
    totalDebtMissing: string | null;
    netCash: number | null;
    netCashMissing: string | null;
    currentRatio: number | null;
    currentRatioMissing: string | null;
    totalAssets: ViewCell;
    totalLiabilities: ViewCell;
    stockholdersEquity: ViewCell;
    /**
     * TRUE when `stockholdersEquity` is the filer's TOTAL equity, including
     * noncontrolling interests, because it published no parent-only figure.
     * Same pattern as cashIncludesRestricted: the label follows the figure.
     */
    equityIncludesNci: boolean;
  } | null;
  /** Days between the balance-sheet instant and the income-statement period end. */
  balanceSheetSpreadDays: number | null;
  incomeStatement: ViewCell[];
  /**
   * Whether the stored expense lines actually sum to the filed operating income.
   * Measured to fail on 5 of 32 probe quarters (ARM, MU) by 1-7%, always because
   * the filer expenses something the stored breakdown has no line for. The card
   * must not imply the waterfall is complete when it is not.
   *
   * SUMMING IS THE WHOLE TEST — a line the filer did not report contributes
   * nothing and does not fail it. See the comment at the computation for the
   * measurement that made that distinction necessary.
   */
  incomeStatementComplete: boolean;
  /**
   * The filed periods, newest first, for the earnings-history table.
   *
   * RENAMED FROM recentQuarters. The rows are whatever the anchor list holds,
   * which for an annual-only filer is fiscal years — the old name was the
   * reason a "Recent reported quarters" heading sat over five FY rows.
   */
  recentPeriods: {
    label: string;
    end: string;
    revenue: ViewCell;
    epsDiluted: ViewCell;
    netIncome: ViewCell;
  }[];
  ttmRevenue: number | null;
  ttmNetIncome: number | null;
  coverShares: StoredFactSet["cover"];
  asOf: number;
};

/**
 * Year-over-year change, or the reason there isn't one. See `Pct`.
 *
 * TWO GUARDS, NOT ONE. A zero base was already excluded because it divides;
 * these two exclude bases that divide perfectly well and produce a number that
 * means nothing:
 *
 *   base <= 0   the earlier period was a loss (or nil), so there is no
 *               magnitude for the change to be a proportion OF.
 *   now  <  0   the later period is a loss while the base was a profit, so the
 *               "change" crosses zero and the percentage understates a sign
 *               flip as if it were a large decline.
 */
const yoy = (now: number | null, then: number | null): Pct => {
  if (now === null || then === null) return null;
  // THE CROSSING CASES, NAMED. A base of zero divides to infinity and belongs
  // with them: there is no proportion of nothing.
  if (then < 0 && now >= 0) return "turned-profitable";
  if (then >= 0 && now < 0) return "swung-to-loss";
  if (then < 0 && now < 0) return "loss-both";
  // A BASE OF EXACTLY ZERO divides to infinity, so there is no percentage
  // either. Going from nil to a profit is the same event as coming out of a
  // loss, so it gets the same words; nil to nil says nothing and stays blank.
  if (then === 0) return now > 0 ? "turned-profitable" : null;
  return ((now - then) / then) * 100;
};

/**
 * THE PRIOR-YEAR QUARTER, MATCHED BY FISCAL LABEL — NOT BY ARRAY INDEX.
 *
 * ── WHAT THIS REPLACED, AND WHAT IT PRINTED ───────────────────────────────
 * This was `q[i + 4]`: four rows back in the stored series. Four rows back is
 * one year ONLY when the series is dense and gapless, which is true of a US
 * domestic 10-Q filer and false of everyone else. AAPL and MU passed every
 * earlier check for exactly that reason, and the defect was invisible until a
 * foreign private issuer was rendered.
 *
 * Measured on the #464 preview, /stock/AZN/earnings. AZN's stored series is:
 *
 *   [0] Q3 FY2020  [1] Q4 FY2020  [2] Q1 FY2021  [3] Q2 FY2021
 *   [4] Q2 FY2022  [5] Q2 FY2023  [6] Q2 FY2024  [7] Q2 FY2025
 *
 * — a half-yearly 20-F/6-K filer with a three-quarter hole. row[7] minus four
 * rows is row[3], Q2 FY2021, so the card rendered:
 *
 *   YOY REVENUE GROWTH  +75.9%   Compared with Q2 FY2021
 *   YOY EPS GROWTH     +273.8%   Compared with Q2 FY2021
 *
 * against a latest quarter of Q2 FY2025. A FOUR-YEAR comparison labelled
 * "year over year", arithmetically confirmed: 14.46/8.22 = 1.759 and
 * 1.57/0.42 = 3.738. The Growth & Margins table was worse, because it prints
 * the percentage with no base disclosed at all.
 *
 * ── AND THERE IS NO FALLBACK ──────────────────────────────────────────────
 * When no period carries the same fiscal quarter one year earlier this returns
 * null and the figure renders blank. Falling back to the nearest available row
 * is what produced the number above: a wrong base is worse than a blank,
 * because a blank cannot be quoted.
 */
export function priorYearOf(
  quarters: StoredPeriod[],
  p: StoredPeriod | null
): StoredPeriod | null {
  // No fiscal label, no match. fp/fy are derived from the filer's own year-end
  // by fiscalLabel(); a period the labeller could not place has no defensible
  // comparator, and guessing one is the whole defect.
  if (!p?.fp || p.fy == null) return null;
  return quarters.find((c) => c.fp === p.fp && c.fy === p.fy! - 1) ?? null;
}

/**
 * Is `older` the fiscal quarter immediately before `newer`?
 *
 * Used to MARK GAPS rather than to hide them: eight stored rows were presented
 * as a contiguous run of quarters while AZN's carry a three-quarter hole, so
 * the table implied a continuity the data does not have.
 */
export function isConsecutive(newer: StoredPeriod, older: StoredPeriod): boolean {
  if (!newer.fp || !older.fp || newer.fy == null || older.fy == null) return false;
  const n = Number(newer.fp.slice(1));
  const o = Number(older.fp.slice(1));
  if (!Number.isFinite(n) || !Number.isFinite(o)) return false;
  return n === 1
    ? o === 4 && older.fy === newer.fy - 1
    : o === n - 1 && older.fy === newer.fy;
}

const pctOf = (part: number | null, whole: number | null) =>
  part === null || whole === null || whole === 0 ? null : (part / whole) * 100;

/**
 * How many of the stored periods the tables render.
 *
 * The store keeps SEC_QUARTER_WINDOW (12); this renders the newest 8, so every
 * rendered row has four older periods behind it to reach a prior year in. The
 * two numbers are deliberately different — see SEC_QUARTER_WINDOW.
 */
export const RENDERED_QUARTERS = 8;

/**
 * How many fiscal years the five-year card renders.
 *
 * SIX ARE STORED (SEC_YEAR_WINDOW) and five are shown, for exactly the reason
 * twelve quarters back eight: the oldest RENDERED row has to find its own
 * FY-1 inside the stored set. With five stored and five shown, the oldest row
 * read "not on file" on every symbol that had ever filed — a permanent blank
 * produced by the window, not by the filings.
 */
export const RENDERED_YEARS = 5;

/**
 * How stale the newest stored QUARTER may be before the quarterly table stops
 * rendering, in days from the newest stored period of any kind.
 *
 * ── WHAT THIS STOPS ───────────────────────────────────────────────────────
 * Anchoring the snapshot on the newest period by DATE fixed one defect and
 * exposed another underneath it. A filer that stopped filing 10-Qs years ago
 * still has those quarters in the store, so the page showed a FY2025 snapshot
 * above a table of quarters from another decade — CNI's newest is 2009-09-30,
 * BIDU's 2018, ESLT's 2016, IAG's 2017. Individually every row was true; the
 * page as a whole said "here is this company's recent quarterly history" and
 * meant 2009.
 *
 * EIGHTEEN MONTHS, because the thing being tolerated is a REPORTING CADENCE,
 * not a delay. A half-yearly filer's newest quarter is ~6 months behind its
 * newest annual period and that table is current; a filer that has genuinely
 * stopped is years behind. There is a wide empty gap between those two cases
 * and the threshold sits in it — AZN at 184 days keeps its table with a year
 * of room to spare.
 *
 * NOT A JUDGEMENT ABOUT THE FILER. The quarters are still stored, still read,
 * and still serve as comparators; what stops is presenting them as a recent
 * history under a much newer headline.
 */
export const STALE_QUARTER_DAYS = 548;

/**
 * ── ONE READER, TWO ANCHORS ───────────────────────────────────────────────
 *
 * This used to hardcode `set.quarters` and return null when a filer had none,
 * which is how KGC — 5 annual periods, 8 balance-sheet dates, 24 populated
 * fields in its best period — rendered nothing at all.
 *
 * The anchor list is a parameter of the data now: `quarters` for a normal
 * filer, `years` for an annual-only one. EVERYTHING DOWNSTREAM WAS ALREADY
 * PERIOD-GENERIC — view(), pctOf(), priorYearOf(), the P&L list, the
 * balance-sheet block and cashFrom all take a period rather than a quarter —
 * so there is no second annual-period reader anywhere, and there must never be
 * one: two readers is two places for the label, the differencing and the
 * comparator to drift apart.
 *
 * priorYearOf needs no annual variant either. Annual periods carry
 * `fp: "FY"` and a real `fy`, so "same fiscal period, one year earlier" is
 * FY vs FY-1 by label, with no new code and no array offset.
 */
export function buildSecEarningsView(set: StoredFactSet): SecEarningsView | null {
  // ── A SET THAT IS NOT IN DOLLARS DOES NOT RENDER ─────────────────────────
  //
  // `cur` non-USD with `fx` absent means the filer reports in a currency the
  // rate sources could not serve, so the stored values are the filer's own
  // figures. Every card below renders them with a dollar sign. Returning null
  // sends the page down the same path it already takes for a filer it cannot
  // read — which is exactly where these symbols are today — rather than
  // printing euros as dollars, which is the single worst outcome available
  // here and the one nobody would catch by looking.
  if ((set.cur ?? "USD") !== "USD" && !set.fx) return null;
  const epsStd = epsStandardWord(accountingOf(set));

  // ── TWO ANCHORS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS ──────────────────
  //
  // THE DEFECT THIS SPLITS APART. AZN's snapshot read "Most recent quarter
  // filed: Q2 FY2025 (period ending 2025-06-30)" while the store held FY2025,
  // ended 2025-12-31 — six months NEWER — and the five-year card showed it two
  // cards down. The page presented stale data as the latest thing it had,
  // because "latest" was decided by KIND (a quarter if any quarters exist)
  // rather than by DATE.
  //
  //   latest      the newest period by PERIOD END, whichever kind it is. The
  //               snapshot, the score and the Quality of Earnings card are
  //               claims about "the latest reported period", so they follow
  //               this, and `basis` takes its wording from it.
  //   tableBasis  quarters when the filer has any AND they keep up with what
  //               it is still publishing, years otherwise. A newer annual
  //               period does not stop recent quarters existing, so AZN's
  //               table stays; a series that stopped a decade ago is not a
  //               "recent quarterly history" and stops rendering. See
  //               STALE_QUARTER_DAYS.
  //
  // COLLAPSING THESE BACK INTO ONE FIELD IS THE BUG. The old `annualOnly` did
  // both jobs, so making the snapshot annual for AZN would have deleted its
  // quarterly table, and keeping the table meant keeping the stale snapshot.
  const newestQuarter = set.quarters[0] ?? null;
  const newestYear = set.years[0] ?? null;
  if (!newestQuarter && !newestYear) return null;
  const yearIsNewer =
    !!newestYear && (!newestQuarter || newestYear.e > newestQuarter.e);
  const latest = (yearIsNewer ? newestYear : newestQuarter)!;
  const basis: PeriodBasis = yearIsNewer ? "year" : "quarter";

  // Kept for the places that ask "does this filer publish quarters at all" —
  // the gap badge, which is a quarterly idea.
  const annualOnly = set.quarters.length === 0;

  // ── AND A TABLE OF QUARTERS HAS TO BE ABOUT RECENT QUARTERS ───────────────
  //
  // Measured from the newest stored period of ANY kind, not from today: the
  // question is whether the quarterly series keeps up with what the filer is
  // still publishing, and a set that is simply old should not lose its table
  // for being old. See STALE_QUARTER_DAYS.
  const quarterAgeDays =
    newestQuarter && latest
      ? Math.round((Date.parse(latest.e) - Date.parse(newestQuarter.e)) / 86400000)
      : null;
  const quartersAreCurrent =
    !annualOnly && quarterAgeDays !== null && quarterAgeDays <= STALE_QUARTER_DAYS;

  // The kind of period the TABLES walk, which is not always the anchor's kind.
  const tableBasis: PeriodBasis = quartersAreCurrent ? "quarter" : "year";

  // The list the TABLES walk. Not the anchor list: see above. A stale quarterly
  // series falls back to years here as well as in the wording — otherwise the
  // page would say "fiscal year" over rows that are still quarters.
  const q = quartersAreCurrent ? set.quarters : set.years;
  if (!q.length) return null;

  // MATCHED BY FISCAL LABEL. See priorYearOf for the four-year comparison the
  // old `q[4]` printed on AZN and why there is no nearest-row fallback.
  // SEARCHED IN THE LIST `latest` CAME FROM. When the anchor is the year and
  // the tables walk quarters, searching `q` would look for FY2024 among
  // quarters and find nothing — a blank snapshot comparison on a filer that
  // has the prior year right there.
  const yearAgo = priorYearOf(yearIsNewer ? set.years : q, latest);

  // ── EVERY ROW THE TABLE COULD SHOW, MEASURED BEFORE ANY ARE CHOSEN ───────
  //
  // THE FULL STORED LIST IS THE SEARCH SPACE; only the DISPLAY is trimmed.
  // Searching the trimmed list is exactly the defect the window change removed,
  // so `prior` is still looked up across all of `q`.
  //
  // Both the margins row and the growth row are derived here, together, because
  // the cards read them BY INDEX (`view.growth[i]` beside `view.margins[i]`).
  // Two independently filtered lists would silently pair a margin with another
  // period's growth — a wrong number that looks entirely plausible.
  // ── GROWTH IS TAKEN IN THE CURRENCY THE FILER REPORTS IN ─────────────────
  //
  // Each period was converted at ITS OWN rate, which is right for a figure and
  // wrong for a rate of change: a YoY across two converted periods is the
  // business result COMPOUNDED WITH THE CURRENCY MOVE. Measured on real rates,
  // a filer whose home currency moved 8.35% shows that 8.35% as "growth" on a
  // genuinely flat year.
  //
  // So the two YoY lines below read the reporting-currency figures, recovered
  // from the rate stored with the set. For a USD filer `home` is the identity
  // and nothing changes — which is every symbol rendering today.
  //
  // MARGINS DELIBERATELY DO NOT USE IT. A margin is a ratio WITHIN one period,
  // so the rate appears on both sides and cancels exactly; routing them through
  // here would add a way for a row to vanish (no rate -> null) in exchange for
  // no difference in the number.
  const home = (p: StoredPeriod | null) =>
    p === null ? null : storedInReportingCurrency(p, set.fx);
  const measured = q.map((p) => {
    const prior = priorYearOf(q, p);
    return {
      p,
      prior,
      revenueYoY: yoy(valueOf(home(p), "revenue"), valueOf(home(prior), "revenue")),
      epsYoY: yoy(valueOf(home(p), "epsDiluted"), valueOf(home(prior), "epsDiluted")),
      gross: pctOf(valueOf(p, "grossProfit") ?? nullableDiff(p), valueOf(p, "revenue")),
      operating: pctOf(valueOf(p, "operatingIncome"), valueOf(p, "revenue")),
      net: pctOf(valueOf(p, "netIncome"), valueOf(p, "revenue")),
    };
  });

  /**
   * A ROW THIN ENOUGH TO BE NOISE DOES NOT RENDER, AND DOES NOT USE UP A SLOT.
   *
   * ── WHAT WAS MEASURED, AND HOW THE RULE MOVED ─────────────────────────────
   * On the #465 preview /stock/AZN/earnings showed Q3 FY2020, Q4 FY2020 and
   * Q1 FY2021 with four of five cells empty. The first rule written for this
   * dropped only rows where ALL FIVE were null — and it did not reach those
   * three, because AZN stores exactly ONE field for them (revenue; its full
   * quarters store 15), so each still produced a revenue YoY: +6.3%, +12.2%,
   * +15.0%. Three of the eight slots carried one number each.
   *
   * THE BAR IS AN EPS COMPARISON OR A MARGIN. Revenue alone cannot fill a row
   * in a table headed "Growth & Margins": there are no margins to show, and no
   * profit figure to compare. A period that thin is not a row, it is a gap with
   * one number in it.
   *
   * WHAT IT COSTS, STATED BECAUSE IT IS A REAL COST: three filed revenue-growth
   * figures stop rendering for AZN. The owner's call, taken against the
   * measurement — 8 rows of which 3 were one-fifth full becomes 6 rows of which
   * 5 are complete. Neither AAPL (8) nor KGC (5) changes.
   *
   * NULL IS EMPTY; "n/m" IS NOT. A cell reading n/m is a statement about the
   * figures — the comparison crosses zero — so a row whose EPS YoY is n/m has
   * told the reader something and stays.
   */
  const hasSomething = (r: typeof measured[number]) =>
    r.epsYoY !== null ||
    r.gross !== null || r.operating !== null || r.net !== null;

  /**
   * A ROW WITHOUT A COMPARATOR DOES NOT RENDER — AND STILL SERVES AS ONE.
   *
   * ── WHAT THE OWNER SAW ───────────────────────────────────────────────────
   * GEV was spun off in 2024 and has four fiscal years on file. Its oldest,
   * FY2022, has nothing behind it, so the row rendered "not on file" beside a
   * dash — a row whose entire content is the admission that it has no content.
   * That is worse than absent: it invites the reader to look for a filing that
   * does not exist.
   *
   * THE PERIOD IS STILL READ. Dropping the ROW is not dropping the DATA:
   * FY2022 remains in `measured` and in `q`, so FY2023 still finds it and still
   * names it as its base. The oldest period a filer has is a comparator, not a
   * row.
   */
  const hasComparator = (r: typeof measured[number]) => r.prior !== null;

  // HOW MANY ROWS THIS BASIS RENDERS. Eight for quarters, five for years — the
  // same number the five-year card shows, because on an annual-only filer that
  // card IS this table. Slicing a year anchor to RENDERED_QUARTERS gave the
  // growth rows six entries against the annual card's five: invisible today
  // (the growth card does not render on a year anchor) and a trap for whoever
  // renders it next.
  const renderLimit = annualOnly ? RENDERED_YEARS : RENDERED_QUARTERS;
  // NEWEST N THAT CLEAR THE BAR, not the newest N of which some are nearly bare.
  const rows = measured.filter((r) => hasSomething(r) && hasComparator(r)).slice(0, renderLimit);
  const shown = rows.map((r) => r.p);

  const margins = rows.map(({ p, gross, operating, net }, i) => ({
    label: periodLabel(p),
    // TRUE when the row OLDER than this one is not the immediately preceding
    // fiscal quarter. `shown` is newest-first, so the older neighbour is i + 1.
    //
    // ANNUAL SERIES GET FALSE, NOT A COMPUTATION. isConsecutive reads the
    // quarter number out of `fp`, and Number("FY".slice(1)) is NaN — so an
    // annual view would mark every row as a gap. A gap is a quarterly idea and
    // the badge is hidden on the annual card rather than computed wrong.
    // A GAP IS NOW ALSO A DROPPED EMPTY ROW, which is the honest reading: the
    // row below is not the period immediately before this one, whether the
    // filing is absent from the store or present with nothing in it.
    gapAfter: annualOnly ? false : shown[i + 1] ? !isConsecutive(p, shown[i + 1]) : false,
    gross, operating, net,
  })).reverse();

  const growth = rows.map(({ p, prior, revenueYoY, epsYoY }) => ({
    label: periodLabel(p),
    // THE BASE IS CARRIED WITH THE FIGURE, not left implicit. The snapshot
    // card disclosed its comparator and the table did not, which is why the
    // same wrong base was visible in one place and silent in the other.
    comparedWith: prior ? periodLabel(prior) : null,
    revenueYoY,
    epsYoY,
  })).reverse();

  // ── WHICH PERIOD THE CASH CARD IS BUILT FROM, AND WHY IT IS ONE PERIOD ────
  //
  // Half-yearly filers publish a cash-flow statement only on 6- and 12-month
  // frames. extractCompanyFacts steps one frame-length at a time, so n=2 needs
  // an n=1 and n=4 needs an n=3, and AZN supplies neither: its quarterly cash
  // cells are ALL null while its ANNUAL ones are populated. Measured, relay
  // 34978655653 -- revenue publishes n=[1,2,4] and cash flow n=[2,4], which is
  // why revenue resolves on the same 90-day row that cash flow does not.
  //
  // A permanently empty Quality of Earnings card is worse than the annual
  // figures, so the card falls back to the year.
  //
  // ── AND THE WHOLE CARD MOVES TOGETHER, WHICH IS THE POINT ────────────────
  // THE TRAP: that card's headline is "cash flow less net income". Annual
  // operating cash flow against QUARTERLY net income reads as roughly 4x cash
  // conversion, and the score would call it STRONG for a purely arithmetic
  // reason -- a plausible wrong number produced by mixing periods on one
  // comparison line.
  //
  // So `cashBasis` selects ONE period for every figure on the card: operating
  // cash flow, capex, free cash flow, net income and share-based compensation
  // all come from it, and `cashPeriod` names it on the card and in the score's
  // narrative. There is no per-row fallback, deliberately: a card assembled
  // row-by-row from whichever period happened to have a value is exactly the
  // mixed comparison this guards against.
  const cashYear = set.years[0] ?? null;
  const quarterHasCash = valueOf(latest, "operatingCashFlow") !== null;
  const cashFrom = quarterHasCash || !cashYear || valueOf(cashYear, "operatingCashFlow") === null
    ? latest
    : cashYear;
  // ANNUAL-ONLY FILERS ARE ALWAYS "year", even though cashFrom === latest.
  // The anchor IS a fiscal year for them, so the old `cashFrom === latest`
  // test reported basis "quarter" beside a period labelled FY2025 — the exact
  // period mislabel the basis field exists to prevent, arriving through the
  // one branch that had never had a non-quarter anchor.
  // WHAT KIND OF PERIOD cashFrom ACTUALLY IS, asked of the data rather than
  // inferred from `latest`. The old test was `annualOnly || cashFrom !== latest`,
  // which reported "quarter" the moment the anchor itself became a year — the
  // card would have carried annual figures under quarterly wording on exactly
  // the filer this change is about.
  const cashBasis: "quarter" | "year" =
    set.years.some((y) => y.e === cashFrom.e && y.fp === cashFrom.fp) ? "year" : "quarter";

  // ── THE FIVE-YEAR ANNUAL ROWS, BUILT ONCE FOR BOTH PLACES THEY APPEAR ────
  //
  // (i) the annual card that every stock gets, and (ii) the only growth table
  // an annual-only filer has. One shape, one builder, so the two cannot drift.
  //
  // Same rules as the quarterly table and the same helpers: YoY is FY against
  // FY-1 BY LABEL via priorYearOf, null when the prior year is not on file,
  // and margins are levels rather than changes. Oldest first for display, as
  // the quarterly table is.
  // RENDERS FIVE, SEARCHES ALL SIX — the same asymmetry as the quarterly table
  // and the entire point of storing more than is displayed. priorYearOf is
  // given `set.years`, not the sliced list; searching the trimmed list is the
  // defect itself.
  // SAME RULE, SAME REASON. Filter BEFORE the slice, so dropping a row that
  // cannot be compared does not cost the card a row that can.
  const annualRows = set.years
    .filter((p) => priorYearOf(set.years, p) !== null)
    .slice(0, RENDERED_YEARS)
    .map((p) => {
    const prior = priorYearOf(set.years, p);
    return {
      label: periodLabel(p),
      end: p.e,
      comparedWith: prior ? periodLabel(prior) : null,
      revenue: view(p, "revenue", "Revenue"),
      revenueYoY: yoy(valueOf(p, "revenue"), valueOf(prior, "revenue")),
      epsDiluted: view(p, "epsDiluted", `Diluted EPS (${epsStd})`),
      epsYoY: yoy(valueOf(p, "epsDiluted"), valueOf(prior, "epsDiluted")),
      gross: pctOf(valueOf(p, "grossProfit") ?? nullableDiff(p), valueOf(p, "revenue")),
      operating: pctOf(valueOf(p, "operatingIncome"), valueOf(p, "revenue")),
      net: pctOf(valueOf(p, "netIncome"), valueOf(p, "revenue")),
    };
  }).reverse();

  const ocf = view(cashFrom, "operatingCashFlow", "Operating cash flow");
  /**
   * THE CAPEX HEADING NAMES THE MEASURE IT IS ACTUALLY SHOWING.
   *
   * capex resolves from ONE concept per filer (FieldDef.oneConceptPerFiler):
   * PaymentsToAcquirePropertyPlantAndEquipment where the filer publishes it,
   * and the broader PaymentsToAcquireProductiveAssets only where it never does.
   * Those are different measures — productive assets is wider — so a filer on
   * the fallback is not showing the same line as a filer on the primary, and
   * one heading over both would be a false equivalence on the ones that differ.
   *
   * READ FROM THE STORED CHOICE, never inferred from the value or from absence.
   * A set written before the rule has no `cc`, and for it the honest heading is
   * the plain one: it does not know which concept it used, and inventing the
   * qualifier would label some filers wrong in the other direction.
   */
  const capexConcept = set.cc?.capex ?? null;
  const capexIsBroad = capexConcept !== null && capexConcept.endsWith("|PaymentsToAcquireProductiveAssets");
  const capexLabel = capexIsBroad
    ? "Capital expenditure (incl. other productive assets)"
    : "Capital expenditure";
  const capex = view(cashFrom, "capex", capexLabel);
  const fcf = ocf.val === null || capex.val === null ? null : ocf.val - capex.val;
  /**
   * WHICH INPUT STOPPED A DERIVED FIGURE, so the card can name it.
   *
   * "Can't calculate" on its own is the same shrug as "—" with more syllables.
   * The reader's next question is always "why", and the view is the only place
   * that knows — by the time the card has a null it has lost the reason.
   */
  const missingOf = (parts: [string, number | null][]) => {
    const gone = parts.filter(([, v]) => v === null).map(([name]) => name);
    return gone.length ? gone.join(" and ") : null;
  };
  const fcfMissing = missingOf([
    ["operating cash flow", ocf.val],
    ["capital expenditure", capex.val],
  ]);

  const bsAt = set.instants[0] ?? null;
  const std = valueOf(bsAt, "shortTermDebt");
  const ltd = valueOf(bsAt, "longTermDebt");
  const totalDebt = std === null && ltd === null ? null : (std ?? 0) + (ltd ?? 0);
  /**
   * ── CASH, AND THE ONE SUBSTITUTE THAT IS ALLOWED FOR IT ──────────────────
   *
   * Some filers tag only CashCashEquivalentsRestrictedCashAndRestrictedCash-
   * Equivalents — the combined figure — and nothing under the plain concept.
   * GEV files 13.12bn that way and rendered a blank cash line as a result.
   *
   * THE SUBSTITUTE IS NOT SILENT. It is a DIFFERENT measure: restricted cash is
   * money the company cannot freely spend, so presenting it under the same
   * label as "Cash & equivalents" would overstate what is available. It is used
   * only when the plain figure is absent, and it is LABELLED when it is — here,
   * once, so the card and net cash cannot disagree about which they showed.
   *
   * The chains stay separate: `cash` is not taught to accept the combined
   * concept, because then no card could tell the two apart.
   */
  const plainCash = view(bsAt, "cash", "Cash & equivalents");
  const inclRestricted = view(bsAt, "cashIncludingRestricted", "Cash & equivalents (incl. restricted)");
  const usingRestricted = plainCash.val === null && inclRestricted.val !== null;
  const cashCell = usingRestricted ? inclRestricted : plainCash;

  // ── SHAREHOLDERS' EQUITY, ON THE SAME RULE AS CASH ────────────────────────
  // The parent-only figure is what the row means, and it wins wherever it is
  // filed. A filer that tags only the total (AVAV: StockholdersEquityIncluding-
  // PortionAttributableToNoncontrollingInterest, 4,396,055,000 at 2026-08-01,
  // no parent-only tag — relay 35838601488) read "Not reported" beside a filed
  // equity figure. That total is already stored as `totalEquity`; the row shows
  // it UNDER ITS OWN LABEL rather than calling it the parent's equity.
  const equityCell = (at: StoredPeriod | null | undefined) => {
    const parent = view(at, "stockholdersEquity", "Shareholders' equity");
    const total = view(at, "totalEquity", "Total equity (incl. noncontrolling interests)");
    const useTotal = parent.val === null && total.val !== null;
    return { stockholdersEquity: useTotal ? total : parent, equityIncludesNci: useTotal };
  };

  const cashVal = cashCell.val;
  const sti = valueOf(bsAt, "shortTermInvestments");
  const liquid = cashVal === null && sti === null ? null : (cashVal ?? 0) + (sti ?? 0);

  const PL: [string, string][] = [
    ["revenue", "Revenue"],
    ["costOfRevenue", "Cost of revenue"],
    ["grossProfit", "Gross profit"],
    ["researchAndDevelopment", "Research & development"],
    ["sellingGeneralAndAdministrative", "Selling, general & admin"],
    ["otherOperatingExpense", "Other operating expense"],
    ["operatingIncome", "Operating income (EBIT)"],
    ["interestExpense", "Interest expense"],
    ["nonOperatingIncomeExpense", "Other income / expense"],
    ["preTaxIncome", "Pre-tax income"],
    ["incomeTaxExpense", "Income tax"],
    ["netIncomeToNoncontrollingInterest", "Less: noncontrolling interest"],
    ["netIncome", "Net income"],
    ["epsBasic", `Basic EPS (${epsStd})`],
    ["epsDiluted", `Diluted EPS (${epsStd})`],
    ["sharesDiluted", "Diluted shares"],
  ];

  // Does the stored breakdown actually reach the filed operating income? If it
  // does not, the card says the waterfall is partial rather than presenting a
  // subtraction that does not work.
  //
  // ── WHY AN ABSENT LINE NO LONGER FAILS THIS ──────────────────────────────
  // This used to also require all three expense lines to be PRESENT, which is
  // a different question from whether they add up, and it is the requirement
  // that was actually failing. MEASURED over the six committed fixtures: all
  // six reported false, every one of them for a missing line rather than a
  // failed subtraction — AAPL files no OtherOperatingExpense, and
  // 109.42B − 54.65B − 11.73B − 7.35B reaches its filed 35.70B to within 0.03%.
  // The card therefore told every reader that Apple's expense lines "do not
  // add up to operating income", which is false, and the waterfall built on
  // this flag would have drawn for nobody.
  //
  // A LINE THE FILER NEVER REPORTED IS NOT AN UNRECONCILED LINE. The sum below
  // already treats it as contributing nothing, and the table above already
  // says "Not reported" beside it. What matters is whether the lines that DO
  // exist close the gap, which is what remains asserted — plus at least one
  // real expense line, because "revenue minus nothing equals operating income"
  // reconciles trivially and breaks nothing down.
  const gp = valueOf(latest, "grossProfit");
  const opex = ["researchAndDevelopment", "sellingGeneralAndAdministrative", "otherOperatingExpense"]
    .map((k) => valueOf(latest, k));
  const opInc = valueOf(latest, "operatingIncome");
  const incomeStatementComplete =
    gp !== null && opInc !== null && opex.some((v) => v !== null) &&
    // `reduce<number>` because `some` does not narrow the array the way
    // `every((v) => v !== null)` did — TS infers a type predicate there and
    // handed the reduce a number[]. The `?? 0` was always doing the work; the
    // annotation just says so out loud.
    Math.abs(gp - opex.reduce<number>((a, b) => a + (b ?? 0), 0) - opInc) <=
      Math.max(Math.abs(opInc), 1) * 0.01;

  return {
    symbol: set.symbol,
    entityName: set.entityName,
    latestLabel: periodLabel(latest),
    latestEnd: latest.e,
    latestAccession: latest.a,
    latestFiled: latest.f,
    // BY ACCESSION, NOT BY "ff IS PRESENT": the credit belongs to the period
    // that filing supplied, and a later companyfacts re-read that published it
    // leaves no ff at all.
    latestFromFiling: set.ff && latest.a === set.ff.accn ? set.ff : null,
    filedNotInFeed: set.lg && set.lg.reportDate > latest.e ? set.lg : null,
    snapshot: {
      revenue: view(latest, "revenue", "Revenue"),
      // SAME REPORTING-CURRENCY RULE AS THE GROWTH TABLE. The snapshot's two
      // YoY figures are the most prominent numbers on the page, so leaving
      // them on converted values would put the FX move in the headline while
      // the table below it read correctly.
      revenueYoY: yoy(valueOf(home(latest), "revenue"), valueOf(home(yearAgo), "revenue")),
      epsDiluted: view(latest, "epsDiluted", `Diluted EPS (${epsStd})`),
      epsYoY: yoy(valueOf(home(latest), "epsDiluted"), valueOf(home(yearAgo), "epsDiluted")),
      netIncome: view(latest, "netIncome", "Net income"),
      operatingIncome: view(latest, "operatingIncome", "Operating income"),
      comparedWith: yearAgo ? periodLabel(yearAgo) : null,
      fyEpsDiluted: fiscalYearEps(set, latest, epsStd),
    },
    accounting: accountingOf(set),
    untagged: set.nt ?? null,
    currency:
      (set.cur ?? "USD") === "USD"
        ? null
        : {
            reporting: set.cur as string,
            source: set.fx!.source,
            latestRate: set.fx?.applied.find((a) => a.end === latest.e)?.usdPerUnit ?? null,
            latestBasis: set.fx?.applied.find((a) => a.end === latest.e)?.basis ?? null,
            refused: set.fx?.refused ?? [],
          },
    basis,
    tableBasis,
    annual: annualRows,
    margins,
    growth,
    cashQuality: {
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: fcf,
      // FCF inherits the derivation of its inputs: if either leg was
      // differenced, the difference is derived too and is labelled as such.
      freeCashFlowDerived: isDerived(ocf) || isDerived(capex),
      // FROM cashFrom, NOT FROM latest. Net income is the other half of the
      // "cash flow less net income" line, so it must be the same period or the
      // line is a ratio between a year and a quarter.
      netIncome: view(cashFrom, "netIncome", "Net income"),
      shareBasedCompensation: view(cashFrom, "shareBasedCompensation", "Share-based compensation"),
      accruals:
        ocf.val === null || valueOf(cashFrom, "netIncome") === null
          ? null
          : ocf.val - valueOf(cashFrom, "netIncome")!,
      freeCashFlowMissing: fcfMissing,
      accrualsMissing: missingOf([
        ["operating cash flow", ocf.val],
        ["net income", valueOf(cashFrom, "netIncome")],
      ]),
      basis: cashBasis,
      period: periodLabel(cashFrom),
    },
    /**
     * HOW FAR APART THE THREE PERIODS ON THIS PAGE ARE, in days.
     *
     * The page shows an income statement for one period, a cash-flow statement
     * for another and a balance sheet as at a third instant — each correctly
     * labelled, all three under a lede that says "latest reported quarter".
     * Measured on AZN: income statement Q2 FY2025, cash flow FY2025, balance
     * sheet as at 2025-12-31. Individually honest, collectively confusing.
     *
     * Null when there is no balance sheet. The card says one line when this
     * exceeds a quarter; see BALANCE_SHEET_SPREAD_DAYS.
     */
    balanceSheetSpreadDays:
      bsAt && latest.e
        ? Math.round((Date.parse(bsAt.e) - Date.parse(latest.e)) / 86400000)
        : null,
    balance: bsAt
      ? {
          asOf: bsAt.e,
          cash: cashCell,
          /** True when the cash line is the combined figure, so cards can qualify it. */
          cashIncludesRestricted: usingRestricted,
          shortTermInvestments: view(bsAt, "shortTermInvestments", "Short-term investments"),
          totalDebt,
          totalDebtMissing: missingOf([["short-term debt", std], ["long-term debt", ltd]]),
          netCash: liquid === null || totalDebt === null ? null : liquid - totalDebt,
          netCashMissing: missingOf([
            ["cash and short-term investments", liquid],
            ["total debt", totalDebt],
          ]),
          currentRatio: (() => {
            const ca = valueOf(bsAt, "totalCurrentAssets");
            const cl = valueOf(bsAt, "totalCurrentLiabilities");
            return ca === null || cl === null || cl === 0 ? null : ca / cl;
          })(),
          currentRatioMissing: missingOf([
            ["current assets", valueOf(bsAt, "totalCurrentAssets")],
            ["current liabilities", valueOf(bsAt, "totalCurrentLiabilities")],
          ]),
          totalAssets: view(bsAt, "totalAssets", "Total assets"),
          totalLiabilities: view(bsAt, "totalLiabilities", "Total liabilities"),
          ...equityCell(bsAt),
        }
      : null,
    incomeStatement: PL.map(([k, label]) => view(latest, k, label)),
    incomeStatementComplete,
    // ── THE SAME THIN-ROW BAR AS THE GROWTH TABLE, AND THE SAME CAP ─────────
    //
    // This mapped the WHOLE of `q`, unfiltered and uncapped, while the growth
    // table above filtered and sliced the identical list. So AZN rendered
    // twelve rows here, of which 2019-2021 carried a revenue figure and read
    // "Not reported" under both Diluted EPS and Net income — the exact rows the
    // growth table had already been ruled thin, in a table one card further
    // down. One list, two standards.
    //
    // THE BAR IS THIS TABLE'S OWN COLUMNS. `hasSomething` is about margins and
    // an EPS comparison, which this table does not show; here a row needs more
    // than revenue, meaning a diluted EPS or a net income. Same rule, applied
    // to what is actually on screen rather than borrowed wholesale.
    //
    // NO hasComparator. That rule drops a row with nothing BEHIND it, which
    // matters for a year-over-year table and not for one that simply lists what
    // was filed — the oldest period here is a row, not only a base.
    //
    // The tableBasis gate needs nothing new: `q` is already the list tableBasis
    // chose, so a stale quarterly series brings years here too, and
    // SecRecentPeriodsCard returns null on a year anchor regardless.
    recentPeriods: q
      .filter((p) => valueOf(p, "epsDiluted") !== null || valueOf(p, "netIncome") !== null)
      .slice(0, renderLimit)
      .map((p) => ({
        label: periodLabel(p),
        end: p.e,
        revenue: view(p, "revenue", "Revenue"),
        epsDiluted: view(p, "epsDiluted", `Diluted EPS (${epsStd})`),
        netIncome: view(p, "netIncome", "Net income"),
      })),
    ttmRevenue: ttm(q, "revenue"),
    ttmNetIncome: ttm(q, "netIncome"),
    coverShares: set.cover,
    asOf: set.at,
  };
}

/** revenue - costOfRevenue, for a filer that publishes no GrossProfit tag. */
function nullableDiff(p: StoredPeriod): number | null {
  const r = valueOf(p, "revenue");
  const c = valueOf(p, "costOfRevenue");
  return r === null || c === null ? null : r - c;
}
