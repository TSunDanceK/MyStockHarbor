// lib/market-mood.ts

export type MarketMoodTone = "green" | "yellow" | "red";

export type MarketMoodResult = {
  score: number;
  label: string;
  tone: MarketMoodTone;
};

// Returns null when not one of the four terms below was computable. #313
// guarded the caller on whether the FETCH succeeded; this guards on whether the
// fetched series was long enough to compute anything from. A 100-bar series has
// no MA200, so three of the four terms never fire and a successful read of a
// short series still produced a confident "50/100 -- Neutral".
export function buildMarketMoodScore(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi: number | null;
}): MarketMoodResult | null {
  const { lastClose, ma50, ma200, rsi } = args;

  // Only the three moving-average terms count as signals. RSI is a +/-5
  // modifier that contributes nothing at all between 30 and 70, so a score
  // built from a mid-range RSI and nothing else is still the bare seed -- and
  // counting it would have let "50/100 Neutral" through on a series too short
  // for any MA. Verified: with only rsi=52 supplied, counting RSI as a signal
  // returns 50/100 "Neutral"; requiring an MA term returns null.
  let score = 50;
  let signals = 0;

  if (typeof lastClose === "number" && typeof ma200 === "number") {
    score += lastClose > ma200 ? 15 : -15;
    signals++;
  }

  if (typeof lastClose === "number" && typeof ma50 === "number") {
    score += lastClose > ma50 ? 10 : -10;
    signals++;
  }

  if (typeof ma50 === "number" && typeof ma200 === "number") {
    score += ma50 > ma200 ? 10 : -10;
    signals++;
  }

  if (typeof rsi === "number") {
    if (rsi > 70) score += 5;
    else if (rsi < 30) score -= 5;
  }

  // 50 with no structural term added to it is the seed, not a reading.
  if (signals === 0) return null;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label = "Neutral";
  if (score <= 24) label = "Extreme Fear";
  else if (score <= 44) label = "Fear";
  else if (score <= 55) label = "Neutral";
  else if (score <= 75) label = "Greed";
  else label = "Extreme Greed";

  const tone: MarketMoodTone =
    score >= 65 ? "green" : score >= 50 ? "yellow" : "red";

  return { score, label, tone };
}
