// THE FIFTH REASON A PRICE OR MARKET CAP IS NOT SHOWN, AND WHY IT IS NOT A
// FIFTH TIER OF THE OTHER FOUR.
//
// Stage 4 ended with four reasons the /stock/[symbol]/earnings card withholds a
// market cap, and check-sec-valuation §8 asserts the PRECEDENCE between them --
// which wins when two are true at once:
//
//   security-kind (#495)    this ticker is not the security the filings describe
//   FPI / ADS unit (#489,#491)  ordinary-share count against an ADS price
//   staleness (#497)        the filer stopped updating its count
//   weighted-average (#500) an average over a period, not a count at a date
//
// EVERY ONE OF THOSE IS A CLAIM ABOUT A FIGURE WE HAVE. They are refusals: the
// number exists, or could be computed, and is withheld because computing it
// would be wrong. They form a ladder because they can co-occur on one symbol
// and the reader must get the reason that is certain.
//
// THIS ONE IS NOT THAT. It says we hold no price for the symbol at all, so
// there is nothing to refuse. It cannot rank against the other four because it
// is not the same kind of statement, and folding it in as a fifth tier would
// let "we never had it" read as a judgement about data we do have -- which is
// the absence-vs-failure confusion this build has now hit three times
// (claude/traps/absence-needs-the-producer-to-have-run.md).
//
// So it is a separate module with a separate assertion, deliberately.
//
// ── WHAT DECIDES IT ───────────────────────────────────────────────────────
// Owner decision 2026-09-21: stage 4 builds against the CURRENT 700-symbol
// analysis universe's existing bar source ONLY. Whole-market bars are off the
// roadmap -- no budget for a paid source, and Stooq was eliminated from three
// independent egress paths -- so there is no prospect of these symbols gaining
// a price later. The absence is permanent, not pending.
//
// The signal is the price pool itself rather than a universe list, and that is
// the honest form: the question is "does the bar source hold this symbol", not
// "is it nominally in the universe". A universe member the pool has never
// warmed has no price either, and a list-based test would claim it does.
//
// ── HIDDEN, NOT DASHED ────────────────────────────────────────────────────
// The house pattern for a column that lost its source (Forward PE, the Analysts
// tab) is to hide it with a comment naming the source and the date -- see
// claude/fmp-exit-options-pickers-2026-09-12.md §0. A dash claims the figure
// was looked for and found missing FOR THIS COMPANY, which is a statement about
// the company. Nothing is the truthful rendering of "not offered here".

/** Whether this row's price and market cap can be shown at all. */
export type PriceCoverage =
  /** The bar source holds this symbol. Figures render normally. */
  | "covered"
  /**
   * Outside the bar source. NOT a refusal -- there is no figure to refuse.
   * Permanent: whole-market bars are closed, so nothing is pending.
   */
  | "outside-bar-universe";

export type CoverageInputs = {
  /**
   * Whether this symbol's quote came from the shared price pool, which is the
   * bar source the analysis universe is warmed into. False for a symbol quoted
   * individually off-universe, and false for a universe member never warmed.
   */
  fromPricePool: boolean;
};

export function priceCoverage(inputs: CoverageInputs): PriceCoverage {
  return inputs.fromPricePool ? "covered" : "outside-bar-universe";
}

/** Whether a row's price and market-cap cells render at all. */
export function showsPriceCells(coverage: PriceCoverage): boolean {
  return coverage === "covered";
}

/**
 * Said ONCE beneath the grid when any row is uncovered, rather than per cell.
 *
 * PER-CELL TEXT WOULD BE WORSE THAN THE DASH IT REPLACES. Fifty rows each
 * carrying "not covered" is noise, and a tooltip is invisible on a phone. One
 * sentence under the table explains every blank cell above it, which is what a
 * reader actually needs to not misread the gap as a broken page.
 */
export const PRICE_COVERAGE_NOTE =
  "Price and market cap are shown for the companies this site tracks closely. " +
  "Blank cells are companies outside that set — the figures are not collected " +
  "for them, rather than missing for those companies.";
