// THE "GROWTH & MARGINS" PICTURE'S DATA, FROM A's VIEW (#563 COWORK #26/#27).
//
// Presentation only. Every number here is one A's buildSecEarningsView already
// produced; this file joins A's lists by period label and words them for a
// beginner. It computes no new figure from filings:
//
//   sales, profit/loss   view.recentPeriods (quarters), view.annual (years):
//                        the filed cells, with their derived marks
//   last year's bar      the period A names in growth[i].comparedWith /
//                        annual[i].comparedWith, looked up by label among the
//                        periods on this page; absent -> no ghost, never derived
//   growth wording       growth[i].revenueYoY / annual[i].revenueYoY as A
//                        computed it; above +200% it reads "from a small base"
//   "kept X¢ of $1"      margins[i].gross, A's gross margin, rounded to a cent
//   costs vs sales       A's operating / net margins, re-worded only when they
//                        are beyond ±100% ("about 2.9× sales" for -194.5%)
//   one-off tag          the note A attaches (largeNonOperatingNote), on the
//                        period A computed it for, plus any per-period notes A
//                        passes in `oneOffs`
//
// PLAIN DATA OUT, strings already formatted, so the interactive chart (a client
// component) receives JSON and never imports server code.
import type { Pct, SecEarningsView, ViewCell } from "./server/secEarningsView";
import { EMPTY_REASONS, periodWords } from "./server/secEarningsView";
import { scaledAmount } from "./server/secPresentation";

/** Above this year-on-year %, the label reads SMALL_BASE instead (COWORK #26 §2). */
export const SMALL_BASE_ABOVE_PCT = 200;
export const SMALL_BASE = "from a small base";
/** Beyond ±this %, a margin is worded as a multiple of sales (COWORK #26 §4). */
export const MARGIN_AS_MULTIPLE_BEYOND_PCT = 100;

export type GvAmount = {
  /** The filed value, for bar geometry only. */
  val: number;
  /** "$83.8M", "-$88.4M". */
  text: string;
  /** A's derived note ("Q4 = full year less nine months…"); null when filed as is. */
  derivedNote: string | null;
};

export type GvPeriod = {
  /** A's label, the join key: "Q2 FY2026", "FY2025". */
  label: string;
  /** The axis label: "Q2 '26", "FY25". */
  short: string;
  sales: GvAmount | null;
  /** The same period a year earlier, when it is on this page. */
  lastYear: (GvAmount & { label: string }) | null;
  /** "+67.0%", "from a small base", or null when not measured. */
  growth: string | null;
  profit: GvAmount | null;
  /** A's one-off note for this period, or null. */
  oneOff: string | null;
  /** Gross margin as cents kept per $1, or null with `grossNote` saying why. */
  keptCents: number | null;
  grossNote: string | null;
  /** Operating and net margin, worded: "−85.1%" or "costs were about 2.9× sales". */
  operating: string | null;
  net: string | null;
};

export type GvSeries = { one: string; many: string; periods: GvPeriod[]; summary: string | null; profitMissing: string | null };
export type GrowthVisualsData = { quarters: GvSeries | null; years: GvSeries | null };

/** "Q2 FY2026" -> "Q2 '26", "FY2025" -> "FY25"; anything else unchanged. */
export function shortLabel(label: string): string {
  const q = /^(Q[1-4]|H[12]) FY(\d{4})$/.exec(label);
  if (q) return `${q[1]} '${q[2].slice(2)}`;
  const y = /^FY(\d{4})$/.exec(label);
  return y ? `FY${y[1].slice(2)}` : label;
}

function amount(cell: ViewCell | undefined | null): GvAmount | null {
  if (!cell || cell.val == null || !Number.isFinite(cell.val)) return null;
  return { val: cell.val, text: scaledAmount(cell.val), derivedNote: cell.derivedNote ?? null };
}

const isNum = (v: Pct | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** A's YoY as a beginner reads it. Crossings and absences say nothing here. */
export function growthWords(v: Pct | undefined): string | null {
  if (!isNum(v)) return null;
  if (v > SMALL_BASE_ABOVE_PCT) return SMALL_BASE;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

/** Gross margin as cents kept of each $1 of sales. */
export function keptCents(gross: number | null, refused: boolean): { cents: number | null; note: string | null } {
  // A's own words for a refused margin (its table's "Not meaningful" tooltip).
  if (refused) return { cents: null, note: EMPTY_REASONS.revenueIncomplete };
  if (gross == null || !Number.isFinite(gross)) return { cents: null, note: null };
  if (gross < 0) return { cents: null, note: "the direct costs of sales were more than the sales" };
  return { cents: Math.round(gross), note: null };
}

/** An operating/net margin, re-worded when it is beyond ±100% of sales. */
export function marginWords(m: number | null, kind: "operating" | "net", refused: boolean): string | null {
  if (refused || m == null || !Number.isFinite(m)) return null;
  if (Math.abs(m) <= MARGIN_AS_MULTIPLE_BEYOND_PCT) return `${m >= 0 ? "" : "−"}${Math.abs(m).toFixed(1)}%`;
  if (kind === "operating") {
    // Operating margin m = (sales − operating costs) / sales, so costs/sales = 1 − m/100.
    return m < 0
      ? `costs were about ${(1 - m / 100).toFixed(1)}× sales`
      : `operating profit was about ${(m / 100).toFixed(1)}× sales`;
  }
  return m < 0
    ? `the loss was about ${(-m / 100).toFixed(1)}× sales`
    : `the profit was about ${(m / 100).toFixed(1)}× sales`;
}

/** One hedged sentence from the series. Never advice; null when there is too little to say. */
export function summaryLine(periods: GvPeriod[], growth: (Pct | undefined)[], one: string, many: string): string | null {
  const parts: string[] = [];
  // Sales: the run of year-on-year rises (or falls) ending at the newest period.
  const yoy = growth.slice().reverse();
  const first = yoy.find((v) => isNum(v));
  if (isNum(first) && isNum(yoy[0])) {
    const up = yoy[0] > 0;
    let run = 0;
    for (const v of yoy) { if (isNum(v) && (v > 0) === up && v !== 0) run++; else break; }
    if (run >= 2) parts.push(`Sales were ${up ? "higher" : "lower"} than a year earlier in each of the last ${run} ${many}`);
    else parts.push(`Sales in the latest ${one} were ${up ? "higher" : "lower"} than a year earlier`);
  }
  // Profit: losses and profits among the periods with a figure.
  const withProfit = periods.filter((p) => p.profit);
  if (withProfit.length >= 2) {
    const losses = withProfit.filter((p) => p.profit!.val < 0).length;
    const profits = withProfit.length - losses;
    const n = withProfit.length;
    let s =
      losses === n ? `it reported a net loss in all ${n} ${many} shown`
        : profits === n ? `it reported a net profit in all ${n} ${many} shown`
          : `it reported a net loss in ${losses} of the ${n} ${many} shown`;
    const profitable = withProfit.filter((p) => p.profit!.val >= 0);
    if (losses > 0 && profitable.length > 0 && profitable.every((p) => p.oneOff)) {
      s += profitable.length === 1
        ? `, and the profitable ${one} includes a one-off gain`
        : `, and each profitable ${one} includes a one-off gain`;
    }
    parts.push(s);
  }
  if (!parts.length) return null;
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * Build the picture's data from A's view.
 *
 * `oneOffs`: per-period one-off notes keyed by A's label, for periods other than
 * the latest. A's view marks only the latest period today (largeNonOperating is
 * computed on the latest income statement); this is where A can pass the others.
 */
export function buildGrowthVisuals(
  view: SecEarningsView,
  opts: { oneOffs?: Record<string, string> } = {}
): GrowthVisualsData {
  const oneOffOf = (label: string): string | null =>
    opts.oneOffs?.[label] ??
    (label === view.latestLabel && view.largeNonOperating && view.largeNonOperatingNote ? view.largeNonOperatingNote : null);

  // ── QUARTERS (or whatever the table basis is): the periods on file, oldest first.
  let quarters: GvSeries | null = null;
  if (view.recentPeriods.length) {
    const ordered = view.recentPeriods.slice().reverse();
    const byLabel = new Map(view.recentPeriods.map((p) => [p.label, p]));
    const marginOf = new Map(view.margins.map((m) => [m.label, m]));
    const growthOf = new Map(view.growth.map((g) => [g.label, g]));
    const periods: GvPeriod[] = ordered.map((p) => {
      const g = growthOf.get(p.label);
      const m = marginOf.get(p.label);
      const prior = g?.comparedWith ? byLabel.get(g.comparedWith) : undefined;
      const priorAmount = prior ? amount(prior.revenue) : null;
      const kept = keptCents(m?.gross ?? null, m?.marginsRefused ?? false);
      return {
        label: p.label,
        short: shortLabel(p.label),
        sales: amount(p.revenue),
        lastYear: priorAmount && prior ? { ...priorAmount, label: prior.label } : null,
        growth: growthWords(g?.revenueYoY),
        profit: amount(p.netIncome),
        oneOff: oneOffOf(p.label),
        keptCents: kept.cents,
        grossNote: kept.note,
        operating: marginWords(m?.operating ?? null, "operating", m?.marginsRefused ?? false),
        net: marginWords(m?.net ?? null, "net", m?.marginsRefused ?? false),
      };
    });
    // A's nouns for the table basis, not a second rule for them.
    const { one, many } = periodWords(view.tableBasis);
    quarters = {
      one, many, periods, profitMissing: null,
      summary: summaryLine(periods, ordered.map((p) => growthOf.get(p.label)?.revenueYoY), one, many),
    };
  }

  // ── YEARS: A's five-year history. It carries no net income in dollars, so the
  // profit chart says so rather than deriving one from a margin.
  let years: GvSeries | null = null;
  if (view.annual.length && view.tableBasis !== "year") {
    const byLabel = new Map(view.annual.map((a) => [a.label, a]));
    const periods: GvPeriod[] = view.annual.map((a) => {
      const prior = a.comparedWith ? byLabel.get(a.comparedWith) : undefined;
      const priorAmount = prior ? amount(prior.revenue) : null;
      const kept = keptCents(a.gross, a.marginsRefused);
      return {
        label: a.label,
        short: shortLabel(a.label),
        sales: amount(a.revenue),
        lastYear: priorAmount && prior ? { ...priorAmount, label: prior.label } : null,
        growth: growthWords(a.revenueYoY),
        profit: null,
        oneOff: null,
        keptCents: kept.cents,
        grossNote: kept.note,
        operating: marginWords(a.operating, "operating", a.marginsRefused),
        net: marginWords(a.net, "net", a.marginsRefused),
      };
    });
    const yw = periodWords("year");
    years = {
      one: yw.one, many: yw.many, periods,
      profitMissing: "Yearly profit or loss in dollars isn’t shown here yet; the net margin for each year is under “See all the numbers”.",
      summary: summaryLine(periods, view.annual.map((a) => a.revenueYoY), yw.one, yw.many),
    };
  }
  return { quarters, years };
}
