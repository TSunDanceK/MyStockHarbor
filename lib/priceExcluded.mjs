// SYMBOLS HIDDEN FROM PRICE SURFACES, ONE DATED LIST (#553 COWORK #61 §1).
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
 * "tiingo-gap": Tiingo returns no usable history for it; the owner has asked
 * Tiingo support. "debt-security": a note or other debt listing, whose price is
 * not an equity chart.
 * @typedef {"tiingo-gap" | "debt-security"} PriceExclusionReason
 */

/** @type {Record<string, { reason: PriceExclusionReason, since: string, note: string }>} */
export const PRICE_EXCLUDED = {
  // Empty price series from Tiingo, and no IEX quote (CODE-B #50).
  EQR: { reason: "tiingo-gap", since: "2026-09-27", note: "Tiingo returns an empty price series" },
  // 5 rows since 2022 from Tiingo, and no IEX quote (CODE-B #50).
  BK: { reason: "tiingo-gap", since: "2026-09-27", note: "Tiingo returns 5 rows since 2022" },
  // Comcast Holdings ZONES: an exchangeable note, not an equity (COWORK #60).
  CCZ: { reason: "debt-security", since: "2026-09-27", note: "exchangeable note (Comcast ZONES)" },
};

/** Dashed or dotted, any case. @param {string} symbol @returns {boolean} */
export function isPriceExcluded(symbol) {
  return Object.prototype.hasOwnProperty.call(PRICE_EXCLUDED, toDashed(symbol));
}
