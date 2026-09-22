// The earnings score, on filed figures — ONE COPY, TWO SURFACES.
//
// ── WHY THIS LEFT THE PAGE ────────────────────────────────────────────────
// Every line below was written for and lived inside
// app/stock/[symbol]/earnings/page.tsx. It moved here unchanged when the
// sidebar snapshot card (app/components/LatestEarningsCard.tsx) came off FMP
// and needed the same tone: the alternative was a second scorer reading the
// same SecEarningsView, and two scorers for one value is the failure this repo
// has already catalogued (claude/traps/two-validators-for-one-value.md). They
// would agree on every symbol anyone opened and disagree on the ones nobody
// did — /stock/MU's sidebar reading Good over a /stock/MU/earnings gauge
// reading Mixed, from the same filing.
//
// SO THE PAGE AND THE CARD CALL scoreFromSec. Nothing here is new logic and
// nothing was tuned on the way across; scripts/check-sec-earnings-page.mjs
// lifts this file now instead of grepping the page for it, which is the same
// assertions against the same arithmetic.
import {
  isPct, periodWords,
  type PeriodBasis, type SecEarningsView,
} from "./secEarningsView";
import type { ColdResult } from "./secColdFetch";
import type { EarningsTone as PresentationTone } from "./secPresentation";

// THE TYPE COMES FROM THE RULES MODULE, so a fourth tone could not be added to
// one side only.
export type EarningsTone = PresentationTone;

/**
 * THE BANDS, WITH THEIR THRESHOLDS, IN ONE TABLE — AND THE GAUGE READS IT.
 *
 * ── THE CONTRADICTION THIS REMOVES ────────────────────────────────────────
 * Measured on the #465 preview, /stock/KGC/earnings: a pill reading "Good"
 * sitting directly above a gauge whose axis was labelled Weak / Mixed /
 * Strong, under the number 100/100. Two vocabularies for one scale, and the
 * top of the axis named a band the pill could never produce — so a perfect
 * score looked like it had fallen short of a "Strong" that does not exist.
 *
 * NOT A CLAMP BUG, which was the other candidate: `tone` is derived from
 * `rounded`, the SAME clamped value the card prints, so the number and the
 * band always agree with each other. The axis was the only thing disagreeing.
 *
 * The thresholds were also invisible. A reader could see 100/100 and "Good"
 * and had no way to know what 100 had to clear, so the card states them.
 */
export const SCORE_BANDS: { tone: EarningsTone; label: string; from: number }[] = [
  { tone: "good", label: "Good", from: 66 },
  { tone: "neutral", label: "Mixed", from: 40 },
  { tone: "weak", label: "Weak", from: 0 },
];

/** The band a tone belongs to. The pill and the gauge axis both call this. */
export function toneLabel(tone: EarningsTone) {
  return SCORE_BANDS.find((b) => b.tone === tone)!.label;
}

/**
 * The thresholds as one sentence, so the number on the card can be read.
 *
 * A FUNCTION, NOT A CONST, because SCORE_SEED is declared further down this
 * module and a top-level const reading it here throws in the temporal dead
 * zone at import — a blank page, not a wrong word.
 */
export function scoreBandNote() {
  return (
    `${SCORE_BANDS[0].label} is ${SCORE_BANDS[0].from} and above, ` +
    `${SCORE_BANDS[1].label} is ${SCORE_BANDS[1].from} to ${SCORE_BANDS[0].from - 1}, ` +
    `${SCORE_BANDS[2].label} is ${SCORE_BANDS[1].from - 1} and below. ` +
    `${SCORE_SEED} is the neutral starting point, not a reading.`
  );
}

/** The band for a score, read from the same table the axis is labelled from. */
export function bandFor(score: number): EarningsTone {
  return SCORE_BANDS.find((b) => score >= b.from)!.tone;
}

// toneColor and toneBg now live in lib/server/secPresentation.ts, because the
// cards in SecEarningsCards.tsx need the same greens and had no way to reach
// these. Two `#22c55e`s is how one of them becomes `#22c55d`.

/**
 * The five things the score can read, DESCRIBED IN THE PAGE'S OWN PERIOD.
 *
 * These strings said "the same quarter a year earlier" and "whether the
 * quarter was profitable" for every filer, including one whose every figure is
 * a fiscal year. They take the basis now, like every other period noun on the
 * page — see PeriodBasis in secEarningsView.
 */
export const scoreComponents = (basis: PeriodBasis) => {
  const w = periodWords(basis);
  return {
    revenueGrowth: `revenue growth against ${w.yoyPhrase}`,
    epsGrowth: `EPS growth against ${w.yoyPhrase}`,
    profitability: `whether the ${w.one} was profitable`,
    marginTrend: "the direction of operating margin",
    // The wording stays period-neutral because it also appears in the
    // "Not measured" list, where no period applies.
    cashConversion: "whether reported profit is turning into cash",
  } as const;
};
/** The quarterly wording, for the states where there is no view to take a basis from. */
export const SCORE_COMPONENTS = scoreComponents("quarter");
export type ScoreComponent = keyof ReturnType<typeof scoreComponents>;

/**
 * THE NARRATIVE IS BUILT FROM WHAT ACTUALLY RAN, not from the tone alone.
 *
 * ── WHAT THE TONE-ONLY VERSION CLAIMED ────────────────────────────────────
 * Measured on the #464 preview, /stock/AZN/earnings: every field of the
 * Quality of Earnings card rendered "—" — operating cash flow, capital
 * expenditure, free cash flow, cash-flow-less-net-income, share-based
 * compensation — and the score directly above it read GOOD, 100/100, with
 * "reported profit is backed by cash."
 *
 * The scorer had not awarded points for the missing chain; the sentence was
 * canned per tone and asserted the claim regardless. That is the same failure
 * shape as a check that supplies its own expected value: the component that
 * could not be measured still spoke.
 *
 * So the clauses are assembled from the components that RAN, and a component
 * that did not run contributes no clause and is listed as unavailable.
 */
function scoreExplanation(
  tone: EarningsTone,
  ran: Set<ScoreComponent>,
  /** The period the cash component actually read. See SecCashQualityCard. */
  cashBasis: "quarter" | "year",
  cashPeriod: string,
  /** The page's own anchor. NOT cashBasis: those differ on a half-yearly filer. */
  basis: PeriodBasis = "quarter"
) {
  const w = periodWords(basis);
  const clauses: string[] = [];
  const up = tone === "good";
  if (ran.has("revenueGrowth") || ran.has("epsGrowth")) {
    clauses.push(up ? "revenue and profit are growing year over year" : "growth is under pressure");
  }
  if (ran.has("marginTrend")) clauses.push(up ? "margins are holding" : "margins are slipping");
  // THE CLAUSE THAT WAS WRONG. It appears only when the cash component ran —
  // AND IT NAMES ITS PERIOD when that period is not the quarter the rest of the
  // sentence is about. A half-yearly filer's cash component reads the full
  // year, and a sentence that said "backed by cash" beside quarterly growth
  // would be describing two different periods as one.
  if (ran.has("cashConversion")) {
    const over = cashBasis === "year" ? ` over ${cashPeriod}` : "";
    clauses.push(up ? `reported profit is backed by cash${over}` : `cash conversion is weak${over}`);
  } else if (ran.has("profitability")) {
    clauses.push(up ? `the ${w.one} was profitable` : `the ${w.one} was loss-making`);
  }
  const body = clauses.length
    ? clauses.join(", ").replace(/, ([^,]*)$/, " and $1")
    : "the filing carries few of the figures this score reads";
  if (tone === "good") return `The latest filed ${w.one} reads constructive: ${body}.`;
  if (tone === "weak") return `The latest filed ${w.one} reads weak: ${body}.`;
  return `The latest earnings read is mixed: ${body}. Investors should focus on whether future reports confirm improvement or reveal more pressure.`;
}

/** What the score could NOT read, in the page's own words and its own period. */
function scoreGaps(ran: Set<ScoreComponent>, basis: PeriodBasis = "quarter"): string[] {
  const names = scoreComponents(basis);
  return (Object.keys(names) as ScoreComponent[])
    .filter((k) => !ran.has(k))
    .map((k) => names[k]);
}

/**
 * THE SCALE, STATED ONCE SO IT CAN BE CHECKED.
 *
 * 50 is the neutral seed and each component adds a signed contribution. That is
 * what makes an absent component NEUTRAL rather than a penalty: it contributes
 * ZERO, and zero is the middle of its own range, not the bottom of it.
 *
 * THE MIRROR-IMAGE FAILURE THIS RULES OUT. Had the score been a percentage over
 * a FIXED denominator of five, a filer whose cash chain cannot produce a
 * quarterly figure would be capped at four fifths — 80 — and could never read
 * STRONG however good its filings were. That would have replaced a score that
 * claimed an input it could not see with one that punished the filer for the
 * page's own limit. Measured against these bounds: the four non-cash components
 * sum to +58 at their maxima, so 50 + 58 = 108 clamps to 100. A filer with no
 * cash chain can still reach 100.
 */
export const SCORE_SEED = 50;
export const SCORE_MAX_CONTRIBUTION: Record<ScoreComponent, number> = {
  revenueGrowth: 22,
  epsGrowth: 20,
  profitability: 6,
  marginTrend: 10,
  cashConversion: 10,
};

function buildScoreResult(
  score: number,
  tone: EarningsTone,
  ran: Set<ScoreComponent>,
  contributions: Partial<Record<ScoreComponent, number>>,
  cashBasis: "quarter" | "year",
  cashPeriod: string,
  basis: PeriodBasis = "quarter"
) {
  return {
    available: true as const,
    score,
    tone,
    label: toneLabel(tone),
    explanation: scoreExplanation(tone, ran, cashBasis, cashPeriod, basis),
    // THE SCORE SAYS WHICH KIND OF PERIOD IT READ. Point 5 of the approved
    // scope: an annual-only filer's score is built on fiscal years, and a
    // reader comparing it with a 10-Q filer's score has to be told that.
    basis,
    // NOT a count. A reader needs to know WHICH input was missing to judge the
    // number; "4 of 5 signals" is the kind of summary that hides the one that
    // mattered.
    unavailable: scoreGaps(ran, basis),
    // THE ARITHMETIC, NOT A DESCRIPTION OF IT. Carried so a probe and a check
    // can read the points each component actually added, rather than inferring
    // them from the total -- which is how "80 is four fifths of 100, so the
    // denominator must be five" becomes plausible. It is not: 80 here is
    // 50 + 6.4 + 8.0 + 6 + 10.
    seed: SCORE_SEED,
    contributions,
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * The earnings score, rebuilt on filed figures.
 *
 * TWO OF ITS THREE SIGNALS WERE ESTIMATES, AND THEY ARE GONE. The old version
 * weighted EPS surprise at 1.35x and revenue surprise at 3.2x -- together the
 * dominant term -- against FMP's analyst consensus, which left with the FMP
 * licence. Those terms were not simply deleted: a score still described as
 * measuring "estimate performance" while silently running on growth alone is
 * worse than no score, because it keeps the authority of the old one.
 *
 * So it is scored on what the filings actually contain -- growth against the
 * year-ago quarter, profitability, margin direction, and whether reported
 * profit is turning into cash -- and the explanation says so.
 *
 * `available: false` is still the point. It returns 50 because the shape
 * requires a number, but 50 is NOT a reading: it is the neutral seed with
 * nothing added, and the card must not render it as one.
 */
/**
 * WHY THERE IS NO SCORE, in the same words the cards below use.
 *
 * ── ONE MESSAGE WAS SERVING SIX SITUATIONS ────────────────────────────────
 * The unavailable branch said "This company's SEC filings have not been read
 * into the site yet" whenever `view` was null, and that is true of exactly one
 * of them. On /stock/RYAAY/earnings it put that sentence at the top of a page
 * whose own card two sections down said "Its filings are available now on SEC
 * EDGAR" — two statements contradicting each other about the same company,
 * three inches apart. Ryanair HAS been read in: 5 instants and 5 years are
 * stored. What it does not have is figures this page can print, because it
 * reports in euros.
 *
 * The states, and which sentence each gets:
 *
 *   no-cik                     404s before this runs.
 *   pending                    genuinely not read in yet — the original text.
 *   no-xbrl / currency         read in; reports in a currency this page does
 *                              not print. RYAAY lands here.
 *   no-xbrl / unread-taxonomy  read in; filed under a taxonomy not read yet.
 *   no-xbrl / unread-detail    read in; nothing resolved from what we do read.
 *   no-xbrl / none             filed no XBRL financial statements at all.
 *   no-xbrl / unknown          stored before the taxonomy census existed.
 *   ready, no quarters         read in, with data — but no QUARTERLY periods,
 *                              and every term of this score is a quarter.
 *
 * The last one is not hypothetical either: KGC stores 5 years and 8 instants
 * with 24 populated fields in its best period and not one quarter.
 */
function noScoreReason(symbol: string, cold: ColdResult, hasSet: boolean): string {
  // FIRST, BECAUSE THE FALLBACK AT THE BOTTOM IS FALSE FOR THIS CASE. It says
  // the filings "have not been read into the site yet", which promises they
  // will be. For a preferred or a baby bond there is nothing of its own to
  // read, ever -- the filings on that CIK belong to the issuer, and that is
  // the point of refusing them.
  if (cold.status === "not-issuer-equity") {
    const parent = cold.siblings.filter((x) => !/[-.]/.test(x)).sort((a, b) => a.length - b.length)[0];
    return cold.reason === "derivative-of-issuer"
      ? `${symbol} is debt, preferred stock or a warrant. The financial statements filed under its SEC registrant describe ${parent ?? "another company"}, not this security, so there is nothing here to score.`
      : `${symbol} shares an SEC registrant with other securities and which one it is could not be established, so the filings there cannot be attributed to it.`;
  }
  // AND THE SAME PROBLEM ONE STATUS EARLIER. A symbol with no CIK has no
  // filings to read under that ticker, so the fallback's "have not been read
  // into the site yet" promises a read that cannot happen. MSTY showed this:
  // /stock/MSTY said its filings were pending while /stock/MSTY/earnings 404'd,
  // and neither was true — MSTY is a series of a trust, and the trust is the
  // registrant.
  //
  // IT NAMES BOTH REASONS AND CLAIMS NEITHER, matching SecNoRegistrantCard on
  // the earnings page. Measured through the shipped gate, two populations land
  // here: funds whose ticker is never a registrant (MSTY, TSLY, JEPI) and
  // companies SEC's directory simply does not carry (BK, EA, EQR, WBS). A
  // sentence that guessed would be wrong for one of them on every page that
  // renders this string — and there are four.
  if (cold.status === "no-cik") {
    return `${symbol} does not appear in the SEC company-ticker directory this page reads, so there are no filings to score and none are on the way. Either it is a fund or ETF share class — those file under their trust rather than their ticker — or it is a company the directory does not carry.`;
  }
  if (cold.status === "no-xbrl") {
    const named = cold.taxonomies.join(", ");
    switch (cold.why) {
      case "currency":
        return `${symbol}'s filings have been read, but it reports in ${named} and this page reads US-dollar figures only — so there is nothing here to score.`;
      case "unread-taxonomy":
        return `${symbol}'s filings have been read, but they are filed under the ${named} taxonomy, which this page does not read yet.`;
      case "none":
        return `${symbol} has not filed XBRL financial statements, so there is nothing to score.`;
      default:
        return `${symbol}'s filings have been read, but none of the figures this score reads resolved from them.`;
    }
  }
  if (hasSet) {
    // READ IN, WITH DATA, AND STILL NOT SCORABLE. Every term here is a quarter,
    // and some filers publish only annual periods.
    return `${symbol} has filed no quarterly periods — this score is built on quarters, and its annual figures cannot stand in for one.`;
  }
  return `${symbol}'s SEC filings have not been read into the site yet, so there is nothing to score.`;
}

export function scoreFromSec(view: SecEarningsView | null, symbol: string, cold: ColdResult) {
  if (!view) {
    return {
      score: 50, available: false as const, tone: "neutral" as EarningsTone,
      label: "Unavailable",
      explanation: noScoreReason(symbol, cold, cold.status === "ready"),
      unavailable: Object.values(SCORE_COMPONENTS) as string[],
      basis: "quarter" as PeriodBasis,
      seed: SCORE_SEED,
      contributions: {} as Partial<Record<ScoreComponent, number>>,
    };
  }

  let score = SCORE_SEED;
  // WHICH COMPONENTS ACTUALLY RAN, not how many. An absent input contributes no
  // points AND no clause; see scoreExplanation for the sentence that used to
  // claim cash backing from an empty cash-flow chain.
  const ran = new Set<ScoreComponent>();
  const contributions: Partial<Record<ScoreComponent, number>> = {};
  // ONE PLACE WHERE A COMPONENT ENTERS THE SCALE. Adding points and recording
  // both the membership and the amount in three separate statements is how the
  // three drift apart; this makes them one act.
  const contribute = (key: ScoreComponent, points: number) => {
    score += points;
    ran.add(key);
    contributions[key] = points;
  };
  const s = view.snapshot;

  // isPct, NOT `!= null`. A "n/m" is a string, so `!= null` admitted it and
  // TypeScript then multiplied it — KGC's FY2023 sign flip out of a loss was
  // worth a full +20, the largest contribution any component can make, for an
  // artefact of dividing by a negative. A figure that cannot be RENDERED must
  // not be SCORED; see Pct in secEarningsView.
  if (isPct(s.revenueYoY)) contribute("revenueGrowth", clamp(s.revenueYoY * 0.55, -22, 22));
  if (isPct(s.epsYoY)) contribute("epsGrowth", clamp(s.epsYoY * 0.30, -20, 20));
  if (s.netIncome.val != null) contribute("profitability", s.netIncome.val > 0 ? 6 : -8);

  // MARGIN DIRECTION, over the four most recent quarters that have one. Not a
  // single-quarter reading: one quarter's margin move is as often mix as trend.
  const opMargins = view.margins.filter((m) => m.operating != null).slice(-4).map((m) => m.operating!);
  if (opMargins.length >= 2) {
    contribute("marginTrend", clamp((opMargins[opMargins.length - 1] - opMargins[0]) * 0.8, -10, 10));
  }

  // CASH AGAINST PROFIT. Positive accruals mean cash is running ahead of
  // reported profit, which is the quality signal the page's own card shows.
  const acc = view.cashQuality.accruals;
  const ni = view.cashQuality.netIncome.val;
  if (acc != null && ni != null && ni !== 0) {
    contribute("cashConversion", clamp((acc / Math.abs(ni)) * 8, -10, 10));
  }

  if (ran.size === 0) {
    return {
      score: 50, available: false as const, tone: "neutral" as EarningsTone,
      label: "Unavailable",
      explanation: `${symbol}'s latest filing carries no figures that can be scored yet — there is no prior-year ${periodWords(view.basis).one} to measure growth from.`,
      unavailable: Object.values(scoreComponents(view.basis)) as string[],
      basis: view.basis,
      seed: SCORE_SEED,
      contributions: {} as Partial<Record<ScoreComponent, number>>,
    };
  }

  const rounded = Math.round(clamp(score, 0, 100));
  // FROM THE SAME TABLE THE AXIS IS LABELLED FROM, and from the CLAMPED value
  // the card prints — so the number, the pill and the gauge cannot disagree.
  const tone = bandFor(rounded);
  return buildScoreResult(rounded, tone, ran, contributions, view.cashQuality.basis, view.cashQuality.period, view.basis);
}

/**
 * The scorer's return shape, for callers that pass it around.
 *
 * DERIVED FROM THE FUNCTION, NOT DECLARED BESIDE IT. A hand-written interface
 * here is a second description of the same value, and the union of the
 * available and unavailable branches is exactly the thing a caller has to
 * narrow on — writing it out by hand is how `available` acquires a third
 * state nobody implements.
 */
export type SecEarningsScore = ReturnType<typeof scoreFromSec>;
