// lib/market-mood.ts

export type MarketMoodTone = "green" | "yellow" | "red";

export type MarketMoodResult = {
  score: number;
  label: string;
  tone: MarketMoodTone;
};

export function buildMarketMoodScore(args: {
  lastClose: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi: number | null;
}): MarketMoodResult {
  const { lastClose, ma50, ma200, rsi } = args;

  let score = 50;

  if (typeof lastClose === "number" && typeof ma200 === "number") {
    score += lastClose > ma200 ? 15 : -15;
  }

  if (typeof lastClose === "number" && typeof ma50 === "number") {
    score += lastClose > ma50 ? 10 : -10;
  }

  if (typeof ma50 === "number" && typeof ma200 === "number") {
    score += ma50 > ma200 ? 10 : -10;
  }

  if (typeof rsi === "number") {
    if (rsi > 70) score += 5;
    else if (rsi < 30) score -= 5;
  }

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
