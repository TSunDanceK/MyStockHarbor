/**
 * ── WHY A PICKERS CELL IS EMPTY (#553 COWORK #69, 2026-10-01) ─────────────
 *
 * The owner flagged how many "–" cells /low-pe-stocks and /cheap-tech-stocks
 * show. Most are honest refusals (no cover share count, a multi-class cover,
 * debt not tagged, negative FCF, negative equity), so the fix is to say so: every
 * "–" carries its reason on hover or tap, and a figure that does not apply to a
 * bank or insurer reads "n/a" in a lighter tone instead of the missing-data dash.
 *
 * THE PAGE SHIPS A CODE, NOT THE SENTENCE. A Pickers page carries hundreds of
 * rows; a short code per refused cell keeps the payload small, and the words
 * live here, once. The codes for A's refusals are produced by
 * lib/server/pickersSecFundamentals.ts (WHY_FOR_REFUSAL), and
 * scripts/check-pickers-cell-why.mjs fails if any refusal A can return has no
 * code, or any code has no words -- so a new refusal cannot reach the page as
 * an unexplained dash.
 *
 * IMPORTS NOTHING: PickerResultsGrid is a client component.
 *
 * WORDING: filed facts only, hedged ("on file", "appears"), and never a cause
 * we do not know (#552 COWORK #51's rule for share-basis-changed).
 */
export const CELL_WHY_WORDS = {
  // ── A's refusals (lib/server/secValuation.ts ValuationRefusal)
  noShr: "No share count on the latest filing cover",
  multi: "More than one share class, and the filing cover doesn't give the count by class",
  adsS: "The share count is filed in ordinary shares, but this stock trades as depositary shares, so the two aren't the same unit",
  adsE: "Earnings are filed per ordinary share, but this stock trades as depositary shares, so the two aren't the same unit",
  debt: "This listing is notes or units, not common stock, so stock ratios don't apply",
  shOld: "The latest share count on file is too old to value the company with",
  noEps: "No twelve months of earnings per share on file",
  epsOld: "The latest earnings on file ended more than 15 months ago",
  basis: "The share count on file differs too much from the one behind earnings per share to compare them",
  epsNeg: "Earnings per share over the last twelve months were not positive, so a P/E isn't meaningful",
  eps0: "Earnings per share were close to zero, so a P/E isn't meaningful",
  noRev: "No twelve months of revenue on file",
  revInc: "The revenue line in the filing's tagged data appears incomplete",
  noEq: "No shareholders' equity on the latest balance sheet on file",
  eqNci: "Equity is filed only including minority interests, so a figure for shareholders isn't calculated",
  eqNeg: "Shareholders' equity is negative",
  // A's refusal from main (#552 COWORK #86b), given a code on the 2026-10-03 merge.
  eqSmall: "Book equity is under 1% of market value, so a P/B isn't meaningful",
  evIn: "Debt or cash isn't on the latest filing in a form that can be added up, and it isn't estimated",
  ebitNeg: "EBITDA over the last twelve months was not positive",
  // ── this grid's own
  fcfNeg: "Free cash flow was negative",
  // #553 COWORK #103 (2026-10-03): zero is not negative -- it was reading "Neg.".
  fcf0: "Free cash flow is zero, so P/FCF is not meaningful",
  noFcf: "No twelve months of free cash flow on file",
  noOpi: "No twelve months of operating income on file",
  noNi: "No twelve months of net income on file",
  noDiv: "No dividend on file for the last twelve months",
  noDg: "Not enough dividend history on file to compare",
  payMix: "Not shown: the earnings and dividend periods on file differ",
  noPay: "No dividend and earnings on file for the same period",
  // #553 COWORK #184 item 1 (2026-10-07).
  payLoss: "Earnings per share over the period were not positive, so there is no payout ratio",
  divIfrs: "This company reports under IFRS, whose filings carry no per-share dividend figure, so none is shown",
  fx: "The filing is in a currency that couldn't be converted to US dollars",
  noPx: "No current price for this stock",
  noCap: "Market value can't be calculated from the latest filing",
  // ── "n/a": the figure does not apply, rather than being missing
  naEv: "Doesn't apply: debt isn't reported in a comparable way for banks and insurers",
  naPs: "Doesn't apply: revenue isn't comparable for banks and insurers",
  naFcf: "Doesn't apply: free cash flow isn't comparable for banks and insurers",
  // #553 COWORK #168 item 2: preferreds and notes (pickerEquity "debt-or-preferred").
  notCommon: "Not a common share: this listing appears to be a preferred stock or note, so stock ratios don't apply",
} as const;

export type CellWhyCode = keyof typeof CELL_WHY_WORDS;

/** Codes that mark a figure as not applicable ("n/a"), not missing ("–"). */
export const NOT_APPLICABLE_CODES: ReadonlySet<string> = new Set<CellWhyCode>(["naEv", "naPs", "naFcf", "notCommon"]);

/**
 * The grid column keys a filings row can explain. The page attaches
 * `cellWhy[columnKey] = code` for each of these that is empty on that row.
 */
export const CELL_WHY_COLUMNS = [
  "marketCap", "ev", "pe", "ps", "pb", "pfcf",
  "dps", "dyield", "payout", "dgrowth",
  "revenue", "opinc", "netinc", "fcf", "eps",
] as const;
export type CellWhyColumn = (typeof CELL_WHY_COLUMNS)[number];

/** A dash with no code: a stock the filings job has not reached, or a non-filings column. */
export const CELL_WHY_DEFAULT = "Not available for this stock yet";

/**
 * The line under every Pickers table (COWORK #69 item 4, the owner's wording).
 *
 * HIDDEN, NOT DELETED (2026-10-03, #553 COWORK #103): it is no longer printed
 * whole. It said "SEC filings" under the Performance tab too, and "Hover" on a
 * phone. The table now prints CELL_WHY_TABLE_NOTE_BY_TAB's line for the tab
 * plus the hover/tap action below; the owner's wording is kept verbatim as the
 * lead on the tabs whose columns all come from the filings.
 */
export const CELL_WHY_TABLE_NOTE =
  "Figures come from company SEC filings; '–' means the filing doesn't give enough to calculate it. Hover for why.";

/** The tabs the grid has (PickerResultsGrid's TabKey; a new tab is a type error there until it has a note). */
export type PickerNoteTab = "general" | "performance" | "valuation" | "dividends" | "financials" | "analysts";

const OWNER_LEAD = "Figures come from company SEC filings; '–' means the filing doesn't give enough to calculate it";

/**
 * THE TABLE NOTE, PER TAB (#553 COWORK #103, 2026-10-03). The SEC wording only
 * where every visible column comes from the filings (Valuation, Dividends,
 * Financials); hedged wording on the mixed General tab and the price-based
 * Performance tab. The word cells ("Loss", "Neg.", "Not meaningful", "n/a")
 * are named on exactly the tabs whose columns can show them (CELL_WORDS, plus
 * A's words per column, pickersSecFundamentals.REFUSAL_WORD_CODES) -- the
 * check derives that from the grid's columns, so a tab cannot promise a word it never shows.
 * Each ends without the action: the grid appends CELL_WHY_ACTION's hover or
 * tap sentence, chosen by CSS media query so the server render is the same.
 */
export const CELL_WHY_TABLE_NOTE_BY_TAB: Record<PickerNoteTab, string> = {
  // HIDDEN, NOT DELETED (2026-10-03, #553 COWORK #102): P/E can now also read
  // A's "Not meaningful" (EPS near zero), so the line names it. Was:
  //   "Market Cap and P/E are based on company SEC filings where available, and price, change and volume on market data; " +
  //   "'–' means a figure isn't available, and 'Loss' means earnings per share weren't positive, so a P/E isn't meaningful."
  general:
    "Market Cap and P/E are based on company SEC filings where available, and price, change and volume on market data; " +
    "'–' means a figure isn't available, and 'Loss' means earnings per share weren't positive and 'Not meaningful' that they were close to zero, " +
    "so a P/E isn't meaningful; 'n/a' means the listing isn't a common share.",
  performance:
    "Returns are calculated from price history, and Market Cap is based on company SEC filings where available; " +
    "'–' means there isn't enough data to calculate a figure.",
  // HIDDEN, NOT DELETED (2026-10-03, #553 COWORK #102): P/E, P/S and P/B can
  // now also read A's "Not meaningful", so the line names it. Was:
  //   `${OWNER_LEAD}; 'Loss', 'Neg.' or 'n/a' means a ratio isn't meaningful (a loss, negative free cash flow or equity) ` +
  //   "or doesn't apply (banks and insurers).",
  valuation:
    `${OWNER_LEAD}; 'Loss', 'Neg.', 'Not meaningful' or 'n/a' means a ratio isn't meaningful ` +
    "(a loss, negative free cash flow or equity, earnings near zero, an incomplete revenue line, or equity that is very small next to market value) " +
    "or doesn't apply (banks and insurers, or a listing that isn't a common share).",
  // HIDDEN, NOT DELETED (2026-10-07, #553 COWORK #184 item 1): Payout can now
  // read "Loss", so the line names it. Was: `${OWNER_LEAD}.`
  dividends: `${OWNER_LEAD}; 'Loss' means earnings per share weren't positive, so there's no payout ratio.`,
  financials: `${OWNER_LEAD}.`,
  analysts: "Analyst figures aren't from company filings; '–' means a figure isn't available.",
};

/** The action sentence after the note: hover on a pointer device, tap on touch. */
export const CELL_WHY_ACTION = { hover: "Hover for why.", tap: "Tap for why." } as const;

/**
 * THE POPOVER'S EDGE CLAMP (#553 COWORK #103). The CSS anchors .whyPop to the
 * mark's right edge and caps its width at the viewport less a gutter each
 * side, so it fits a 360 px screen; this is the px shift that pulls a popover
 * still poking past either edge back inside. 0 when it already fits.
 */
export const WHY_POP_GUTTER = 8;
export function whyPopShift(left: number, right: number, viewport: number, gutter: number = WHY_POP_GUTTER): number {
  if (right > viewport - gutter) return Math.max(viewport - gutter - right, gutter - left);
  if (left < gutter) return gutter - left;
  return 0;
}

/**
 * WORD CELLS (#553 COWORK #94 Part 1). Where a figure would be MEANINGLESS
 * rather than missing, the cell says so in a word instead of "–". Same
 * lighter tone as "n/a", same hover/tap reason. A word cell has no figure, so
 * it sorts with the blanks (compareForSort), never as zero.
 *
 * TWO SOURCES, NEITHER DUPLICATED (#553 COWORK #102, 2026-10-03):
 *   - A's refusals ("Loss" for a P/E on a loss, "Neg." for a P/B on negative
 *     equity, "Not meaningful" for EPS near zero, an incomplete revenue line
 *     on P/S, or book equity too small for a P/B) come from secValuation's
 *     REFUSAL_CELL_WORD, looked up SERVER-SIDE
 *     (pickersSecFundamentals.secPickerWords, per column in
 *     REFUSAL_WORD_CODES) and shipped as `entry.cellWord`, because this module
 *     is imported by the client and may not import it.
 *   - The grid's own: "Neg." for negative free cash flow (not an A refusal)
 *     and the bank/insurer "n/a", below. Keyed by column AND code, so the word
 *     only appears in the column the ruling names; every other reason ("no
 *     dividend on file", "not enough history", ...) stays a dash.
 */
export const CELL_WORDS: Readonly<Partial<Record<CellWhyColumn, Partial<Record<CellWhyCode, string>>>>> = {
  // HIDDEN, NOT DELETED (2026-10-03, #553 COWORK #102): `pe: { epsNeg: "Loss" }`
  // and `pb: { eqNeg: "Neg." }` were here; the same words now come from A's
  // REFUSAL_CELL_WORD via entry.cellWord, so they live once.
  pfcf: { fcfNeg: "Neg.", naFcf: "n/a", notCommon: "n/a" },
  ev: { naEv: "n/a", notCommon: "n/a" },
  ps: { naPs: "n/a", notCommon: "n/a" },
  // Market Cap is on every tab, so a non-common listing's cap keeps the dash
  // (with the "Not a common share" reason on tap) rather than an "n/a" every
  // tab's note would then have to name.
  pe: { notCommon: "n/a" },
  pb: { notCommon: "n/a" },
};

/**
 * The mark an empty cell shows: a word (lighter tone) or the dash. `aWord` is
 * the word the page shipped for this cell from A's map, when there is one.
 */
export const CELL_DASH = "–";
export function cellMark(column: string, code: string | null | undefined, aWord?: string | null): { mark: string; word: boolean } {
  const byCode = (CELL_WORDS as Record<string, Record<string, string> | undefined>)[column];
  const word = code ? (byCode?.[code] ?? (aWord || undefined)) : undefined;
  return word ? { mark: word, word: true } : { mark: CELL_DASH, word: false };
}

/**
 * THE GRID'S SORT ORDER, for one pair of cell values. An empty cell -- a dash
 * or a word cell, which carry no figure -- sinks below every figure in BOTH
 * directions; it is never read as zero.
 */
export function compareForSort(
  av: string | number | null | undefined,
  bv: string | number | null | undefined,
  sortType: "str" | "num",
  dir: "asc" | "desc"
): number {
  const factor = dir === "asc" ? 1 : -1;
  if (sortType === "str") {
    const as = typeof av === "string" ? av : "";
    const bs = typeof bv === "string" ? bv : "";
    if (!as && !bs) return 0;
    if (!as) return 1;
    if (!bs) return -1;
    return factor * as.localeCompare(bs);
  }
  const an = typeof av === "number" && Number.isFinite(av) ? av : null;
  const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : null;
  if (an === null && bn === null) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  return factor * (an - bn);
}

/**
 * THE FISCAL-YEAR MARKER (#553 COWORK #90). A P/E, EPS or Payout figure on a
 * fiscal-year basis (A's EpsBasis "fiscal-year", labelled "FY2025" by
 * basisLabel in lib/server/pickersSecFundamentals.ts) carries a small "FY"
 * BEFORE the number, in a fixed-width slot, so the digits stay right-aligned
 * down the column with or without it. Its hover/tap note reuses A's label.
 */
export const FY_MARK = "FY";
export function isFiscalYearBasis(basis: string | null | undefined): boolean {
  return typeof basis === "string" && basis.startsWith("FY");
}
export function fyMarkWords(basis: string): string {
  return `Based on the last full fiscal year on file (${basis}), not the latest four quarters`;
}

/** The sentence for a code, or the default for an unknown or missing one. */
export function cellWhyWords(code: string | null | undefined): string {
  return (code && (CELL_WHY_WORDS as Record<string, string>)[code]) || CELL_WHY_DEFAULT;
}

/**
 * BANKS AND INSURERS, BY A's INDUSTRY LABEL (data/sec/sic-classification.json,
 * via resolveProfileBulk). Insurance brokers and agents are left out on
 * purpose: they are service businesses whose debt and revenue read like any
 * other company's.
 */
export function isBankOrInsurer(industry: string | null | undefined): boolean {
  const s = String(industry ?? "").trim();
  if (!s) return false;
  if (/^Banks\b/.test(s)) return true;
  if (/^Insurance - (Life|Property & Casualty|Reinsurance|Specialty|Diversified)$/.test(s)) return true;
  return s === "Insurance Carriers, NEC";
}

/**
 * THE DIV ($) CELL'S MARK (#553 COWORK #184 item 1, 2026-10-07): "cut" when
 * the figure is the latest quarter annualised because it sits below the
 * trailing total, "+ special" when a special dividend was left out of the
 * figure, the yield and the growth. Null when neither applies.
 */
export function dividendMark(e: { divCut?: { ttm: number }; divSpecial?: number }): { tag: string; tip: string } | null {
  const parts: string[] = [];
  let tag = "";
  if (e.divCut && Number.isFinite(e.divCut.ttm)) {
    tag = "cut";
    parts.push(`The latest quarterly dividend, annualised. It is below the last four quarters' total of $${e.divCut.ttm.toFixed(2)}, which suggests the dividend was cut; yield uses this figure.`);
  }
  if (typeof e.divSpecial === "number" && e.divSpecial > 0) {
    tag = tag ? `${tag} · + special` : "+ special";
    parts.push(`+ special $${e.divSpecial.toFixed(2)}: a special dividend in the last four quarters, left out of this figure, the yield and the growth.`);
  }
  return parts.length ? { tag, tip: parts.join(" ") } : null;
}
