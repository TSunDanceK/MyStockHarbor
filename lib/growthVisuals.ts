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
//   gross margin %       margins[i].gross, A's gross margin: whole % on the dot,
//                        one decimal in the panel (owner ruling, #563 COWORK #55:
//                        margins in %, never cents-per-dollar wording)
//   margin chart         gross margin; when NO period in the series has one filed
//                        (ORCL, which reports expenses by function with no cost
//                        of sales line), A's operating margin for the whole
//                        series instead, said so under the title (#563 COWORK
//                        #71). Never gross for some periods and operating for
//                        others. Neither for any period: no chart, and why.
//   costs vs sales       A's operating / net margins, re-worded only when they
//                        are beyond ±100% ("about 2.9× sales" for -194.5%)
//   one-off tag          the note A attaches (largeNonOperatingNote), on the
//                        period A computed it for, plus any per-period notes A
//                        passes in `oneOffs`
//
// THE PROFIT CHART NEEDS EVERY PERIOD CHECKED FOR A ONE-OFF (COWORK #36 blocker).
// A's view flags only the latest period today, so on ONDS as filed Q1 FY2026's
// non-operating gain would draw as a large green bar with no tag. Until A passes
// `oneOffs` (its per-period notes; an empty map means "checked, none"), the
// quarterly profit figures are left out of the picture altogether: no bars, no
// detail row, no summary clause. They stay in A's table under "See all the numbers".
//
// PLAIN DATA OUT, strings already formatted, so the interactive chart (a client
// component) receives JSON and never imports server code.
import type { Pct, SecEarningsView, ViewCell } from "./server/secEarningsView";
import { EMPTY_REASONS, periodWords } from "./server/secEarningsView";
import { scaledAmount } from "./server/secPresentation";

/** The one plain sentence explaining gross margin (#563 COWORK #55), printed under "About these figures". */
export const GROSS_MARGIN_MEANS = "Gross margin is the share of sales left after the direct costs of making them.";
/** The same sentence when the chart shows operating margin instead (#563 COWORK #71/#72). */
export const OPERATING_MARGIN_MEANS = "Operating margin is the share of sales left after the costs of running the business, before interest and tax.";

/**
 * The card's one intro line, following the series' measure (#563 COWORK #72):
 * "…and gross margin each quarter", "…and operating margin…", or no margin at all.
 */
export function introLine(kind: GvMarginKind | undefined, one: string): string {
  const what = kind === "operating" ? "Sales, profit or loss and operating margin" : kind === "none" ? "Sales and profit or loss" : "Sales, profit or loss and gross margin";
  return `${what} each ${one}, as filed. Tap a ${one} for its figures.`;
}
/** The "About these figures" margin sentence for the series' measure; null when there is no margin chart. */
export const marginMeans = (kind: GvMarginKind | undefined): string | null =>
  kind === "operating" ? OPERATING_MARGIN_MEANS : kind === "none" ? null : GROSS_MARGIN_MEANS;

/** Above this year-on-year %, the label reads SMALL_BASE instead (COWORK #26 §2). */
export const SMALL_BASE_ABOVE_PCT = 200;
export const SMALL_BASE = "from a small base";
/** Beyond ±this %, a margin is worded as a multiple of sales (COWORK #26 §4). */
export const MARGIN_AS_MULTIPLE_BEYOND_PCT = 100;
/** Shown in place of the quarterly profit chart until A's per-period one-off notes arrive. */
export const profitWaitsForOneOffs = (one: string) =>
  `Profit or loss for each ${one} is under “See all the numbers” for now, until one-off gains and losses are marked on every ${one}.`;

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
  /**
   * Set when A's one-off rule cannot be run on this period (view.oneOffUnchecked,
   * #552 COWORK #117): no profit bar and no figure, and this says why.
   */
  profitUnchecked?: string | null;
  /** Gross margin, whole %, for the dot (negative is drawn below zero, red); null with `grossNote` saying why. */
  grossPct: number | null;
  /** The same margin at one decimal for the panel ("43.4%"), or null. */
  grossText: string | null;
  /** Why there is no gross margin. Set whenever grossPct is null (a missing dot always says why); on a negative one, what it means. */
  grossNote: string | null;
  /**
   * Operating margin for the chart when the series falls back to it (#563
   * COWORK #71): whole % for the dot, one decimal for the panel, or null with
   * why. Computed for every period; drawn only when GvSeries.margin.kind is
   * "operating".
   */
  opPct: number | null;
  opText: string | null;
  opNote: string | null;
  /** Operating and net margin, worded: "−85.1%" or "costs were about 2.9× sales". */
  operating: string | null;
  net: string | null;
};

/**
 * Which margin the series' third chart draws (#563 COWORK #71): gross when any
 * period has a gross margin filed; operating for the WHOLE series when none
 * does; none (no chart, `note` says why) when operating is missing too.
 */
export type GvMarginKind = "gross" | "operating" | "none";
export type GvMargin = {
  kind: GvMarginKind;
  /** Under the chart's title (operating), or in place of the chart (none). Null for gross. */
  note: string | null;
  /** The panel's gross-margin row when no period has one: "Not stated in Oracle's filings". */
  grossAbsent: string | null;
};

export type GvSeries = { one: string; many: string; periods: GvPeriod[]; summary: string | null; profitMissing: string | null; margin: GvMargin };
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
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A's YoY as a beginner reads it. Crossings and absences say nothing here. */
export function growthWords(v: Pct | undefined): string | null {
  if (!isNum(v)) return null;
  if (v > SMALL_BASE_ABOVE_PCT) return SMALL_BASE;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

/**
 * A's gross margin as a percentage, or the reason there is none. NEVER A BLANK
 * WITHOUT A REASON (#563 COWORK #55): every null carries a note, in A's words
 * where A has them.
 */
export function grossMargin(
  gross: number | null,
  refused: boolean,
  hasSales: boolean
): { pct: number | null; text: string | null; note: string | null } {
  // A's own words for a refused margin (its table's "Not meaningful" tooltip).
  if (refused) return { pct: null, text: null, note: EMPTY_REASONS.revenueIncomplete };
  if (gross == null || !Number.isFinite(gross)) {
    return { pct: null, text: null, note: hasSales ? EMPTY_REASONS.notCaptured : EMPTY_REASONS.needsRevenue };
  }
  // NEGATIVE IS DRAWN, BELOW ZERO, IN RED (owner, 3 Oct): the chart's scale
  // moves down to take it. The note says what a negative gross margin means.
  if (gross < 0) return { pct: Math.round(gross), text: `−${Math.abs(gross).toFixed(1)}%`, note: "The direct costs of sales were more than the sales" };
  return { pct: Math.round(gross), text: `${gross.toFixed(1)}%`, note: null };
}

/**
 * A's operating margin as the chart's dot, when the series has no gross margin
 * at all (#563 COWORK #71). The same rules as grossMargin: a refusal and a
 * missing figure each say why. An operating loss is drawn below zero, in red
 * (owner, 3 Oct); the panel's operating row words it.
 */
export function operatingMarginDot(
  m: number | null,
  refused: boolean,
  hasSales: boolean
): { pct: number | null; text: string | null; note: string | null } {
  if (refused) return { pct: null, text: null, note: EMPTY_REASONS.revenueIncomplete };
  if (m == null || !Number.isFinite(m)) {
    return { pct: null, text: null, note: hasSales ? EMPTY_REASONS.notCaptured : EMPTY_REASONS.needsRevenue };
  }
  if (m < 0) return { pct: Math.round(m), text: `−${Math.abs(m).toFixed(1)}%`, note: null };
  return { pct: Math.round(m), text: `${m.toFixed(1)}%`, note: null };
}

/** Corporate suffixes dropped from a filer's SEC name for the margin note. */
const NAME_SUFFIX = /\b(corporation|corp|incorporated|inc|company|co|ltd|limited|plc|holdings?|group|n\.?v|s\.?a|ag|se|lp|llc)\.?$/i;
const SMALL_WORDS = new Set(["of", "and", "the", "for", "&"]);

/**
 * "ORACLE CORP" -> "Oracle"; "BANK OF AMERICA CORP /DE/" -> "Bank of America".
 * The filer's own SEC name, title-cased with its legal suffix dropped, for
 * "Oracle's filings don't state…". Null when there is nothing left to say.
 */
export function filerName(entityName: string | null | undefined): string | null {
  let n = (entityName ?? "").replace(/\s*\/[A-Z]{2,}\/?\s*$/i, "").replace(/[,.]+$/, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = n.replace(NAME_SUFFIX, "").replace(/[\s,&]+$/, "").trim();
    if (next === n || !next) break;
    n = next;
  }
  if (!n) return null;
  return n.split(/\s+/).map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(" ");
}

/** "Oracle's" / "This company's". */
const filersOf = (name: string | null) => (name ? `${name}'s` : "This company's");

/**
 * The series' margin chart: gross, operating for the whole series, or none.
 * `grossFiled` counts the periods with a gross margin figure at all (a negative
 * one counts and is drawn below zero). `opDrawn` counts periods with an
 * operating margin dot: a loss is drawn too, below zero (owner, 3 Oct).
 */
export function marginChoice(grossFiled: number, opDrawn: number, name: string | null, many: string): GvMargin {
  if (grossFiled > 0) return { kind: "gross", note: null, grossAbsent: null };
  const whose = filersOf(name);
  const grossAbsent = `Not stated in ${name ? `${name}'s` : "this company's"} filings`;
  if (opDrawn > 0) {
    return {
      kind: "operating",
      note: `${whose} filings don't state a cost of sales line, so gross margin can't be worked out; operating margin is shown instead.`,
      grossAbsent,
    };
  }
  const mid = name ? `${name}'s` : "this company's";
  return {
    kind: "none",
    note: `No margin chart: ${mid} filings don't state a cost of sales line, and operating margin isn't available for these ${many}.`,
    grossAbsent,
  };
}

/**
 * An operating/net margin, re-worded when it is beyond ±100% of sales.
 *
 * ONE PATTERN FOR THE MULTIPLES (COWORK #36 ask 2): "<what> was/were about N× sales",
 * with the "what" naming the measure, so the two read side by side as
 * "operating costs were about 2.9× sales · the net loss was about 1.1× sales".
 * Within ±100% it stays a percentage, and the panel shows it under "Operating margin".
 */
export function marginWords(m: number | null, kind: "operating" | "net", refused: boolean): string | null {
  if (refused || m == null || !Number.isFinite(m)) return null;
  if (Math.abs(m) <= MARGIN_AS_MULTIPLE_BEYOND_PCT) return `${m >= 0 ? "" : "−"}${Math.abs(m).toFixed(1)}%`;
  if (kind === "operating") {
    // Operating margin m = (sales − operating costs) / sales, so costs/sales = 1 − m/100.
    return m < 0
      ? `operating costs were about ${(1 - m / 100).toFixed(1)}× sales`
      : `the operating profit was about ${(m / 100).toFixed(1)}× sales`;
  }
  return m < 0
    ? `the net loss was about ${(-m / 100).toFixed(1)}× sales`
    : `the net profit was about ${(m / 100).toFixed(1)}× sales`;
}

/**
 * One short hedged line from the series (#563 COWORK #56: "Sales up on a year
 * earlier in the last 2 quarters · a net loss in 7 of 8"). Never advice; null
 * when there is too little to say.
 */
export function summaryLine(periods: GvPeriod[], growth: (Pct | undefined)[], one: string, many: string): string | null {
  const parts: string[] = [];
  // Sales: the run of year-on-year rises (or falls) ending at the newest period.
  const yoy = growth.slice().reverse();
  const first = yoy.find((v) => isNum(v));
  if (isNum(first) && isNum(yoy[0])) {
    const up = yoy[0] > 0;
    let run = 0;
    for (const v of yoy) { if (isNum(v) && (v > 0) === up && v !== 0) run++; else break; }
    parts.push(run >= 2
      ? `Sales ${up ? "up" : "down"} on a year earlier in each of the last ${run} ${many}`
      : `Sales ${up ? "up" : "down"} on a year earlier in the latest ${one}`);
  }
  // Profit: losses and profits among the periods with a figure.
  const withProfit = periods.filter((p) => p.profit);
  if (withProfit.length >= 2) {
    const losses = withProfit.filter((p) => p.profit!.val < 0).length;
    const profits = withProfit.length - losses;
    const n = withProfit.length;
    let s =
      losses === n ? `a net loss in all ${n} ${many}`
        : profits === n ? `a net profit in all ${n} ${many}`
          : `a net loss in ${losses} of ${n} ${many}`;
    const profitable = withProfit.filter((p) => p.profit!.val >= 0);
    if (losses > 0 && profitable.length > 0 && profitable.every((p) => p.oneOff)) {
      s += profitable.length === 1
        ? ` (the profitable ${one} includes a one-off gain)`
        : ` (each profitable ${one} includes a one-off gain)`;
    }
    parts.push(s);
  }
  if (!parts.length) return null;
  const text = parts.join(" · ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Whether any period's sales or profit is derived, for the "*" footnote under "About these figures". */
export const anyDerived = (s: GvSeries | null): boolean =>
  !!s && s.periods.some((p) => p.sales?.derivedNote || p.profit?.derivedNote || p.lastYear?.derivedNote);

/**
 * Build the picture's data from A's view.
 *
 * `oneOffs`: per-period one-off notes keyed by A's label, for periods other than
 * the latest. A's view marks only the latest period today (largeNonOperating is
 * computed on the latest income statement); this is where A can pass the others.
 * Passing it (even `{}`) says every period was checked, and turns the quarterly
 * profit chart on; leaving it out keeps the chart off (see the header).
 */
/** Said in place of a profit figure the one-off rule could not check (#552 COWORK #117). */
export const PROFIT_UNCHECKED =
  "Not drawn: this period can’t be checked for one-off gains or losses (the filing reports no revenue, operating income or non-operating figure for it).";

export function buildGrowthVisuals(
  view: SecEarningsView,
  opts: { oneOffs?: Record<string, string>; unchecked?: string[] } = {}
): GrowthVisualsData {
  const profitChecked = opts.oneOffs !== undefined;
  const name = filerName(view.entityName);
  // A PERIOD THE RULE COULD NOT RUN ON IS NOT "CHECKED, NONE": no bar for it.
  const unchecked = new Set(opts.unchecked ?? []);
  const oneOffOf = (label: string): string | null =>
    opts.oneOffs?.[label] ??
    (label === view.latestLabel && view.largeNonOperating && view.largeNonOperatingNote ? view.largeNonOperatingNote : null);

  // The profit fields, the same for quarters and years: drawn only once every
  // period was checked, never for a period the rule could not run on.
  const profitOf = (label: string, netIncome: ViewCell) => ({
    profit: profitChecked && !unchecked.has(label) ? amount(netIncome) : null,
    oneOff: profitChecked && !unchecked.has(label) ? oneOffOf(label) : null,
    profitUnchecked: profitChecked && unchecked.has(label) ? PROFIT_UNCHECKED : null,
  });

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
      const kept = grossMargin(m?.gross ?? null, m?.marginsRefused ?? false, amount(p.revenue) !== null);
      const op = operatingMarginDot(m?.operating ?? null, m?.marginsRefused ?? false, amount(p.revenue) !== null);
      return {
        label: p.label,
        short: shortLabel(p.label),
        sales: amount(p.revenue),
        lastYear: priorAmount && prior ? { ...priorAmount, label: prior.label } : null,
        growth: growthWords(g?.revenueYoY),
        ...profitOf(p.label, p.netIncome),
        grossPct: kept.pct,
        grossText: kept.text,
        grossNote: kept.note,
        opPct: op.pct,
        opText: op.text,
        opNote: op.note,
        operating: marginWords(m?.operating ?? null, "operating", m?.marginsRefused ?? false),
        net: marginWords(m?.net ?? null, "net", m?.marginsRefused ?? false),
      };
    });
    // A's nouns for the table basis, not a second rule for them.
    const { one, many } = periodWords(view.tableBasis);
    const grossFiled = ordered.filter((p) => isFiniteNum(marginOf.get(p.label)?.gross)).length;
    quarters = {
      one, many, periods, profitMissing: profitChecked ? null : profitWaitsForOneOffs(one),
      margin: marginChoice(grossFiled, periods.filter((p) => p.opPct !== null).length, name, many),
      summary: summaryLine(periods, ordered.map((p) => growthOf.get(p.label)?.revenueYoY), one, many),
    };
  }

  // ── YEARS: A's five-year history, with each year's filed net income. A's
  // `oneOffs` covers every stored fiscal year too (#552 COWORK #117), so the
  // profit chart follows the same gate as the quarters'. Never derived from a margin.
  let years: GvSeries | null = null;
  if (view.annual.length && view.tableBasis !== "year") {
    const byLabel = new Map(view.annual.map((a) => [a.label, a]));
    const periods: GvPeriod[] = view.annual.map((a) => {
      const prior = a.comparedWith ? byLabel.get(a.comparedWith) : undefined;
      const priorAmount = prior ? amount(prior.revenue) : null;
      const kept = grossMargin(a.gross, a.marginsRefused, amount(a.revenue) !== null);
      const op = operatingMarginDot(a.operating, a.marginsRefused, amount(a.revenue) !== null);
      return {
        label: a.label,
        short: shortLabel(a.label),
        sales: amount(a.revenue),
        lastYear: priorAmount && prior ? { ...priorAmount, label: prior.label } : null,
        growth: growthWords(a.revenueYoY),
        ...profitOf(a.label, a.netIncome),
        grossPct: kept.pct,
        grossText: kept.text,
        grossNote: kept.note,
        opPct: op.pct,
        opText: op.text,
        opNote: op.note,
        operating: marginWords(a.operating, "operating", a.marginsRefused),
        net: marginWords(a.net, "net", a.marginsRefused),
      };
    });
    const yw = periodWords("year");
    years = {
      one: yw.one, many: yw.many, periods,
      margin: marginChoice(view.annual.filter((a) => isFiniteNum(a.gross)).length, periods.filter((p) => p.opPct !== null).length, name, yw.many),
      profitMissing: profitChecked ? null : profitWaitsForOneOffs(yw.one),
      summary: summaryLine(periods, view.annual.map((a) => a.revenueYoY), yw.one, yw.many),
    };
  }
  return { quarters, years };
}
