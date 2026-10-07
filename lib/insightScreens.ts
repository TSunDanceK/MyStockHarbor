// WHICH SCREENS A STOCK SHOWS UP IN, FOR THE INSIGHT PAGE (#563 COWORK #133).
//
// The pickers payload's per-symbol flags, each mapped to the screen page that
// lists that condition. Every href is one of PICKER_ROUTES (lib/pickerRoutes.ts);
// scripts/check-insight-page.mjs holds them to that list. Flags with no page of
// their own (buy / sell signals and the other category picks) are left out.
import type { SetupLabel } from "@/lib/insightView";

export const SCREEN_ROUTES = {
  oversold: { label: "Oversold", href: "/oversold-stocks-today" },
  overbought: { label: "Overbought", href: "/overbought-stocks-today" },
  buyTheDip: { label: "20%+ from all-time high", href: "/stocks-down-20-from-all-time-highs" },
  breakout: { label: "Breakout", href: "/breakout-signal-stocks" },
  volumeSpike: { label: "Volume spike", href: "/volume-spike-stocks" },
  atrSpike: { label: "Range spike (ATR)", href: "/atr-spike-stocks" },
  dailyMa200Proximity: { label: "Near the 200-day", href: "/stocks-near-200-day-moving-average" },
  weeklyMa200Proximity: { label: "Near the 200-week", href: "/stocks-near-weekly-200-day-moving-average" },
  aboveMA200: { label: "Above the 200-day", href: "/stocks-trading-above-200-day-moving-average" },
  belowMA200: { label: "Below the 200-day", href: "/stocks-below-200-day-moving-average" },
  aboveMA50: { label: "Above the 50-day", href: "/stocks-above-50-day-moving-average" },
  belowMA50: { label: "Below the 50-day", href: "/stocks-below-50-day-moving-average" },
  trendFlipBullish: { label: "Trend flip up (daily)", href: "/stocks-with-bullish-trend-flip" },
  trendFlipBearish: { label: "Trend flip down (daily)", href: "/stocks-with-bearish-trend-flip" },
  trendFlipBullishWeekly: { label: "Trend flip up (weekly)", href: "/stocks-with-weekly-bullish-trend-flip" },
  trendFlipBearishWeekly: { label: "Trend flip down (weekly)", href: "/stocks-with-weekly-bearish-trend-flip" },
  bullishRsiDivergence: { label: "Bullish RSI divergence", href: "/bullish-rsi-divergence-stocks" },
  bearishRsiDivergence: { label: "Bearish RSI divergence", href: "/bearish-rsi-divergence-stocks" },
  bullishMacdDivergence: { label: "Bullish MACD divergence", href: "/bullish-macd-divergence-stocks" },
  bearishMacdDivergence: { label: "Bearish MACD divergence", href: "/bearish-macd-divergence-stocks" },
  positiveLastEarnings: { label: "Positive last earnings", href: "/stocks-with-positive-last-earnings" },
  strongEarningsGrowth: { label: "Strong earnings growth", href: "/stocks-with-strong-earnings-growth" },
} as const;

export type ScreenFlag = keyof typeof SCREEN_ROUTES;

/**
 * THE MOST RELEVANT SCREEN FOR THE POST'S SETUP (the "More on" card): the
 * screen of the level the label names, else the stock's first screen, else
 * the level's own screen even when the stock is not on it today.
 */
export function screenFor(label: SetupLabel | null, flags: readonly ScreenFlag[] | null): { label: string; href: string } | null {
  const t = label?.text ?? "";
  const want: ScreenFlag[] = /200-week/.test(t) ? ["weeklyMa200Proximity"]
    : /200-day/.test(t) ? (/Testing/.test(t) ? ["dailyMa200Proximity"] : /Above/.test(t) ? ["aboveMA200", "dailyMa200Proximity"] : ["belowMA200", "dailyMa200Proximity"])
    : /50-day/.test(t) ? (/Below/.test(t) ? ["belowMA50"] : ["aboveMA50"])
    : [];
  const hit = want.find((f) => flags?.includes(f)) ?? flags?.[0] ?? want[0];
  return hit ? { ...SCREEN_ROUTES[hit] } : null;
}
