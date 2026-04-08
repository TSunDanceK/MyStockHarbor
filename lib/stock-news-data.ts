import { unstable_cache } from "next/cache";
import {
  getAiNewsBriefs,
  getAiNewsInsight,
  type AiNewsBrief,
  type AiNewsInsight,
} from "@/lib/ai-news-briefs";

export type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

export type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
  description: string | null;
};

type ScoreTone = "green" | "yellow" | "red";

export type NewsScoreResult = {
  score: number;
  tone: ScoreTone;
  label: string;
  reason: string;
  positives: string[];
  negatives: string[];
  confidence: "Low" | "Medium" | "High";
};

export type EarningsScoreResult = {
  score: number;
  label: string;
  tone: ScoreTone;
  reason: string;
};

export type StockNewsBaseData = {
  symbol: string;
  companyName: string;
  quote: Quote | null;
  history: Point[];
  news: NewsItem[];
  trend: string;
  lastClose: number | null;
  lastMA50: number | null;
  lastMA200: number | null;
  lastRsi: number | null;
  priceVs50: number | null;
  priceVs200: number | null;
  recentHigh: number | null;
  recentLow: number | null;
  isInvalidTicker: boolean;
  isDataUnavailable: boolean;
  newsScore: NewsScoreResult;
  earningsScore: EarningsScoreResult;
  rankedNews: NewsItem[];
  detailedNews: NewsItem[];
  compactNews: NewsItem[];
};

export type StockNewsAiData = {
  aiBriefs: AiNewsBrief[];
  aiInsight: AiNewsInsight | null;
  summaryByTitle: Record<string, string>;
};

export type StockNewsData = StockNewsBaseData & StockNewsAiData;

type BuildOptions = {
  maxDetailedItems?: number;
  includeInsight?: boolean;
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanRssDescription(value: string | null) {
  if (!value) return null;

  const cleaned = decodeHtml(
    value
      .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  return cleaned || null;
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split("<item>").slice(1);

  for (const block of blocks) {
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>(.*?)<\/title>/)?.[1] ??
      "";

    const link = block.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? null;
    const source = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ?? null;
    const description =
      block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ??
      block.match(/<description>(.*?)<\/description>/)?.[1] ??
      null;

    if (title && link) {
      items.push({
        title: decodeHtml(title.replace(/\s+-\s+Google News$/i, "").trim()),
        link: link.trim(),
        pubDate,
        source: source ? decodeHtml(source.trim()) : null,
        description: cleanRssDescription(description),
      });
    }
  }

  return items;
}

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
    if (lines.length < 2) return [];

    const points: Point[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const date = String(cols[0] ?? "").replace(/\r/g, "").trim();
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

async function fetchNews(symbol: string, companyName: string): Promise<NewsItem[]> {
  const company = companyName.trim();
  const baseNameQuery = company ? `${company} ${symbol}` : symbol;

  const queries = [
    `${baseNameQuery} stock`,
    baseNameQuery,
    `${symbol} partnership OR deal OR joins OR project`,
    `${company || symbol} Elon OR Musk OR SpaceX OR xAI`,
    `${company || symbol} AI chip project`,
  ];

  try {
    const results = await Promise.all(
      queries.map(async (query) => {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
          query
        )}&hl=en-GB&gl=GB&ceid=GB:en`;

        try {
          const res = await fetch(url, {
            next: { revalidate: 1800 },
          });

          if (!res.ok) return [];

          const xml = await res.text();
          return parseRss(xml).slice(0, 12);
        } catch {
          return [];
        }
      })
    );

    return mergeNewsPools(results).slice(0, 40);
  } catch {
    return [];
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

function mergeNewsPools(pools: NewsItem[][]): NewsItem[] {
  const merged: NewsItem[] = [];
  const seenLinks = new Set<string>();

  for (const pool of pools) {
    for (const item of pool) {
      const key = item.link.trim();
      if (!key || seenLinks.has(key)) continue;
      seenLinks.add(key);
      merged.push(item);
    }
  }

  return merged;
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

function trendLabel(lastClose: number | null, ma50: number | null, ma200: number | null) {
  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Bullish trend";
    if (lastClose < ma50 && ma50 < ma200) return "Bearish trend";
    if (lastClose > ma200 && lastClose < ma50) return "Pullback in larger uptrend";
    if (lastClose < ma200 && lastClose > ma50) return "Counter-trend bounce";
  }

  return "Mixed / range";
}

function keywordHits(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function isLowValueNewsItem(item: NewsItem) {
  const title = item.title.toLowerCase();
  const source = (item.source ?? "").toLowerCase();

  const lowValuePatterns = [
    "stock price",
    "share price",
    "stock quote",
    "stock chart",
    "price today",
    "price prediction",
    "forecast for",
    "technical analysis",
    "live price",
    "market cap",
    "52-week",
    "research report",
    "stock overview",
    "stocks to watch",
    "stock analysis",
  ];

  const lowValueSources = [
    "etfdailynews",
    "investing.com",
    "benzinga",
    "zacks",
    "marketbeat",
    "defense world",
    "ticker report",
    "best stocks",
  ];

  if (keywordHits(title, lowValuePatterns)) return true;
  if (lowValueSources.some((entry) => source.includes(entry))) return true;

  return false;
}

function scoreNewsItem(item: NewsItem) {
  const title = item.title.toLowerCase();
  const source = (item.source ?? "").toLowerCase();
  let score = 0;

  if (
    keywordHits(title, [
      "earnings",
      "guidance",
      "results",
      "revenue",
      "profit",
      "forecast",
      "partnership",
      "deal",
      "agreement",
      "joins",
      "project",
      "contract",
      "funding",
      "investment",
      "acquisition",
      "merger",
      "lawsuit",
      "probe",
      "investigation",
      "recall",
    ])
  ) {
    score += 6;
  }

  if (
    keywordHits(title, [
      "beats",
      "misses",
      "raises",
      "cuts",
      "surge",
      "plunge",
      "slump",
      "record",
      "warning",
      "growth",
      "demand",
    ])
  ) {
    score += 4;
  }

  if (
    keywordHits(title, [
      "elon",
      "musk",
      "tesla",
      "spacex",
      "xai",
      "openai",
      "nvidia",
      "amd",
      "tsmc",
      "amazon",
      "microsoft",
      "google",
      "meta",
      "government",
      "pentagon",
      "white house",
      "chips act",
    ])
  ) {
    score += 6;
  }

  if (
    keywordHits(title, ["partnership", "joins", "deal", "project"]) &&
    keywordHits(title, ["ai", "chip", "factory", "data center"])
  ) {
    score += 5;
  }

  if (["reuters", "bloomberg", "ap"].some((name) => source.includes(name))) {
    score += 8;
  } else if (
    ["cnbc", "marketwatch", "barron's", "wsj", "ft"].some((name) =>
      source.includes(name)
    )
  ) {
    score += 5;
  } else if (["yahoo"].some((name) => source.includes(name))) {
    score += 2;
  }

  if (item.pubDate) {
    const ageHours = Math.max(0, (Date.now() - new Date(item.pubDate).getTime()) / 36e5);

    if (ageHours <= 12) score += 6;
    else if (ageHours <= 24) score += 5;
    else if (ageHours <= 72) score += 3;
    else if (ageHours <= 168) score += 1;
  }

  if (item.description && item.description.length > 80) {
    score += 1;
  }

  if (isLowValueNewsItem(item)) {
    score -= 8;
  }

  return score;
}

function normaliseTitleForDedupe(title: string) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(the|a|an|and|or|for|to|of|in|on|with|from|at|by|stock|shares)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const deduped: NewsItem[] = [];

  for (const item of items) {
    const key = normaliseTitleForDedupe(item.title)
      .split(" ")
      .slice(0, 8)
      .join(" ");

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function rankNews(news: NewsItem[]) {
  return dedupeNews(
    [...news].sort((a, b) => {
      const scoreDiff = scoreNewsItem(b) - scoreNewsItem(a);
      if (scoreDiff !== 0) return scoreDiff;

      const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return bTime - aTime;
    })
  );
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

  const ranked = rankNews(news);
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

    const positionWeight = i === 0 ? 1.35 : i === 1 ? 1.18 : i === 2 ? 1.02 : 0.9;
    let itemScore = 0;

    const strongPositive = [
      "beat",
      "beats",
      "strong",
      "surge",
      "record",
      "upgrade",
      "buy rating",
      "top pick",
      "price target raised",
      "raises guidance",
      "growth",
      "expansion",
      "partnership",
      "wins",
      "rebound",
      "demand",
      "momentum",
      "profit jump",
    ];

    const moderatePositive = [
      "launch",
      "production",
      "deliveries",
      "delivery",
      "analyst",
      "bullish",
      "margin",
      "forecast",
      "outlook",
      "sec filing",
      "insider buy",
    ];

    const strongNegative = [
      "miss",
      "misses",
      "warning",
      "downgrade",
      "sell rating",
      "price target cut",
      "lawsuit",
      "probe",
      "investigation",
      "recall",
      "delay",
      "cuts guidance",
      "weak",
      "slump",
      "plunge",
      "loss",
    ];

    const moderateNegative = [
      "falls",
      "drop",
      "soft",
      "tariff",
      "concern",
      "pressure",
      "decline",
      "headwinds",
      "insider sale",
      "tax-driven share sale",
    ];

    if (keywordHits(title, strongPositive)) itemScore += 3.2;
    if (keywordHits(title, moderatePositive)) itemScore += 1.4;

    if (keywordHits(title, strongNegative)) itemScore -= 3.2;
    if (keywordHits(title, moderateNegative)) itemScore -= 1.4;

    if (
      keywordHits(title, ["earnings", "results", "revenue", "guidance", "quarter"]) &&
      keywordHits(title, ["beat", "beats", "strong", "raises", "growth", "record"])
    ) {
      itemScore += 2.2;
    }

    if (
      keywordHits(title, ["earnings", "results", "revenue", "guidance", "quarter"]) &&
      keywordHits(title, ["miss", "warning", "cuts", "weak", "loss"])
    ) {
      itemScore -= 2.2;
    }

    if (
      keywordHits(title, ["insider", "cfo", "director", "executive"]) &&
      keywordHits(title, ["tax-driven", "rsu", "vesting"])
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
      reason:
        "There is not enough usable headline detail here to push sentiment strongly either way.",
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

  if (score >= 66) {
    tone = "green";
    label = "Bullish";
  } else if (score <= 34) {
    tone = "red";
    label = "Bearish";
  } else if (score >= 58) {
    tone = "green";
    label = "Slightly Bullish";
  } else if (score <= 42) {
    tone = "red";
    label = "Slightly Bearish";
  }

  const confidence: "Low" | "Medium" | "High" =
    signalCount >= 4 ? "High" : signalCount >= 2 ? "Medium" : "Low";

  let reason =
    "The current headline mix looks balanced, so the overall news tone reads neutral right now.";

  if (label === "Bullish") {
    reason =
      "Higher-value headlines lean meaningfully positive, with stronger signals around growth, upgrades, guidance, or demand.";
  } else if (label === "Slightly Bullish") {
    reason =
      "There is a mild positive lean in the higher-value headlines, though the setup is not strong enough to call decisively bullish.";
  } else if (label === "Bearish") {
    reason =
      "Higher-value headlines lean clearly negative, with stronger signals around downgrades, warnings, weak results, or other pressure points.";
  } else if (label === "Slightly Bearish") {
    reason =
      "There is a mild negative lean in the higher-value headlines, though the setup is not strong enough to call decisively bearish.";
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

function scoreEarnings(news: NewsItem[]): EarningsScoreResult {
  const earningsItems = news.filter((item) =>
    keywordHits(item.title.toLowerCase(), [
      "earnings",
      "results",
      "revenue",
      "guidance",
      "quarter",
      "profit",
      "eps",
    ])
  );

  if (!earningsItems.length) {
    return {
      score: 50,
      label: "Neutral earnings tone",
      tone: "yellow",
      reason: "There is no strong earnings-related signal in the current headline mix.",
    };
  }

  let signal = 0;

  for (const item of earningsItems.slice(0, 4)) {
    const title = item.title.toLowerCase();

    if (keywordHits(title, ["beat", "beats", "strong", "record", "raises", "growth"])) {
      signal += 2;
    }

    if (keywordHits(title, ["miss", "misses", "weak", "cuts", "warning", "loss"])) {
      signal -= 2;
    }
  }

  const score = Math.max(0, Math.min(100, 50 + signal * 7));

  let label = "Mixed earnings tone";
  let tone: ScoreTone = "yellow";
  let reason =
    "Recent earnings-linked headlines are mixed, so the score stays close to the middle.";

  if (score >= 64) {
    label = "Positive earnings tone";
    tone = "green";
    reason =
      "The earnings-linked headlines look more constructive than negative, which may help support confidence in the next leg of the story.";
  } else if (score <= 36) {
    label = "Weak earnings tone";
    tone = "red";
    reason =
      "The earnings-linked headlines look more pressured than supportive, which can weigh on sentiment until the business story improves again.";
  }

  return {
    score,
    label,
    tone,
    reason,
  };
}

async function buildStockNewsBaseData(
  symbol: string,
  options: BuildOptions
): Promise<StockNewsBaseData> {
  const upper = symbol.trim().toUpperCase();
  const maxDetailedItems = Math.max(1, Math.min(options.maxDetailedItems ?? 3, 3));

  const [quote, history, companyName] = await Promise.all([
    fetchQuote(upper),
    fetchHistory(upper),
    fetchCompanyName(upper),
  ]);

  const news = await fetchNews(upper, companyName);

  const closes = history.map((point) => point.close);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const rsi = rsiWilder(closes, 14);

  const lastClose = history.length ? history[history.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);
  const lastRsi = lastNum(rsi);

  const trend = trendLabel(lastClose, lastMA50, lastMA200);
  const hasNoQuote = !quote || quote.price == null;
  const hasNoHistory = !history || history.length === 0;

  const isInvalidTicker = false;
  const isDataUnavailable = hasNoQuote && hasNoHistory;
  const priceVs50 = pctFromBase(lastClose, lastMA50);
  const priceVs200 = pctFromBase(lastClose, lastMA200);

  const trailing = history.slice(-20);
  const recentHigh = trailing.length
    ? Math.max(...trailing.map((point) => point.high ?? point.close))
    : null;
  const recentLow = trailing.length
    ? Math.min(...trailing.map((point) => point.low ?? point.close))
    : null;

  const newsScore = scoreNews(news);
  const earningsScore = scoreEarnings(news);

  const rankedNews = rankNews(news);

  const highValueNews = rankedNews.filter((item) => !isLowValueNewsItem(item));
  const fallbackNews = rankedNews.filter((item) => isLowValueNewsItem(item));

  const detailedNews = [...highValueNews, ...fallbackNews].slice(0, maxDetailedItems);

  const compactNews = rankedNews
    .filter((item) => !detailedNews.some((picked) => picked.link === item.link))
    .slice(0, 6);

  return {
    symbol: upper,
    companyName,
    quote,
    history,
    news,
    trend,
    lastClose,
    lastMA50,
    lastMA200,
    lastRsi,
    priceVs50,
    priceVs200,
    recentHigh,
    recentLow,
    isInvalidTicker,
    isDataUnavailable,
    newsScore,
    earningsScore,
    rankedNews,
    detailedNews,
    compactNews,
  };
}

export async function getStockNewsAiData(
  baseData: StockNewsBaseData,
  options: BuildOptions = {}
): Promise<StockNewsAiData> {
  const includeInsight = options.includeInsight ?? true;

  const {
    symbol,
    companyName,
    trend,
    newsScore,
    earningsScore,
    lastRsi,
    priceVs50,
    priceVs200,
    recentHigh,
    recentLow,
    detailedNews,
    isInvalidTicker,
  } = baseData;

  const aiBriefs = isInvalidTicker
    ? []
    : await getAiNewsBriefs({
        symbol,
        companyName,
        trend,
        newsScoreLabel: newsScore.label,
        items: detailedNews.map((item) => ({
          title: item.title,
          source: item.source,
          pubDate: item.pubDate,
          description: item.description,
        })),
      });

  const summaryByTitle = Object.fromEntries(
    detailedNews.map((item, index) => [
      item.title,
      aiBriefs[index]?.summary ?? item.description ?? "",
    ])
  );

  const aiInsight =
    isInvalidTicker || !includeInsight
      ? null
      : await getAiNewsInsight({
          symbol,
          companyName,
          trend,
          newsScoreLabel: newsScore.label,
          newsScoreValue: newsScore.score,
          earningsTone: earningsScore.label,
          rsi: lastRsi,
          priceVs50,
          priceVs200,
          recentHigh,
          recentLow,
          items: detailedNews.map((item, index) => ({
            title: item.title,
            source: item.source,
            pubDate: item.pubDate,
            description: item.description,
            summary: aiBriefs[index]?.summary ?? null,
            whyItMatters: aiBriefs[index]?.whyItMatters ?? null,
          })),
        });

  return {
    aiBriefs,
    aiInsight,
    summaryByTitle,
  };
}

const getCachedStockNewsBaseData = unstable_cache(
  async (key: string) => {
    const parsed = JSON.parse(key) as {
      symbol: string;
      options: BuildOptions;
    };

    return buildStockNewsBaseData(parsed.symbol, parsed.options);
  },
  ["msh-stock-news-base-data-v2"],
  {
    revalidate: 1800,
  }
);

export async function getStockNewsBaseData(
  symbol: string,
  options: BuildOptions = {}
): Promise<StockNewsBaseData> {
  const safeSymbol = symbol.trim().toUpperCase();

  return getCachedStockNewsBaseData(
    JSON.stringify({
      symbol: safeSymbol,
      options: {
        maxDetailedItems: options.maxDetailedItems ?? 3,
      },
    })
  );
}

export async function getStockNewsData(
  symbol: string,
  options: BuildOptions = {}
): Promise<StockNewsData> {
  const baseData = await getStockNewsBaseData(symbol, options);
  const aiData = await getStockNewsAiData(baseData, options);

  return {
    ...baseData,
    ...aiData,
  };
}
