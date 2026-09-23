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
  type PeriodBasis, type Pct, type SecEarningsView,
} from "./secEarningsView";
import type { ColdResult } from "./secColdFetch";
import type { EarningsTone as PresentationTone } from "./secPresentation";
import {
  MARGIN_NOT_MEANINGFUL, SMALL_REVENUE_BASE, marginMoveMeaningful, marginMoveVerb,
  pinCoverage, revenueBaseTooSmall, scoreCoverage, toneForGrowth, toneForMarginDelta, type ScoreCoverage,
} from "./secPresentation";

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

/** The five inputs, as a reader would name them in a list. */
export const SCORE_SHORT_NAMES: Record<ScoreComponent, string> = {
  revenueGrowth: "Revenue growth",
  epsGrowth: "EPS growth",
  profitability: "Profitability",
  marginTrend: "Margin trend",
  cashConversion: "Cash conversion",
};

/**
 * THE OPERATING-MARGIN MOVE THE PAGE ITSELF SHOWS, in percentage points.
 *
 * The anchor period against the period its growth is measured against — the
 * same pair the snapshot's "Compared with" caption names and the growth card's
 * operating-margin line prints. Looked up BY LABEL in the rows of the anchor's
 * own kind (fiscal years for an annual anchor), never by offset; null when
 * either side is not on file.
 *
 * NOT THE SCORE'S marginTrend INPUT. That one reads the last four quarters'
 * direction, first against last, which is a different question and can have
 * the opposite sign: on AVAV it ran Q2 FY2026 -6.4% to Q1 FY2027 -2.3% (up)
 * while the old sentence said "margins are slipping". The narrative describes
 * what the reader can see on the page, so it uses the page's comparison.
 */
export function anchorMarginDelta(view: SecEarningsView): number | null {
  const pair = anchorMarginPair(view);
  return pair ? pair.latest - pair.prior : null;
}

/** The two operating margins anchorMarginDelta subtracts, for the words and the meaningfulness rule. */
export function anchorMarginPair(view: SecEarningsView): { prior: number; latest: number } | null {
  const base = view.snapshot?.comparedWith ?? null;
  if (!base) return null;
  const rows: { label: string; operating: number | null }[] =
    view.basis === "year" ? view.annual ?? [] : view.margins ?? [];
  const latest = rows.find((r) => r.label === view.latestLabel);
  const prior = rows.find((r) => r.label === base);
  if (latest?.operating == null || prior?.operating == null) return null;
  return { prior: prior.operating, latest: latest.operating };
}

/**
 * THE PAIR THE SCORE'S marginTrend READS: the oldest and newest of the four most
 * recent periods with an operating margin. Exported so the rule and the score
 * cannot pick different pairs.
 */
export function scoreMarginPair(view: SecEarningsView): { first: number; last: number } | null {
  const op = view.margins.filter((m) => m.operating != null).slice(-4).map((m) => m.operating!);
  return op.length >= 2 ? { first: op[0], last: op[op.length - 1] } : null;
}

/**
 * ONE HEDGED SENTENCE, BUILT FROM THE FIGURES ON THE PAGE.
 *
 * ── WHAT IT REPLACED, AND WHY IT WAS WRONG ────────────────────────────────
 * The old narrative picked each clause by the OVERALL tone: any score below
 * Good said "growth is under pressure, margins are slipping". AVAV scored
 * Mixed with revenue +5.7% and operating margin +13.0pp against Q1 FY2026 —
 * both on the page directly below — and was told its margins were slipping.
 * It then closed with "Investors should focus on…", an instruction to the
 * reader the page has no standing to give.
 *
 * So each clause now states its own figure with its own sign, using the same
 * bands the cards colour by (GROWTH_BAND_PCT, MARGIN_BAND_PP), and the close
 * is a "may", never a "should". No cash clause: the cash card states its own
 * figures, and a sentence here summarising them was the AZN defect.
 */
function scoreExplanation(view: SecEarningsView, basis: PeriodBasis = "quarter") {
  const w = periodWords(basis);
  const s = view.snapshot;
  const base = s?.comparedWith ?? null;
  const clauses: string[] = [];
  const rev = s?.revenueYoY ?? null;
  // OFF A VERY SMALL BASE (#535 COWORK #20 rule 2): the figure is stated, with
  // why it is not a signal, and it carries no tone into the "though" below.
  const smallBase = revenueBaseTooSmall(s?.revenue?.val ?? null, rev);
  const revTone = smallBase ? null : toneForGrowth(rev);
  if (isPct(rev) && base) {
    const verb = rev >= 0 ? `revenue grew ${rev.toFixed(1)}%` : `revenue fell ${Math.abs(rev).toFixed(1)}%`;
    clauses.push(
      smallBase ? `${verb} against ${base}, ${SMALL_REVENUE_BASE}`
        : revTone === "good" ? `revenue grew ${rev.toFixed(1)}% against ${base}`
          : revTone === "weak" ? `revenue fell ${Math.abs(rev).toFixed(1)}% against ${base}`
            : `revenue was roughly flat against ${base}`
    );
  }
  const pair = anchorMarginPair(view);
  const pp = pair ? pair.latest - pair.prior : null;
  // NOT A MOVE AT ALL below -100% or beyond ±100pp (rule 1): WKHS's "widened
  // 658.1pp" was that. The words say so and the tone stays out of "though".
  const meaningful = pair !== null && marginMoveMeaningful(pair.prior, pair.latest);
  const mTone = meaningful ? toneForMarginDelta(pp) : null;
  if (pair && pp !== null) {
    // "Widened"/"narrowed" only where both margins are positive; a negative
    // margin moving towards zero "improved" (rule 3).
    const verb = meaningful ? marginMoveVerb(pair.prior, pair.latest, mTone) : null;
    clauses.push(
      !meaningful ? `operating margin is ${MARGIN_NOT_MEANINGFUL}`
        : verb ? `operating margin ${verb} ${Math.abs(pp).toFixed(1)}pp`
          : "operating margin held steady"
    );
  }
  const ni = s?.netIncome?.val ?? null;
  const opInc = s?.operatingIncome?.val ?? null;
  // BYND Q2 FY2026: net income +$16.4M from a non-operating gain on an
  // operating loss of $30.8M. "Profitable" alone read against the rest of the
  // page; the words now say where the profit came from.
  const profit = ni === null ? null
    : ni > 0 ? (opInc !== null && opInc < 0 ? `the ${w.one} was profitable after non-operating items` : `the ${w.one} was profitable`)
      : `the ${w.one} was loss-making`;
  if (!clauses.length) {
    return profit
      ? `${profit[0].toUpperCase()}${profit.slice(1)}; later filings may show more.`
      : "The latest filing carries few of the figures this score reads.";
  }
  const head = clauses.join(" and ");
  // "THOUGH" WHERE THE PROFIT LINE CUTS AGAINST THE REST, so a loss beside
  // growing revenue does not read as one more piece of good news.
  const up = revTone === "good" || mTone === "good";
  const down = revTone === "weak" || mTone === "weak";
  const against = ni !== null && ((ni <= 0 && up && !down) || (ni > 0 && down && !up));
  const body = profit ? `${head}, ${against ? "though" : "and"} ${profit}` : head;
  return `${body[0].toUpperCase()}${body.slice(1)}; later filings may show whether that continues.`;
}

/** What the score could NOT read, in the page's own words and its own period. */
function scoreGaps(ran: Set<ScoreComponent>, basis: PeriodBasis = "quarter"): string[] {
  const names = scoreComponents(basis);
  return (Object.keys(names) as ScoreComponent[])
    .filter((k) => !ran.has(k))
    .map((k) => names[k]);
}

/**
 * WHY EACH MISSING INPUT IS MISSING — the real cause, from the view.
 *
 * ── THE SENTENCE THIS REPLACES WAS FALSE ─────────────────────────────────
 * "Not measured, because AVAV's filings do not carry it: EPS growth". AVAV's
 * filings carry EPS for both quarters: -$0.10 and -$1.44. EPS growth did not
 * run because both are losses, and a growth rate between two losses is not a
 * rate of anything (see Pct). "The filings do not carry it" was the one cause
 * it was not. Each input now says which of its causes applies:
 *
 *   a crossing          loss in both periods / swung to a loss / turned profitable
 *   Q4                  Q4 EPS is not filed as a separate period
 *   no comparator       no year-earlier period on file
 *   genuinely absent    no revenue line in the filings (the extraction-time
 *                       marker, StoredFactSet.nt) or not in this period's
 *                       filed figures
 */
function gapReason(key: ScoreComponent, view: SecEarningsView): string {
  const w = periodWords(view.basis ?? "quarter");
  const s = view.snapshot;
  const untagged = new Set(view.untagged ?? []);
  const derivedQ4 = view.basis === "quarter" && /^Q4 /.test(view.latestLabel ?? "");
  const noPrior = `no year-earlier ${w.one} on file`;
  const crossing = (p: Pct) =>
    p === "loss-both" ? `loss in both ${w.many}`
      : p === "swung-to-loss" ? "swung to a loss"
        : p === "turned-profitable" ? "turned profitable"
          : null;
  // EPS NAMES ITS MEASURE: BYND's diluted EPS was negative in both quarters
  // while its net income was positive, and "loss in both quarters" beside "the
  // quarter was profitable" read as a contradiction (#535 COWORK #20).
  const epsCrossing = (p: Pct) =>
    p === "loss-both" ? `diluted EPS negative in both ${w.many}`
      : p === "swung-to-loss" ? "diluted EPS turned negative"
        : p === "turned-profitable" ? "diluted EPS turned positive"
          : null;
  const absent = (field: string, what: string) =>
    // "NOT CAPTURED", NOT "NOT IN THE FILING": without the extraction-time
    // marker we cannot tell a chain gap from a line the filer never had, and
    // AVAV's FY2022/23 revenue was the former (owner review, #522).
    untagged.has(field) ? `no ${what} line in the filings` : `${what} not captured from this filing`;
  switch (key) {
    case "revenueGrowth":
      if (s.revenue?.val == null) return absent("revenue", "revenue");
      if (revenueBaseTooSmall(s.revenue.val, s.revenueYoY)) return SMALL_REVENUE_BASE;
      return crossing(s.revenueYoY) ?? (s.comparedWith ? `no revenue on file for ${s.comparedWith}` : noPrior);
    case "epsGrowth":
      if (epsCrossing(s.epsYoY)) return epsCrossing(s.epsYoY)!;
      if (s.epsDiluted?.val == null) return derivedQ4 ? "Q4 EPS isn't filed separately" : absent("epsDiluted", "EPS");
      return s.comparedWith ? `no EPS on file for ${s.comparedWith}` : noPrior;
    case "profitability":
      return absent("netIncome", "net income");
    case "marginTrend": {
      const pair = scoreMarginPair(view);
      if (pair && !marginMoveMeaningful(pair.first, pair.last)) return MARGIN_NOT_MEANINGFUL;
      return `fewer than two ${w.many} with an operating margin`;
    }
    case "cashConversion": {
      const c = view.cashQuality;
      if (c?.netIncome?.val === 0) return "net income was zero";
      return c?.accrualsMissing ? `${c.accrualsMissing} not captured from this filing` : "cash-flow figures not captured from this filing";
    }
  }
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
  view: SecEarningsView,
  basis: PeriodBasis = "quarter"
) {
  return {
    available: true as const,
    score,
    tone,
    label: toneLabel(tone),
    explanation: scoreExplanation(view, basis),
    // THE SCORE SAYS WHICH KIND OF PERIOD IT READ. Point 5 of the approved
    // scope: an annual-only filer's score is built on fiscal years, and a
    // reader comparing it with a 10-Q filer's score has to be told that.
    basis,
    // NOT a count. A reader needs to know WHICH input was missing to judge the
    // number; "4 of 5 signals" is the kind of summary that hides the one that
    // mattered.
    unavailable: scoreGaps(ran, basis),
    // AND WHY, per input, in the same order — the short name and the real
    // cause. The card prints these; `unavailable` stays for the checks and
    // the sidebar that read the long names.
    unavailableWhy: (Object.keys(SCORE_SHORT_NAMES) as ScoreComponent[])
      .filter((k) => !ran.has(k))
      .map((k) => ({ key: k, name: SCORE_SHORT_NAMES[k], reason: gapReason(k, view) })),
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
      unavailableWhy: [] as { key: ScoreComponent; name: string; reason: string }[],
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
  // NOT SCORED OFF A VERY SMALL BASE (rule 2, prior-period revenue < $5M): the
  // growth prints, with why, and contributes nothing.
  if (isPct(s.revenueYoY) && !revenueBaseTooSmall(s.revenue?.val ?? null, s.revenueYoY)) {
    contribute("revenueGrowth", clamp(s.revenueYoY * 0.55, -22, 22));
  }
  if (isPct(s.epsYoY)) contribute("epsGrowth", clamp(s.epsYoY * 0.30, -20, 20));
  if (s.netIncome.val != null) contribute("profitability", s.netIncome.val > 0 ? 6 : -8);

  // MARGIN DIRECTION, over the four most recent quarters that have one. Not a
  // single-quarter reading: one quarter's margin move is as often mix as trend.
  // AND NOT AT ALL where the pair is not a move (rule 1): below -100% at either
  // end, or beyond ±100pp.
  const marginPair = scoreMarginPair(view);
  if (marginPair && marginMoveMeaningful(marginPair.first, marginPair.last)) {
    contribute("marginTrend", clamp((marginPair.last - marginPair.first) * 0.8, -10, 10));
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
      unavailableWhy: [] as { key: ScoreComponent; name: string; reason: string }[],
      basis: view.basis,
      seed: SCORE_SEED,
      contributions: {} as Partial<Record<ScoreComponent, number>>,
    };
  }

  const rounded = Math.round(clamp(score, 0, 100));
  // FROM THE SAME TABLE THE AXIS IS LABELLED FROM, and from the CLAMPED value
  // the card prints — so the number, the pill and the gauge cannot disagree.
  const tone = bandFor(rounded);
  return buildScoreResult(rounded, tone, ran, contributions, view, view.basis);
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

/**
 * HOW MUCH OF THIS SCORE RAN — the ONE computation both surfaces use.
 *
 * It lived inline in app/stock/[symbol]/earnings/page.tsx, which was fine while
 * that page was the only place a score was drawn. The sidebar card draws the
 * same score on /stock/[symbol] and /stock/[symbol]/news, and ABVX showed MIXED
 * there while the full report, one click away, said "Partial · 2 of 5
 * measured". Two copies of this arithmetic are two answers about one stock the
 * first time either is tuned, so it moved here and both call it.
 *
 * `contributions` holds exactly the components that contributed (see
 * `contribute`, which writes the set and the record together), so its keys ARE
 * the ones that ran. profitability's magnitude is 8, not 6: it contributes +6
 * when profitable and -8 when not, and the reachable LOW has to use the larger.
 *
 * Null when the score did not run at all — that case already says
 * "Unavailable" and has no range to report.
 */
export function coverageOf(score: SecEarningsScore): ScoreCoverage | null {
  if (!score.available) return null;
  return pinCoverage(
    scoreCoverage(
      score.seed,
      { ...SCORE_MAX_CONTRIBUTION, profitability: 8 },
      score.unavailable.length,
      Object.keys(score.contributions)
    ),
    SCORE_BANDS.find((b) => b.tone === "neutral")!.from,
    SCORE_BANDS.find((b) => b.tone === "good")!.from - 1
  );
}
