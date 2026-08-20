import type { CSSProperties } from "react";
import StockNewsTickerJump from "./StockNewsTickerJump";
import type { Metadata } from "next";
import Link from "next/link";
import { getStockNewsBaseData } from "@/lib/stock-news-data";
import {
  buildWhyItMatters,
  buildBeyondHeadline,
  buildWhatItMeans,
} from "@/lib/stock-news-templates";
import { getDailyHistory } from "@/lib/server/historyCache";
import {
  computeIndicatorSeed,
  type Point,
} from "@/lib/indicators";
import ShareButton from "@/app/components/ShareButton";
import TickerLogo from "@/app/components/TickerLogo";
import WhyThisMatters from "./WhyThisMatters";
import AiInsightCard from "./AiInsightCard";
import { WatermarkVisibilityProvider, HideWatermarksBar, NewsScoreWatermark } from "@/app/components/WatermarkVisibility";
import {
  getLatestEarningsData,
  type LatestEarningsData,
  type EarningsPeriodSummary,
  type EarningsYearSummary,
} from "@/lib/latest-earnings-data";
import SharedLatestEarningsCard from "@/app/components/LatestEarningsCard";
import { getRelatedSymbols } from "@/lib/curatedSymbols";
import RelatedStocks from "@/app/components/RelatedStocks";

export const runtime = "nodejs";

// This page previously set `dynamic = "force-dynamic"`, for a real reason worth
// keeping on the record: Vercel's Full Route Cache was observed serving
// pre-deploy HTML for this page well past a code change, and for a news page
// whose filtering logic gets tuned periodically, "always reflects the latest
// deploy" was judged worth a per-request render.
//
// That trade-off is revisited, not discarded. The staleness window is now
// bounded by the layout's `revalidate = 900`, so the worst case is 15 minutes
// behind a deploy rather than indefinite. Against that: every request to this
// route -- and most of them are prefetches and crawlers, not readers -- was
// paying a full serverless render, ~615 of them in 24h, to produce
// substantially identical HTML.
//
// No `dynamic`/`revalidate` export here on purpose: segment config cascades
// from app/stock/[symbol]/layout.tsx, so the three routes under it cannot
// drift apart. If this page ever genuinely needs to bypass the cache after a
// deploy, on-demand revalidation is the tool, not force-dynamic.

type Props = {
  params: Promise<{ symbol: string }>;
};

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
  description: string | null;
  // FMP stock-news items usually include a thumbnail image; the Google
  // News RSS fallback in lib/stock-news-data.ts does not, so this can be
  // null/undefined and rendering below must handle that gracefully.
  image?: string | null;
};

type ScoreTone = "green" | "yellow" | "red";

type NewsScoreResult = {
  score: number;
  tone: ScoreTone;
  label: string;
  reason: string;
  positives: string[];
  negatives: string[];
  confidence: "Low" | "Medium" | "High";
};

type EarningsScoreResult = {
  score: number;
  label: string;
  tone: ScoreTone;
  reason: string;
};

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${stooqSymbol}&f=sd2t2l&h&e=csv`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });

    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;

    const row = lines[1].split(",");
    const price = Number(row[3] ?? "");

    return {
      symbol,
      price: Number.isFinite(price) ? price : null,
      date: row[1] ?? null,
      time: row[2] ?? null,
      source: "Stooq",
    };
  } catch {
    return null;
  }
}

async function fetchHistory(symbol: string): Promise<Point[]> {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });

    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 3) return [];

    const points: Point[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const date = String(cols[0] ?? "")
        .replace(/\r/g, "")
        .trim();
      const high = Number(String(cols[2] ?? "").replace(/\r/g, ""));
      const low = Number(String(cols[3] ?? "").replace(/\r/g, ""));
      const close = Number(String(cols[4] ?? "").replace(/\r/g, ""));
      const volume = Number(String(cols[5] ?? "").replace(/\r/g, ""));

      if (!date || !Number.isFinite(close)) continue;

      points.push({
        date,
        close,
        high: Number.isFinite(high) ? high : undefined,
        low: Number.isFinite(low) ? low : undefined,
        volume: Number.isFinite(volume) ? volume : undefined,
      });
    }

    return points.slice(-320);
  } catch {
    return [];
  }
}

async function fetchCompanyName(symbol: string): Promise<string> {
  try {
    const [nasdaqTxt, otherTxt] = await Promise.all([
      fetch("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt", {
        next: { revalidate: 86400 },
      }).then((r) => r.text()),
      fetch("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt", {
        next: { revalidate: 86400 },
      }).then((r) => r.text()),
    ]);

    const rows = `${nasdaqTxt}\n${otherTxt}`.split("\n");

    for (const row of rows) {
      const cols = row.split("|");
      if ((cols[0] ?? "").trim().toUpperCase() === symbol.toUpperCase()) {
        return (cols[1] ?? "").trim();
      }
    }

    return "";
  } catch {
    return "";
  }
}

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }

  return out;
}

function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;
  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
}

function pctFromBase(last: number | null, base: number | null) {
  if (
    typeof last !== "number" ||
    typeof base !== "number" ||
    !Number.isFinite(last) ||
    !Number.isFinite(base) ||
    base === 0
  ) {
    return null;
  }

  return ((last - base) / base) * 100;
}

function trendLabel(
  lastClose: number | null,
  ma50: number | null,
  ma200: number | null,
) {
  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Bullish trend";
    if (lastClose < ma50 && ma50 < ma200) return "Bearish trend";
    if (lastClose > ma200 && lastClose < ma50)
      return "Pullback in larger uptrend";
    if (lastClose < ma200 && lastClose > ma50) return "Counter-trend bounce";
  }

  return "Mixed / range";
}

function formatMoney(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : "—";
}

function formatPercent(value: number | null, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatDate(value: string | null) {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatLargeMoney(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000_000)
    return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000)
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatPlainDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function earningsToneScore(earnings: LatestEarningsData) {
  if (!earnings.hasStructuredData) return 50;
  if (earnings.tone === "green") return 78;
  if (earnings.tone === "red") return 28;
  return 55;
}

function compactSource(source: string | null) {
  if (!source) return "Publisher";
  return source.replace(/\s+News$/i, "").trim();
}

function keywordHits(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function scoreNews(news: NewsItem[]): NewsScoreResult {
  if (!news.length) {
    return {
      score: 50,
      tone: "yellow",
      label: "Neutral",
      reason:
        "There are not enough fresh headlines here to lean clearly bullish or bearish, so the score stays neutral.",
      positives: [],
      negatives: [],
      confidence: "Low",
    };
  }

  const ranked = [...news].sort((a, b) => {
    const scoreDiff = scoreNewsItem(b) - scoreNewsItem(a);
    if (scoreDiff !== 0) return scoreDiff;

    const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return bTime - aTime;
  });

  const highValue = ranked.filter((item) => !isLowValueNewsItem(item));
  const candidates = (highValue.length ? highValue : ranked).slice(0, 5);

  const positiveTitles: string[] = [];
  const negativeTitles: string[] = [];

  let weightedSum = 0;
  let totalWeight = 0;
  let signalCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const title = item.title.toLowerCase();

    const positionWeight =
      i === 0 ? 1.35 : i === 1 ? 1.18 : i === 2 ? 1.02 : 0.9;
    let itemScore = 0;

    const strongPositive = [
      "beat","beats","strong","surge","record","upgrade","buy rating","top pick",
      "price target raised","raises guidance","growth","expansion","partnership",
      "wins","rebound","demand","momentum","profit jump",
    ];

    const moderatePositive = [
      "launch","production","deliveries","delivery","analyst","bullish","margin",
      "forecast","outlook","sec filing","insider buy",
    ];

    const strongNegative = [
      "miss","misses","warning","downgrade","sell rating","price target cut",
      "lawsuit","probe","investigation","recall","delay","cuts guidance","weak",
      "slump","plunge","loss",
    ];

    const moderateNegative = [
      "falls","drop","soft","tariff","concern","pressure","decline","headwinds",
      "insider sale","tax-driven share sale",
    ];

    if (keywordHits(title, strongPositive)) itemScore += 3.2;
    if (keywordHits(title, moderatePositive)) itemScore += 1.4;
    if (keywordHits(title, strongNegative)) itemScore -= 3.2;
    if (keywordHits(title, moderateNegative)) itemScore -= 1.4;

    if (
      keywordHits(title, ["earnings","results","revenue","guidance","quarter"]) &&
      keywordHits(title, ["beat","beats","strong","raises","growth","record"])
    ) {
      itemScore += 2.2;
    }

    if (
      keywordHits(title, ["earnings","results","revenue","guidance","quarter"]) &&
      keywordHits(title, ["miss","warning","cuts","weak","loss"])
    ) {
      itemScore -= 2.2;
    }

    if (
      keywordHits(title, ["insider","cfo","director","executive"]) &&
      keywordHits(title, ["tax-driven","rsu","vesting"])
    ) {
      itemScore += 0.5;
    }

    if (itemScore > 0.75) {
      positiveTitles.push(item.title);
      signalCount += 1;
    } else if (itemScore < -0.75) {
      negativeTitles.push(item.title);
      signalCount += 1;
    }

    weightedSum += itemScore * positionWeight;
    totalWeight += positionWeight;
  }

  if (!totalWeight) {
    return {
      score: 50,
      tone: "yellow",
      label: "Neutral",
      reason: "There is not enough usable headline detail here to push sentiment strongly either way.",
      positives: [],
      negatives: [],
      confidence: "Low",
    };
  }

  const avg = weightedSum / totalWeight;

  let rawScore = 50 + avg * 11;

  if (signalCount >= 3) rawScore += avg > 0 ? 4 : avg < 0 ? -4 : 0;
  if (signalCount >= 4) rawScore += avg > 0 ? 2 : avg < 0 ? -2 : 0;

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let tone: ScoreTone = "yellow";
  let label = "Neutral";

  if (score >= 66) { tone = "green"; label = "Bullish"; }
  else if (score <= 34) { tone = "red"; label = "Bearish"; }
  else if (score >= 58) { tone = "green"; label = "Slightly Bullish"; }
  else if (score <= 42) { tone = "red"; label = "Slightly Bearish"; }

  const confidence: "Low" | "Medium" | "High" =
    signalCount >= 4 ? "High" : signalCount >= 2 ? "Medium" : "Low";

  let reason = "The latest headline mix looks fairly balanced, so the score stays close to neutral rather than showing a strong directional lean.";

  if (label === "Bullish") {
    reason = "Recent coverage is leaning clearly constructive, with the stronger usable headlines skewing toward upgrades, growth, better-than-feared developments, or supportive business momentum.";
  } else if (label === "Slightly Bullish") {
    reason = "Recent coverage is leaning constructive overall, although the positive read is not strong enough yet to count as a fully decisive bullish headline backdrop.";
  } else if (label === "Bearish") {
    reason = "Recent coverage is leaning clearly weaker, with the stronger usable headlines skewing toward downgrades, misses, legal or operational risk, or broader pressure on the story.";
  } else if (label === "Slightly Bearish") {
    reason = "Recent coverage is leaning a bit weaker than supportive, although the negative read is not broad or strong enough yet to count as a fully decisive bearish backdrop.";
  }

  return {
    score,
    tone,
    label,
    reason,
    positives: positiveTitles.slice(0, 3),
    negatives: negativeTitles.slice(0, 3),
    confidence,
  };
}

function scoreEarnings(news: NewsItem[]) {
  const ranked = [...news].sort((a, b) => {
    const scoreDiff = scoreNewsItem(b) - scoreNewsItem(a);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return bTime - aTime;
  });

  const earningsNews = ranked.filter(
    (item) =>
      !isLowValueNewsItem(item) &&
      keywordHits(item.title, ["earnings","results","revenue","guidance","quarter","q1","q2","q3","q4"]),
  );

  if (!earningsNews.length) {
    return {
      score: 50,
      tone: "yellow" as ScoreTone,
      label: "No clear earnings read",
      reason: "There is not enough obvious earnings-specific coverage in the latest higher-value headlines to push this score strongly either way.",
    };
  }

  let raw = 50;

  earningsNews.slice(0, 4).forEach((item, index) => {
    const weight = index === 0 ? 1.3 : index === 1 ? 1.15 : 1;
    const title = item.title.toLowerCase();

    if (keywordHits(title, ["beat","beats","strong","raises","growth","tops","record"])) raw += 9 * weight;
    if (keywordHits(title, ["miss","cuts","warning","weak","drops","loss"])) raw -= 9 * weight;
  });

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let tone: ScoreTone = "yellow";
  let label = "Mixed earnings tone";
  let reason = "Recent earnings-linked headlines are mixed, so the score stays close to the middle.";

  if (score >= 64) {
    tone = "green";
    label = "Positive earnings tone";
    reason = "The earnings-linked headlines look more constructive than negative, which may help support confidence in the next leg of the story.";
  } else if (score <= 36) {
    tone = "red";
    label = "Weak earnings tone";
    reason = "The earnings-linked headlines look more pressured than supportive, which can weigh on sentiment until the business story improves again.";
  }

  return { score, tone, label, reason };
}

function buildLeadSummary(args: {
  symbol: string;
  companyName: string;
  trend: string;
  newsScore: NewsScoreResult;
  earningsScore: { score: number; tone: ScoreTone; label: string; reason: string; };
}) {
  const { symbol, companyName, trend, newsScore, earningsScore } = args;
  const lead = companyName ? `${companyName} (${symbol})` : symbol;
  return `${lead} is currently showing a ${newsScore.label.toLowerCase()} headline tone with a ${trend.toLowerCase()} backdrop. The latest news flow is being framed here as context rather than prediction, so beginners can quickly see whether headlines are helping, hurting, or complicating the chart story. Earnings tone is currently ${earningsScore.label.toLowerCase()}.`;
}

function buildNewsSummary(item: NewsItem, symbol: string, trend: string, newsScore: NewsScoreResult) {
  const source = compactSource(item.source);
  const lower = item.title.toLowerCase();

  if (keywordHits(lower, ["earnings","results","revenue","guidance","quarter"])) {
    return `${source} is highlighting an earnings-related update for ${symbol}. Recent coverage is focusing on whether the latest results or guidance shift expectations for the next phase of the stock story.`;
  }
  if (keywordHits(lower, ["upgrade","downgrade","price target","analyst"])) {
    return `${source} is focusing on analyst sentiment around ${symbol}. That can matter for short-term attention, especially when the chart is already leaning in the same direction.`;
  }
  if (keywordHits(lower, ["delivery","deliveries","production","factory","supply"])) {
    return `${source} is focusing on operating execution around ${symbol}. The latest coverage suggests traders are watching whether real business performance is lining up with the bigger growth narrative.`;
  }
  if (keywordHits(lower, ["lawsuit","probe","investigation","recall"])) {
    return `${source} is highlighting a risk-related development around ${symbol}. Recent headlines suggest the market may need time to judge whether this is temporary noise or a more durable problem.`;
  }
  if (keywordHits(lower, ["ai","chip","product","launch","software"])) {
    return `${source} is discussing product or theme momentum around ${symbol}. That can help explain why investors stay engaged with the stock, especially when the broader setup already looks active.`;
  }
  if (keywordHits(lower, ["market","sector","fed","rates","tariff"])) {
    return `${source} is framing ${symbol} inside a wider market or sector story. That matters because a stock move is not always driven by company-specific news alone.`;
  }
  if (newsScore.tone === "red" && trend === "Bearish trend") {
    return `${source} is drawing attention to a development that fits into an already softer backdrop for ${symbol}.`;
  }
  if (newsScore.tone === "green" && trend === "Bullish trend") {
    return `${source} is highlighting a development that may support an already stronger backdrop for ${symbol}.`;
  }
  return `${source} is drawing attention to a recent development around ${symbol}. Traders will usually care most about whether the stock shows real follow-through after the market has time to digest the headline.`;
}

function isLowValueNewsItem(item: NewsItem) {
  const title = item.title.toLowerCase();
  const source = (item.source ?? "").toLowerCase();

  const lowValuePatterns = [
    "stock price","current price","live price","price chart","quote today","stock quote",
    "company profile","market cap","forecast 2025","forecast 2026","forecast 2030",
    "buy sell hold","prediction","how to buy","review","price prediction","current chart",
  ];

  const lowValueSources = ["financialcontent","capital.com"];

  if (lowValuePatterns.some((pattern) => title.includes(pattern))) return true;

  if (
    lowValueSources.includes(source) &&
    !keywordHits(title, ["earnings","revenue","guidance","analyst","upgrade","downgrade","price target","delivery","deliveries","production","lawsuit","investigation","recall","partnership","launch","insider","sec"])
  ) {
    return true;
  }

  return false;
}

function scoreNewsItem(item: NewsItem) {
  const title = item.title.toLowerCase();
  const source = (item.source ?? "").toLowerCase();
  let score = 0;

  const strongSignals = [
    "earnings","results","revenue","guidance","quarter","analyst","upgrade","downgrade",
    "price target","delivery","deliveries","production","factory","supply","recall",
    "investigation","lawsuit","probe","launch","partnership","acquisition","margin",
    "forecast","insider","sec","tariff","fed","regulation","robotaxi","autonomous",
  ];

  const weakSignals = [
    "stock price","current price","live price","price chart","quote today","stock quote",
    "company profile","market cap","prediction","buy sell hold","how to buy","review",
  ];

  for (const term of strongSignals) { if (title.includes(term)) score += 3; }
  for (const term of weakSignals) { if (title.includes(term)) score -= 4; }

  if (item.description && item.description.trim().length > 80) score += 1;

  if (source.includes("reuters")) score += 3;
  if (source.includes("barron")) score += 2;
  if (source.includes("marketwatch")) score += 2;
  if (source.includes("stock titan")) score += 2;
  if (source.includes("financialcontent")) score -= 2;
  if (source.includes("capital.com")) score -= 2;

  const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : 0;
  if (pubTime) {
    const ageHours = (Date.now() - pubTime) / (1000 * 60 * 60);
    if (ageHours <= 24) score += 3;
    else if (ageHours <= 72) score += 2;
    else if (ageHours <= 168) score += 1;
  }

  return score;
}

function buildTechnicalRead(args: {
  symbol: string;
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  trend: string;
  rsi: number | null;
  priceVs50: number | null;
  priceVs200: number | null;
}) {
  const { symbol, price, ma50, ma200, trend, rsi, priceVs50, priceVs200 } = args;

  const trendText =
    trend === "Bullish trend"
      ? `${symbol} is trading in a stronger trend structure, with price holding above the shorter and longer trend references.`
      : trend === "Bearish trend"
        ? `${symbol} is trading in a weaker trend structure, with price still sitting below key trend references.`
        : `${symbol} is not giving a fully clean trend read right now, which makes the quality of follow-through especially important.`;

  let momentumText = "Momentum is not especially stretched right now, so price behaviour around fresh headlines may matter more than an extreme oscillator reading.";
  if (typeof rsi === "number" && rsi >= 70) momentumText = "Momentum looks hot rather than calm, which can support strength but also raises the chance of chop, pause, or pullback after fast gains.";
  else if (typeof rsi === "number" && rsi <= 30) momentumText = "Momentum looks washed out rather than strong, which can create rebound interest but does not by itself prove a durable reversal.";

  const levelText = `Last price is ${formatMoney(price)}, versus MA50 at ${formatMoney(ma50)} and MA200 at ${formatMoney(ma200)}. Relative to those reference points, ${symbol} is ${formatPercent(priceVs50)} vs MA50 and ${formatPercent(priceVs200)} vs MA200.`;

  return { trendText, momentumText, levelText };
}

// Defensive, render-layer safety net. lib/stock-news-data.ts already sanitizes
// titles/descriptions at the source, but titles/descriptions are rendered as
// plain React text (never dangerouslySetInnerHTML'd) -- so if a stale cached
// entry or an as-yet-unseen upstream format ever slips a literal HTML tag
// through, it would otherwise show up as visible, broken-looking markup
// instead of being caught. Stripping again here costs nothing and guarantees
// the page never renders raw markup regardless of what happens upstream.
function stripAnyHtml(value: string): string {
  if (!value) return value;
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getArticleSnippet(item: NewsItem, symbol: string) {
  const text = stripAnyHtml(item.description ?? "").trim();
  if (text && text.length >= 40) return text.length > 520 ? `${text.slice(0, 520).trim()}…` : text;
  return `${stripAnyHtml(item.title)} is one of the latest ${symbol} headlines from ${compactSource(item.source)}. Use the full article link for the complete source context.`;
}

function structuredNews(news: NewsItem[], summaryByTitle: Record<string, string>) {
  return news.map((item) => ({
    "@type": "NewsArticle",
    headline: item.title,
    datePublished: item.pubDate,
    description: summaryByTitle[item.title] ?? item.description ?? undefined,
    publisher: { "@type": "Organization", name: compactSource(item.source) },
  }));
}

async function fetchQuoteForMeta(symbol: string): Promise<{ price: number | null; date: string | null }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { price: null, date: null };
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { next: { revalidate: 900 }, headers: { accept: "application/json" } });
    if (!res.ok) return { price: null, date: null };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    const price = typeof row?.price === "number" && Number.isFinite(row.price) ? (row.price as number) : null;
    return { price, date: new Date().toISOString().slice(0, 10) };
  } catch {
    return { price: null, date: null };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  const [rawHistory, { price, date }] = await Promise.all([
    getDailyHistory(upper).catch(() => []),
    fetchQuoteForMeta(upper),
  ]);

  const points: Point[] = (rawHistory as Point[]).filter(
    (p) => p.date && Number.isFinite(p.close)
  );

  const seed = computeIndicatorSeed(points, "", price, date);

  const priceStr = seed.lastClose != null ? ` — Price $${seed.lastClose.toFixed(2)}` : "";
  const trendStr = seed.trend ? `, ${seed.trend}` : "";

  const title = `${upper} Stock News${priceStr} | MyStockHarbor`;
  const description = `Latest ${upper} stock news with beginner-friendly summaries${trendStr}. Headline sentiment score, earnings context and chart analysis on MyStockHarbor.`;

  return {
    title,
    description,
    robots: {
      index: true,
      follow: true,
    },
    alternates: { canonical: `https://www.mystockharbor.com/stock/${upper}/news` },
    openGraph: {
      title: `${upper} Stock News & Analysis | MyStockHarbor`,
      description,
      url: `https://www.mystockharbor.com/stock/${upper}/news`,
      siteName: "MyStockHarbor",
      type: "article",
      images: [{ url: "https://www.mystockharbor.com/og-image-v2.png", width: 1200, height: 630, alt: "MyStockHarbor stock news dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock News & Analysis | MyStockHarbor`,
      description,
      images: ["https://www.mystockharbor.com/og-image-v2.png"],
    },
  };
}

// Renders immediately via SSR (no AI, no network round-trip). Per-article
// "Why this matters" now starts collapsed and is handled by the client-side
// <WhyThisMatters> component: it shows the algorithmic fallback text (built
// below with buildWhyItMatters) instantly on expand, then optionally
// upgrades to an AI-generated line if /api/stock-news/why-it-matters returns
// one. This keeps the whole page fast and indexable while still offering an
// AI read on demand.
function DetailedNewsSection({
  symbol, companyName, trend, newsScore, detailedNews, compactNews,
}: {
  symbol: string;
  companyName: string;
  trend: string;
  newsScore: NewsScoreResult;
  detailedNews: NewsItem[];
  compactNews: NewsItem[];
}) {
  return (
    <section style={editorialCardStyle}>
      <div style={sectionEyebrowStyle}>Latest briefing</div>
      <h2 style={sectionTitleStyle}>What's happening with {symbol}</h2>
      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {detailedNews.length ? (
          detailedNews.map((item, index) => (
            <article key={`${item.link}-${index}`} style={{ ...newsLeadCardStyle, borderLeft: index === 0 ? "3px solid rgba(59,130,246,0.75)" : "3px solid rgba(255,255,255,0.08)" }}>
              {item.image ? (
                <div style={newsThumbWrapStyle}>
                  <img src={item.image} alt="" loading="lazy" style={newsThumbImgStyle} />
                </div>
              ) : null}
              <div style={newsMetaRowStyle}>
                <span style={newsSourcePillStyle}>{compactSource(item.source)}</span>
                <span style={newsDateStyle}>{formatDate(item.pubDate)}</span>
              </div>
              <h3 style={newsHeadlineStyle}>{stripAnyHtml(item.title)}</h3>
              <p style={newsSummaryStyle}>{getArticleSnippet(item, symbol)}</p>
              <WhyThisMatters
                symbol={symbol}
                companyName={companyName}
                trend={trend}
                newsScoreLabel={newsScore.label}
                item={{
                  title: item.title,
                  link: item.link,
                  source: item.source,
                  pubDate: item.pubDate,
                  description: item.description,
                }}
                fallbackText={buildWhyItMatters(item, symbol, trend, newsScore)}
              />
              <div style={{ ...sourceFooterStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span>Article excerpt provided by the FMP news feed. AI is used only for the optional "Why this matters" read.</span>
                <a href={item.link} target="_blank" rel="noopener noreferrer" style={readArticleLinkStyle}>Read full article ↗</a>
              </div>
            </article>
          ))
        ) : (
          <div style={newsLeadCardStyle}>
            <h3 style={{ ...newsHeadlineStyle, marginTop: 0 }}>No fresh headline set available</h3>
            <p style={newsSummaryStyle}>This page still works as a stock-news analysis hub, but the current news feed is light.</p>
          </div>
        )}
      </div>
      {compactNews.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={compactFeedLabelStyle}>Older updates drop into a lighter feed</div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {compactNews.map((item, index) => (
              <article key={`${item.link}-compact-${index}`} className="compactNewsRow" style={compactNewsRowStyle}>
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" style={compactThumbStyle} />
                ) : null}
                <div style={{ minWidth: 88, flexShrink: 0 }}>
                  <div style={compactSourceStyle}>{compactSource(item.source)}</div>
                  <div style={compactDateStyle}>{formatDate(item.pubDate)}</div>
                </div>
                <div className="compactNewsHeadline" style={{ minWidth: 0, flex: 1 }}>
                  <div style={compactHeadlineStyle}>{stripAnyHtml(item.title)}</div>
                </div>
                <a href={item.link} target="_blank" rel="noopener noreferrer" style={compactMutedLinkStyle}>Read ↗</a>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function isEarningsHeadline(item: NewsItem) {
  const text = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return keywordHits(text, ["earnings","eps","results","quarter","quarterly","revenue","guidance","profit","loss","margin","q1","q2","q3","q4"]);
}

function getEarningsNewsItems(news: NewsItem[]) {
  return [...news]
    .filter((item) => !isLowValueNewsItem(item) && isEarningsHeadline(item))
    .sort((a, b) => {
      const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5);
}

function EarningsNewsSection({ symbol, earningsNews, latestEarnings }: { symbol: string; earningsNews: NewsItem[]; latestEarnings: LatestEarningsData; }) {
  return (
    <section style={sidebarCardStyle}>
      <div style={sectionEyebrowStyle}>Earnings news</div>
      <h2 style={sectionTitleSmallStyle}>{symbol} earnings headlines</h2>
      <p style={bodyCopyStyle}>This section is separated from the general news feed so investors can quickly connect the latest headlines with the structured earnings report.</p>
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {earningsNews.length ? (
          earningsNews.slice(0, 2).map((item, index) => (
            <a key={`${item.link}-${index}`} href={item.link} target="_blank" rel="noopener noreferrer" style={earningsNewsRowStyle}>
              <div style={earningsNewsNumberStyle}>{index + 1}</div>
              {/* The thumbnail floats at the top-right of this content column so the
                  meta row / heading / description wrap around it, instead of sitting
                  in its own flex slot and forcing everything else into a tall,
                  separate text column below a fixed-height image. */}
              <div style={{ minWidth: 0, overflow: "hidden" }}>
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" style={earningsThumbStyle} />
                ) : null}
                <div style={newsMetaRowStyle}>
                  <span style={newsSourcePillStyle}>{compactSource(item.source)}</span>
                  <span style={newsDateStyle}>{formatDate(item.pubDate)}</span>
                </div>
                <h3 style={earningsNewsHeadlineStyle}>{stripAnyHtml(item.title)}</h3>
                {item.description ? <p style={earningsNewsTextStyle}>{stripAnyHtml(item.description)}</p> : null}
              </div>
            </a>
          ))
        ) : (
          <div style={earningsNoNewsStyle}>
            <strong>No recent earnings-specific headlines found.</strong>
            <span>The latest structured earnings snapshot is still shown using FMP data{latestEarnings.reportDate ? ` from ${formatPlainDate(latestEarnings.reportDate)}` : ""}.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default async function StockNewsPage({ params }: Props) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  const newsData = await getStockNewsBaseData(upper, { maxDetailedItems: 3 });

  const {
    quote, history, companyName, news, trend, lastClose, lastMA50, lastMA200,
    lastRsi, isDataUnavailable, priceVs50, priceVs200,
    recentHigh, recentLow, newsScore, earningsScore, detailedNews, compactNews,
  } = newsData;

  const latestEarnings = await getLatestEarningsData(upper, earningsScore.tone);
  const earningsNewsItems = getEarningsNewsItems(news);

  const leadSummary = buildLeadSummary({ symbol: upper, companyName, trend, newsScore, earningsScore });
  const whatItMeans = buildWhatItMeans({ symbol: upper, trend, newsScore, rsi: lastRsi, priceVs50 });
  const beyondHeadline = buildBeyondHeadline({ symbol: upper, newsScore, trend, recentHigh, recentLow });
  const technicalRead = buildTechnicalRead({ symbol: upper, price: quote?.price ?? lastClose, ma50: lastMA50, ma200: lastMA200, trend, rsi: lastRsi, priceVs50, priceVs200 });

  const summaryByTitle = Object.fromEntries(
    detailedNews.map((item) => [item.title, getArticleSnippet(item, upper)]),
  );

  // Curated, deterministic set of OTHER stock symbols for the "Explore More
  // Stocks" internal-linking module (see lib/curatedSymbols.ts and
  // app/components/RelatedStocks.tsx).
  const relatedSymbols = getRelatedSymbols(upper);

  return (
    <WatermarkVisibilityProvider>
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 22%), #06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "Organization", "@id": "https://www.mystockharbor.com/#organization", name: "MyStockHarbor", url: "https://www.mystockharbor.com", logo: { "@type": "ImageObject", url: "https://www.mystockharbor.com/logo.png" } },
              { "@type": "WebSite", "@id": "https://www.mystockharbor.com/#website", name: "MyStockHarbor", url: "https://www.mystockharbor.com", publisher: { "@id": "https://www.mystockharbor.com/#organization" } },
              { "@type": "WebPage", "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#webpage`, url: `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news`, name: `${upper} Stock News, Summary & Analysis | MyStockHarbor`, description: leadSummary, isPartOf: { "@id": "https://www.mystockharbor.com/#website" }, about: { "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}#financialproduct` }, breadcrumb: { "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#breadcrumb` }, mainEntity: { "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#collection` } },
              { "@type": "CollectionPage", "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#collection`, url: `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news`, name: `${upper} Stock News`, description: `Latest ${upper} stock news with beginner-friendly summaries, news score, earnings tone and technical context.`, isPartOf: { "@id": "https://www.mystockharbor.com/#website" }, about: { "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}#financialproduct` }, hasPart: structuredNews(news, summaryByTitle) },
              { "@type": "BreadcrumbList", "@id": `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news#breadcrumb`, itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" }, { "@type": "ListItem", position: 2, name: `${upper} Stock Analysis`, item: `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}` }, { "@type": "ListItem", position: 3, name: `${upper} Stock News`, item: `https://www.mystockharbor.com/stock/${encodeURIComponent(upper)}/news` }] },
            ],
          }),
        }}
      />

      <div className="newsWrap">
        <section className="newsHeroShell" style={heroShellStyle}>
          <div className="newsHeroTopBar" style={heroTopBarStyle}>
            <div style={newsDeskTagStyle}>NEWS DESK</div>
            <ShareButton
              url={`https://www.mystockharbor.com/stock/${upper}/news`}
              title={`${upper} Stock News & Analysis | MyStockHarbor`}
              text={`${upper} stock news — headline sentiment, earnings context & chart analysis 📊 MyStockHarbor`}
            />
          </div>
          <div className="newsHeroLeft" style={heroLeftStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 0 0" }}>
              <TickerLogo symbol={upper} name={companyName} size={34} radius={8} />
              <h1 className="newsHeroTitle" style={{ ...heroTitleStyle, margin: 0 }}>
                {upper} Stock News, News Score & What It Could Mean
              </h1>
            </div>
            <p className="newsHeroLead" style={heroLeadStyle}>{leadSummary}</p>
            <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(59,130,246,0.25)", background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(8,18,30,0.92))", fontSize: 14, lineHeight: 1.6, color: "#e5e7eb", maxWidth: 620 }}>
              <strong style={{ color: "#93c5fd" }}>HEADLINE TAKE:</strong>{" "}{newsScore.reason}
            </div>
            <StockNewsTickerJump currentSymbol={upper} />
            <div className="newsHeroCtaRow" style={heroCtaRowStyle}>
              <a href={`/api/go/tradingview?symbol=${encodeURIComponent(upper)}`} target="_blank" rel="noopener noreferrer sponsored nofollow" className="newsHeroBtn" style={heroPrimaryCtaStyle}>OPEN ON TRADINGVIEW ↗</a>
              <Link href="/platforms" className="newsHeroBtn" style={heroSecondaryCtaStyle}>TRADE THIS STOCK</Link>
            </div>
            <div className="newsHeroSubCopy" style={heroSubCopyStyle}>Full chart, indicators and drawing tools on TradingView. Move to Platforms when you are ready to act.</div>
          </div>

          <div className="newsHeroRight" style={heroRightStyle}>
            <div style={scorePanelStyle(newsScore.tone)}>
              <NewsScoreWatermark />
              <NewsScoreGauge newsScore={newsScore} />
            </div>
            <div style={miniScoreGridStyle}>
              <div style={miniScoreCardStyle(latestEarnings.tone)}>
                <div style={miniScoreTitleStyle}>Earnings Tone</div>
                <div style={miniScoreNumberStyle}>{earningsToneScore(latestEarnings)}</div>
                <div style={miniScoreLabelStyle}>{latestEarnings.hasStructuredData ? `${latestEarnings.toneLabel} based on actual EPS/revenue` : "Structured data unavailable"}</div>
              </div>
              <div style={miniScoreCardStyle(newsScore.tone)}>
                <div style={miniScoreTitleStyle}>Confidence</div>
                <div style={miniScoreNumberStyle}>{newsScore.confidence}</div>
                <div style={miniScoreLabelStyle}>Headline depth</div>
              </div>
            </div>
            <div style={miniScoreGridStyle}>
              <div style={heroMetricStyle}>
                <div style={heroMetricLabelStyle}>Last Price</div>
                <div style={heroMetricValueStyle}>{isDataUnavailable ? "DATA UNAVAILABLE" : formatMoney(quote?.price ?? lastClose)}</div>
              </div>
              <div style={heroMetricStyle}>
                <div style={heroMetricLabelStyle}>Trend Context</div>
                <div style={heroMetricValueStyle}>{trend}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="newsGrid" style={newsGridStyle}>
          <div className="newsMainColumn" style={{ display: "grid", gap: 18 }}>
            <DetailedNewsSection symbol={upper} companyName={companyName} trend={trend} newsScore={newsScore} detailedNews={detailedNews} compactNews={compactNews} />
            <AiInsightCard
              symbol={upper}
              companyName={companyName}
              trend={trend}
              newsScore={{ score: newsScore.score, tone: newsScore.tone, label: newsScore.label }}
              earningsScore={{ label: earningsScore.label }}
              lastRsi={lastRsi}
              priceVs50={priceVs50}
              priceVs200={priceVs200}
              recentHigh={recentHigh}
              recentLow={recentLow}
              items={detailedNews.map((item) => ({
                title: item.title,
                source: item.source,
                pubDate: item.pubDate,
                description: item.description,
              }))}
              fallbackBeyondHeadline={beyondHeadline}
              fallbackWhatItMeans={whatItMeans}
            />
          </div>

          <aside className="newsSidebar" style={{ display: "grid", gap: 18, position: "sticky", top: 18 }}>
            <section style={sidebarCardStyle}>
              <div style={sectionEyebrowStyle}>Why the score looks like this</div>
              <h2 style={sectionTitleSmallStyle}>News Score Breakdown</h2>
              <p style={bodyCopyStyle}>{newsScore.reason}</p>
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                <div style={signalBoxStyle("green")}>
                  <div style={signalBoxTitleStyle}>Positive drivers</div>
                  {newsScore.positives.length ? newsScore.positives.map((item) => (<div key={item} style={signalBoxItemStyle}>{item}</div>)) : <div style={signalBoxEmptyStyle}>No strong positive driver stood out in the latest higher-value headlines.</div>}
                </div>
                <div style={signalBoxStyle("red")}>
                  <div style={signalBoxTitleStyle}>Negative drivers</div>
                  {newsScore.negatives.length ? newsScore.negatives.map((item) => (<div key={item} style={signalBoxItemStyle}>{item}</div>)) : <div style={signalBoxEmptyStyle}>No strong negative driver stood out in the latest higher-value headlines.</div>}
                </div>
              </div>
            </section>
            <SharedLatestEarningsCard earnings={latestEarnings} symbol={upper} />
            <EarningsNewsSection symbol={upper} earningsNews={earningsNewsItems} latestEarnings={latestEarnings} />
            <section style={sidebarCardStyle}>
              <div style={sectionEyebrowStyle}>Chart context</div>
              <h2 style={sectionTitleSmallStyle}>Technical Picture</h2>
              <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                <p style={bodyCopyStyle}>{technicalRead.trendText}</p>
                <p style={bodyCopyStyle}>{technicalRead.momentumText}</p>
                <p style={bodyCopyStyle}>{technicalRead.levelText}</p>
              </div>
            </section>
          </aside>
        </section>

        <section className="newsBottomStrip" style={bottomStripStyle}>
          <div>
            <div style={bottomStripTitleStyle}>Continue your {upper} research</div>
            <div style={bottomStripTextStyle}>Use the stock analysis page for a fuller technical read, open TradingView for charting, or head to Platforms when you are ready to place a trade.</div>
          </div>
          <div className="newsBottomActions" style={bottomStripActionsStyle}>
            <Link href={`/stock/${encodeURIComponent(upper)}`} style={bottomActionStyle("blue")}>Stock Analysis</Link>
            <a href={`/api/go/tradingview?symbol=${encodeURIComponent(upper)}`} target="_blank" rel="noopener noreferrer sponsored nofollow" style={bottomActionStyle("green")}>OPEN ON TRADINGVIEW ↗</a>
            <Link href="/platforms" style={bottomActionStyle("red")}>TRADE THIS STOCK</Link>
          </div>
        </section>

        <HideWatermarksBar />
      </div>

      <style>{`
        .newsWrap { max-width: 1240px; margin: 0 auto; padding: 24px 40px 42px; }
        .newsGrid { display: grid; grid-template-columns: minmax(0, 1.22fr) minmax(320px, 0.78fr); gap: 22px; margin-top: 22px; align-items: start; }
        .newsHeroShell { display: grid; grid-template-columns: minmax(0, 1.24fr) minmax(280px, 0.76fr); gap: 18px; }
        .newsHeroTitle { margin: 14px 0 0 0; max-width: 760px; word-break: break-word; }
        .newsHeroLead { margin: 14px 0 0 0; max-width: 780px; }
        .newsHeroMetricRow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
        .newsHeroCtaRow { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
        .newsBottomStrip { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: center; }
        @media (max-width: 1180px) { .newsWrap { padding: 22px 24px 38px; } .newsHeroShell { grid-template-columns: 1fr !important; } .newsGrid { grid-template-columns: 1fr !important; } .newsSidebar { position: static !important; top: auto !important; } }
        @media (max-width: 820px) { .newsWrap { padding: 18px 16px 32px; } .newsHeroTitle { font-size: 34px !important; line-height: 1.06 !important; letter-spacing: -0.045em !important; } .newsHeroLead { font-size: 15px !important; line-height: 1.7 !important; } .newsHeroMetricRow { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } .newsHeroCtaRow { flex-direction: column !important; align-items: stretch !important; } .newsHeroBtn { width: 100%; justify-content: center !important; } .newsBottomStrip { flex-direction: column !important; align-items: stretch !important; } .newsBottomActions { width: 100%; } }
        @media (max-width: 560px) { .newsWrap { padding: 14px 12px 26px; } .newsHeroShell { grid-template-columns: 1fr !important; border-radius: 22px !important; padding: 16px !important; } .newsHeroTitle { font-size: 28px !important; line-height: 1.08 !important; letter-spacing: -0.035em !important; } .newsHeroLead { font-size: 14px !important; line-height: 1.65 !important; } .newsHeroMetricRow { grid-template-columns: 1fr !important; } .compactNewsRow .compactNewsHeadline { order: 5; flex: 1 1 100% !important; width: 100% !important; margin-top: 8px !important; } .newsBottomActions { display: grid !important; grid-template-columns: 1fr !important; width: 100%; } .newsBottomActions a { width: 100%; justify-content: center !important; } .newsMainColumn, .newsSidebar { min-width: 0; } .newsSidebar section, .newsMainColumn section, .compactNewsRow, .newsHeroRight > div, .newsHeroMetricRow > div { min-width: 0; } }
      `}</style>

      {/* -- Explore More Stocks -- server-rendered internal-linking
             module, same pattern as app/stock/[symbol]/page.tsx (see
             lib/curatedSymbols.ts + app/components/RelatedStocks.tsx). -- */}
      <RelatedStocks currentSymbol={upper} symbols={relatedSymbols} />
    </main>
    </WatermarkVisibilityProvider>
  );
}

const heroShellStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.24fr) minmax(280px, 0.76fr)", gap: 18, border: "1px solid rgba(255,255,255,0.09)", borderRadius: 28, padding: 22, background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,9,15,0.98))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 54px rgba(0,0,0,0.36)" };
const heroLeftStyle: CSSProperties = { minWidth: 0 };
const heroTopBarStyle: CSSProperties = { gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const heroRightStyle: CSSProperties = { display: "grid", gap: 14, alignContent: "start" };
const newsDeskTagStyle: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.28)", background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.08))", color: "#dbeafe", fontSize: 12, fontWeight: 950, letterSpacing: "0.08em", textTransform: "uppercase" };
const heroTitleStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 44, lineHeight: 1.02, letterSpacing: "-0.055em", maxWidth: 760 };
const heroLeadStyle: CSSProperties = { margin: "14px 0 0 0", maxWidth: 780, fontSize: 16, lineHeight: 1.75, color: "rgba(241,245,249,0.82)" };
const heroMetricRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 18 };
const heroMetricStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 14, background: "rgba(255,255,255,0.03)" };
const heroMetricLabelStyle: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(191,219,254,0.86)" };
const heroMetricValueStyle: CSSProperties = { marginTop: 8, fontSize: 24, lineHeight: 1.08, fontWeight: 950, letterSpacing: "-0.04em", color: "#f8fafc" };
const heroCtaRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 };
const heroPrimaryCtaStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 46, padding: "12px 16px", borderRadius: 14, border: "1px solid rgba(59,130,246,0.34)", background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))", color: "#dbeafe", textDecoration: "none", fontWeight: 900, fontSize: 13, letterSpacing: "0.04em" };
const heroSecondaryCtaStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 46, padding: "12px 16px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.30)", background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))", color: "#dcfce7", textDecoration: "none", fontWeight: 900, fontSize: 13, letterSpacing: "0.04em" };
const heroSubCopyStyle: CSSProperties = { marginTop: 10, fontSize: 13, lineHeight: 1.6, color: "rgba(241,245,249,0.62)" };

function scorePanelStyle(tone: ScoreTone): CSSProperties {
  if (tone === "green") return { position: "relative", border: "1px solid rgba(34,197,94,0.26)", borderRadius: 20, padding: 18, background: "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(7,16,12,0.96))" };
  if (tone === "red") return { position: "relative", border: "1px solid rgba(248,113,113,0.24)", borderRadius: 20, padding: 18, background: "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(18,10,10,0.96))" };
  return { position: "relative", border: "1px solid rgba(250,204,21,0.24)", borderRadius: 20, padding: 18, background: "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(18,16,8,0.96))" };
}

const scorePanelKickerStyle: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.76)" };
function newsGaugeColour(tone: ScoreTone) { if (tone === "green") return "#22c55e"; if (tone === "red") return "#ef4444"; return "#eab308"; }

function NewsScoreGauge({ newsScore }: { newsScore: NewsScoreResult }) {
  const safeScore = Math.max(0, Math.min(100, newsScore.score));
  const colour = newsGaugeColour(newsScore.tone);
  const markerX = 24 + (192 * safeScore) / 100;
  const markerY = 122 - Math.sin((safeScore / 100) * Math.PI) * 96;

  return (
    <div>
      <div style={scorePanelKickerStyle}>NEWS SCORE</div>
      <div style={{ marginTop: 14, position: "relative", minHeight: 178 }}>
        <svg viewBox="0 0 240 145" role="img" aria-label={`News score ${safeScore} out of 100: ${newsScore.label}`} style={{ width: "100%", display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id="newsGaugeWarmGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="48%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          <path d="M 24 122 A 96 96 0 0 1 216 122" fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="22" strokeLinecap="round" pathLength={100} />
          <path d="M 24 122 A 96 96 0 0 1 216 122" fill="none" stroke="url(#newsGaugeWarmGradient)" strokeWidth="22" strokeLinecap="round" strokeDasharray={`${safeScore} 100`} pathLength={100} style={{ filter: `drop-shadow(0 0 10px ${colour}55)` }} />
          <circle cx={markerX} cy={markerY} r="8" fill={colour} stroke="rgba(255,255,255,0.88)" strokeWidth="3" style={{ filter: `drop-shadow(0 0 10px ${colour}88)` }} />
        </svg>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 18, display: "grid", justifyItems: "center", pointerEvents: "none" }}>
          <div style={scoreValueStyle}>{safeScore}/100</div>
          <div style={scoreLabelStyle(newsScore.tone)}>{newsScore.label}</div>
        </div>
      </div>
      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        <div style={{ color: "#fca5a5" }}>Bearish</div>
        <div style={{ color: "#fde68a", textAlign: "center" }}>Neutral</div>
        <div style={{ color: "#86efac", textAlign: "right" }}>Bullish</div>
      </div>
    </div>
  );
}

const scoreValueStyle: CSSProperties = { marginTop: 8, fontSize: 42, lineHeight: 1, fontWeight: 950, letterSpacing: "-0.06em" };
function scoreLabelStyle(tone: ScoreTone): CSSProperties { return { marginTop: 8, display: "inline-flex", alignItems: "center", padding: "7px 11px", borderRadius: 999, fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: tone === "green" ? "#dcfce7" : tone === "red" ? "#fee2e2" : "#fef3c7", background: tone === "green" ? "rgba(34,197,94,0.18)" : tone === "red" ? "rgba(248,113,113,0.16)" : "rgba(250,204,21,0.14)", border: tone === "green" ? "1px solid rgba(34,197,94,0.28)" : tone === "red" ? "1px solid rgba(248,113,113,0.24)" : "1px solid rgba(250,204,21,0.22)" }; }
const scoreReasonStyle: CSSProperties = { margin: "12px 0 0 0", fontSize: 14, lineHeight: 1.7, color: "rgba(241,245,249,0.82)" };
const miniScoreGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 };
function miniScoreCardStyle(tone: ScoreTone): CSSProperties { return { border: tone === "green" ? "1px solid rgba(34,197,94,0.22)" : tone === "red" ? "1px solid rgba(248,113,113,0.20)" : "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 14, background: "rgba(255,255,255,0.03)" }; }
const miniScoreTitleStyle: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(241,245,249,0.66)" };
const miniScoreNumberStyle: CSSProperties = { marginTop: 8, fontSize: 24, lineHeight: 1.05, fontWeight: 950, letterSpacing: "-0.04em" };
const miniScoreLabelStyle: CSSProperties = { marginTop: 6, fontSize: 13, color: "rgba(241,245,249,0.76)" };
const newsGridStyle: CSSProperties = {};
const editorialCardStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, padding: 20, background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" };
const earningsNewsRowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)", borderRadius: 16, padding: 14, color: "#f1f5f9", textDecoration: "none" };
const earningsNewsNumberStyle: CSSProperties = { width: 28, height: 28, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(59,130,246,0.36)", background: "rgba(59,130,246,0.14)", color: "#bfdbfe", fontSize: 13, fontWeight: 950, flexShrink: 0 };
const earningsThumbStyle: CSSProperties = { float: "right", width: 64, height: 64, borderRadius: 10, objectFit: "cover", marginLeft: 12, marginBottom: 6, background: "rgba(255,255,255,0.04)" };
const earningsNewsHeadlineStyle: CSSProperties = { margin: "9px 0 0", fontSize: 16, lineHeight: 1.38, color: "#f8fafc" };
const earningsNewsTextStyle: CSSProperties = { margin: "8px 0 0", fontSize: 13, lineHeight: 1.6, color: "rgba(226,232,240,0.76)" };
const earningsNoNewsStyle: CSSProperties = { border: "1px solid rgba(250,204,21,0.20)", background: "rgba(250,204,21,0.07)", borderRadius: 16, padding: 14, display: "grid", gap: 6, color: "rgba(254,249,195,0.88)", fontSize: 14, lineHeight: 1.55 };
const sidebarCardStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: 18, background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" };
const sectionEyebrowStyle: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)" };
const sectionTitleStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 28, lineHeight: 1.08, letterSpacing: "-0.04em" };
const sectionTitleSmallStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: 22, lineHeight: 1.12, letterSpacing: "-0.03em" };
const bodyCopyStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: 15, lineHeight: 1.72, color: "rgba(241,245,249,0.82)" };
const newsLeadCardStyle: CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 16, background: "rgba(255,255,255,0.028)" };
const newsThumbWrapStyle: CSSProperties = { width: "100%", aspectRatio: "16 / 9", borderRadius: 12, overflow: "hidden", marginBottom: 12, background: "rgba(255,255,255,0.04)" };
const newsThumbImgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
const newsMetaRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const newsSourcePillStyle: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.22)", color: "#dbeafe", fontSize: 12, fontWeight: 800 };
const newsDateStyle: CSSProperties = { fontSize: 12, fontWeight: 700, color: "rgba(241,245,249,0.58)" };
const newsHeadlineStyle: CSSProperties = { margin: "12px 0 0 0", fontSize: 22, lineHeight: 1.32, letterSpacing: "-0.02em", color: "#f8fafc" };
const newsSummaryStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: 15, lineHeight: 1.72, color: "rgba(241,245,249,0.82)" };
const sourceFooterStyle: CSSProperties = { marginTop: 12, fontSize: 12, lineHeight: 1.5, color: "rgba(241,245,249,0.48)" };
const compactFeedLabelStyle: CSSProperties = { fontSize: 12, fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(241,245,249,0.56)" };
const compactNewsRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 12, background: "rgba(255,255,255,0.02)" };
const compactThumbStyle: CSSProperties = { width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "rgba(255,255,255,0.04)" };
const compactSourceStyle: CSSProperties = { fontSize: 12, fontWeight: 800, color: "#dbeafe" };
const compactDateStyle: CSSProperties = { marginTop: 4, fontSize: 11, color: "rgba(241,245,249,0.56)" };
const compactHeadlineStyle: CSSProperties = { fontSize: 14, lineHeight: 1.55, color: "rgba(241,245,249,0.84)" };
const compactMutedStyle: CSSProperties = { fontSize: 11, lineHeight: 1.4, color: "rgba(241,245,249,0.42)", textAlign: "right" };
const compactMutedLinkStyle: CSSProperties = { fontSize: 12, color: "#93c5fd", textAlign: "right", textDecoration: "none", fontWeight: 900, whiteSpace: "nowrap", flexShrink: 0, marginLeft: "auto" };
const readArticleLinkStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px 10px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.30)", background: "rgba(59,130,246,0.10)", color: "#bfdbfe", textDecoration: "none", fontWeight: 900, fontSize: 12, whiteSpace: "nowrap" };
function signalBoxStyle(tone: "green" | "red"): CSSProperties { return { border: tone === "green" ? "1px solid rgba(34,197,94,0.22)" : "1px solid rgba(248,113,113,0.20)", borderRadius: 14, padding: 12, background: tone === "green" ? "rgba(34,197,94,0.06)" : "rgba(248,113,113,0.05)" }; }
const signalBoxTitleStyle: CSSProperties = { fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(241,245,249,0.8)" };
const signalBoxItemStyle: CSSProperties = { marginTop: 8, fontSize: 13, lineHeight: 1.55, color: "rgba(241,245,249,0.78)" };
const signalBoxEmptyStyle: CSSProperties = { marginTop: 8, fontSize: 13, lineHeight: 1.55, color: "rgba(241,245,249,0.58)" };
const bottomStripStyle: CSSProperties = { marginTop: 22, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 22, padding: 18, background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" };
const bottomStripTitleStyle: CSSProperties = { fontSize: 22, lineHeight: 1.1, fontWeight: 900, letterSpacing: "-0.03em" };
const bottomStripTextStyle: CSSProperties = { marginTop: 8, maxWidth: 760, fontSize: 14, lineHeight: 1.65, color: "rgba(241,245,249,0.76)" };
const bottomStripActionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10 };
function bottomActionStyle(tone: "blue" | "green" | "red"): CSSProperties {
  const base: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, padding: "11px 15px", borderRadius: 999, textDecoration: "none", fontSize: 13, fontWeight: 850, lineHeight: 1, whiteSpace: "nowrap" };
  if (tone === "blue") return { ...base, border: "1px solid rgba(59,130,246,0.24)", background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.08))", color: "#dbeafe" };
  if (tone === "green") return { ...base, border: "1px solid rgba(34,197,94,0.22)", background: "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(21,128,61,0.08))", color: "#dcfce7" };
  return { ...base, border: "1px solid rgba(248,113,113,0.22)", background: "linear-gradient(135deg, rgba(248,113,113,0.14), rgba(185,28,28,0.08))", color: "#fee2e2" };
}
