// What the earnings page renders, derived from one stored fact set.
//
// SEPARATE FROM THE PAGE ON PURPOSE. The page is 1,300 lines of JSX; the rules
// about which number is which, what is derived, and what has no source any more
// are the part that has to be checkable. scripts/check-sec-earnings-page.mjs
// asserts against this file, not against the markup.
import {
  cell, periodLabel, ttm, valueOf,
  type Cell, type StoredFactSet, type StoredPeriod,
} from "./secFactCodec";

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
      "Segment revenue is filed on an XBRL segment axis, and companyfacts publishes " +
      "the default context only — the breakdown is not in it. Source unresolved; see " +
      "hide-list-verdict §6.",
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
 * EPS IS GAAP, AND THE PAGE SAYS SO.
 *
 * SEC gives GAAP; FMP gave adjusted; on a charge-heavy quarter they are far
 * apart. Measured on the five-symbol run: AAPL's FQ4-2024 reads $0.97 GAAP
 * against FMP's $1.64 — the EU State Aid charge, visible in the same quarter's
 * income tax line at 14,874.0M against ~5,000M either side. Labelling it is
 * accurate whichever way the adjusted question later goes.
 */
export const GAAP_EPS_NOTE =
  "EPS is GAAP, as filed with the SEC. Companies often headline an adjusted " +
  "figure that excludes one-off charges; the two can differ substantially.";

/**
 * The label for a figure the filer did not publish for that period.
 *
 * Q4 is NEVER FILED as a standalone quarter, and every cash-flow quarter but Q1
 * is filed year-to-date, so a large share of what this page shows is arithmetic
 * on filed numbers rather than a filed number. Saying which is which is the
 * difference between a figure a reader can check against the 10-Q and one they
 * cannot.
 */
export function derivationNote(derived: Cell["derived"]): string | null {
  switch (derived) {
    case "differenced":
      return "Derived: this period minus the previous year-to-date figure, because the filer reports cash flow cumulatively.";
    case "computed":
      return "Derived: net income divided by this quarter's weighted average share count.";
    case "ambiguous":
      return "The filer reports this separately for each share class and the filing does not say which is which, so no single figure is shown.";
    default:
      return null;
  }
}

export const isDerived = (c: Cell) => c.derived === "differenced" || c.derived === "computed";

// ── the view ────────────────────────────────────────────────────────────────

export type ViewCell = Cell & { label: string; derivedNote: string | null };

const view = (p: StoredPeriod | null | undefined, key: string, label: string): ViewCell => {
  const c = cell(p, key);
  return { ...c, label, derivedNote: derivationNote(c.derived) };
};

export type SecEarningsView = {
  symbol: string;
  entityName: string | null;
  /** The newest quarter, fiscal-labelled. */
  latestLabel: string;
  latestEnd: string;
  latestAccession: string | null;
  latestFiled: string | null;
  snapshot: {
    revenue: ViewCell;
    revenueYoY: number | null;
    epsDiluted: ViewCell;
    epsYoY: number | null;
    netIncome: ViewCell;
    operatingIncome: ViewCell;
    comparedWith: string | null;
  };
  margins: {
    label: string;
    /** True when the NEXT row down (older) is not the immediately preceding fiscal quarter. */
    gapAfter: boolean;
    gross: number | null;
    operating: number | null;
    net: number | null;
  }[];
  /**
   * TRUE when the filer publishes no quarterly periods at all and this whole
   * view is built on annual ones. Cards read it to hide quarterly-only ideas
   * (the gap badge, the quarterly table heading) rather than compute them for
   * a series that has no quarters.
   */
  annualOnly: boolean;
  /**
   * Up to five fiscal years, oldest first. Rendered on EVERY stock as its own
   * card, and it is the only growth table an annual-only filer has.
   */
  annual: {
    label: string;
    end: string;
    comparedWith: string | null;
    revenue: ViewCell;
    revenueYoY: number | null;
    epsDiluted: ViewCell;
    epsYoY: number | null;
    gross: number | null;
    operating: number | null;
    net: number | null;
  }[];
  growth: {
    label: string;
    /** The period the percentages are measured against, or null when none is on file. */
    comparedWith: string | null;
    revenueYoY: number | null;
    epsYoY: number | null;
  }[];
  cashQuality: {
    operatingCashFlow: ViewCell;
    capex: ViewCell;
    freeCashFlow: number | null;
    freeCashFlowDerived: boolean;
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
    shortTermInvestments: ViewCell;
    totalDebt: number | null;
    netCash: number | null;
    currentRatio: number | null;
    totalAssets: ViewCell;
    totalLiabilities: ViewCell;
    stockholdersEquity: ViewCell;
  } | null;
  /** Days between the balance-sheet instant and the income-statement period end. */
  balanceSheetSpreadDays: number | null;
  incomeStatement: ViewCell[];
  /**
   * Whether the stored expense lines actually sum to the filed operating income.
   * Measured to fail on 5 of 32 probe quarters (ARM, MU) by 1-7%, always because
   * the filer expenses something the stored breakdown has no line for. The card
   * must not imply the waterfall is complete when it is not.
   */
  incomeStatementComplete: boolean;
  recentQuarters: {
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

const yoy = (now: number | null, then: number | null) =>
  now === null || then === null || then === 0 ? null : ((now - then) / Math.abs(then)) * 100;

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
  const annualOnly = set.quarters.length === 0;
  const q = annualOnly ? set.years : set.quarters;
  if (!q.length) return null;
  // THE FULL STORED LIST IS THE SEARCH SPACE; only the DISPLAY is trimmed.
  // Searching the trimmed list is exactly the defect this change removes.
  const shown = q.slice(0, RENDERED_QUARTERS);
  const latest = q[0];
  // MATCHED BY FISCAL LABEL. See priorYearOf for the four-year comparison the
  // old `q[4]` printed on AZN and why there is no nearest-row fallback.
  const yearAgo = priorYearOf(q, latest);

  const margins = shown.map((p, i) => ({
    label: periodLabel(p),
    // TRUE when the row OLDER than this one is not the immediately preceding
    // fiscal quarter. `shown` is newest-first, so the older neighbour is i + 1.
    //
    // ANNUAL SERIES GET FALSE, NOT A COMPUTATION. isConsecutive reads the
    // quarter number out of `fp`, and Number("FY".slice(1)) is NaN — so an
    // annual view would mark every row as a gap. A gap is a quarterly idea and
    // the badge is hidden on the annual card rather than computed wrong.
    gapAfter: annualOnly ? false : shown[i + 1] ? !isConsecutive(p, shown[i + 1]) : false,
    gross: pctOf(valueOf(p, "grossProfit") ?? nullableDiff(p), valueOf(p, "revenue")),
    operating: pctOf(valueOf(p, "operatingIncome"), valueOf(p, "revenue")),
    net: pctOf(valueOf(p, "netIncome"), valueOf(p, "revenue")),
  })).reverse();

  const growth = shown.map((p) => {
    // SEARCHES `q` (all 12 stored), RENDERS FROM `shown` (the newest 8). That
    // asymmetry is the entire point of storing more than is displayed.
    const prior = priorYearOf(q, p);
    return {
      label: periodLabel(p),
      // THE BASE IS CARRIED WITH THE FIGURE, not left implicit. The snapshot
      // card disclosed its comparator and the table did not, which is why the
      // same wrong base was visible in one place and silent in the other.
      comparedWith: prior ? periodLabel(prior) : null,
      revenueYoY: yoy(valueOf(p, "revenue"), valueOf(prior, "revenue")),
      epsYoY: yoy(valueOf(p, "epsDiluted"), valueOf(prior, "epsDiluted")),
    };
  }).reverse();

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
  const cashBasis: "quarter" | "year" = cashFrom === latest ? "quarter" : "year";

  // ── THE FIVE-YEAR ANNUAL ROWS, BUILT ONCE FOR BOTH PLACES THEY APPEAR ────
  //
  // (i) the annual card that every stock gets, and (ii) the only growth table
  // an annual-only filer has. One shape, one builder, so the two cannot drift.
  //
  // Same rules as the quarterly table and the same helpers: YoY is FY against
  // FY-1 BY LABEL via priorYearOf, null when the prior year is not on file,
  // and margins are levels rather than changes. Oldest first for display, as
  // the quarterly table is.
  const annualRows = set.years.slice(0, 5).map((p) => {
    const prior = priorYearOf(set.years, p);
    return {
      label: periodLabel(p),
      end: p.e,
      comparedWith: prior ? periodLabel(prior) : null,
      revenue: view(p, "revenue", "Revenue"),
      revenueYoY: yoy(valueOf(p, "revenue"), valueOf(prior, "revenue")),
      epsDiluted: view(p, "epsDiluted", "Diluted EPS (GAAP)"),
      epsYoY: yoy(valueOf(p, "epsDiluted"), valueOf(prior, "epsDiluted")),
      gross: pctOf(valueOf(p, "grossProfit") ?? nullableDiff(p), valueOf(p, "revenue")),
      operating: pctOf(valueOf(p, "operatingIncome"), valueOf(p, "revenue")),
      net: pctOf(valueOf(p, "netIncome"), valueOf(p, "revenue")),
    };
  }).reverse();

  const ocf = view(cashFrom, "operatingCashFlow", "Operating cash flow");
  const capex = view(cashFrom, "capex", "Capital expenditure");
  const fcf = ocf.val === null || capex.val === null ? null : ocf.val - capex.val;

  const bsAt = set.instants[0] ?? null;
  const std = valueOf(bsAt, "shortTermDebt");
  const ltd = valueOf(bsAt, "longTermDebt");
  const totalDebt = std === null && ltd === null ? null : (std ?? 0) + (ltd ?? 0);
  const cashVal = valueOf(bsAt, "cash");
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
    ["epsBasic", "Basic EPS (GAAP)"],
    ["epsDiluted", "Diluted EPS (GAAP)"],
    ["sharesDiluted", "Diluted shares"],
  ];

  // Does the stored breakdown actually reach the filed operating income? If it
  // does not, the card says the waterfall is partial rather than presenting a
  // subtraction that does not work.
  const gp = valueOf(latest, "grossProfit");
  const opex = ["researchAndDevelopment", "sellingGeneralAndAdministrative", "otherOperatingExpense"]
    .map((k) => valueOf(latest, k));
  const opInc = valueOf(latest, "operatingIncome");
  const incomeStatementComplete =
    gp !== null && opInc !== null && opex.every((v) => v !== null) &&
    Math.abs(gp - opex.reduce((a, b) => a + (b ?? 0), 0) - opInc) <=
      Math.max(Math.abs(opInc), 1) * 0.01;

  return {
    symbol: set.symbol,
    entityName: set.entityName,
    latestLabel: periodLabel(latest),
    latestEnd: latest.e,
    latestAccession: latest.a,
    latestFiled: latest.f,
    snapshot: {
      revenue: view(latest, "revenue", "Revenue"),
      revenueYoY: yoy(valueOf(latest, "revenue"), valueOf(yearAgo, "revenue")),
      epsDiluted: view(latest, "epsDiluted", "Diluted EPS (GAAP)"),
      epsYoY: yoy(valueOf(latest, "epsDiluted"), valueOf(yearAgo, "epsDiluted")),
      netIncome: view(latest, "netIncome", "Net income"),
      operatingIncome: view(latest, "operatingIncome", "Operating income"),
      comparedWith: yearAgo ? periodLabel(yearAgo) : null,
    },
    annualOnly,
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
          cash: view(bsAt, "cash", "Cash & equivalents"),
          shortTermInvestments: view(bsAt, "shortTermInvestments", "Short-term investments"),
          totalDebt,
          netCash: liquid === null || totalDebt === null ? null : liquid - totalDebt,
          currentRatio: (() => {
            const ca = valueOf(bsAt, "totalCurrentAssets");
            const cl = valueOf(bsAt, "totalCurrentLiabilities");
            return ca === null || cl === null || cl === 0 ? null : ca / cl;
          })(),
          totalAssets: view(bsAt, "totalAssets", "Total assets"),
          totalLiabilities: view(bsAt, "totalLiabilities", "Total liabilities"),
          stockholdersEquity: view(bsAt, "stockholdersEquity", "Shareholders' equity"),
        }
      : null,
    incomeStatement: PL.map(([k, label]) => view(latest, k, label)),
    incomeStatementComplete,
    recentQuarters: q.map((p) => ({
      label: periodLabel(p),
      end: p.e,
      revenue: view(p, "revenue", "Revenue"),
      epsDiluted: view(p, "epsDiluted", "Diluted EPS (GAAP)"),
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
