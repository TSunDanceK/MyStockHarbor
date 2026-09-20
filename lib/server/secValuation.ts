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

/** Why a numerator could not be supplied. Rendered, never swallowed. */
export type ValuationRefusal =
  | "no-cover-share-count"
  | "multi-class-share-count-is-ambiguous"
  | "no-twelve-month-eps"
  | "eps-is-zero-or-negative";

export const REFUSAL_WORDS: Record<ValuationRefusal, string> = {
  "no-cover-share-count":
    "the filer's cover page does not state a share count",
  "multi-class-share-count-is-ambiguous":
    "this filer has more than one share class and the SEC feed does not name them",
  "no-twelve-month-eps":
    "twelve months of diluted EPS are not on file",
  "eps-is-zero-or-negative":
    "diluted EPS over the last twelve months is not positive, so a P/E is not meaningful",
};

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
export function valuationInputs(set: StoredFactSet): ValuationInputs {
  const refusals: ValuationRefusal[] = [];

  let shares: SharesBasis | null = null;
  const cover = set.cover;
  if (cover?.candidates?.length) {
    // THE EXTRACTOR ALREADY REFUSED TO PICK. Picking here would route around
    // that decision from the other end of the pipeline.
    refusals.push("multi-class-share-count-is-ambiguous");
  } else if (typeof cover?.val === "number" && cover.val > 0 && cover.asOf) {
    shares = { val: cover.val, asOf: cover.asOf };
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
  if (!inputs.shares) {
    const why = inputs.refusals.find(
      (r) => r === "multi-class-share-count-is-ambiguous" || r === "no-cover-share-count"
    );
    return why ? { ok: false, why } : null;
  }
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  return { ok: true, val: inputs.shares.val * price };
}

/**
 * P/E — price divided by twelve months of diluted EPS, or a named refusal.
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
  if (!inputs.eps) {
    return inputs.refusals.includes("no-twelve-month-eps")
      ? { ok: false, why: "no-twelve-month-eps" }
      : null;
  }
  if (inputs.eps.val <= 0) return { ok: false, why: "eps-is-zero-or-negative" };
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  return { ok: true, val: price / inputs.eps.val };
}
