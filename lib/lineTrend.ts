// THE INCOME STATEMENT'S TRAFFIC LIGHTS (#552 COWORK #137 §2).
//
// A quick, at-a-glance colour on each figure: green = improved, white = little
// change, red = weaker, against the same quarter a year earlier (or the prior
// fiscal year). A quick comparison of filed figures, NOT a rating. PURE and
// import-free, so a check can run every rule on fixtures.
//
// DIRECTION PER LINE, because a growing company's costs rise too:
//   higher is better   revenue, gross profit, operating income, pre-tax
//                      income, net income, basic and diluted EPS
//   costs              cost of revenue, R&D, SG&A, other operating expense:
//                      by SHARE OF REVENUE, a lower share is better
//   fewer is better    diluted shares (buybacks green, dilution red)
//   no colour          income tax, interest, other income / expense,
//                      noncontrolling interest: neither good nor bad in itself
//
// NO COLOUR, AND SAY WHY: the comparison period has no figure; either period
// is a flagged one-off (on the lines below operating income, which a
// non-operating item moves); the revenue line is incomplete (on revenue and
// the lines read against it).

export type Trend = "improved" | "flat" | "weaker";

export type LineTrend =
  | { trend: Trend; kind: "pct"; pct: number }
  | { trend: Trend; kind: "flip"; words: string }
  | { trend: Trend; kind: "share"; shareNow: number; shareThen: number; change: number }
  | { trend: null; reason: string };

/** A period's one-off flag: true flagged, false checked and none, "unchecked" the rule could not run. */
export type OneOff = boolean | "unchecked";

/** Within this relative change, a line reads "little change" (white). */
export const LINE_TREND_FLAT_PCT = 3;

export const HIGHER_BETTER = new Set(["revenue", "grossProfit", "operatingIncome", "preTaxIncome", "netIncome", "epsBasic", "epsDiluted"]);
export const COST_SHARE = new Set(["costOfRevenue", "researchAndDevelopment", "sellingGeneralAndAdministrative", "otherOperatingExpense"]);
export const FEWER_BETTER = new Set(["sharesDiluted"]);
/** The lines a non-operating one-off moves. */
export const BELOW_OPERATING = new Set(["preTaxIncome", "netIncome", "epsBasic", "epsDiluted"]);
/** The lines read against revenue. */
export const READ_AGAINST_REVENUE = new Set(["revenue", "grossProfit", ...COST_SHARE]);

export const NO_COLOUR_LINE = "No colour: this line is neither better nor worse in itself.";

/** A relative change in %, from `then` to `now`; `then` is non-zero. */
const lineRel = (now: number, then: number) => ((now - then) / Math.abs(then)) * 100;
const lineBand = (pct: number, betterIfUp: boolean): Trend =>
  Math.abs(pct) <= LINE_TREND_FLAT_PCT ? "flat" : (pct > 0) === betterIfUp ? "improved" : "weaker";

export function lineTrend(
  key: string,
  base: { now: Record<string, number | null>; then: Record<string, number | null>; label: string; revenueIncomplete: boolean },
  oneOff: { now: OneOff; then: OneOff },
): LineTrend {
  if (!HIGHER_BETTER.has(key) && !COST_SHARE.has(key) && !FEWER_BETTER.has(key)) return { trend: null, reason: NO_COLOUR_LINE };
  if (READ_AGAINST_REVENUE.has(key) && base.revenueIncomplete) {
    return { trend: null, reason: "No colour: the revenue line is incomplete in this filer's tagged data, so this line can't be compared fairly." };
  }
  if (BELOW_OPERATING.has(key)) {
    // A FLAGGED ONE-OFF FIRST: it is the stronger reason. Then a period the
    // one-off rule could not be run on, which is not the same as "none".
    if (oneOff.now === true || oneOff.then === true) {
      return { trend: null, reason: `No colour: ${oneOff.now === true ? "this period" : base.label} includes a large one-off item, which would decide the colour.` };
    }
    if (oneOff.now === "unchecked" || oneOff.then === "unchecked") {
      return { trend: null, reason: `No colour: ${oneOff.now === "unchecked" ? "this period" : base.label} can't be checked for a large one-off item.` };
    }
  }
  const now = base.now[key], then = base.then[key];
  if (now == null || then == null) return { trend: null, reason: `No colour: no figure for ${base.label} to compare with.` };

  if (COST_SHARE.has(key)) {
    const rNow = base.now.revenue, rThen = base.then.revenue;
    if (!rNow || !rThen || rNow <= 0 || rThen <= 0) return { trend: null, reason: `No colour: no revenue for ${base.label} to measure this cost against.` };
    const shareNow = (now / rNow) * 100, shareThen = (then / rThen) * 100;
    if (shareThen === 0) return { trend: null, reason: `No colour: this cost was nil in ${base.label}.` };
    const change = lineRel(shareNow, shareThen);
    return { trend: lineBand(change, false), kind: "share", shareNow, shareThen, change };
  }
  if (FEWER_BETTER.has(key)) {
    if (then <= 0) return { trend: null, reason: `No colour: no share count for ${base.label} to compare with.` };
    const pct = lineRel(now, then);
    return { trend: lineBand(pct, false), kind: "pct", pct };
  }
  // HIGHER IS BETTER, and a sign flip is coloured by the improvement, in words.
  if (then < 0 && now >= 0) return { trend: "improved", kind: "flip", words: "from a loss to a profit" };
  if (then >= 0 && now < 0) return { trend: "weaker", kind: "flip", words: "from a profit to a loss" };
  if (then === 0) return { trend: null, reason: `No colour: the figure was nil in ${base.label}.` };
  const pct = lineRel(now, then);
  if (then < 0 && now < 0) {
    const t = lineBand(pct, true);
    return { trend: t, kind: "flip", words: t === "flat" ? "a similar loss" : t === "improved" ? "a smaller loss" : "a larger loss" };
  }
  return { trend: lineBand(pct, true), kind: "pct", pct };
}
