// What the earnings page renders, derived from one stored fact set.
//
// SEPARATE FROM THE PAGE ON PURPOSE. The page is 1,300 lines of JSX; the rules
// about which number is which, what is derived, and what has no source any more
// are the part that has to be checkable. scripts/check-sec-earnings-page.mjs
// asserts against this file, not against the markup.
import {
  cell, periodLabel, ttm, valueOf,
  type Cell, type StoredFactSet, type StoredPeriod,
} from "./secFactStore";

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
  margins: { label: string; gross: number | null; operating: number | null; net: number | null }[];
  growth: { label: string; revenueYoY: number | null; epsYoY: number | null }[];
  cashQuality: {
    operatingCashFlow: ViewCell;
    capex: ViewCell;
    freeCashFlow: number | null;
    freeCashFlowDerived: boolean;
    netIncome: ViewCell;
    shareBasedCompensation: ViewCell;
    accruals: number | null;
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

const pctOf = (part: number | null, whole: number | null) =>
  part === null || whole === null || whole === 0 ? null : (part / whole) * 100;

export function buildSecEarningsView(set: StoredFactSet): SecEarningsView | null {
  const q = set.quarters;
  if (!q.length) return null;
  const latest = q[0];
  // The year-ago comparator is the FOURTH quarter back, and it has to exist:
  // YoY against whatever happens to be oldest in the list would compare a
  // quarter with one three or five quarters earlier and label it "year over
  // year". Retention is 8 quarters precisely so every row in the recent table
  // has a real one.
  const yearAgo = q[4] ?? null;

  const margins = q.map((p) => ({
    label: periodLabel(p),
    gross: pctOf(valueOf(p, "grossProfit") ?? nullableDiff(p), valueOf(p, "revenue")),
    operating: pctOf(valueOf(p, "operatingIncome"), valueOf(p, "revenue")),
    net: pctOf(valueOf(p, "netIncome"), valueOf(p, "revenue")),
  })).reverse();

  const growth = q.map((p, i) => {
    const prior = q[i + 4] ?? null;
    return {
      label: periodLabel(p),
      revenueYoY: yoy(valueOf(p, "revenue"), valueOf(prior, "revenue")),
      epsYoY: yoy(valueOf(p, "epsDiluted"), valueOf(prior, "epsDiluted")),
    };
  }).reverse();

  const ocf = view(latest, "operatingCashFlow", "Operating cash flow");
  const capex = view(latest, "capex", "Capital expenditure");
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
    margins,
    growth,
    cashQuality: {
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: fcf,
      // FCF inherits the derivation of its inputs: if either leg was
      // differenced, the difference is derived too and is labelled as such.
      freeCashFlowDerived: isDerived(ocf) || isDerived(capex),
      netIncome: view(latest, "netIncome", "Net income"),
      shareBasedCompensation: view(latest, "shareBasedCompensation", "Share-based compensation"),
      accruals:
        ocf.val === null || valueOf(latest, "netIncome") === null
          ? null
          : ocf.val - valueOf(latest, "netIncome")!,
    },
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
