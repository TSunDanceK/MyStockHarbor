/**
 * ── PICKER COLUMNS THAT ARE HIDDEN, NOT REMOVED (2026-09-23) ──────────────
 *
 * Relay B, #553 COWORK #1 item 4 and COWORK #5 Q4. The same shape as
 * RETIRED_BLOCKS in app/stock/[symbol]/retiredBlocks.ts: every entry names what
 * the column showed, what supplied it, when it stopped and why -- so the next
 * person to notice the gap finds the reason instead of wiring the column to
 * whatever is nearest.
 *
 * IMPORTS NOTHING. PickerResultsGrid is a client component and
 * lib/screenerFields.ts is bundled for the browser; both read this list, and so
 * does the server page and scripts/check-pickers-sec.mjs.
 *
 * ONE LIST DECIDES THREE THINGS, so they cannot disagree:
 *   1. the grid's columns (a hidden column is not rendered and not sortable);
 *   2. the tabs (a tab whose every data column is hidden is not offered);
 *   3. the filter fields (a condition on a hidden field is not offered, and a
 *      URL carrying one is ignored rather than filtering on nothing).
 * The page also stops copying these fields into the payload.
 *
 * WHAT A HIDDEN COLUMN RENDERS: nothing. No placeholder column of dashes.
 * Removing an entry restores the column, the tab and the filter, and nothing
 * else has to change -- the column definitions are kept in the grid.
 */
export type HiddenPickerField = {
  /** The ResultEntry field. */
  field: "rating" | "analystCount" | "priceTarget" | "forwardEps" | "payoutFreq";
  /** Grid column keys that read it. */
  columns: string[];
  /** What a reader saw. */
  label: string;
  /** What supplied it. */
  source: string;
  retiredOn: string;
  reason: string;
};

const ANALYST_REASON =
  "A vendor consensus, not a filed figure. The SEC publishes nothing equivalent and no " +
  "free source covers it, so the column has no successor to move to.";

export const HIDDEN_PICKER_FIELDS: HiddenPickerField[] = [
  {
    field: "rating",
    columns: ["rating"],
    label: "Rating",
    source: "FMP /stable/grades-consensus, via warm-stock-data",
    retiredOn: "2026-09-23",
    reason: ANALYST_REASON,
  },
  {
    field: "analystCount",
    columns: ["analysts"],
    label: "Analysts",
    source: "FMP /stable/price-target-summary lastQuarterCount (analyst-estimates as fallback)",
    retiredOn: "2026-09-23",
    reason: ANALYST_REASON,
  },
  {
    field: "priceTarget",
    columns: ["ptgt", "ptups"],
    label: "Price Target, PT Upside",
    source: "FMP /stable/price-target-summary lastQuarterAvgPriceTarget",
    retiredOn: "2026-09-23",
    reason: ANALYST_REASON,
  },
  {
    field: "forwardEps",
    columns: ["fwdpe"],
    label: "Forward PE",
    source: "FMP /stable/analyst-estimates epsAvg (price ÷ forward EPS)",
    retiredOn: "2026-09-23",
    reason: "Forward EPS is an analyst estimate, not a filed figure. " + ANALYST_REASON,
  },
  {
    field: "payoutFreq",
    columns: ["freq"],
    label: "Payout Freq.",
    source: "FMP /stable/dividends frequency",
    retiredOn: "2026-09-23",
    reason:
      "The filings carry the per-share amount declared, not a payment schedule. Inferring one " +
      "from how many quarters carry a declaration is unmeasured, so the column is hidden " +
      "rather than guessed (COWORK #5 Q4).",
  },
];

/** Tabs that are hidden because every data column on them is. */
export const HIDDEN_PICKER_TABS: string[] = ["analysts"];

export const HIDDEN_FIELD_KEYS: ReadonlySet<string> = new Set(HIDDEN_PICKER_FIELDS.map((h) => h.field));
export const HIDDEN_COLUMN_KEYS: ReadonlySet<string> = new Set(HIDDEN_PICKER_FIELDS.flatMap((h) => h.columns));
