// Shared "custom builder" filter definitions -- the same boolean-field
// checklist used by /pickers' own filter chips (app/pickers/PickersClient.tsx)
// and by the single-category picker pages (via ScreenerNav's FilterChecklist
// + PickerResultsGrid, see app/components/PickerResultPage.tsx). Kept in one
// module so both surfaces filter on exactly the same fields/labels/tones and
// can't drift apart.
export type FilterKey =
  | "oversold"
  | "overbought"
  | "buyTheDip"
  | "breakout"
  | "volumeSpike"
  | "atrSpike"
  | "aboveMA50"
  | "belowMA50"
  | "aboveMA200"
  | "belowMA200"
  | "dailyMa200Proximity"
  | "weeklyMa200Proximity"
  | "trendFlipBullish"
  | "trendFlipBearish"
  | "trendFlipBullishWeekly"
  | "trendFlipBearishWeekly"
  | "bullishRsiDivergence"
  | "bearishRsiDivergence"
  | "bullishMacdDivergence"
  | "bearishMacdDivergence"
  | "positiveLastEarnings"
  | "strongEarningsGrowth";

export type PickerTone = "green" | "yellow" | "orange" | "red" | "blue";

export type FilterDef = { key: FilterKey; label: string; tone: PickerTone };

export const FILTER_DEFS: FilterDef[] = [
  { key: "oversold", label: "Oversold", tone: "green" },
  { key: "overbought", label: "Overbought", tone: "red" },
  { key: "buyTheDip", label: "20%+ From ATH", tone: "yellow" },
  { key: "breakout", label: "Breakout", tone: "orange" },
  { key: "volumeSpike", label: "Volume Spike", tone: "orange" },
  { key: "atrSpike", label: "ATR Spike", tone: "orange" },
  { key: "aboveMA50", label: "Above MA50", tone: "yellow" },
  { key: "belowMA50", label: "Below MA50", tone: "yellow" },
  { key: "aboveMA200", label: "Above MA200", tone: "yellow" },
  { key: "belowMA200", label: "Below MA200", tone: "yellow" },
  { key: "dailyMa200Proximity", label: "Near 200-Day MA (Daily)", tone: "yellow" },
  { key: "weeklyMa200Proximity", label: "Near 200-Day MA (Weekly)", tone: "yellow" },
  // Trend Helper (Slow) confirmed a direction flip within the last four bars.
  // See computeTrendFlips in lib/server/pickersBuilder.ts for the exact rule.
  { key: "trendFlipBullish", label: "Bullish Trend Flip (Daily)", tone: "green" },
  { key: "trendFlipBearish", label: "Bearish Trend Flip (Daily)", tone: "red" },
  { key: "trendFlipBullishWeekly", label: "Bullish Trend Flip (Weekly)", tone: "green" },
  { key: "trendFlipBearishWeekly", label: "Bearish Trend Flip (Weekly)", tone: "red" },
  { key: "bullishRsiDivergence", label: "Bullish RSI Divergence", tone: "green" },
  { key: "bearishRsiDivergence", label: "Bearish RSI Divergence", tone: "red" },
  { key: "bullishMacdDivergence", label: "Bullish MACD Divergence", tone: "green" },
  { key: "bearishMacdDivergence", label: "Bearish MACD Divergence", tone: "red" },
  { key: "positiveLastEarnings", label: "Positive Last Earnings", tone: "green" },
  { key: "strongEarningsGrowth", label: "Strong Earnings Growth", tone: "green" },
];

// A second, separate set of checkable keys -- NOT part of the 18-condition
// custom builder above, so adding to this list never changes what /pickers'
// own filter chips (PickersClient.tsx) offer. These back the category
// checkboxes in ScreenerNav (see ScreenerNav.tsx's GROUPS): each one means
// "this stock is a member of that category's own page", derived for free
// from data already fetched for every picker page (the full `sections` +
// `signalRecords` payload -- see buildCategoryFlags in PickerResultPage.tsx).
export type CategoryFilterKey =
  | "hasBuySignal"
  | "hasSellSignal"
  | "bestTrendPick"
  | "divergencePick"
  | "athBreakoutPick"
  | "threeMonthHighPick"
  | "macroSrPick";

// The combined type ScreenerNav/PickerFilterContext/PickerResultsGrid use --
// a selection can mix conditions from the custom builder (e.g. "oversold")
// with category-membership checks (e.g. "hasBuySignal") and both are ANDed
// together the same way.
export type AnyFilterKey = FilterKey | CategoryFilterKey;

// {key, label, tone} for the 7 category-membership checks, in the same
// shape as FILTER_DEFS above -- lets the "allSymbols" custom-screener page
// (see PickerResultPage.tsx's buildEntries) build reason-chip labels and a
// combined score for these 7 checks exactly the same way it already does
// for the 18 custom-builder FILTER_DEFS.
export const CATEGORY_FILTER_DEFS: { key: CategoryFilterKey; label: string; tone: PickerTone }[] = [
  { key: "hasBuySignal", label: "Buy Signal", tone: "green" },
  { key: "hasSellSignal", label: "Sell Signal", tone: "red" },
  { key: "bestTrendPick", label: "Best Trend", tone: "green" },
  { key: "divergencePick", label: "Divergence", tone: "blue" },
  { key: "athBreakoutPick", label: "ATH Breakout", tone: "orange" },
  { key: "threeMonthHighPick", label: "3-Month High", tone: "orange" },
  { key: "macroSrPick", label: "Macro S/R", tone: "blue" },
];

export function toneDotColor(tone?: string) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  if (tone === "blue") return "#60a5fa";
  return "rgba(255,255,255,0.30)";
}
