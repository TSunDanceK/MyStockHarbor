// MARKET CAP AND P/E, WITH THEIR NUMERATORS TAKEN FROM THE FILINGS.
//
// Both figures are one SEC quantity multiplied or divided by one price:
//
//   market cap = shares outstanding x price
//   P/E        = price / diluted EPS over twelve months
//
// The price half is not this module's business. What is, is that the SEC half
// is either RIGHT or ABSENT — never approximate, never assembled from periods
// that do not add up to what the label claims.
//
// ── WHY THIS IS NOT A PAIR OF ONE-LINERS ──────────────────────────────────
//
// Every failure available here produces a plausible number rather than an
// error, and a plausible P/E is worse than a missing one: a reader has no way
// to tell a 14 built from four real quarters from a 19 built from three.
//
//   - THREE QUARTERS SUMMED AND CALLED A YEAR understates by a quarter. After
//     D1b, Q4 EPS is legitimately null for many filers, so the three-quarter
//     case is the COMMON one rather than an edge.
//   - FOUR QUARTERS THAT SKIP ONE are not twelve months. A filer missing Q2
//     yields Q1, Q3, Q4, Q1-prior — four values, four rows, one year apart at
//     the ends, and fifteen months of trading inside.
//   - A FISCAL YEAR PLUS NINE MONTHS is the analyst's rolling-TTM construction
//     (FY + current 9M - prior 9M) and it mixes three periods from two fiscal
//     years. It is explicitly not built here. Two bases are admitted and they
//     are never combined.
//   - A MULTI-CLASS SHARE COUNT CANNOT BE PICKED. companyfacts publishes the
//     default-context series only, so a multi-class filer's rows arrive with
//     the same end, the same accession and nothing to tell the classes apart.
//     The extractor already refuses to choose and records both candidates;
//     multiplying either one by a price is the BRK.B share-count bug wearing
//     a market cap.
//
// ── REFUSALS ARE NAMED, NOT BLANK ─────────────────────────────────────────
//
// Each result carries WHY it is absent, because "P/E: —" invites the reader to
// assume the company has no earnings, which is a claim about the company. The
// true claim is almost always about the filing.
import type { StoredFactSet, StoredPeriod } from "./secFactCodec";
import { valueOf } from "./secFactCodec";
import { isConsecutive } from "./secEarningsView";
import { DEADLINE_FALLBACK } from "./secReportDates";

/** Why a numerator could not be supplied. Rendered, never swallowed. */
export type ValuationRefusal =
  | "no-cover-share-count"
  | "multi-class-share-count-is-ambiguous"
  | "ads-ratio-makes-shares-incomparable"
  | "ads-ratio-makes-eps-incomparable"
  | "share-count-is-stale"
  | "no-twelve-month-eps"
  | "eps-is-zero-or-negative";

export const REFUSAL_WORDS: Record<ValuationRefusal, string> = {
  "no-cover-share-count":
    "the filer's cover page does not state a share count",
  "multi-class-share-count-is-ambiguous":
    "this filer has more than one share class and the SEC feed does not name them",
  "ads-ratio-makes-shares-incomparable":
    "this company files its share count in ordinary shares and trades here as depositary shares, which are not the same unit",
  "ads-ratio-makes-eps-incomparable":
    "this company files earnings per ordinary share and trades here as depositary shares, which are not the same unit",
  "share-count-is-stale":
    "the most recent share count this company has filed is too old to value it with",
  "no-twelve-month-eps":
    "twelve months of diluted EPS are not on file",
  "eps-is-zero-or-negative":
    "diluted EPS over the last twelve months is not positive, so a P/E is not meaningful",
};

// ─────────────────────────────────────────────────────────────────────────────
// HOW OLD A SHARE COUNT MAY BE, AND WHY THERE HAS TO BE A BOUND
//
// MEASURED (relay 35620148960, claude/multiclass-shares-not-computable-2026-09-21):
// the newest dei:EntityCommonStockSharesOutstanding companyfacts holds for
// Berkshire Hathaway is dated 2011-04-29 and Fox's is 2010-01-29 -- fifteen and
// sixteen years old. Nothing rejected them. `valuationInputs` accepted any row
// with `val > 0` and any `asOf` at all, so that 2011 figure was multiplied by
// today's close and rendered as a market cap.
//
// IT IS NOT A NEAR MISS. Berkshire's 941,481 is the CLASS A count; BRK.B has
// roughly 1.3 billion shares. Pricing one against the other is wrong by about
// 2,400x. The only mercy is that it lands nowhere plausible -- the usual danger
// on this page is the opposite.
//
// priceIsCurrent (secPresentation) already bounds the OTHER half of the same
// product for exactly this reason, and had no counterpart here. A market cap is
// shares x price; bounding one operand and not the other bounds nothing.
//
// ── THE BOUND IS DERIVED, NOT PICKED ──────────────────────────────────────
// A company that still files states a fresh count on every periodic report. The
// slowest lawful cadence is annual, and the slowest annual deadline in the table
// this repo already verified against 17 CFR 240.13a-1 is DEADLINE_FALLBACK.annual.
// So the oldest cover a COMPLIANT annual-only filer can present is one year of
// cadence plus one deadline's lateness:
//
//   365 + 90 = 455 days
//
// Past that the filer has missed a required report, and its share count is not a
// fact about the company today. The figure is IMPORTED rather than copied, so a
// correction to the statutory table moves this bound with it -- the trap recorded
// in claude/traps/two-validators-for-one-value.md, which is what the report-date
// reconciliation (#484) was about.
//
// DELIBERATELY GENEROUS. The cost of a bound slightly too loose is a share count
// a few months stale, which moves a market cap by the buyback rate. The cost of
// one too tight is refusing a figure a company did file. The error this exists to
// stop is measured in DECADES, so it is caught by any bound in this region.
export const COVER_SHARES_MAX_AGE_DAYS = 365 + DEADLINE_FALLBACK.annual;

/**
 * Whether a cover-page share count is recent enough to value a company with.
 *
 * `today` is passed in rather than read from the clock, for the reason
 * priceIsCurrent gives: a bound that can only be exercised by waiting is a
 * bound nobody exercises.
 */
export function coverIsCurrent(asOf: string | null | undefined, today: string): boolean {
  if (!asOf) return false;
  const t = Date.parse(today);
  const a = Date.parse(asOf);
  if (!Number.isFinite(t) || !Number.isFinite(a)) return false;
  // A COUNT DATED AFTER TODAY IS NOT FRESH, IT IS WRONG -- the same rule, and
  // the same reasoning, as priceIsCurrent's future-date guard.
  if (a > t) return false;
  return (t - a) / 86400000 <= COVER_SHARES_MAX_AGE_DAYS;
}

/**
 * THE SHARE COUNT AND ITS OWN AS-OF DATE.
 *
 * The cover date sits two to four weeks AFTER the period end, and that is not
 * a defect to correct — it is the most recent count the filer has stated, and
 * it is the right one to multiply a price by. But it is a different date from
 * the EPS period, so it is carried separately and labelled separately rather
 * than folded into one "as of" the page would have to pick a meaning for.
 */
export type SharesBasis = { val: number; asOf: string };

/**
 * TWELVE MONTHS OF DILUTED EPS, AND WHICH TWELVE.
 *
 * `basis` is not decoration: "four quarters" and "fiscal year" are different
 * claims about the same number, and a filer that has just changed its year-end
 * can produce both with different values.
 */
export type EpsBasis = {
  val: number;
  basis: "four-quarters" | "fiscal-year";
  /** The newest period end the figure covers. */
  periodEnd: string;
};

export type ValuationInputs = {
  shares: SharesBasis | null;
  eps: EpsBasis | null;
  /** Every refusal that applies, in the order they were decided. */
  refusals: ValuationRefusal[];
};

/**
 * FOUR CONSECUTIVE QUARTERS, ALL PRESENT, OR NOTHING.
 *
 * `ttm()` in secFactCodec already enforces "all four or null". It does NOT
 * enforce CONSECUTIVE, because it walks the newest four entries of a list. For
 * a filer with a hole in its quarterly series that is four real values spanning
 * fifteen months, summed and presented as a year.
 *
 * This is the same rule plus the gap test, and it lives here rather than being
 * pushed into `ttm()` because `ttm` is also used where the caller has already
 * established the run — and widening it would silently shorten tables that are
 * correct today.
 */
function fourConsecutiveQuarters(quarters: StoredPeriod[]): EpsBasis | null {
  const four = quarters.slice(0, 4);
  if (four.length < 4) return null;
  for (let i = 1; i < four.length; i++) {
    if (!isConsecutive(four[i - 1], four[i])) return null;
  }
  const vals = four.map((q) => valueOf(q, "epsDiluted"));
  if (vals.some((v) => v === null)) return null;
  return {
    val: (vals as number[]).reduce((a, b) => a + b, 0),
    basis: "four-quarters",
    periodEnd: four[0].e,
  };
}

/**
 * THE NEWEST FISCAL YEAR'S DILUTED EPS.
 *
 * Admitted as a second basis because an annual-only filer — RYAAY and ABEV
 * among them — has no quarters to sum and a fiscal year IS twelve months. It
 * is not a fallback for a filer whose quarters merely failed the test above:
 * quarters are preferred when they qualify because they are newer, and when
 * they do not qualify the year is used because it is whole, not because it is
 * close enough.
 */
function newestFiscalYear(years: StoredPeriod[]): EpsBasis | null {
  const y = years[0];
  if (!y) return null;
  const val = valueOf(y, "epsDiluted");
  if (val === null) return null;
  return { val, basis: "fiscal-year", periodEnd: y.e };
}

/**
 * What the two valuation figures can be built from, for this stored set.
 *
 * THE TWO LEGS ARE INDEPENDENT. A filer can have an unusable share count and a
 * perfectly good EPS, and suppressing the P/E because the market cap failed
 * would be hiding a figure that is on file. Each is decided on its own inputs
 * and each carries its own refusal.
 */
// ─────────────────────────────────────────────────────────────────────────────
// FOREIGN PRIVATE ISSUERS: THE SHARE COUNT AND THE PRICE ARE IN DIFFERENT UNITS
//
// A foreign private issuer files its cover-page share count in ORDINARY SHARES,
// because that is what it has issued. What trades on a US exchange -- and what
// every price on this site is a price OF -- is an AMERICAN DEPOSITARY SHARE,
// which represents some ratio of those ordinary shares. The ratio is set by the
// depositary bank and is not in the filing.
//
//   TSM: 1 ADS = 5 ordinary shares.
//
// So `shares x price` multiplies a count of one instrument by the price of a
// different one. For TSM that overstates the market cap FIVE TIMES OVER. The
// number is not noisy or slightly stale -- it is a category error, and it lands
// in the plausible range, which is what makes it dangerous. A reader cannot
// see that it is wrong; it looks exactly like a market cap.
//
// WHY A LIST AND NOT A DETECTOR. There is no field in companyfacts that says
// "this is an ADS" and none that carries the ratio. The honest options were a
// named list or a wrong number, and a wrong number is not an option. The list
// is the five FPIs in the analysis universe, checked by hand against their
// filings. It is deliberately conservative: a name absent from it gets a cap
// computed the ordinary way, which is correct for a domestic filer.
//
// WHEN TO EXTEND IT. Any 20-F filer admitted to the universe belongs here.
// `data/static-profile.json` is not a source for this -- the flaw is in the
// UNIT, not in any figure, so a profile field could not express it.
//
// THE COMPANIES STAY IN EVERY LIST THEY BELONG TO. This suppresses a FIGURE,
// not a company. TSM and BABA are among the largest listed companies on earth
// and dropping them from a page because one column cannot be computed would be
// a far bigger lie than the column's absence.
const ADS_FILERS_WITHOUT_A_STATED_RATIO = new Set([
  "HDB",  // HDFC Bank
  "IBN",  // ICICI Bank
  "TSM",  // Taiwan Semiconductor -- 1 ADS = 5 ordinary
  "BABA", // Alibaba
  "ASML", // ASML Holding
]);

/**
 * Whether this filer's cover-page share count is denominated in a different
 * instrument from the price this site quotes. Exported so the check suite can
 * assert the membership rather than re-declaring it.
 */
export function sharesAreIncomparableToPrice(symbol: string): boolean {
  return ADS_FILERS_WITHOUT_A_STATED_RATIO.has(String(symbol).trim().toUpperCase());
}

export function valuationInputs(set: StoredFactSet, today: string): ValuationInputs {
  const refusals: ValuationRefusal[] = [];

  // BEFORE THE COVER PAGE IS EVEN READ. This is a fact about the UNIT the
  // count is in, so it holds whatever the cover page turns out to say -- a
  // perfectly clean, unambiguous, single-class ordinary-share count is exactly
  // the case this refusal exists for.
  if (sharesAreIncomparableToPrice(set.symbol)) {
    // TWO REFUSALS, NOT ONE, because they are two different claims about two
    // different figures and only one of them was ever assumed. The share-count
    // one is true by definition: a cover-page count is a count of ordinary
    // shares. The EPS one is a fact about what the filer CHOSE to state, and it
    // was measured rather than inferred from the first -- see the note above
    // ADS_FILERS_WITHOUT_A_STATED_RATIO. Collapsing them into one refusal would
    // make a measured finding look like a restatement of a definition.
    refusals.push("ads-ratio-makes-shares-incomparable");
    refusals.push("ads-ratio-makes-eps-incomparable");
  }

  let shares: SharesBasis | null = null;
  const cover = set.cover;
  if (cover?.candidates?.length) {
    // THE EXTRACTOR ALREADY REFUSED TO PICK. Picking here would route around
    // that decision from the other end of the pipeline.
    refusals.push("multi-class-share-count-is-ambiguous");
  } else if (typeof cover?.val === "number" && cover.val > 0 && cover.asOf) {
    // AGE IS CHECKED AFTER THE VALUE IS KNOWN GOOD, so a stale row is refused
    // for BEING STALE rather than folded into "no cover share count". The two
    // are different facts about the filer -- one has never stated a count, the
    // other stated one and stopped -- and a reader sent to EDGAR by the wrong
    // one of those goes looking for something that is there.
    if (coverIsCurrent(cover.asOf, today)) {
      shares = { val: cover.val, asOf: cover.asOf };
    } else {
      refusals.push("share-count-is-stale");
    }
  } else {
    refusals.push("no-cover-share-count");
  }

  // QUARTERS FIRST — they are newer. A filer with both gets the four-quarter
  // figure, which is what "trailing twelve months" means to a reader.
  const eps = fourConsecutiveQuarters(set.quarters) ?? newestFiscalYear(set.years);
  if (!eps) refusals.push("no-twelve-month-eps");

  return { shares, eps, refusals };
}

export type ValuationFigure =
  | { ok: true; val: number }
  | { ok: false; why: ValuationRefusal };

/**
 * MARKET CAP — shares x price, or a named refusal.
 *
 * `price` null is not a refusal REASON this module owns: the caller knows
 * whether bars were unavailable, and inventing a share-count reason for a
 * missing price would misattribute the gap.
 */
export function marketCap(
  inputs: ValuationInputs,
  price: number | null
): ValuationFigure | null {
  // FIRST, AND BEFORE THE SHARE COUNT IS CONSULTED. An ADS filer usually HAS a
  // clean share count -- that is the trap. Ordering this after the `!shares`
  // guard would let a well-behaved cover page produce a five-times-wrong cap.
  //
  // It is also the more specific answer when both apply: a multi-class ADS
  // filer is refused for the unit mismatch, which is certain, rather than for
  // the class ambiguity, which is merely also true.
  if (inputs.refusals.includes("ads-ratio-makes-shares-incomparable")) {
    return { ok: false, why: "ads-ratio-makes-shares-incomparable" };
  }
  if (!inputs.shares) {
    const why = inputs.refusals.find(
      (r) =>
        r === "multi-class-share-count-is-ambiguous" ||
        r === "share-count-is-stale" ||
        r === "no-cover-share-count"
    );
    return why ? { ok: false, why } : null;
  }
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  return { ok: true, val: inputs.shares.val * price };
}

/**
 * P/E — price divided by twelve months of diluted EPS, or a named refusal.
 *
 * ── MEASURED, AND THE ANSWER WAS NOT SYMMETRY (2026-09-21) ───────────────
 * #489 left this OPEN rather than assuming the share-count rule extended to
 * EPS. It does, and the measurement is the reason that is a fact here rather
 * than a guess: relay run 35588547888 computed, from each filer's own
 * arithmetic, `epsDiluted x sharesDiluted / netIncome` over every period where
 * all three came from the SAME accession.
 *
 *   HDB   us-gaap     1.0000  over 47 periods   per ordinary share
 *   TSM   ifrs-full   0.9999  over 11 periods   per ordinary share
 *   BABA  us-gaap     0.9984  over 47 periods   per ordinary share
 *   ASML  us-gaap     1.0002  over 51 periods   per ordinary share
 *   IBN   --          no XBRL companyfacts at all (6-K and 20-F only)
 *
 * A ratio of 1 means EPS is in the same unit as the ordinary share count and a
 * DIFFERENT unit from the ADS price, so the P/E is wrong by the ADS ratio --
 * five times over for TSM, printed beside the cap that already refuses.
 *
 * TWO THINGS THE FIRST PROBE GOT WRONG AND SAID SO, worth keeping because both
 * would have produced a confident wrong answer:
 *   - It read `us-gaap` only, so TSM came back {0, 0, 0} -- not a filer missing
 *     three tags but one with no us-gaap facts at all. It reported "cannot be
 *     judged" instead of resolving three zeroes into a verdict. TSM reports
 *     under `ifrs-full`, which secFields.ts already reads.
 *   - IBN's 404 was ambiguous until submissions was asked too: the filer
 *     exists and publishes NO XBRL, so nothing can be extracted for it at all.
 *     Its suppression is therefore vacuous today and kept anyway, because the
 *     rule should already be in place if it ever starts filing XBRL.
 *
 * A NON-POSITIVE EPS IS REFUSED RATHER THAN DIVIDED. A loss-making company has
 * a negative P/E arithmetically and no P/E in any sense a reader uses the
 * number for; printing -8.4 reads as a small positive multiple to anyone
 * skimming. The page already has this convention for growth across zero —
 * see PctCrossing in secEarningsView — and this is the same refusal.
 */
export function peRatio(
  inputs: ValuationInputs,
  price: number | null
): ValuationFigure | null {
  // FIRST, for the same reason the cap's guard is first: these filers usually
  // HAVE a clean twelve months of EPS on file. The figure is present, well
  // formed and in the wrong unit, so nothing downstream of `!inputs.eps` can
  // catch it.
  if (inputs.refusals.includes("ads-ratio-makes-eps-incomparable")) {
    return { ok: false, why: "ads-ratio-makes-eps-incomparable" };
  }
  if (!inputs.eps) {
    return inputs.refusals.includes("no-twelve-month-eps")
      ? { ok: false, why: "no-twelve-month-eps" }
      : null;
  }
  if (inputs.eps.val <= 0) return { ok: false, why: "eps-is-zero-or-negative" };
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  return { ok: true, val: price / inputs.eps.val };
}
