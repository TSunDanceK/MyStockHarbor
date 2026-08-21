// lib/stock-news-templates.ts
//
// Pure, non-AI template helpers for the stock/news pages. These build the
// algorithmic "why this matters" / "beyond the headline" / "what it means"
// copy that renders instantly (no AI call, no network round-trip, safe to
// run on every request or inside a route handler).
//
// They also serve as the guaranteed-safe fallback whenever an AI call is
// unavailable (no OPENAI_API_KEY) or fails: callers should always be able
// to show *something* useful from these functions alone.
//
// Extracted out of app/stock/[symbol]/news/page.tsx so that route handlers
// (app/api/stock-news/why-it-matters/route.ts, app/api/stock-news/insight/route.ts)
// can reuse the exact same fallback logic without importing from a page
// module, which the Next.js App Router does not support.

export type ScoreTone = "green" | "yellow" | "red";

type ToneLike = {
  tone: ScoreTone;
};

type ArticleLike = {
  title: string;
};

function keywordHits(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function formatMoney(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : "—";
}

export function buildWhyItMatters(
  item: ArticleLike,
  symbol: string,
  // null when the trend could not be established. Every use below compares
  // trend against a specific state, so null simply matches none of them --
  // except the one !== check at buildBeyondHeadline, which is guarded there.
  trend: string | null,
  newsScore: ToneLike
) {
  const lower = item.title.toLowerCase();

  if (keywordHits(lower, ["earnings", "results", "revenue", "guidance", "quarter"])) {
    return `Quarterly updates can reset expectations quickly, so even one earnings-related headline can change how investors frame ${symbol} in the near term.`;
  }
  if (keywordHits(lower, ["upgrade", "downgrade", "price target", "analyst"])) {
    return `Analyst calls can shift attention fast, but they usually matter more when price action starts confirming the same message.`;
  }
  if (keywordHits(lower, ["delivery", "deliveries", "production", "factory", "supply"])) {
    return `Execution headlines matter because investors want proof that the business story is holding up in real operations, not just in market hype.`;
  }
  if (keywordHits(lower, ["lawsuit", "probe", "investigation", "recall"])) {
    return `Risk headlines can weigh on sentiment because uncertainty often stays in the stock until the market sees the issue is contained.`;
  }
  if (keywordHits(lower, ["ai", "chip", "product", "launch", "software"])) {
    return `Product and theme headlines matter when traders are trying to decide whether a stock still has a strong reason to stay in focus.`;
  }
  if (keywordHits(lower, ["market", "sector", "fed", "rates", "tariff"])) {
    return `Sometimes a stock reacts more to the environment around it than to company-specific news, so broader context can matter more than one isolated headline.`;
  }
  if (newsScore.tone === "green" && trend === "Bullish trend") {
    return `The headline matters more when the chart is already supportive, because news and price structure are pulling in the same direction.`;
  }
  if (newsScore.tone === "red" && trend === "Bearish trend") {
    return `The headline matters more when the chart is already weak, because bad news has less technical support underneath it.`;
  }
  return `This matters mainly because traders now watch whether the chart absorbs the headline calmly or starts to break in response.`;
}

export function buildWhatItMeans(args: {
  symbol: string;
  trend: string | null;
  newsScore: ToneLike;
  rsi: number | null;
  priceVs50: number | null;
}) {
  const { symbol, trend, newsScore, rsi, priceVs50 } = args;
  const lines: string[] = [];

  if (newsScore.tone === "green" && trend === "Bullish trend") {
    lines.push(`${symbol} has a cleaner backdrop when positive headlines are landing into an already supportive chart, because the news and the structure are pointing in the same direction.`);
  } else if (newsScore.tone === "green") {
    lines.push(`The recent headline flow for ${symbol} looks better than the chart structure, so traders may now watch for stronger price confirmation rather than assuming the story has already fully improved.`);
  } else if (newsScore.tone === "red" && trend === "Bearish trend") {
    lines.push(`${symbol} looks more vulnerable when weaker headlines arrive into an already soft chart, because negative news has less technical support underneath it.`);
  } else if (newsScore.tone === "red") {
    lines.push(`The chart may still be holding up better than the recent headline tone, but traders will watch whether weaker coverage starts damaging support or simply gets absorbed.`);
  } else {
    lines.push(`${symbol} currently sits in a more mixed zone where headline tone alone is unlikely to settle the next move without clearer price confirmation.`);
  }

  if (typeof rsi === "number" && rsi >= 70) {
    lines.push(`Momentum already looks warm, so even strong news may lead to pause-and-hold behaviour before the next cleaner move higher.`);
  } else if (typeof rsi === "number" && rsi <= 35) {
    lines.push(`Momentum is softer, which means modestly better news could matter more than usual if traders start looking for stabilisation or rebound attempts.`);
  }

  if (typeof priceVs50 === "number" && priceVs50 >= 10) {
    lines.push(`Because ${symbol} is already stretched above the 50-day average, the next bullish step often depends on support holding rather than on endless excitement.`);
  } else if (typeof priceVs50 === "number" && priceVs50 <= -10) {
    lines.push(`Because ${symbol} is trading well below the 50-day average, stronger headlines may first need to repair damage before the market treats them as a fresh uptrend signal.`);
  }

  return lines.slice(0, 3);
}

export function buildBeyondHeadline(args: {
  symbol: string;
  newsScore: ToneLike;
  trend: string | null;
  recentHigh: number | null;
  recentLow: number | null;
}) {
  const { symbol, newsScore, trend, recentHigh, recentLow } = args;

  // trend !== "Bearish trend" is true for null too, which would assert "price
  // keeps holding above important structure" for a stock whose structure was
  // never established. Require a known trend.
  if (newsScore.tone === "red" && trend !== null && trend !== "Bearish trend") {
    return `The outside-the-box read for ${symbol} is that apparently bad news does not always become lasting damage. If price keeps holding above important structure despite weaker headlines, that can mean some fear was already priced in or that stronger hands are still supporting the stock.`;
  }
  if (newsScore.tone === "green" && trend === "Bearish trend") {
    return `The outside-the-box read for ${symbol} is that good news can still disappoint if the chart remains weak. Traders often want to see reclaim attempts and better price behaviour before assuming the headlines have truly changed the bigger trend.`;
  }
  if (typeof recentHigh === "number" && typeof recentLow === "number") {
    return `${symbol} may not need perfect headlines to improve. Sometimes the more important clue is whether the stock stops making lower lows near ${formatMoney(recentLow)} and starts building toward resistance near ${formatMoney(recentHigh)}. That kind of behaviour can quietly matter more than a dramatic headline.`;
  }
  return `The deeper read for ${symbol} is that headlines often matter most when they confirm or challenge the chart at a key moment. Good news is most useful when it attracts follow-through. Bad news is most dangerous when support is already fragile.`;
}
