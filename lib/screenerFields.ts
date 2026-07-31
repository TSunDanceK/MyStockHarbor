import { FILTER_DEFS, CATEGORY_FILTER_DEFS, type AnyFilterKey } from "@/lib/pickerFilters";

// ---------------------------------------------------------------------------
// The screener's field registry.
//
// Every filterable thing on a screener page is described here exactly once:
// the 25 boolean conditions that already existed, the two classification
// fields (sector / industry), and the ~26 numbers that were already being
// attached to every entry for the list-view tabs but were never filterable.
//
// This exists so adding a filter stops being a code change and becomes a data
// change. The old model hardcoded two separate shapes -- an AnyFilterKey[] of
// booleans and a string[] of sectors -- which meant every new *kind* of filter
// needed its own state, its own toggle, its own clause in the grid and its own
// block of UI. With a registry plus the Predicate union below, a new numeric
// filter is one entry in NUMBER_FIELDS and nothing else.
//
// Deliberately free of any component import: this module is pure data, so it
// can be read by the server component, the nav and the grid without creating a
// cycle (PickerResultPage already imports from lib/pickerFilters). Reading a
// value off an entry is the caller's job -- see valueForField in
// PickerResultsGrid.tsx, which handles the handful of derived fields (price,
// % change and volume fall back to end-of-day data when the price pool misses)
// that a plain property lookup can't express.
// ---------------------------------------------------------------------------

export type ScreenerFieldKind = "flag" | "category" | "number";

// Number formatting hint, used by the UI to render sensible inputs and by any
// future preset-page serialisation. Purely presentational -- filtering itself
// always compares raw numbers.
export type NumberFormat = "plain" | "percent" | "currency" | "abbreviated";

export type ScreenerFieldDef = {
  // Property name on a ResultEntry. Doubles as the predicate's field id.
  key: string;
  label: string;
  // Section header in the "Add a filter" search results.
  group: string;
  kind: ScreenerFieldKind;
  format?: NumberFormat;
  // Extra words to match on in search, for fields whose label isn't what
  // someone would actually type ("PE Ratio" vs "valuation", "cheap").
  aliases?: string[];
};

// The 18 custom-builder conditions plus the 7 category-membership ones. Reused
// from lib/pickerFilters.ts rather than restated, so the wording here can never
// drift from the checkbox labels in ScreenerNav.
export const FLAG_FIELDS: ScreenerFieldDef[] = [
  ...FILTER_DEFS.map((def) => ({
    key: def.key as string,
    label: def.label,
    group: "Conditions",
    kind: "flag" as const,
  })),
  ...CATEGORY_FILTER_DEFS.map((def) => ({
    key: def.key as string,
    label: def.label,
    group: "Conditions",
    kind: "flag" as const,
  })),
];

// Sector (~11 values) and industry (~150). Both come off the cached profile
// record. Industry is the one people actually search for -- "semiconductor
// stocks", not "technology sector stocks" -- but it's far too long to render as
// a list, which is why the search box matches category VALUES as well as field
// names.
export const CATEGORY_FIELDS: ScreenerFieldDef[] = [
  { key: "sector", label: "Sector", group: "Classification", kind: "category" },
  {
    key: "industry",
    label: "Industry",
    group: "Classification",
    kind: "category",
    aliases: ["semiconductor", "biotech", "banks", "software", "mining"],
  },
  { key: "rating", label: "Analyst Rating", group: "Analysts", kind: "category" },
  { key: "payoutFreq", label: "Payout Frequency", group: "Dividends", kind: "category" },
];

// Everything numeric already attached to an entry by the warm crons. None of
// this needed new data -- it was all being shipped for the list-view tabs and
// simply wasn't filterable.
export const NUMBER_FIELDS: ScreenerFieldDef[] = [
  // Trading
  { key: "price", label: "Stock Price", group: "Trading", kind: "number", format: "currency", aliases: ["under", "cheap", "share price"] },
  { key: "changePct", label: "% Change", group: "Trading", kind: "number", format: "percent" },
  { key: "volume", label: "Volume", group: "Trading", kind: "number", format: "abbreviated" },
  { key: "marketCap", label: "Market Cap", group: "Trading", kind: "number", format: "abbreviated", aliases: ["small cap", "large cap", "megacap", "size"] },

  // Valuation
  { key: "peRatio", label: "PE Ratio", group: "Valuation", kind: "number", aliases: ["p/e", "price to earnings", "cheap", "expensive"] },
  { key: "enterpriseValue", label: "Enterprise Value", group: "Valuation", kind: "number", format: "abbreviated", aliases: ["ev"] },
  { key: "psRatio", label: "PS Ratio", group: "Valuation", kind: "number", aliases: ["p/s", "price to sales"] },
  { key: "pbRatio", label: "PB Ratio", group: "Valuation", kind: "number", aliases: ["p/b", "price to book"] },
  { key: "pfcfRatio", label: "P/FCF Ratio", group: "Valuation", kind: "number", aliases: ["price to free cash flow"] },

  // Dividends
  { key: "divYield", label: "Dividend Yield", group: "Dividends", kind: "number", format: "percent", aliases: ["income", "yield"] },
  { key: "divPerShare", label: "Dividend Per Share", group: "Dividends", kind: "number", format: "currency" },
  { key: "payoutRatio", label: "Payout Ratio", group: "Dividends", kind: "number", format: "percent" },
  { key: "divGrowth", label: "Dividend Growth", group: "Dividends", kind: "number", format: "percent" },

  // Financials
  { key: "revenue", label: "Revenue", group: "Financials", kind: "number", format: "abbreviated", aliases: ["sales", "turnover"] },
  { key: "operatingIncome", label: "Operating Income", group: "Financials", kind: "number", format: "abbreviated" },
  { key: "netIncome", label: "Net Income", group: "Financials", kind: "number", format: "abbreviated", aliases: ["profit", "earnings"] },
  { key: "freeCashFlow", label: "Free Cash Flow", group: "Financials", kind: "number", format: "abbreviated", aliases: ["fcf"] },
  { key: "epsTtm", label: "EPS", group: "Financials", kind: "number", aliases: ["earnings per share"] },

  // Analysts
  { key: "analystCount", label: "Analyst Coverage", group: "Analysts", kind: "number", aliases: ["number of analysts"] },
  { key: "priceTarget", label: "Price Target", group: "Analysts", kind: "number", format: "currency", aliases: ["pt", "target"] },

  // Performance
  { key: "perf1w", label: "1 Week Performance", group: "Performance", kind: "number", format: "percent" },
  { key: "perf1m", label: "1 Month Performance", group: "Performance", kind: "number", format: "percent" },
  { key: "perf6m", label: "6 Month Performance", group: "Performance", kind: "number", format: "percent" },
  { key: "perfYtd", label: "YTD Performance", group: "Performance", kind: "number", format: "percent", aliases: ["year to date"] },
  { key: "perf1y", label: "1 Year Performance", group: "Performance", kind: "number", format: "percent" },
];

export const ALL_FIELDS: ScreenerFieldDef[] = [...FLAG_FIELDS, ...CATEGORY_FIELDS, ...NUMBER_FIELDS];

export const FIELD_BY_KEY = new Map<string, ScreenerFieldDef>(ALL_FIELDS.map((f) => [f.key, f]));

export function fieldLabel(key: string) {
  return FIELD_BY_KEY.get(key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// Predicates
//
// One selection list replaces the old pair of arrays. Semantics, unchanged from
// what the UI already does today:
//
//   * predicates AND with each other      -- oversold AND PE < 15
//   * `values` within one category OR     -- Technology OR Healthcare
//   * an absent min or max is unbounded   -- PE < 15 is { max: 15 }
//
// A flag predicate is exactly the old selectedFilters entry, and a category
// predicate on "sector" is exactly the old selectedSectors list, which is why
// PickerFilterContext can keep exposing both as derived views while the store
// underneath becomes this.
// ---------------------------------------------------------------------------

export type FlagPredicate = { kind: "flag"; field: AnyFilterKey };
export type CategoryPredicate = { kind: "category"; field: string; values: string[] };
export type NumberPredicate = { kind: "number"; field: string; min?: number; max?: number };

export type Predicate = FlagPredicate | CategoryPredicate | NumberPredicate;

// Stable identity for a predicate, used as a React key and to find the
// predicate a UI row is editing. One predicate per field is the rule: ticking a
// second sector extends the existing category predicate's `values` rather than
// adding another, which is what makes them OR rather than AND.
export function predicateId(p: Predicate) {
  return `${p.kind}:${p.field}`;
}

export function findPredicate(predicates: Predicate[], kind: Predicate["kind"], field: string) {
  return predicates.find((p) => p.kind === kind && p.field === field);
}

/**
 * Human summary of a single predicate, for the active-filter rows and for the
 * "N of M match your filters" line. Kept here beside the registry so the
 * wording follows the field labels automatically.
 */
export function describePredicate(p: Predicate): string {
  const label = fieldLabel(p.field);
  if (p.kind === "flag") return label;
  if (p.kind === "category") {
    if (!p.values.length) return label;
    if (p.values.length === 1) return `${label}: ${p.values[0]}`;
    return `${label}: any of ${p.values.join(", ")}`;
  }
  const { min, max } = p;
  if (min != null && max != null) return `${label} ${min}–${max}`;
  if (max != null) return `${label} under ${max}`;
  if (min != null) return `${label} over ${min}`;
  return label;
}

/**
 * Does a single already-extracted value satisfy this predicate?
 *
 * Value extraction is the caller's job (see valueForField in
 * PickerResultsGrid.tsx) because a few fields are derived rather than plain
 * properties. Keeping the comparison here means the rules live next to the
 * model they belong to, and the grid's filter loop stays one line.
 *
 * A missing value never passes a predicate. That's deliberate: a stock whose
 * profile hasn't been warmed has no sector, and a stock with no earnings has no
 * PE -- neither should silently slip through a filter the visitor set.
 */
export function valueSatisfies(p: Predicate, value: unknown): boolean {
  if (p.kind === "flag") return value === true;

  if (p.kind === "category") {
    if (!p.values.length) return true;
    return typeof value === "string" && p.values.includes(value);
  }

  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (p.min != null && value < p.min) return false;
  if (p.max != null && value > p.max) return false;
  return true;
}
