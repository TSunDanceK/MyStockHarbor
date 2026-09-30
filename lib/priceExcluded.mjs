// SYMBOLS HIDDEN FROM PRICE SURFACES, ONE DATED LIST (#553 COWORK #61 §1, #70).
//
// Hidden from: the Tiingo EOD and quote universes (nothing fetched or stored),
// the Pickers/screener universe and so every preset and signal built on it,
// the dashboard ticker's movers, and the "Explore More Stocks" links.
// NOT hidden from: their SEC and earnings pages, and search. Hide from lists,
// never delete.
//
// REVERSIBLE BY DESIGN: removing a row is the whole un-hide. Each row says why
// and since when, so the list can be re-read against its reasons.
//
// scripts/check-price-excluded.mjs pins the rows and every place that applies
// them.
//
// PLAIN .mjs, like symbolSpellings.mjs: lib/curatedSymbols.ts imports it, and
// scripts/check-curated-symbols.mjs transpiles that file on its own, so the
// list must load in bare Node with no build step.
import { toDashed } from "./symbolSpellings.mjs";

/**
 * "debt-security": a note or other debt listing, whose price is not an equity
 * chart.
 *
 * REMOVED 2026-09-29 (#553 COWORK #70): EQR and BK, listed here on 2026-09-27
 * as "tiingo-gap". They were retickers, not Tiingo gaps: SEC moved their CIKs
 * to VMRK and BNY, and Tiingo support confirmed it. We had asked Tiingo for dead
 * tickers. VMRK and BNY are priced as usual, and a retickered symbol is now
 * kept out of the Tiingo universe by rule (marketData/universe.ts,
 * retickeredOut) rather than by a row here.
 * @typedef {"debt-security"} PriceExclusionReason
 */

/** @type {Record<string, { reason: PriceExclusionReason, since: string, note: string }>} */
export const PRICE_EXCLUDED = {
  // Comcast Holdings ZONES: an exchangeable note, not an equity (COWORK #60).
  CCZ: { reason: "debt-security", since: "2026-09-27", note: "exchangeable note (Comcast ZONES)" },
};

/** Dashed or dotted, any case. @param {string} symbol @returns {boolean} */
export function isPriceExcluded(symbol) {
  return Object.prototype.hasOwnProperty.call(PRICE_EXCLUDED, toDashed(symbol));
}
