// WHAT THE CARDS SHOW AS COLOUR, AS A BAR, AND AS A SUMMARY — the decisions,
// separated from the JSX that draws them.
//
// Everything here is a judgement about a number: is this growth good, is this
// margin holding, does this breakdown add up, what does the run of periods say.
// None of it is layout. It lives apart from the components for two reasons:
//
//   1. A THRESHOLD IN JSX IS A THRESHOLD NOBODY CAN CHECK. `±3%` written inline
//      in three cards is three numbers that drift. Here it is one exported
//      constant a check can read from the source.
//   2. THE RULES ARE WHERE THE MISTAKES ARE. Colour on a finance page is a
//      claim — green says "this is good" — and the ways to get it wrong are
//      arithmetic, not visual.
//
// ── THE ONE RULE THAT RUNS THROUGH ALL OF IT: n/m IS NOT A NUMBER ─────────
//
// `Pct` is a number, OR a crossing marker ("turned-profitable", "swung-to-loss",
// "loss-both"), OR null. A crossing is the page saying "a percentage here would
// be an artefact of the arithmetic" — see CROSSING_NOTE. It is not a large
// positive, not a large negative, and not a zero.
//
// So a crossing colours GREY and draws NO BAR, and it is excluded from every
// aggregate rather than coerced into one. A loss-to-profit quarter averaged in
// as "+172%" is exactly the number CROSSING_NOTE exists to stop being printed;
// averaging it into a trend summary would print it again, once removed.
import type { PeriodBasis, Pct, SecEarningsView } from "./secEarningsView";
import { isPct, periodWords } from "./secEarningsView";

/** Good, mixed, weak — the page's existing three. Null is "no claim". */
export type EarningsTone = "good" | "neutral" | "weak";

/**
 * How far growth must move from flat before it is called anything.
 *
 * ±3% ON A YEAR-OVER-YEAR FIGURE. Below that the difference is inside the
 * noise of a filer's own comparability — an extra selling week, a small
 * acquisition, a currency move on a foreign reporter — and colouring it green
 * or red asserts a direction the number does not carry.
 */
export const GROWTH_BAND_PCT = 3;

/**
 * How far a margin must move, in PERCENTAGE POINTS, before it is called
 * anything.
 *
 * NOT A PERCENT OF A PERCENT. A margin going 10% -> 10.4% has moved 0.4
 * POINTS and 4 percent; the first is the number a reader means and the second
 * is four times more dramatic for no reason. Mixing the two is the classic
 * margin error, so the unit is in the constant's name.
 */
export const MARGIN_BAND_PP = 0.5;

/**
 * The tone for a growth figure, or NULL for "make no claim".
 *
 * Null covers both absent and n/m, and the caller renders both the same way:
 * grey, no bar. They are different facts — nothing filed, versus a comparison
 * that crosses zero — and the CARD says which in words. What they share is
 * that neither supports a colour.
 */
export function toneForGrowth(v: Pct): EarningsTone | null {
  if (!isPct(v)) return null;
  if (v >= GROWTH_BAND_PCT) return "good";
  if (v <= -GROWTH_BAND_PCT) return "weak";
  return "neutral";
}

/** The same, for a margin move already expressed in percentage points. */
export function toneForMarginDelta(pp: number | null): EarningsTone | null {
  if (pp === null || !Number.isFinite(pp)) return null;
  if (pp >= MARGIN_BAND_PP) return "good";
  if (pp <= -MARGIN_BAND_PP) return "weak";
  return "neutral";
}

/**
 * A value a bar chart may draw, or null for no bar at all.
 *
 * A CROSSING MUST NOT BECOME A BAR OF ANY LENGTH, including zero: a zero-height
 * bar sits on the axis and reads as "no change", which is a claim, and the
 * wrong one. Absence of a bar is the only honest rendering.
 */
export function barValue(v: Pct): number | null {
  return isPct(v) ? v : null;
}

// ── the trend summary ──────────────────────────────────────────────────────

/**
 * The fewest periods that can be called a trend.
 *
 * Two points are a line through any two points. Three is the smallest number
 * that can disagree with itself, which is what makes a direction meaningful.
 */
export const TREND_MIN_PERIODS = 3;

export type TrendLine = {
  label: string;
  /** The median across the periods that were figures. Null when refused. */
  value: number | null;
  tone: EarningsTone | null;
  /** Periods that contributed. */
  counted: number;
  /** Periods left out because they were n/m or absent. */
  skipped: number;
};

export type TrendSummary = {
  basis: PeriodBasis;
  lines: TrendLine[];
  /** Said on the card when anything was left out. Null when nothing was. */
  exclusionNote: string | null;
};

/**
 * THE MEDIAN, NOT THE MEAN.
 *
 * One quarter against a COVID-shaped base can put a +180% into an otherwise
 * flat run, and a mean reports that as the trend. The median answers the
 * question the card asks — what does a typical period look like — and is the
 * reason this is not `reduce((a,b)=>a+b)/n`.
 */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Summarise the rendered run, NEVER averaging across an n/m.
 *
 * Crossings and absences are counted and excluded, and a line that drops below
 * TREND_MIN_PERIODS is refused outright rather than summarising two periods as
 * though they were eight. The counts travel with the figure so the card can
 * say "5 of 8 periods" rather than implying it read them all.
 */
export function trendSummary(view: SecEarningsView): TrendSummary {
  const w = periodWords(view.tableBasis);
  const line = (label: string, values: Pct[]): TrendLine => {
    const nums = values.filter(isPct) as number[];
    const skipped = values.length - nums.length;
    if (nums.length < TREND_MIN_PERIODS) {
      return { label, value: null, tone: null, counted: nums.length, skipped };
    }
    const m = median(nums);
    return { label, value: m, tone: toneForGrowth(m as Pct), counted: nums.length, skipped };
  };

  const growth = view.growth ?? [];
  const lines = [
    line(`Revenue growth, typical ${w.one}`, growth.map((g) => g.revenueYoY)),
    line(`EPS growth, typical ${w.one}`, growth.map((g) => g.epsYoY)),
  ];

  // MARGIN IS A LEVEL, NOT A RATE, so it gets its own line rather than being
  // forced through the growth wording.
  const opMargins = view.margins.map((m) => m.operating).filter((x): x is number => x !== null);
  if (opMargins.length >= TREND_MIN_PERIODS) {
    const m = median(opMargins);
    lines.push({
      label: `Operating margin, typical ${w.one}`,
      value: m,
      // A LEVEL HAS NO TONE HERE. Whether a 6% operating margin is good depends
      // on the industry, and this page has no industry comparison — colouring
      // it would be inventing a judgement. The DIRECTION is toned below.
      tone: null,
      counted: opMargins.length,
      skipped: view.margins.length - opMargins.length,
    });
  }

  const totalSkipped = lines.reduce((a, l) => a + l.skipped, 0);
  return {
    basis: view.tableBasis,
    lines,
    exclusionNote: totalSkipped
      ? `${totalSkipped} ${totalSkipped === 1 ? `${w.one} is` : `${w.many} are`} left out of these ` +
        `figures: either the ${w.one} is not on file, or the comparison crosses between profit and ` +
        `loss, where a percentage would be an artefact of the arithmetic rather than a rate of change.`
      : null,
  };
}

// ── the P&L waterfall gate ────────────────────────────────────────────────

/**
 * How far the stored lines may miss operating income and still be drawn as a
 * waterfall, as a share of revenue.
 *
 * MEASURED, NOT PICKED. The breakdown was found to miss by 1–7% on 5 of 32
 * probe quarters (ARM, MU): those filers expense things the stored lines have
 * no slot for. Operating income is taken AS FILED and is right; it is the
 * SUBTRACTION that does not close.
 */
export const WATERFALL_TOLERANCE_PCT = 0.5;

export type WaterfallGate =
  | { ok: true; steps: { key: string; label: string; delta: number }[]; total: number }
  | { ok: false; why: "incomplete-breakdown" | "missing-lines" };

/**
 * MAY THE LATEST PERIOD BE DRAWN AS A WATERFALL?
 *
 * ── WHY THIS IS A GATE AND NOT A RENDERING DETAIL ────────────────────────
 * A waterfall's whole visual grammar is "these bars sum to that bar". Drawing
 * one asserts the arithmetic closes. Where it does not, every available
 * rendering lies: bars that visibly miss the total read as a drawing bug, and
 * a silent residual invents an expense the filer never reported.
 *
 * MEASURED: the breakdown misses operating income by 1-7% on 5 of 32 probe
 * quarters (ARM, MU), because those filers expense things the stored lines
 * have no slot for. Operating income is taken AS FILED and is right; it is the
 * SUBTRACTION that does not close.
 *
 * ── THE TEST IS view.incomeStatementComplete, NOT A SECOND COPY OF IT ─────
 * That flag already decides whether the P&L card calls its breakdown partial,
 * and it is computed against the stored period with its own tolerance. A
 * reconciliation test written again here would be a second rule over one fact
 * — the shape secStaleness's docblock warns about — and the two would disagree
 * the first time either tolerance moved. The chart and the card's wording now
 * turn on the same boolean, so they cannot contradict each other on screen.
 */
export function waterfallGate(view: SecEarningsView): WaterfallGate {
  if (!view.incomeStatementComplete) return { ok: false, why: "incomplete-breakdown" };
  const by = new Map(view.incomeStatement.map((c) => [c.key, c]));
  const val = (k: string) => {
    const v = by.get(k)?.val;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const revenue = val("revenue");
  const operating = val("operatingIncome");
  const parts: { key: string; label: string }[] = [
    { key: "costOfRevenue", label: "Cost of revenue" },
    { key: "researchAndDevelopment", label: "R&D" },
    { key: "sellingGeneralAndAdministrative", label: "SG&A" },
    { key: "otherOperatingExpense", label: "Other operating" },
  ];
  if (revenue === null || operating === null) return { ok: false, why: "missing-lines" };
  const steps = [{ key: "revenue", label: "Revenue", delta: revenue }];
  for (const p of parts) {
    const v = val(p.key);
    // A NULL LINE IS NOT A ZERO EXPENSE. incomeStatementComplete has already
    // established the lines reconcile, so a null here means the gate and the
    // cells disagree — refuse rather than draw a step of length zero, which
    // would read as "this company spends nothing on R&D".
    if (v === null) return { ok: false, why: "missing-lines" };
    steps.push({ key: p.key, label: p.label, delta: -v });
  }
  return { ok: true, steps, total: operating };
}
