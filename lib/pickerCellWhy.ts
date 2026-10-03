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
  evIn: "Debt or cash isn't on the latest filing in a form that can be added up, and it isn't estimated",
  ebitNeg: "EBITDA over the last twelve months was not positive",
  // ── this grid's own
  fcfNeg: "Free cash flow was negative",
  noFcf: "No twelve months of free cash flow on file",
  noOpi: "No twelve months of operating income on file",
  noNi: "No twelve months of net income on file",
  noDiv: "No dividend on file for the last twelve months",
  noDg: "Not enough dividend history on file to compare",
  payMix: "Not shown: the earnings and dividend periods on file differ",
  noPay: "No dividend and earnings on file for the same period",
  fx: "The filing is in a currency that couldn't be converted to US dollars",
  noPx: "No current price for this stock",
  noCap: "Market value can't be calculated from the latest filing",
  // ── "n/a": the figure does not apply, rather than being missing
  naEv: "Doesn't apply: debt isn't reported in a comparable way for banks and insurers",
  naPs: "Doesn't apply: revenue isn't comparable for banks and insurers",
  naFcf: "Doesn't apply: free cash flow isn't comparable for banks and insurers",
} as const;

export type CellWhyCode = keyof typeof CELL_WHY_WORDS;

/** Codes that mark a figure as not applicable ("n/a"), not missing ("–"). */
export const NOT_APPLICABLE_CODES: ReadonlySet<string> = new Set<CellWhyCode>(["naEv", "naPs", "naFcf"]);

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

/** The line under every Pickers table (COWORK #69 item 4, the owner's wording). */
export const CELL_WHY_TABLE_NOTE =
  "Figures come from company SEC filings; '–' means the filing doesn't give enough to calculate it. Hover for why.";

/**
 * WORD CELLS (#553 COWORK #94 Part 1). Where a figure would be MEANINGLESS
 * rather than missing, the cell says so in a word instead of "–": a P/E on a
 * loss, a P/FCF on negative free cash flow, a P/B on negative equity, and the
 * bank/insurer "n/a" above. Keyed by column AND code, so the word only appears
 * in the column the ruling names (a "–" for "EPS near zero", "no dividend on
 * file", "not enough history" and every other reason stays a dash). Same
 * lighter tone as "n/a", same hover/tap reason. A word cell has no figure, so
 * it sorts with the blanks (compareForSort), never as zero.
 */
export const CELL_WORDS: Readonly<Partial<Record<CellWhyColumn, Partial<Record<CellWhyCode, string>>>>> = {
  pe: { epsNeg: "Loss" },
  pfcf: { fcfNeg: "Neg.", naFcf: "n/a" },
  pb: { eqNeg: "Neg." },
  ev: { naEv: "n/a" },
  ps: { naPs: "n/a" },
};

/** The mark an empty cell shows: a word (lighter tone) or the dash. */
export const CELL_DASH = "–";
export function cellMark(column: string, code: string | null | undefined): { mark: string; word: boolean } {
  const byCode = (CELL_WORDS as Record<string, Record<string, string> | undefined>)[column];
  const word = code ? byCode?.[code] : undefined;
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
