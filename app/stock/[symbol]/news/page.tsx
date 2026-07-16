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
import PageShareBar from "@/app/components/PageShareBar";
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

export const runtime = "nodejs";

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