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
  { key: "bullishRsiDivergence", label: "Bullish RSI Divergence", tone: "green" },
  { key: "bearishRsiDivergence", label: "Bearish RSI Divergence", tone: "red" },
  { key: "bullishMacdDivergence", label: "Bullish MACD Divergence", tone: "green" },
  { key: "bearishMacdDivergence", label: "Bearish MACD Divergence", tone: "red" },
  { key: "positiveLastEarnings", label: "Positive Last Earnings", tone: "green" },
  { key: "strongEarningsGrowth", label: "Strong Earnings Growth", tone: "green" },
];

export function toneDotColor(tone?: string) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  if (tone === "blue") return "#60a5fa";
  return "rgba(255,255,255,0.30)";
}
