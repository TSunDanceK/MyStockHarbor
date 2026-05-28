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

type FmpStockNewsItem = {
  symbol?: string;
  publishedDate?: string;
  publisher?: string;
  title?: string;
  image?: string;
  site?: string;
  text?: string;
  url?: string;
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
      next: { revalidate: 60 },
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

async function fetchFmpStockNews(symbol: string): Promise<NewsItem[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  const encoded = encodeURIComponent(symbol.toUpperCase());
  const key = encodeURIComponent(apiKey);

  const endpoints = [
    `https://financialmodelingprep.com/stable/news/stock?symbols=${encoded}&limit=50&apikey=${key}`,
    `https://financialmodelingprep.com/api/v3/stock_news?tickers=${encoded}&limit=50&apikey=${key}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        next: { revalidate: 900 },
      });

      if (!res.ok) continue;

      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) continue;

      const items = data
        .map((item: FmpStockNewsItem): NewsItem | null => {
          const title = typeof item.title === "string" ? item.title.trim() : "";
          const link = typeof item.url === "string" ? item.url.trim() : "";

          if (!title || !link) return null;

          return {
            title: decodeHtml(title),
            link,
            pubDate:
              typeof item.publishedDate === "string" ? item.publishedDate : null,
            source:
              typeof item.site === "string" && item.site.trim()
                ? item.site.trim()
                : typeof item.publisher === "string" && item.publisher.trim()
                  ? item.publisher.trim()
                  : "FMP News",
            description:
              typeof item.text === "string" && item.text.trim()
                ? cleanRssDescription(item.text.slice(0, 650))
                : null,
          };
        })
        .filter((item): item is NewsItem => Boolean(item));

      if (items.length) return items;
    } catch {
      continue;
    }
  }

  return [];
}

function isVideoOrLowQualitySource(item: NewsItem) {
  const combined = `${item.source ?? ""} ${item.link} ${item.title}`.toLowerCase();

  return [
    "youtube.com",
    "youtu.be",
    "m.youtube.com",
    "youtube",
    "podcast",
    "livestream",
    "live stream",
    "watch video",
  ].some((term) => combined.includes(term));
}

async function fetchGoogleNews(symbol: string, companyName: string): Promise<NewsItem[]> {
  const cleanCompany = getCleanCompanyName(companyName);
  const query = cleanCompany
    ? `${cleanCompany} ${symbol.toUpperCase()} stock`
    : `${symbol.toUpperCase()} stock`;

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query,
  )}&hl=en-GB&gl=GB&ceid=GB:en`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 900 },
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; MyStockHarborBot/1.0; +https://www.mystockharbor.com)",
      },
    });

    if (!res.ok) return [];

    const xml = await res.text();
    return parseRss(xml).filter((item) => !isVideoOrLowQualitySource(item));
  } catch {
    return [];
  }
}

async function fetchNews(symbol: string, companyName: string): Promise<NewsItem[]> {
  const [fmpNews, googleNews] = await Promise.all([
    fetchFmpStockNews(symbol),
    fetchGoogleNews(symbol, companyName),
  ]);

  return mergeNewsPools([
    fmpNews.filter((item) => !isVideoOrLowQualitySource(item)),
    googleNews,
  ]).slice(0, 50);
}

function isEarningsNewsItem(item: NewsItem) {
  const text = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return keywordHits(text, [
    "earnings",
    "eps",
    "results",
    "quarter",
    "quarterly",
    "revenue",
    "guidance",
    "profit",
    "loss",
    "margin",
    "q1",
    "q2",
    "q3",
    "q4",
  ]);
}

async function fetchEarningsNews(symbol: string, companyName: string): Promise<NewsItem[]> {
  const [fmpNews, googleNews] = await Promise.all([
    fetchFmpStockNews(symbol),
    fetchGoogleNews(symbol, companyName),
  ]);

  return mergeNewsPools([
    fmpNews
      .filter((item) => !isVideoOrLowQualitySource(item))
      .filter(isEarningsNewsItem),
    googleNews.filter(isEarningsNewsItem),
  ]).slice(0, 30);
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

function getCleanCompanyName(companyName: string) {
  return companyName
    .toLowerCase()
    .replace(/\b(inc|inc\.|corporation|corp|corp\.|company|co|co\.|ltd|plc|class a|class b|common stock|ordinary shares|american depositary shares|ads|adr)\b/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isClearlyAboutRequestedCompany(item: NewsItem, symbol: string, companyName: string) {
  const rawText = `${item.title} ${item.description ?? ""} ${item.source ?? ""}`.toLowerCase();
  const text = rawText.replace(/[^\w\s:$.-]/g, " ").replace(/\s+/g, " ");

  const ticker = symbol.toLowerCase();
  const cleanedCompany = getCleanCompanyName(companyName);
  const companyWords = cleanedCompany.split(" ").filter((word) => word.length >= 4);

  const explicitTickerSignals = [
    `${ticker} stock`,
    `${ticker} shares`,
    `${ticker} earnings`,
    `${ticker} revenue`,
    `${ticker} investor`,
    `${ticker} price target`,
    `${ticker} class`,
    `nyse ${ticker}`,
    `nasdaq ${ticker}`,
    `ticker ${ticker}`,
    `$${ticker}`,
    `(${ticker})`,
  ];

  if (explicitTickerSignals.some((term) => text.includes(term))) {
    return true;
  }

  if (cleanedCompany && cleanedCompany.length >= 5 && text.includes(cleanedCompany)) {
    return true;
  }

  if (companyWords.length >= 2 && companyWords.every((word) => text.includes(word))) {
    return true;
  }

  const primaryCompanyWord = companyWords[0];
  if (primaryCompanyWord && primaryCompanyWord.length >= 5 && text.includes(primaryCompanyWord)) {
    return true;
  }

  return false;
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
    .replace(/&amp;/g, " and ")
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(the|a|an|and|or|for|to|of|in|on|with|from|at|by|stock|stocks|share|shares|company|inc|corp|ltd|plc|says|said|report|reports)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function storySignature(item: NewsItem) {
  const text = normaliseTitleForDedupe(`${item.title} ${item.description ?? ""}`);

  const themeWords = text
    .split(" ")
    .filter((word) => word.length > 2)
    .filter((word) =>
      [
        "amazon",
        "meta",
        "chip",
        "chips",
        "ai",
        "deal",
        "partnership",
        "anthropic",
        "aws",
        "graviton",
        "tesla",
        "elon",
        "musk",
        "spacex",
        "xai",
        "earnings",
        "revenue",
        "guidance",
        "profit",
        "lawsuit",
        "probe",
        "investigation",
        "upgrade",
        "downgrade",
        "analyst",
        "price",
        "target",
      ].includes(word)
    );

  if (themeWords.length >= 2) {
    return [...new Set(themeWords)].slice(0, 5).sort().join("-");
  }

  return text.split(" ").slice(0, 7).join(" ");
}

function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seenLinks = new Set<string>();
  const seenStories = new Set<string>();
  const deduped: NewsItem[] = [];

  for (const item of items) {
    const linkKey = item.link.trim();
    const storyKey = storySignature(item);

    if (!linkKey || seenLinks.has(linkKey)) {
      continue;
    }

    if (!storyKey || seenStories.has(storyKey)) {
      continue;
    }

    seenLinks.add(linkKey);
    seenStories.add(storyKey);
    deduped.push(item);
  }

  return deduped;
}

function rankNews(news: NewsItem[], symbol = "", companyName = "") {
  const relevantNews =
    symbol && companyName
      ? news.filter((item) => isClearlyAboutRequestedCompany(item, symbol, companyName))
      : news;

  return dedupeNews(
    [...relevantNews].sort((a, b) => {
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


function extractOpenAiResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const record = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  if (Array.isArray(record.output)) {
    const text = record.output
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .find((part) => part?.type === "output_text" && typeof part.text === "string")?.text;

    return typeof text === "string" ? text.trim() : "";
  }

  return "";
}

function scoreToTone(score: number): ScoreTone {
  if (score >= 58) return "green";
  if (score <= 42) return "red";
  return "yellow";
}

function scoreToNewsLabel(score: number) {
  if (score >= 66) return "Bullish";
  if (score >= 58) return "Slightly Bullish";
  if (score <= 34) return "Bearish";
  if (score <= 42) return "Slightly Bearish";
  return "Neutral";
}

function scoreToEarningsLabel(score: number) {
  if (score >= 64) return "Positive earnings tone";
  if (score <= 36) return "Weak earnings tone";
  return "Mixed earnings tone";
}

function clampScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 3);
}


function getAiScoreGuardrails(items: NewsItem[]) {
  const relevant = items.filter((item) => !isLowValueNewsItem(item)).slice(0, 8);

  let strongBullishCatalysts = 0;
  let weakBullishOnlyCatalysts = 0;
  let bearishCatalysts = 0;
  let actualEarningsResultCatalysts = 0;

  for (const item of relevant) {
    const text = headlineText(item);

    const speculative = containsAny(text, [
      "speculation",
      "speculative",
      "rumor",
      "rumour",
      "may ",
      "could ",
      "might ",
      "potential",
      "possible",
    ]);

    const analystOnly = containsAny(text, [
      "analyst",
      "price target",
      "upside",
      "projected upside",
      "rating",
    ]);

    const strongBullish =
      containsAny(text, [
        "earnings beat",
        "beats estimates",
        "beat estimates",
        "tops estimates",
        "above estimates",
        "better than expected",
        "better-than-expected",
        "raises guidance",
        "guidance above",
        "outlook above",
        "forecast above",
        "revenue above",
        "eps above",
        "shares jump",
        "shares surge",
        "stock jumps",
        "stock surges",
        "rallies after",
        "major deal",
        "customer win",
        "strategic win",
        "contract win",
        "supply deal",
        "chip deal",
        "ai chip deal",
        "terafab",
        "launch of",
        "launches",
        "joining the project",
        "joins the project",
        "joins terafab",
        "applied materials joining",
        "intel joining",
        "confirmed partner",
        "major partner",
      ]) ||
      (containsAny(text, ["partnership", "joins", "joining", "deal", "project", "launch", "collaboration", "terafab"]) &&
        containsAny(text, ["ai", "chip", "semiconductor", "data center", "major", "tesla", "nvidia", "amazon", "microsoft", "meta", "google", "intel", "applied materials"]) &&
        !speculative);

    const weakBullish = analystOnly || speculative;

    const bearish = containsAny(text, [
      "insider sale",
      "insider resale",
      "stock sale",
      "share sale",
      "sells shares",
      "sold shares",
      "10b5-1",
      "rsu sale",
      "restricted stock",
      "coo executes",
      "weak demand",
      "softening demand",
      "demand pressure",
      "competition",
      "competitive pressure",
      "misses estimates",
      "missed estimates",
      "below estimates",
      "cuts guidance",
      "guidance cut",
      "weak guidance",
      "warning",
      "downgrade",
      "liquidity",
      "bankruptcy",
      "going concern",
      "investigation",
      "probe",
      "lawsuit",
      "recall",
    ]);

    const actualEarningsResult = isActualEarningsResultNews(item);

    if (strongBullish) strongBullishCatalysts += 1;
    else if (weakBullish) weakBullishOnlyCatalysts += 1;

    if (bearish) bearishCatalysts += 1;
    if (actualEarningsResult) actualEarningsResultCatalysts += 1;
  }

  let newsCap: number | null = null;
  let earningsCap: number | null = null;

  if (strongBullishCatalysts === 0 && bearishCatalysts >= 2) {
    newsCap = 42;
  } else if (strongBullishCatalysts === 0 && bearishCatalysts >= 1) {
    newsCap = 48;
  } else if (strongBullishCatalysts === 0 && weakBullishOnlyCatalysts >= 1) {
    newsCap = 56;
  }

  if (actualEarningsResultCatalysts === 0) {
    earningsCap = 55;
  }

  return {
    newsCap,
    earningsCap,
    strongBullishCatalysts,
    weakBullishOnlyCatalysts,
    bearishCatalysts,
    actualEarningsResultCatalysts,
  };
}

function getEarningsQualityGuardrails(items: NewsItem[]) {
  const cleaned = items.filter((item) => !isLowValueNewsItem(item));
  const actualResults = cleaned
    .filter((item) => isActualEarningsResultNews(item))
    .slice(0, 8);
  const routineAnnouncements = cleaned.filter((item) => isRoutineEarningsAnnouncement(item));

  let positiveActualResults = 0;
  let strongPositiveActualResults = 0;
  let negativeActualResults = 0;
  let severeNegativeActualResults = 0;

  for (const item of actualResults) {
    const text = headlineText(item);

    const positive = containsFreshPositiveEarningsResult(text);
    const strongPositive =
      containsAny(text, [
        "beat and raise",
        "beat and raised",
        "beats and raises",
        "beat estimates and raised guidance",
        "beats estimates and raises guidance",
        "revenue beat",
        "eps beat",
        "guidance above",
        "outlook above",
        "raises guidance",
        "raised guidance",
      ]) ||
      containsAll(text, [
        ["beat", "beats", "above estimates", "better than expected", "better-than-expected"],
        ["raises guidance", "raised guidance", "guidance above", "outlook above"],
      ]);

    const negative = containsNegativeEarningsResult(text);
    const severeNegative = containsSevereNegativeEarningsResult(text);

    if (positive) positiveActualResults += 1;
    if (strongPositive) strongPositiveActualResults += 1;
    if (negative) negativeActualResults += 1;
    if (severeNegative) severeNegativeActualResults += 1;
  }

  const newestActualTime = actualResults.reduce(
    (latest, item) => Math.max(latest, newsItemTime(item)),
    0
  );
  const newestRoutineTime = routineAnnouncements.reduce(
    (latest, item) => Math.max(latest, newsItemTime(item)),
    0
  );
  const newestActualAgeDays = ageInDays(newestActualTime);
  const newerRoutineAnnouncementExists =
    newestRoutineTime > 0 && (!newestActualTime || newestRoutineTime > newestActualTime);

  // If the latest earnings-related item is only an upcoming earnings date/call,
  // the previous earnings result should not keep driving a bullish/weak earnings tone.
  // In that case, treat earnings as stale/no clear current read.
  const staleActualResults =
    !actualResults.length ||
    (typeof newestActualAgeDays === "number" && newestActualAgeDays > 75) ||
    newerRoutineAnnouncementExists;

  let earningsCap: number | null = null;
  let earningsFloor: number | null = null;

  if (!actualResults.length) {
    earningsCap = 55;
  } else if (staleActualResults) {
    earningsCap = 55;
  } else if (severeNegativeActualResults >= 2) {
    earningsCap = 45;
  } else if (severeNegativeActualResults >= 1 && positiveActualResults >= 1) {
    earningsCap = 55;
  } else if (negativeActualResults >= 2 && positiveActualResults <= 1) {
    earningsCap = 50;
  } else if (negativeActualResults >= 1 && positiveActualResults === 0) {
    earningsCap = 42;
  }

  if (!staleActualResults && negativeActualResults === 0 && severeNegativeActualResults === 0) {
    if (strongPositiveActualResults >= 1 || positiveActualResults >= 2) {
      earningsFloor = 72;
    } else if (positiveActualResults >= 1) {
      earningsFloor = 64;
    }
  }

  return {
    earningsCap,
    earningsFloor,
    actualEarningsResultCatalysts: staleActualResults ? 0 : actualResults.length,
    rawActualEarningsResultCatalysts: actualResults.length,
    positiveActualResults,
    strongPositiveActualResults,
    negativeActualResults,
    severeNegativeActualResults,
    staleActualResults,
    newerRoutineAnnouncementExists,
    newestActualAgeDays,
  };
}

function applyScoreCap(score: number, cap: number | null) {
  if (typeof cap !== "number") return score;
  return Math.min(score, cap);
}

function headlineText(item: NewsItem) {
  return `${item.title} ${item.description ?? ""}`.toLowerCase();
}

function newsItemTime(item: NewsItem) {
  if (!item.pubDate) return 0;
  const time = new Date(item.pubDate).getTime();
  return Number.isFinite(time) ? time : 0;
}

function ageInDays(time: number) {
  if (!time) return null;
  return (Date.now() - time) / (1000 * 60 * 60 * 24);
}

function containsAll(text: string, groups: string[][]) {
  return groups.every((group) => containsAny(text, group));
}

function containsFreshPositiveEarningsResult(text: string) {
  return containsAny(text, [
    "beat",
    "beats",
    "tops estimates",
    "top estimates",
    "above estimates",
    "better than expected",
    "better-than-expected",
    "revenue beat",
    "eps beat",
    "raises guidance",
    "raised guidance",
    "guidance above",
    "outlook above",
    "forecast above",
    "strong earnings",
    "solid earnings",
    "positive earnings",
    "profit jumps",
    "loss narrowed",
  ]);
}

function containsNegativeEarningsResult(text: string) {
  return containsAny(text, [
    "miss",
    "misses",
    "missed estimates",
    "below estimates",
    "below guidance",
    "cuts guidance",
    "cut guidance",
    "guidance cut",
    "guidance below",
    "weak guidance",
    "warning",
    "disappointing guidance",
    "revenue fell",
    "revenue declined",
    "revenue decline",
    "declining revenue",
    "sales fell",
    "sales declined",
    "net loss",
    "big loss",
    "wider loss",
    "loss widened",
    "losses remain",
    "subscriber decline",
    "subscribers declined",
    "users declined",
    "demand pressure",
    "weak demand",
    "softening demand",
    "competition pressure",
    "margin pressure",
  ]);
}

function containsSevereNegativeEarningsResult(text: string) {
  return containsAny(text, [
    "revenue fell",
    "revenue declined",
    "revenue decline",
    "declining revenue",
    "net loss",
    "big loss",
    "wider loss",
    "loss widened",
    "below guidance",
    "cuts guidance",
    "weak guidance",
    "subscriber decline",
    "subscribers declined",
    "weak demand",
    "softening demand",
  ]);
}

function containsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function isRoutineEarningsAnnouncement(item: NewsItem) {
  const text = headlineText(item);

  return containsAny(text, [
    "announces date",
    "conference call",
    "earnings call",
    "webcast",
    "release date",
    "to report",
    "will report",
    "scheduled",
    "upcoming earnings",
  ]);
}

function isAnalystOrPreviewEarningsItem(item: NewsItem) {
  const text = headlineText(item);

  return containsAny(text, [
    "analyst",
    "price target",
    "upside",
    "projection",
    "preview",
    "estimate",
    "estimates for",
    "expectations for",
    "what to expect",
    "before earnings",
    "ahead of earnings",
  ]);
}

function isActualEarningsResultNews(item: NewsItem) {
  const text = headlineText(item);

  if (isRoutineEarningsAnnouncement(item)) return false;

  const hasEarningsContext = containsAny(text, [
    "earnings",
    "financial results",
    "quarterly results",
    "results",
    "revenue",
    "eps",
    "profit",
    "loss",
    "net loss",
    "guidance",
    "outlook",
    "adjusted ebitda",
    "margin",
    "fiscal",
    "q1",
    "q2",
    "q3",
    "q4",
  ]);

  const hasActualResultSignal = containsAny(text, [
    "reports",
    "reported",
    "announces financial results",
    "announced financial results",
    "posts",
    "posted",
    "beat",
    "beats",
    "miss",
    "misses",
    "tops estimates",
    "above estimates",
    "below estimates",
    "better than expected",
    "better-than-expected",
    "raises guidance",
    "raised guidance",
    "cuts guidance",
    "guidance above",
    "guidance below",
    "revenue fell",
    "revenue declined",
    "revenue rose",
    "revenue growth",
    "loss narrowed",
    "net loss",
    "profit jumps",
    "adjusted ebitda",
    "full-year outlook",
  ]);

  if (!hasEarningsContext || !hasActualResultSignal) return false;

  const isOnlyMarketReaction =
    containsAny(text, ["shares jump", "shares surge", "stock jumps", "stock surges", "rallies after"]) &&
    !containsAny(text, [
      "reported",
      "reports",
      "financial results",
      "revenue",
      "eps",
      "guidance",
      "beat",
      "beats",
      "miss",
      "misses",
      "net loss",
      "profit",
      "margin",
      "adjusted ebitda",
    ]);

  if (isOnlyMarketReaction) return false;

  if (
    isAnalystOrPreviewEarningsItem(item) &&
    !containsAny(text, [
      "reported",
      "reports",
      "financial results",
      "revenue fell",
      "revenue declined",
      "net loss",
      "beat",
      "beats",
      "miss",
      "misses",
      "raises guidance",
      "raised guidance",
      "cuts guidance",
    ])
  ) {
    return false;
  }

  return true;
}

function rankEarningsNews(news: NewsItem[]) {
  return dedupeNews(
    [...news].sort((a, b) => {
      const aActual = isActualEarningsResultNews(a) ? 1 : 0;
      const bActual = isActualEarningsResultNews(b) ? 1 : 0;
      if (aActual !== bActual) return bActual - aActual;

      const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;

      return scoreNewsItem(b) - scoreNewsItem(a);
    })
  );
}

function getCatalystFloors(items: NewsItem[]) {
  const relevant = items.filter((item) => !isLowValueNewsItem(item)).slice(0, 8);

  let bullishCatalysts = 0;
  let bearishCatalysts = 0;
  let bullishEarningsCatalysts = 0;
  let bearishEarningsCatalysts = 0;

  const bullishTerms = [
    "beat",
    "beats",
    "tops estimates",
    "top estimates",
    "above estimates",
    "better than expected",
    "better-than-expected",
    "strong earnings",
    "good earnings",
    "solid earnings",
    "revenue beat",
    "eps beat",
    "raises guidance",
    "guidance above",
    "outlook above",
    "forecast above",
    "shares jump",
    "shares surge",
    "stock jumps",
    "stock surges",
    "rallies after",
    "strategic win",
    "major deal",
    "customer win",
    "confirmed partnership",
    "major partnership",
    "supply deal",
    "chip deal",
    "ai chip deal",
    "terafab",
    "launch of",
    "launches",
    "joining the project",
    "joins the project",
    "joins terafab",
    "applied materials joining",
    "intel joining",
    "ai demand",
    "data center demand",
    "foundry ambitions",
  ];

  const bearishTerms = [
    "misses estimates",
    "missed estimates",
    "below estimates",
    "cuts guidance",
    "guidance cut",
    "warning",
    "weak guidance",
    "shares plunge",
    "stock plunges",
    "downgrade",
    "investigation",
    "probe",
    "lawsuit",
    "recall",
    "insider resale",
    "insider sale",
    "stock sale",
    "share sale",
    "10b5-1",
    "softening demand",
    "weak demand",
    "competition",
  ];

  const earningsTerms = [
    "earnings",
    "results",
    "revenue",
    "guidance",
    "quarter",
    "eps",
    "profit",
    "q1",
    "q2",
    "q3",
    "q4",
  ];

  for (const item of relevant) {
    const text = headlineText(item);
    const isEarnings = isActualEarningsResultNews(item);
    const speculative = containsAny(text, ["speculation", "speculative", "rumor", "rumour", "may ", "could ", "might ", "potential", "possible"]);
    const analystOnly = containsAny(text, ["analyst", "price target", "upside", "projected upside", "rating"]);
    const bullish = containsAny(text, bullishTerms) && !speculative && !analystOnly;
    const bearish = containsAny(text, bearishTerms);

    if (bullish) bullishCatalysts += 1;
    if (bearish) bearishCatalysts += 1;

    if (isEarnings && bullish) bullishEarningsCatalysts += 1;
    if (isEarnings && bearish) bearishEarningsCatalysts += 1;
  }

  let newsFloor: number | null = null;
  let earningsFloor: number | null = null;

  if (bullishCatalysts >= 2 && bearishCatalysts === 0) newsFloor = 78;
  else if (bullishCatalysts >= 1 && bearishCatalysts === 0) newsFloor = 72;
  else if (bullishCatalysts >= 2 && bearishCatalysts <= 1) newsFloor = 74;
  else if (bullishCatalysts >= 1 && bearishCatalysts <= 1) newsFloor = 68;
  else if (bullishCatalysts >= 1 && bearishCatalysts <= 2) newsFloor = 64;

  if (bullishEarningsCatalysts >= 2 && bearishEarningsCatalysts === 0) earningsFloor = 78;
  else if (bullishEarningsCatalysts >= 1 && bearishEarningsCatalysts === 0) earningsFloor = 72;
  else if (bullishEarningsCatalysts >= 1 && bearishEarningsCatalysts <= 1) earningsFloor = 64;

  return { newsFloor, earningsFloor };
}

function applyCatalystFloor(score: number, floor: number | null) {
  if (typeof floor !== "number") return score;
  return Math.max(score, floor);
}

type DominantNewsTone =
  | "Strongly Bearish"
  | "Bearish"
  | "Neutral"
  | "Bullish"
  | "Strongly Bullish";

type DominantEarningsTone =
  | "No earnings signal"
  | "Weak"
  | "Mixed"
  | "Positive"
  | "Strong Positive";

function clampToBand(score: number, min: number, max: number) {
  return Math.max(min, Math.min(max, score));
}

function applyDominantNewsToneBand(score: number, tone: unknown) {
  if (tone === "Strongly Bullish") return clampToBand(score, 80, 90);
  if (tone === "Bullish") return clampToBand(score, 65, 80);
  if (tone === "Neutral") return clampToBand(score, 45, 60);
  if (tone === "Bearish") return clampToBand(score, 25, 45);
  if (tone === "Strongly Bearish") return clampToBand(score, 10, 25);

  return score;
}

function applyDominantEarningsToneBand(score: number, tone: unknown) {
  if (tone === "Strong Positive") return clampToBand(score, 75, 90);
  if (tone === "Positive") return clampToBand(score, 64, 80);
  if (tone === "Mixed") return clampToBand(score, 45, 60);
  if (tone === "No earnings signal") return clampToBand(score, 45, 55);
  if (tone === "Weak") return clampToBand(score, 20, 42);

  return score;
}

type AiScorePayload = {
  newsScore: NewsScoreResult;
  earningsScore: EarningsScoreResult;
};

async function getAiScoredNews(args: {
  symbol: string;
  companyName: string;
  trend: string;
  rankedNews: NewsItem[];
  rankedEarningsNews: NewsItem[];
  keywordNewsScore: NewsScoreResult;
  keywordEarningsScore: EarningsScoreResult;
}): Promise<AiScorePayload | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_NEWS_MODEL || "gpt-4.1-mini";

  if (!apiKey) return null;

  const candidates = args.rankedNews
    .filter((item) => !isLowValueNewsItem(item))
    .slice(0, 8)
    .map((item) => ({
      title: item.title,
      source: item.source,
      pubDate: item.pubDate,
      description: item.description,
    }));

  const earningsCandidates = args.rankedEarningsNews
    .filter((item) => !isLowValueNewsItem(item) && isActualEarningsResultNews(item))
    .slice(0, 8)
    .map((item) => ({
      title: item.title,
      source: item.source,
      pubDate: item.pubDate,
      description: item.description,
    }));

  if (!candidates.length && !earningsCandidates.length) return null;

  const earningsQualityGuardrails = getEarningsQualityGuardrails(args.rankedEarningsNews);
  const hasActualEarningsHeadlines = earningsQualityGuardrails.actualEarningsResultCatalysts > 0;

  const schema = {
    name: "stock_news_scores",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        newsScore: {
          type: "object",
          additionalProperties: false,
          properties: {
            score: { type: "number" },
            label: {
              type: "string",
              enum: ["Bearish", "Slightly Bearish", "Neutral", "Slightly Bullish", "Bullish"],
            },
            reason: { type: "string" },
            positives: {
              type: "array",
              items: { type: "string" },
            },
            negatives: {
              type: "array",
              items: { type: "string" },
            },
            confidence: {
              type: "string",
              enum: ["Low", "Medium", "High"],
            },
            dominantTone: {
              type: "string",
              enum: ["Strongly Bearish", "Bearish", "Neutral", "Bullish", "Strongly Bullish"],
            },
          },
          required: ["score", "label", "reason", "positives", "negatives", "confidence", "dominantTone"],
        },
        earningsScore: {
          type: "object",
          additionalProperties: false,
          properties: {
            score: { type: "number" },
            label: {
              type: "string",
              enum: ["No clear earnings read", "Weak earnings tone", "Mixed earnings tone", "Positive earnings tone", "Neutral earnings tone"],
            },
            reason: { type: "string" },
            dominantTone: {
              type: "string",
              enum: ["No earnings signal", "Weak", "Mixed", "Positive", "Strong Positive"],
            },
          },
          required: ["score", "label", "reason", "dominantTone"],
        },
      },
      required: ["newsScore", "earningsScore"],
    },
  };

  const systemPrompt = [
    "You are the AI news-score engine for MyStockHarbor. Your score is the primary source of truth.",
    "Use only the supplied headlines, descriptions, sources, dates, company name, ticker, and chart trend context.",
    "Do not copy any fallback keyword score. Do not anchor to headline tone. Judge the real likely business impact for investors.",
    "Think like a skeptical equity analyst: quality of signal matters more than whether the headline sounds positive.",
    "First decide the dominant narrative, then classify newsScore.dominantTone exactly as Strongly Bearish, Bearish, Neutral, Bullish, or Strongly Bullish.",
    "The final score must fit the chosen dominantTone band: Strongly Bearish 10-25, Bearish 25-45, Neutral 45-60, Bullish 65-80, Strongly Bullish 80-90.",
    "Do not cluster every stock around 60-70. Use 30-45 when the business read is poor, even if one headline contains a positive phrase.",
    "A stock can only be Bullish when high-quality positives clearly dominate the full headline set.",
    "High-quality bullish signals include: actual earnings beat plus raised guidance, strong revenue or EPS, improving margins or profitability, strong demand data, confirmed major customer wins, material contracts, or major partnerships with clear revenue/strategic impact.",
    "Low-quality positives include: upcoming earnings-date announcements, conference-call notices, generic analyst upside, price-target chatter, vague AI mentions, possible/speculative projects, CEO pay packages, compensation awards, management awards, routine filings, or routine insider-plan activity.",
    "Low-quality positives must not push the stock above Neutral by themselves.",
    "Important bearish signals include: revenue decline, widening loss, large net loss, weak or softening demand, competition pressure, cash burn, delayed profitability, weak guidance, guidance cuts, missed estimates, investigations, lawsuits, recalls, downgrades, insider selling, CFO selling, executive selling, RSU sales, 10b5-1 plans, or stock sales.",
    "For turnaround, cash-burning, loss-making, or challenged consumer companies, be very strict: an earnings beat is not bullish if revenue is falling, losses remain large, demand is weakening, EPS missed, subscribers/users are soft, or competition is pressuring the business.",
    "For those weaker businesses, analyst upside, price targets, speculative partnerships, conference-call announcements, and 'less bad than feared' earnings must be treated as weak positives only.",
    "If revenue decline, large loss, EPS miss, softening demand, or competition pressure appears in the supplied text, the stock should usually be Bearish or Neutral unless there is a clearly stronger confirmed catalyst that directly improves fundamentals.",
    "If the positive drivers are mostly analyst opinion, projected upside, upcoming earnings dates, routine partnerships, or speculative partnerships while the negatives include real business weakness, choose Neutral or Bearish and keep the score below 50.",
    "For strong AI/platform leaders, do not under-score real confirmed ecosystem expansion simply because one headline mentions a short-term stock slip.",
    "Partnerships are bullish only when they are confirmed and plausibly material. Speculative partnerships, possible involvement, or hype words like AI/chip/project without clear business impact should be Neutral.",
    "Price action in a headline is supporting evidence only. It should not dominate the score unless attached to a real fundamental catalyst.",
    "Before scoring, judge headline relevance. If headlines are unrelated to the company, ticker, or business model, treat them as low-quality noise, not positive or negative evidence.",
    "Examples of irrelevant noise include generic uses of the company name as a normal word, sports stories, retail deals, shopping articles, transfer news, or unrelated local news.",
    "If most supplied headlines are irrelevant, generic, or low-information, confidence should be Low or Medium and newsScore should usually stay Neutral or below.",
    "A score above 60 requires multiple relevant, company-specific, high-quality headlines. One relevant positive headline surrounded by unrelated noise is not enough for Bullish.",
    "For earningsScore, use ONLY earningsHeadlines. Do not infer earnings tone from general partnership, product, analyst, stock-price, or project headlines.",
    "Classify earningsScore.dominantTone exactly as No earnings signal, Weak, Mixed, Positive, or Strong Positive.",
    "The earnings score must fit the chosen band: No earnings signal 45-55, Weak 20-42, Mixed 45-60, Positive 64-80, Strong Positive 75-90.",
    "If earningsHeadlines are empty, stale, or only mention an upcoming earnings date, conference call, analyst preview, estimate, or routine filing, choose No earnings signal and score around 50.",
    "Only choose Positive or Strong Positive earnings when there are actual reported results with clear beats, raised guidance, strong revenue/EPS, strong margins, improving profitability, or clearly positive financial results.",
    "If revenue declined, revenue missed guidance, losses remain large, subscribers/users declined, demand weakened, margins were pressured, or guidance disappointed, earningsScore should be Weak or Mixed unless a stronger actual beat-and-raise clearly outweighs those negatives.",
    "Use positives and negatives to explain the score. Positives must be meaningful. Negatives must include the real risk drivers. Keep the language concise and beginner-friendly. Do not invent facts.",
  ].join(" ");

  const userPrompt = JSON.stringify({
    symbol: args.symbol,
    companyName: args.companyName,
    trend: args.trend,
    headlines: candidates,
    earningsHeadlines: earningsCandidates,
  });

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_output_tokens: 900,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            ...schema,
          },
        },
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as unknown;
    const rawText = extractOpenAiResponseText(data);
    if (!rawText) return null;

const parsed = JSON.parse(rawText) as {
  newsScore?: Partial<NewsScoreResult> & { dominantTone?: DominantNewsTone };
  earningsScore?: Partial<EarningsScoreResult> & { dominantTone?: DominantEarningsTone };
};

    const aiNewsScore = applyDominantNewsToneBand(
      clampScore(parsed.newsScore?.score),
      parsed.newsScore?.dominantTone
    );

    const aiEarningsScore = hasActualEarningsHeadlines
      ? applyDominantEarningsToneBand(
          clampScore(parsed.earningsScore?.score),
          parsed.earningsScore?.dominantTone
        )
      : 50;

    const newsTone = scoreToTone(aiNewsScore);
    const earningsTone = scoreToTone(aiEarningsScore);

    const newsScore: NewsScoreResult = {
      score: aiNewsScore,
      tone: newsTone,
      label: scoreToNewsLabel(aiNewsScore),
      reason:
        typeof parsed.newsScore?.reason === "string" && parsed.newsScore.reason.trim()
          ? parsed.newsScore.reason.trim()
          : args.keywordNewsScore.reason,
      positives: cleanStringArray(parsed.newsScore?.positives),
      negatives: cleanStringArray(parsed.newsScore?.negatives),
      confidence:
        parsed.newsScore?.confidence === "High" ||
        parsed.newsScore?.confidence === "Medium" ||
        parsed.newsScore?.confidence === "Low"
          ? parsed.newsScore.confidence
          : args.keywordNewsScore.confidence,
    };

    const earningsScore: EarningsScoreResult = {
      score: aiEarningsScore,
      tone: earningsTone,
      label:
        !hasActualEarningsHeadlines || parsed.earningsScore?.dominantTone === "No earnings signal"
          ? "No clear earnings read"
          : scoreToEarningsLabel(aiEarningsScore),
      reason:
        typeof parsed.earningsScore?.reason === "string" && parsed.earningsScore.reason.trim()
          ? parsed.earningsScore.reason.trim()
          : args.keywordEarningsScore.reason,
    };

    return {
      newsScore,
      earningsScore,
    };
  } catch {
    return null;
  }
}

function scoreEarnings(news: NewsItem[]): EarningsScoreResult {
  const ranked = rankEarningsNews(news);
  const earningsItems = ranked.filter((item) => isActualEarningsResultNews(item));

  if (!earningsItems.length) {
    return {
      score: 50,
      label: "No clear earnings read",
      tone: "yellow",
      reason: "There are no clear recent earnings-result headlines in the dedicated earnings feed.",
    };
  }

  let signal = 0;
  const positiveDrivers: string[] = [];
  const negativeDrivers: string[] = [];

  for (const item of earningsItems.slice(0, 5)) {
    const text = headlineText(item);

    const positive = containsAny(text, [
      "beat",
      "beats",
      "tops estimates",
      "top estimates",
      "above estimates",
      "better than expected",
      "better-than-expected",
      "good earnings",
      "strong earnings",
      "solid earnings",
      "revenue beat",
      "eps beat",
      "raises guidance",
      "guidance above",
      "outlook above",
      "forecast above",
      "shares jump",
      "shares surge",
      "stock jumps",
      "stock surges",
      "rallies after",
      "growth",
      "record",
    ]);

    const negative = containsAny(text, [
      "miss",
      "misses",
      "missed estimates",
      "below estimates",
      "cuts guidance",
      "guidance cut",
      "weak guidance",
      "warning",
      "slump",
      "plunge",
      "revenue fell",
      "revenue declined",
      "declining revenue",
      "big loss",
      "net loss",
      "subscriber decline",
      "subscribers declined",
      "below guidance",
    ]);

    if (positive) {
      signal += 2.5;
      positiveDrivers.push(item.title);
    }

    if (negative) {
      signal -= 2.5;
      negativeDrivers.push(item.title);
    }

    // Losses or restructuring should only be a heavy negative when they are not paired with
    // a positive earnings catalyst in the same headline/description.
    if (!positive && containsAny(text, ["loss", "losses", "layoffs", "restructuring"])) {
      signal -= 1;
    }
  }

  let score = Math.max(0, Math.min(100, Math.round(50 + signal * 7)));

  const earningsQualityGuardrails = getEarningsQualityGuardrails(ranked);
  score = applyScoreCap(
    applyCatalystFloor(score, earningsQualityGuardrails.earningsFloor),
    earningsQualityGuardrails.earningsCap
  );

  let label = "Mixed earnings tone";
  let tone: ScoreTone = "yellow";
  let reason =
    "Recent earnings-linked headlines are mixed, so the score stays close to the middle.";

  if (score >= 64) {
    label = "Positive earnings tone";
    tone = "green";
    reason = positiveDrivers.length
      ? "Recent earnings-linked headlines look constructive, with stronger signals around beats, guidance, revenue, or share-price reaction."
      : "The earnings-linked headlines look more constructive than negative, which may help support confidence in the next leg of the story.";
  } else if (score <= 36) {
    label = "Weak earnings tone";
    tone = "red";
    reason = negativeDrivers.length
      ? "Recent earnings-linked headlines look pressured, with weaker signals around misses, guidance cuts, or disappointing results."
      : "The earnings-linked headlines look more pressured than supportive, which can weigh on sentiment until the business story improves again.";
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

  const [news, earningsNews] = await Promise.all([
    fetchNews(upper, companyName),
    fetchEarningsNews(upper, companyName),
  ]);

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

  const rankedNews = rankNews(news, upper, companyName);
  const rankedEarningsNews = rankEarningsNews(earningsNews);

  const keywordNewsScore = scoreNews(news);
  const keywordEarningsScore = scoreEarnings(earningsNews);

  const earningsQualityGuardrails = getEarningsQualityGuardrails(rankedEarningsNews);

  const fallbackNewsScoreValue = keywordNewsScore.score;
  const hasActualEarningsHeadlines =
    earningsQualityGuardrails.actualEarningsResultCatalysts > 0;
  const fallbackEarningsScoreValue = hasActualEarningsHeadlines
    ? keywordEarningsScore.score
    : 50;

  const newsScore = {
    ...keywordNewsScore,
    score: fallbackNewsScoreValue,
    tone: scoreToTone(fallbackNewsScoreValue),
    label: scoreToNewsLabel(fallbackNewsScoreValue),
    reason: news.length
      ? keywordNewsScore.reason
      : "FMP did not return recent stock-specific headlines for this ticker.",
  };

  const earningsScore = {
    ...keywordEarningsScore,
    score: fallbackEarningsScoreValue,
    tone: scoreToTone(fallbackEarningsScoreValue),
    label: hasActualEarningsHeadlines
      ? scoreToEarningsLabel(fallbackEarningsScoreValue)
      : "No clear earnings read",
    reason: hasActualEarningsHeadlines
      ? keywordEarningsScore.reason
      : "FMP did not return recent earnings-specific headlines. Use the structured earnings snapshot instead.",
  };

  const highValueNews = rankedNews.filter((item) => !isLowValueNewsItem(item));
  const fallbackNews = rankedNews.filter((item) => isLowValueNewsItem(item));

const newestFirst = (items: NewsItem[]) =>
  [...items].sort((a, b) => {
    const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;

    return bTime - aTime;
  });

function oneArticlePerDate(items: NewsItem[]) {
  const seenDates = new Set<string>();
  const filtered: NewsItem[] = [];

  for (const item of items) {
    const dateKey = item.pubDate
      ? new Date(item.pubDate).toISOString().slice(0, 10)
      : "unknown";

    if (seenDates.has(dateKey)) continue;

    seenDates.add(dateKey);
    filtered.push(item);
  }

  return filtered;
}

const aiFilteredNews = oneArticlePerDate(
  dedupeNews([
    ...newestFirst(highValueNews),
    ...newestFirst(fallbackNews),
  ])
);

const detailedNews = aiFilteredNews.slice(0, maxDetailedItems);

const compactNews = aiFilteredNews
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

  const aiBriefsPromise = isInvalidTicker
    ? Promise.resolve([])
    : getAiNewsBriefs({
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

  const aiInsightPromise =
    isInvalidTicker || !includeInsight
      ? Promise.resolve(null)
      : getAiNewsInsight({
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
          items: detailedNews.map((item) => ({
            title: item.title,
            source: item.source,
            pubDate: item.pubDate,
            description: item.description,
            summary: item.description ?? null,
            whyItMatters: null,
          })),
        });

  const [aiBriefs, aiInsight] = await Promise.all([
    aiBriefsPromise,
    aiInsightPromise,
  ]);

  const summaryByTitle = Object.fromEntries(
    detailedNews.map((item) => [item.title, item.description ?? ""])
  );

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
  ["msh-stock-news-base-data-v22-fmp-primary"],
  {
    revalidate: 60,
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
