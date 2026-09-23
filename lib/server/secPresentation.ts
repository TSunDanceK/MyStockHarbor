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
import { isCrossing, isPct, periodWords } from "./secEarningsView";

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

// ── WHEN A MARGIN MOVE OR A GROWTH RATE IS NOT A SIGNAL (#535 COWORK #20) ──
//
// WKHS Q2 FY2026: revenue $3.6M, +374.9% on ~$0.76M, operating margin about
// -545% against about -1,197%, a $20.2M net loss — and a score of 72, near
// GOOD, because the margin "widened 658.1pp" (+10) and revenue "grew" (+22).
// Both are arithmetic on a revenue line too small to carry a ratio. Measured
// on 856 scored sets (2026-09-23): the margin rule trips 41, the floor 21.
// By rule, not by symbol; the figures still print, only the score and the
// sentence stop reading them as signals.

/** An operating margin below this (percent) is revenue too small relative to costs. */
export const MARGIN_MEANINGFUL_FLOOR_PCT = -100;
/** A margin move beyond this many percentage points is the same artefact. */
export const MARGIN_MEANINGFUL_MOVE_PP = 100;

/** Whether a margin pair (older, newer) can be read as a move at all. */
export function marginMoveMeaningful(older: number | null, newer: number | null): boolean {
  if (older === null || newer === null || !Number.isFinite(older) || !Number.isFinite(newer)) return false;
  if (older < MARGIN_MEANINGFUL_FLOOR_PCT || newer < MARGIN_MEANINGFUL_FLOOR_PCT) return false;
  return Math.abs(newer - older) <= MARGIN_MEANINGFUL_MOVE_PP;
}

export const MARGIN_NOT_MEANINGFUL = "not meaningful — revenue is too small relative to costs";

/**
 * Revenue growth off a prior-period revenue under this (USD) is shown but not
 * scored. A FLOOR ONLY (owner ruling, #535 COWORK #23): large growth off a real
 * base (NBIS +479% on $91.5M) is growth, and keeps scoring.
 */
export const REVENUE_BASE_FLOOR_USD = 5_000_000;

/** The prior period's revenue, from the latest figure and its growth. Null when either is missing. */
export function priorRevenueFrom(latest: number | null, growthPct: Pct): number | null {
  if (latest === null || !isPct(growthPct) || growthPct <= -100) return null;
  return latest / (1 + growthPct / 100);
}

export function revenueBaseTooSmall(latest: number | null, growthPct: Pct): boolean {
  const prior = priorRevenueFrom(latest, growthPct);
  return prior !== null && Math.abs(prior) < REVENUE_BASE_FLOOR_USD;
}

export const SMALL_REVENUE_BASE = "off a very small base";

/**
 * The verb for a margin move. "Widened" on a negative margin that moved towards
 * zero reads as the loss widening; for a margin below zero at either end the
 * words are "improved" / "worsened", and "widened" / "narrowed" only where both
 * ends are positive.
 */
export function marginMoveVerb(older: number, newer: number, tone: EarningsTone | null): string | null {
  if (tone !== "good" && tone !== "weak") return null;
  const positive = older >= 0 && newer >= 0;
  if (tone === "good") return positive ? "widened" : "improved";
  return positive ? "narrowed" : "worsened";
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
  /**
   * A RATE OR A LEVEL — and the card must not print them the same way.
   *
   * "+32.0%" for a median operating margin reads as 32% growth in the margin.
   * It is a level: the typical period's margin WAS 32%. The sign belongs on a
   * rate of change and nowhere else, and the card takes it from here rather
   * than from a regex over the label, which is a second rule that goes wrong
   * the first time a label is reworded.
   */
  kind: "rate" | "level";
  /** The median across the periods that were figures. Null when refused. */
  value: number | null;
  tone: EarningsTone | null;
  /**
   * THE NEWEST PERIOD'S OWN FIGURE, beside the typical one — null when it is
   * not a number (absent, or a crossing). A median can sit a long way from
   * now: AVAV's typical quarter is +133.3% because its acquisition quarters
   * dominate, while its latest quarter is +5.7%. Printing only the median
   * reads as "revenue is growing 133%" (owner review, #522).
   */
  latest: number | null;
  /** The latest figure's tone, by the same rule as `tone`. */
  latestTone: EarningsTone | null;
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
  /**
   * How many of the excluded periods were CROSSINGS rather than absences.
   *
   * The card needs the two apart: they are excluded for different reasons and
   * only one of them is worth explaining to a reader who has never seen it.
   * See toneBandNote.
   */
  crossings: number;
  /**
   * ONE HEDGED LINE when a growth median sits far above the newest figure —
   * null otherwise. See TREND_SKEW_PP.
   */
  skewNote: string | null;
};

/**
 * HOW FAR APART "TYPICAL" AND "LATEST" MAY SIT BEFORE THE CARD SAYS WHY.
 *
 * AVAV printed "Typical +133.3% · Latest +5.7%": the median is lifted by the
 * quarters that compare against its pre-acquisition base, and a reader takes
 * the big number as the current pace. Past 50 percentage points on a growth
 * line, and only where the typical figure is the HIGHER one, the card adds
 * one sentence. It states what the numbers show and gives no instruction.
 */
export const TREND_SKEW_PP = 50;

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
  // COUNTED HERE, not inferred by the caller: a crossing is a string in a Pct
  // and an absence is a null, and once both have been filtered out by isPct
  // the difference is unrecoverable.
  let crossings = 0;
  const line = (label: string, values: Pct[]): TrendLine => {
    const nums = values.filter(isPct) as number[];
    const skipped = values.length - nums.length;
    crossings += values.filter(isCrossing).length;
    // `values` is oldest first (see GrowthMarginsChart), so the newest is last.
    const last = values.length ? values[values.length - 1] : null;
    const latest = isPct(last) ? last : null;
    const latestTone = toneForGrowth(latest);
    if (nums.length < TREND_MIN_PERIODS) {
      return { label, kind: "rate", value: null, tone: null, latest, latestTone, counted: nums.length, skipped };
    }
    const m = median(nums);
    return { label, kind: "rate", value: m, tone: toneForGrowth(m as Pct), latest, latestTone, counted: nums.length, skipped };
  };

  const growth = view.growth ?? [];
  const lines = [
    line("Revenue growth", growth.map((g) => g.revenueYoY)),
    line("EPS growth", growth.map((g) => g.epsYoY)),
  ];

  // MARGIN IS A LEVEL, NOT A RATE, so it gets its own line rather than being
  // forced through the growth wording.
  const opMargins = view.margins.map((m) => m.operating).filter((x): x is number => x !== null);
  if (opMargins.length >= TREND_MIN_PERIODS) {
    const m = median(opMargins);
    lines.push({
      label: "Operating margin",
      kind: "level",
      value: m,
      // A LEVEL HAS NO TONE HERE. Whether a 6% operating margin is good depends
      // on the industry, and this page has no industry comparison — colouring
      // it would be inventing a judgement. The DIRECTION is toned below.
      tone: null,
      latest: view.margins.length ? view.margins[view.margins.length - 1].operating : null,
      latestTone: null,
      counted: opMargins.length,
      skipped: view.margins.length - opMargins.length,
    });
  }

  const totalSkipped = lines.reduce((a, l) => a + l.skipped, 0);
  // THE REASON GIVEN IS THE REASON THAT HAPPENED. The note used to offer both
  // ("either not on file, or the comparison crosses...") on every filer that
  // skipped anything, which tells a reader with one missing margin and no
  // crossing something untrue about their own page.
  const why =
    crossings === 0
      ? `the ${w.one} is not on file`
      : crossings === totalSkipped
        ? `the comparison crosses between profit and loss, where a percentage would be an artefact ` +
          `of the arithmetic rather than a rate of change`
        : `either the ${w.one} is not on file, or the comparison crosses between profit and loss, ` +
          `where a percentage would be an artefact of the arithmetic rather than a rate of change`;
  // RATES ONLY: a margin is a level, and "pace" is not a word for a level.
  const skewed = lines.some((l) =>
    l.kind === "rate" && l.value !== null && l.latest !== null && l.value - l.latest > TREND_SKEW_PP);
  const skewNote = skewed
    ? `The typical figure is lifted by a run of unusually large ${w.many}; ` +
      `the latest may be the better guide to the current pace.`
    : null;
  return {
    basis: view.tableBasis,
    lines,
    skewNote,
    exclusionNote: totalSkipped
      ? `${totalSkipped} ${totalSkipped === 1 ? `${w.one} is` : `${w.many} are`} left out of these ` +
        `figures: ${why}.`
      : null,
    crossings,
  };
}

// ── how much of a score was actually measured ─────────────────────────────

export type ScoreCoverage = {
  /** Components that ran. */
  measured: number;
  /** Components the score has at all. */
  total: number;
  /** The lowest score this filer could have reached, given what ran. */
  low: number;
  /** The highest. */
  high: number;
  /** True when anything at all could not be read. */
  partial: boolean;
  /**
   * True when the reachable band cannot leave the middle verdict — the score
   * was decided by the missing inputs, not by the company.
   */
  pinned: boolean;
};

/**
 * WHAT A SCORE COULD POSSIBLY HAVE SAID, given the inputs that ran.
 *
 * ── THE DEFECT THIS EXISTS FOR, MEASURED ON ABVX ─────────────────────────
 * ABVX renders 48/100 with a MIXED pill and a needle just left of centre,
 * laid out exactly like AAPL's. Three of the five components never ran —
 * revenue growth, EPS growth and margin direction — and those three carry 52
 * of the 58 points the score can move by. What remained was profitability (6)
 * and cash conversion (10), so the arithmetic could only ever land between 34
 * and 66, and the MIXED band is 40 to 65.
 *
 * ABVX COULD NOT HAVE SCORED WEAK OR GOOD. Not "did not" — could not, for any
 * company, however good or bad. The 48 is a reading of how little the page
 * could see, and nothing about the number, the pill or the needle said so.
 *
 * THE ARITHMETIC IS NOT THE BUG AND IS NOT CHANGED HERE. An absent component
 * contributing zero is deliberate and right: the alternative, a fixed
 * denominator, would cap a filer with no cash chain at 80 and punish it for
 * the page's own limit (see SCORE_SEED's docblock). What was missing is that
 * the READER was never told the range had collapsed.
 *
 * ── WHY THE MAXIMA ARE READ AS MAGNITUDES ────────────────────────────────
 * Every component is clamped symmetrically — clamp(v * 0.55, -22, 22),
 * clamp(v * 0.30, -20, 20), and so on — so one table of maxima describes both
 * directions. The one exception is profitability, which is +6 or -8; passing
 * its magnitude as 8 keeps `low` honest and costs `high` nothing, because a
 * band that is slightly too wide understates the problem rather than
 * inventing one.
 */
export function scoreCoverage(
  seed: number,
  maxima: Record<string, number>,
  unavailableCount: number,
  ranKeys: readonly string[]
): ScoreCoverage {
  const total = Object.keys(maxima).length;
  const measured = total - unavailableCount;
  const reach = ranKeys.reduce((a, k) => a + (maxima[k] ?? 0), 0);
  const low = Math.max(0, Math.round(seed - reach));
  const high = Math.min(100, Math.round(seed + reach));
  return { measured, total, low, high, partial: unavailableCount > 0, pinned: false };
}

/**
 * The same, with `pinned` decided against the page's own band thresholds.
 *
 * SEPARATE FROM THE ARITHMETIC because the bands live on the page and the
 * reachable range does not depend on them. A score is PINNED when its whole
 * reachable range sits inside one verdict: the verdict was then a property of
 * the missing data, and calling it "Mixed" without saying so is the claim
 * this whole module exists to stop.
 */
export function pinCoverage(c: ScoreCoverage, bandLow: number, bandHigh: number): ScoreCoverage {
  return { ...c, pinned: c.partial && c.low >= bandLow && c.high <= bandHigh };
}

/** The pill's words when not every input ran. Never a bare verdict. */
export function partialScoreLabel(c: ScoreCoverage): string {
  return `Partial · ${c.measured} of ${c.total} measured`;
}

/**
 * What the card says under a partial score — ONE LINE.
 *
 * It names each missing input WITH ITS REAL CAUSE ("EPS growth — loss in both
 * quarters"), because "not in this company's filings" was false for most of
 * them: AVAV files EPS every quarter, and EPS growth is missing because both
 * quarters were losses.
 *
 * ── THE RANGE ONLY WHEN IT SAYS SOMETHING ────────────────────────────────
 * This used to read "the score could only have landed between 0 and 100" on
 * AVAV. The arithmetic was right — the four inputs that ran reach ±50 around
 * the seed of 50 — and the sentence was empty: every score on the scale is
 * between 0 and 100. The range is printed only when it is narrower than the
 * scale, and the pinned case (ABVX: 32 to 68, inside Mixed whatever the
 * company did) keeps its consequence, because that is the one a reader must
 * not miss.
 */
export function partialScoreNote(
  c: ScoreCoverage,
  gaps: { name: string; reason: string }[],
  pinnedBand: string | null = null
): string {
  const why = gaps.length
    ? ` (${gaps.map((g) => `${g.name} — ${g.reason}`).join("; ")})`
    : "";
  const head = `Partial: ${c.measured} of ${c.total} inputs measured${why}.`;
  const informative = c.low > 0 || c.high < 100;
  const range = !informative ? ""
    : c.pinned && pinnedBand
      ? ` With these inputs it could only land between ${c.low} and ${c.high}, inside ${pinnedBand} either way.`
      : ` With these inputs it could only land between ${c.low} and ${c.high}.`;
  return `${head}${range} Not directly comparable with a full score.`;
}

/** True when the reachable range is narrower than the whole scale — worth drawing. */
export function coverageIsInformative(c: ScoreCoverage): boolean {
  return c.partial && (c.low > 0 || c.high < 100);
}

/**
 * The same fact in one sentence, for the sidebar card.
 *
 * SAME NUMBERS, SHORTER WORDS. The sidebar has no room for the list of missing
 * inputs and the reachable range — the owner's call on #514 — so it states the
 * count and the consequence and leaves the range to the full report, which
 * keeps partialScoreNote. Both take the ScoreCoverage from coverageOf, so the
 * two surfaces cannot disagree about how much was measured.
 */
export function partialScoreShortNote(c: ScoreCoverage, gaps: { name: string; reason: string }[] = []): string {
  const missing = c.total - c.measured;
  // "ISN'T IN THIS COMPANY'S FILINGS" WAS FALSE FOR MOST INPUTS — AVAV files
  // EPS every quarter; EPS growth is missing because both were losses. So the
  // sentence says "wasn't measured" and names the cause when it has one, the
  // same cause the full report prints (see partialScoreNote).
  const verb = missing === 1 ? "wasn't" : "weren't";
  const why = gaps.length ? ` (${gaps.map((g) => `${g.name} — ${g.reason}`).join("; ")})` : "";
  return `${missing} of ${c.total} score inputs ${verb} measured${why}, so this score isn't comparable with a fully measured one.`;
}

// ── how old a price may be and still be called a price ────────────────────

/**
 * How stale the close behind market cap and P/E may be, in calendar days.
 *
 * ── WHY THERE IS A BOUND AT ALL ──────────────────────────────────────────
 * MEASURED ON THE PREVIEW: RYAAY's card priced the company at 50.40 as of
 * 2025-05-15 against a live 53.51, and CNI at 106.22 as of 2026-03-16 against
 * 118.95 — sixteen and six months out. The cause was the price coming off the
 * REACTION CHART'S window, which is sized around report dates and so never
 * reaches near today for a filer that has not reported recently. That is
 * fixed at the source (the card now reads the whole series), but the bound
 * stays, because the same wrong number can arrive a second way: a symbol
 * whose bar cache simply stops — delisted, renamed, or never refilled.
 *
 * A MARKET CAP IS A CLAIM ABOUT NOW. Unlike every other figure on this page,
 * which is a filed fact frozen at its period end, market cap and P/E are
 * assertions about today's market, and a year-old close makes both of them
 * confidently wrong with nothing on screen to say so. Past the bound the card
 * says what it has instead of computing with it.
 *
 * TEN DAYS covers a long weekend either side of a public holiday and a bar
 * cache that refreshes a day late, and nothing longer. It is not a trading-day
 * count because the staleness being caught is measured in months.
 */
export const VALUATION_PRICE_MAX_AGE_DAYS = 10;

/**
 * Whether a close is recent enough to value a company with.
 *
 * `today` is passed in rather than read from the clock so the rule can be
 * tested at a fixed date — a bound that can only be exercised by waiting is a
 * bound nobody exercises.
 */
export function priceIsCurrent(asOf: string | null, today: string): boolean {
  if (!asOf) return false;
  const t = Date.parse(today);
  const a = Date.parse(asOf);
  if (!Number.isFinite(t) || !Number.isFinite(a)) return false;
  // A BAR DATED AFTER TODAY IS NOT FRESH, IT IS WRONG. A future date means the
  // series and the clock disagree, and the honest response to that is the same
  // refusal, not the most generous reading of it.
  if (a > t) return false;
  return (t - a) / 86400000 <= VALUATION_PRICE_MAX_AGE_DAYS;
}

/**
 * What the two figures read when the close behind them is too old to use.
 *
 * NOT "Not reported" — the filer reported its share count perfectly well; the
 * missing half is the price. Naming the filing there would send a reader to
 * EDGAR looking for something that is already on the page.
 */
export const STALE_PRICE_WORDS = "No recent price";

/** Said under the figures, so the staleness is stated rather than implied. */
export function stalePriceNote(price: number, asOf: string): string {
  return (
    `The most recent close on file for this symbol is ${price.toFixed(2)} on ${asOf}, which is ` +
    `more than ${VALUATION_PRICE_MAX_AGE_DAYS} days old. Market cap and P/E are claims about ` +
    `today's market, so they are not computed from it.`
  );
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
    // ── AN ABSENT LINE IS OMITTED, NOT DRAWN AT ZERO AND NOT A REFUSAL ──────
    //
    // A ZERO-LENGTH STEP IS THE THING TO AVOID: a flat "R&D" bar reads as
    // "this company spends nothing on R&D", which is a claim the filing never
    // made. But refusing the whole chart is not the fix — AAPL files no
    // OtherOperatingExpense and its four remaining lines reach operating
    // income to within 0.03%, so refusing there threw away a chart that was
    // entirely correct.
    //
    // OMITTING IS SAFE BECAUSE THE SUM IS CHECKED SEPARATELY:
    // incomeStatementComplete has already established that the lines that DO
    // exist close the gap to operating income, so a chart of those lines adds
    // up exactly as drawn. The line the filer did not report appears in the
    // table above as "Not reported" — the reader is not told it is zero, they
    // are told it is absent, and the chart makes no claim about it at all.
    //
    // A FILED ZERO IS OMITTED TOO, for the original reason: it has no length,
    // so it can only be read as a mislabelled gap.
    if (v === null || v === 0) continue;
    steps.push({ key: p.key, label: p.label, delta: -v });
  }
  // ONE EXPENSE STEP AT MINIMUM. "Revenue, then operating income" is a chart
  // of two bars that breaks nothing down, and a waterfall with no waterfall in
  // it is worse than the table it replaced.
  if (steps.length < 2) return { ok: false, why: "missing-lines" };

  // ── THE CHART CHECKS THE SUM IT ACTUALLY DRAWS ───────────────────────────
  //
  // This is NOT a second opinion on incomeStatementComplete — it is a
  // different subtraction. That flag measures GROSS PROFIT minus the operating
  // expenses; this chart runs from REVENUE, through cost of revenue, to
  // operating income. The two agree only where the filer's reported gross
  // profit equals revenue minus cost of revenue, and gross profit is its own
  // filed line, not a derivation: a filer that classifies something into it
  // that these lines do not carry passes the flag and would still draw a
  // waterfall whose bars visibly do not reach the total.
  //
  // "Never a chart that visibly fails to sum, never a fudged residual" is the
  // rule, so the last thing the gate does is add up its own steps. This is
  // also what WATERFALL_TOLERANCE_PCT is for — it was declared and never
  // enforced, which is a stated tolerance nothing was holding to.
  const drawn = steps.reduce((a, st) => a + st.delta, 0);
  if (Math.abs(drawn - operating) > Math.max(Math.abs(operating), 1) * (WATERFALL_TOLERANCE_PCT / 100)) {
    return { ok: false, why: "incomplete-breakdown" };
  }
  return { ok: true, steps, total: operating };
}

// ── how a tone is SHOWN ────────────────────────────────────────────────────

/**
 * THE COLOURS, MOVED HERE SO THE PAGE AND THE CARDS SHARE ONE SET.
 *
 * These lived in page.tsx while every card that needed them lived in
 * SecEarningsCards.tsx, so the cards had no way to reach them and the next
 * green would have been typed again. Two `#22c55e`s is how one of them becomes
 * `#22c55d` and nobody notices.
 *
 * Null is the FOURTH state and it is not a colour decision at all: no claim is
 * being made, so the mark is the page's muted ink rather than a hue that reads
 * as a verdict.
 */
export function toneColor(tone: EarningsTone | null): string {
  if (tone === "good") return "#22c55e";
  if (tone === "weak") return "#ef4444";
  if (tone === "neutral") return "#facc15";
  return "rgba(148,163,184,0.55)";
}

export function toneBg(tone: EarningsTone | null): string {
  if (tone === "good") return "rgba(34,197,94,0.10)";
  if (tone === "weak") return "rgba(239,68,68,0.10)";
  if (tone === "neutral") return "rgba(250,204,21,0.10)";
  return "rgba(148,163,184,0.08)";
}

/**
 * A FAINT BACKGROUND for a tone — the snapshot tiles. Low alpha so the text
 * over it keeps the contrast it had on the plain card, in either scheme; the
 * hue is the same one toneColor uses, so a green tile and a green chip agree.
 */
export function toneTint(tone: EarningsTone | null): string {
  if (tone === "good") return "rgba(34,197,94,0.08)";
  if (tone === "weak") return "rgba(239,68,68,0.08)";
  if (tone === "neutral") return "rgba(250,204,21,0.08)";
  return "rgba(148,163,184,0.07)";
}

/**
 * THE WORD THAT GOES WITH THE COLOUR — because colour alone is not a label.
 *
 * ── WHY EVERY CHIP CARRIES TEXT ──────────────────────────────────────────
 * Red-green is the common colour-vision deficiency, and these are the two
 * colours carrying the verdict. A chip that is only green says nothing to a
 * reader who cannot separate it from the red one, and nothing at all in print
 * or forced-colors mode. The colour is the fast path; the word is the claim.
 *
 * SEPARATE VERBS PER MEASURE, because "Good" is not what a margin does. A rate
 * grows or declines; a level widens or narrows. Reusing the score's
 * Good/Mixed/Weak here would import a verdict this card has not earned — see
 * the operating-margin line in trendSummary, which deliberately has no tone.
 */
export function growthToneWord(tone: EarningsTone | null): string {
  if (tone === "good") return "Growing";
  if (tone === "weak") return "Declining";
  if (tone === "neutral") return "Flat";
  return "Not measured";
}

export function marginToneWord(tone: EarningsTone | null): string {
  if (tone === "good") return "Widening";
  if (tone === "weak") return "Narrowing";
  if (tone === "neutral") return "Steady";
  return "Not measured";
}

/**
 * The band, as one readable sentence, so the colours on the card can be checked
 * against the rule that produced them rather than guessed at.
 *
 * ── WHY THE CROSSING CLAUSE IS CONDITIONAL ───────────────────────────────
 * The page already has this rule for the n/m legend, and check-earnings-render
 * locks it: "a standing legend for a marker that never appears is noise on
 * every other page". AAPL has never crossed between profit and loss, so a
 * sentence explaining what happens when it does is a sentence about nothing —
 * and a reader who scans it goes looking for the marker it describes.
 *
 * Shipped as a FUNCTION rather than two constants so the caller cannot pick
 * the crossing wording without having counted any crossings.
 */
export function toneBandNote(crossings: number): string {
  const bands =
    `Growth is called growing or declining beyond ±${GROWTH_BAND_PCT}%, and flat inside it. ` +
    `A margin move is called beyond ±${MARGIN_BAND_PP} percentage points.`;
  if (crossings <= 0) return bands;
  return (
    `${bands} Where a comparison crosses between profit and loss no colour is shown, because a ` +
    `percentage there is an artefact of the arithmetic rather than a rate of change.`
  );
}

// ── when a filer's fiscal years end ────────────────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/**
 * ONE SENTENCE FOR THE FIVE-YEAR TABLE'S YEAR-ENDS, or null.
 *
 * Every row carried "ended YYYY-MM-DD" under its label (owner review of AVAV,
 * round 2). The date says one thing per filer, so it is said once:
 *
 *   every end on the same month and day   "Fiscal years end 30 April."
 *   same month, the day moving            "Fiscal years end in late September."
 *     (52/53-week filers — AAPL's ran 24 to 30 September)
 *     early 1-10, mid 11-20, late 21-31; a spread across two of those
 *     names the month alone
 *   the month itself moving               null — no sentence, rather than one
 *                                         that is wrong for some rows
 *
 * The exact date stays on each label as a tooltip.
 */
export function fiscalYearEndNote(ends: string[]): string | null {
  const md = ends.map((e) => /^\d{4}-(\d{2})-(\d{2})$/.exec(e)).filter((m): m is RegExpExecArray => m !== null);
  if (!md.length || md.length !== ends.length) return null;
  const months = new Set(md.map((m) => m[1]));
  if (months.size !== 1) return null;
  const month = MONTHS[Number(md[0][1]) - 1];
  const days = md.map((m) => Number(m[2]));
  if (new Set(days).size === 1) return `Fiscal years end ${days[0]} ${month}.`;
  const third = (d: number) => (d <= 10 ? "early" : d <= 20 ? "mid" : "late");
  const thirds = new Set(days.map(third));
  return thirds.size === 1
    ? `Fiscal years end in ${[...thirds][0]} ${month}.`
    : `Fiscal years end in ${month}.`;
}

/**
 * ── ONE WAY TO WRITE A LARGE AMOUNT, DECIDED PER ROW ─────────────────────
 *
 * Owner decision (PR #531): an amount of $1B or more reads in B at two
 * decimals, as the tables already did ("$1.98B"); EVERYTHING below reads in M
 * at one decimal — "$480.5M", "$12.0M", "-$0.4M", and a filed zero "$0.0M".
 * It replaces two rules that disagreed on one page: money() fell back to the
 * full figure under $1M (AVAV income tax "-$397,000", a zero "$0"), and the
 * bars and waterfall used a second formatter that dropped the decimal past
 * 100 ("$480M" beside a table saying "$480.5M").
 *
 * PER ROW, NOT PER TABLE. A table-wide scale put the small lines of a B table
 * in B ("$0.01B" for TSLA's noncontrolling interest) — precision thrown away
 * to look tidy.
 *
 * T ONLY FROM $1T UP, which in practice is a market cap: "$1,452.30B" is the
 * rule followed off a cliff. No filed statement line reaches it.
 *
 * `currency: false` is a share count — the same scale without the $, so
 * "49.8M" rather than "49,822,595".
 */
export function scaledAmount(v: number, currency = true): string {
  const abs = Math.abs(v);
  // THE TIER IS PICKED FROM THE ROUNDED VALUE, not the raw one. 999,960,000 is
  // under $1B but rounds to 1000.0 in M, and "$1000.0M" is the unit change the
  // rule exists to prevent — so anything that rounds to 1000.0M reads in B,
  // and anything that rounds to 1000.00B reads in T.
  const [div, unit, dp] =
    Number((abs / 1e9).toFixed(2)) >= 1000 ? [1e12, "T", 2]
      : Number((abs / 1e6).toFixed(1)) >= 1000 ? [1e9, "B", 2]
        : [1e6, "M", 1];
  const s = (abs / div).toFixed(dp);
  // No sign on a figure that rounds to zero: "-$0.0M" is a minus on nothing.
  return `${v < 0 && Number(s) !== 0 ? "-" : ""}${currency ? "$" : ""}${s}${unit}`;
}

/**
 * THE ORDER FOR AMOUNTS, ON THE RAW NUMBER — never on scaledAmount's text.
 *
 * Compared as strings, "$480.5M" sorts above "$1.98B" ("4" > "1") and "-$0.4M"
 * lands wherever "-" falls. Nothing on the earnings page sorts today; this is
 * the comparator any sortable amount column must use, and
 * scripts/check-amount-sort.mjs pins it.
 *
 * NO FIGURE IS LAST IN BOTH DIRECTIONS. "Not reported" is neither the smallest
 * amount nor the largest — it is not an amount — so flipping the sort must not
 * float it to the top.
 */
export function compareAmounts(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: "asc" | "desc" = "desc",
): number {
  const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
  if (!ok(a) || !ok(b)) return ok(a) === ok(b) ? 0 : ok(a) ? -1 : 1;
  return dir === "asc" ? a - b : b - a;
}
