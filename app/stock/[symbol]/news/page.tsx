import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";

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

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
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

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

    if (title && link) {
      const clean = decodeHtml(title.replace(/\s+-\s+Google News$/i, "").trim());
      items.push({
        title: clean,
        link: link.trim(),
        pubDate,
        source: source ? decodeHtml(source.trim()) : null,
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
    if (lines.length < 3) return [];

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
  const baseQuery = companyName
    ? `${companyName} ${symbol} stock`
    : `${symbol} stock`;

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    baseQuery
  )}&hl=en-GB&gl=GB&ceid=GB:en`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });

    if (!res.ok) return [];

    const xml = await res.text();
    return parseRss(xml).slice(0, 8);
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

function formatMoney(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
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

function compactSource(source: string | null) {
  if (!source) return "Publisher";
  return source.replace(/\s+News$/i, "").trim();
}

function keywordHits(title: string, words: string[]) {
  const lower = title.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function scoreNews(news: NewsItem[]): NewsScoreResult {
  if (!news.length) {
    return {
      score: 50,
      tone: "yellow",
      label: "Neutral",
      reason:
        "There are not enough fresh headlines here to lean strongly bullish or bearish, so the score stays neutral.",
      positives: [],
      negatives: [],
      confidence: "Low",
    };
  }

  const positiveWords = [
    "beat",
    "beats",
    "strong",
    "growth",
    "surge",
    "record",
    "bullish",
    "expands",
    "expansion",
    "partnership",
    "wins",
    "upgrade",
    "buy rating",
    "top pick",
    "raises",
    "rebound",
    "profit jump",
    "demand",
    "momentum",
  ];

  const negativeWords = [
    "miss",
    "misses",
    "cuts",
    "cut",
    "warning",
    "lawsuit",
    "probe",
    "investigation",
    "downgrade",
    "sell rating",
    "falls",
    "drop",
    "slump",
    "weak",
    "soft",
    "recall",
    "tariff",
    "delay",
    "loss",
    "concern",
  ];

  const positiveTitles: string[] = [];
  const negativeTitles: string[] = [];

  let raw = 50;

  news.slice(0, 6).forEach((item, index) => {
    const weight = index === 0 ? 1.5 : index === 1 ? 1.25 : index <= 3 ? 1 : 0.75;

    if (keywordHits(item.title, positiveWords)) {
      raw += 7 * weight;
      positiveTitles.push(item.title);
    }

    if (keywordHits(item.title, negativeWords)) {
      raw -= 7 * weight;
      negativeTitles.push(item.title);
    }

    if (
      keywordHits(item.title, ["earnings", "results", "revenue", "guidance"]) &&
      keywordHits(item.title, ["beat", "strong", "raises", "growth"])
    ) {
      raw += 5 * weight;
    }

    if (
      keywordHits(item.title, ["earnings", "results", "revenue", "guidance"]) &&
      keywordHits(item.title, ["miss", "cuts", "warning", "weak"])
    ) {
      raw -= 5 * weight;
    }
  });

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let tone: ScoreTone = "yellow";
  let label = "Neutral";
  if (score >= 62) {
    tone = "green";
    label = "Bullish";
  } else if (score <= 38) {
    tone = "red";
    label = "Bearish";
  }

  const confidence =
    news.length >= 5
      ? "High"
      : news.length >= 3
      ? "Medium"
      : "Low";

  let reason =
    "The latest headline mix is balanced, so the score sits in the middle rather than signalling a clear strong lean.";

  if (tone === "green") {
    reason =
      "Recent coverage is leaning more constructive than negative, with the strongest headlines skewing toward momentum, upgrades, demand, or better-than-feared developments.";
  } else if (tone === "red") {
    reason =
      "Recent coverage is leaning weaker than positive, with the strongest headlines skewing toward misses, cuts, downgrades, risk flags, or pressure on the broader story.";
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
  const earningsNews = news.filter((item) =>
    keywordHits(item.title, ["earnings", "results", "revenue", "guidance", "quarter", "q1", "q2", "q3", "q4"])
  );

  if (!earningsNews.length) {
    return {
      score: 50,
      tone: "yellow" as ScoreTone,
      label: "No clear earnings read",
      reason:
        "There is not enough obvious earnings-specific coverage in the latest headline set to push this score strongly either way.",
    };
  }

  let score = 50;

  earningsNews.slice(0, 4).forEach((item) => {
    if (keywordHits(item.title, ["beat", "strong", "raises", "growth", "tops"])) score += 10;
    if (keywordHits(item.title, ["miss", "cuts", "warning", "weak", "drops"])) score -= 10;
  });

  score = Math.max(0, Math.min(100, score));

  let tone: ScoreTone = "yellow";
  let label = "Mixed earnings tone";
  let reason =
    "Recent earnings-linked headlines are mixed, so the score stays close to the middle.";

  if (score >= 62) {
    tone = "green";
    label = "Positive earnings tone";
    reason =
      "The earnings-linked headlines look more constructive than negative, which may help support confidence in the next leg of the story.";
  } else if (score <= 38) {
    tone = "red";
    label = "Weak earnings tone";
    reason =
      "The earnings-linked headlines look more pressured than supportive, which can weigh on sentiment until the business story improves again.";
  }

  return { score, tone, label, reason };
}

function buildLeadSummary(args: {
  symbol: string;
  companyName: string;
  trend: string;
  newsScore: NewsScoreResult;
  earningsScore: { score: number; tone: ScoreTone; label: string; reason: string };
}) {
  const { symbol, companyName, trend, newsScore, earningsScore } = args;
  const lead = companyName ? `${companyName} (${symbol})` : symbol;

  return `${lead} is currently showing a ${newsScore.label.toLowerCase()} headline tone with a ${trend.toLowerCase()} backdrop. The latest news flow is being framed here as context rather than prediction, so beginners can quickly see whether headlines are helping, hurting, or complicating the chart story. Earnings tone is currently ${earningsScore.label.toLowerCase()}.`;
}

function buildNewsSummary(item: NewsItem, symbol: string) {
  const lower = item.title.toLowerCase();

  if (
    keywordHits(lower, ["earnings", "results", "revenue", "guidance", "quarter"])
  ) {
    return `This looks like an earnings-related catalyst for ${symbol}, which matters because results and guidance often reshape expectations faster than ordinary headline flow.`;
  }

  if (keywordHits(lower, ["upgrade", "downgrade", "price target", "analyst"])) {
    return `This headline looks more sentiment-driven, which can change short-term attention on ${symbol} even if it does not fully change the underlying business story.`;
  }

  if (keywordHits(lower, ["partnership", "deal", "contract", "wins", "customer"])) {
    return `This update appears tied to business momentum or validation, which traders often treat as a sign the story still has demand behind it.`;
  }

  if (keywordHits(lower, ["lawsuit", "probe", "investigation", "recall"])) {
    return `This headline looks like a risk flag, which can pressure confidence because traders may need to price in uncertainty before focusing on growth again.`;
  }

  if (keywordHits(lower, ["ai", "chip", "product", "launch", "software"])) {
    return `This item seems linked to product or theme momentum, which matters because narrative strength can amplify already-strong charts and sometimes stabilise weaker ones.`;
  }

  if (keywordHits(lower, ["tariff", "fed", "rates", "market", "sector"])) {
    return `This headline looks more macro or sector-driven than company-only, so it may be shaping how traders view the environment around ${symbol}, not just the stock in isolation.`;
  }

  return `This update adds to the near-term picture around ${symbol}, even if the headline alone does not decide the chart. Traders usually look for follow-through after the first reaction.`;
}

function buildWhatItMeans(args: {
  symbol: string;
  trend: string;
  newsScore: NewsScoreResult;
  rsi: number | null;
  priceVs50: number | null;
}) {
  const { symbol, trend, newsScore, rsi, priceVs50 } = args;
  const lines: string[] = [];

  if (newsScore.tone === "green" && trend === "Bullish trend") {
    lines.push(
      `${symbol} has a friendlier setup when positive headlines are landing into an already supportive chart, because news and structure are pointing in the same direction.`
    );
  } else if (newsScore.tone === "green" && trend !== "Bullish trend") {
    lines.push(
      `The recent news flow for ${symbol} looks better than the chart structure, which can be the early stage of improvement but still needs confirmation from price.`
    );
  } else if (newsScore.tone === "red" && trend === "Bearish trend") {
    lines.push(
      `${symbol} looks more vulnerable when negative headlines are arriving into an already weak structure, because bad news has less technical support beneath it.`
    );
  } else if (newsScore.tone === "red") {
    lines.push(
      `The chart may still be holding up better than the headline tone, but traders will watch whether weaker news starts breaking support or simply gets absorbed.`
    );
  } else {
    lines.push(
      `${symbol} currently sits in a more mixed zone where headline tone alone is unlikely to settle the next move without clearer price confirmation.`
    );
  }

  if (typeof rsi === "number" && rsi >= 70) {
    lines.push(
      `Momentum already looks warm, so even strong news may lead to consolidation first rather than an endlessly clean upside continuation.`
    );
  } else if (typeof rsi === "number" && rsi <= 35) {
    lines.push(
      `Momentum is softer, which means even modestly better news could matter more than usual if traders start looking for stabilisation and rebound attempts.`
    );
  }

  if (typeof priceVs50 === "number" && priceVs50 >= 10) {
    lines.push(
      `Because ${symbol} is already stretched above the 50-day average, the next bullish step often depends on digestion and support-holding rather than pure excitement.`
    );
  } else if (typeof priceVs50 === "number" && priceVs50 <= -10) {
    lines.push(
      `Because ${symbol} is trading well below the 50-day average, stronger headlines may first need to repair damage before the market treats them as a clean fresh uptrend signal.`
    );
  }

  return lines.slice(0, 3);
}

function buildBeyondHeadline(args: {
  symbol: string;
  newsScore: NewsScoreResult;
  trend: string;
  recentHigh: number | null;
  recentLow: number | null;
}) {
  const { symbol, newsScore, trend, recentHigh, recentLow } = args;

  if (newsScore.tone === "red" && trend !== "Bearish trend") {
    return `The outside-the-box read for ${symbol} is that apparently bad news does not always become lasting damage. If price keeps holding above important structure despite weaker headlines, that can mean some of the fear was already priced in or that stronger hands are still supporting the stock.`;
  }

  if (newsScore.tone === "green" && trend === "Bearish trend") {
    return `The outside-the-box read for ${symbol} is that good news can still disappoint if the chart remains weak. Traders often want to see reclaim attempts and better price behaviour before assuming the headlines have truly changed the bigger trend.`;
  }

  if (typeof recentHigh === "number" && typeof recentLow === "number") {
    return `${symbol} may not need perfect headlines to improve. Sometimes the more important clue is whether the stock stops making lower lows near ${formatMoney(
      recentLow
    )} and starts building toward resistance near ${formatMoney(
      recentHigh
    )}. That kind of behaviour can quietly matter more than a dramatic headline.`;
  }

  return `The deeper read for ${symbol} is that headlines often matter most when they confirm or challenge the chart at a key moment. Good news is most useful when it attracts follow-through. Bad news is most dangerous when support is already fragile.`;
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

  let momentumText =
    "Momentum is not especially stretched right now, so price behaviour around fresh headlines may matter more than an extreme oscillator reading.";

  if (typeof rsi === "number" && rsi >= 70) {
    momentumText =
      "Momentum looks hot rather than calm, which can support strength but also raises the chance of chop, pause, or pullback after fast gains.";
  } else if (typeof rsi === "number" && rsi <= 30) {
    momentumText =
      "Momentum looks washed out rather than strong, which can create rebound interest but does not by itself prove a durable reversal.";
  }

  const levelText = `Last price is ${formatMoney(price)}, versus MA50 at ${formatMoney(
    ma50
  )} and MA200 at ${formatMoney(ma200)}. Relative to those reference points, ${symbol} is ${formatPercent(
    priceVs50
  )} vs MA50 and ${formatPercent(priceVs200)} vs MA200.`;

  return {
    trendText,
    momentumText,
    levelText,
  };
}

function buildWatchList(args: {
  symbol: string;
  recentHigh: number | null;
  recentLow: number | null;
  ma50: number | null;
  ma200: number | null;
}) {
  const { symbol, recentHigh, recentLow, ma50, ma200 } = args;
  const items: string[] = [];

  if (typeof recentHigh === "number") {
    items.push(
      `A push toward ${formatMoney(recentHigh)} would show whether ${symbol} can challenge recent resistance instead of fading before it gets there.`
    );
  }

  if (typeof ma50 === "number") {
    items.push(
      `The 50-day average near ${formatMoney(ma50)} is a practical short-term test area for pullbacks, holds, and reclaims.`
    );
  }

  if (typeof ma200 === "number") {
    items.push(
      `The 200-day average near ${formatMoney(ma200)} remains a bigger-picture structure line that longer-term traders often care about.`
    );
  }

  if (typeof recentLow === "number") {
    items.push(
      `A break below ${formatMoney(recentLow)} would make the setup look more fragile and could shift attention back toward risk control instead of upside continuation.`
    );
  }

  return items.slice(0, 4);
}

function structuredNews(news: NewsItem[]) {
  return news.map((item) => ({
    "@type": "NewsArticle",
    headline: item.title,
    datePublished: item.pubDate,
    publisher: {
      "@type": "Organization",
      name: compactSource(item.source),
    },
    url: item.link,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  return {
    title: `${upper} Stock News, News Score & Beginner Analysis | MyStockHarbor`,
    description: `Read ${upper} stock news with a beginner-friendly news score, earnings tone, technical context, and a deeper look at what the latest headlines could mean.`,
    alternates: {
      canonical: `/stock/${upper}/news`,
    },
    openGraph: {
      title: `${upper} Stock News & News Score | MyStockHarbor`,
      description: `Latest ${upper} stock news, headline tone, what it may mean next, and chart context on MyStockHarbor.`,
      url: `/stock/${upper}/news`,
      siteName: "MyStockHarbor",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock News & News Score | MyStockHarbor`,
      description: `Latest ${upper} stock headlines with beginner-friendly analysis and chart context.`,
    },
  };
}

export default async function StockNewsPage({ params }: Props) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

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
  const leadSummary = buildLeadSummary({
    symbol: upper,
    companyName,
    trend,
    newsScore,
    earningsScore,
  });
  const whatItMeans = buildWhatItMeans({
    symbol: upper,
    trend,
    newsScore,
    rsi: lastRsi,
    priceVs50,
  });
  const beyondHeadline = buildBeyondHeadline({
    symbol: upper,
    newsScore,
    trend,
    recentHigh,
    recentLow,
  });
  const technicalRead = buildTechnicalRead({
    symbol: upper,
    price: quote?.price ?? lastClose,
    ma50: lastMA50,
    ma200: lastMA200,
    trend,
    rsi: lastRsi,
    priceVs50,
    priceVs200,
  });
  const watchList = buildWatchList({
    symbol: upper,
    recentHigh,
    recentLow,
    ma50: lastMA50,
    ma200: lastMA200,
  });

  const leadName = companyName ? `${companyName} (${upper})` : upper;
  const detailedNews = news.slice(0, 3);
  const compactNews = news.slice(3, 6);

  return (
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
            "@type": "WebPage",
            name: `${upper} Stock News, News Score & Beginner Analysis`,
            url: `https://mystockharbor.com/stock/${encodeURIComponent(upper)}/news`,
            description: leadSummary,
            mainEntity: {
              "@type": "Dataset",
              name: `${upper} recent stock news summary`,
            },
            hasPart: structuredNews(news),
            breadcrumb: {
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "Home",
                  item: "https://mystockharbor.com/",
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: `${upper} Stock Page`,
                  item: `https://mystockharbor.com/stock/${encodeURIComponent(upper)}`,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: `${upper} Stock News`,
                  item: `https://mystockharbor.com/stock/${encodeURIComponent(upper)}/news`,
                },
              ],
            },
          }),
        }}
      />

      <div className="newsWrap">
        <div style={topNavRowStyle}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={topNavBtnStyle("dashboard")}>
              ← Dashboard
            </Link>
            <Link href={`/stock/${encodeURIComponent(upper)}`} style={topNavBtnStyle("blue")}>
              Full Stock Page
            </Link>
            <Link href="/pickers" style={topNavBtnStyle("pickers")}>
              Trade This Stock
            </Link>
            <Link href="/learn" style={topNavBtnStyle("green")}>
              Learn
            </Link>
          </div>
        </div>

        <section style={heroShellStyle}>
          <div style={heroLeftStyle}>
            <div style={newsDeskTagStyle}>NEWS DESK</div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 44,
                lineHeight: 1.02,
                letterSpacing: "-0.055em",
                maxWidth: 760,
              }}
            >
              {upper} Stock News, News Score & What It Could Mean
            </h1>

            <p
              style={{
                margin: "14px 0 0 0",
                maxWidth: 780,
                fontSize: 16,
                lineHeight: 1.75,
                color: "rgba(241,245,249,0.82)",
              }}
            >
              {leadSummary}
            </p>

            <div style={heroMetricRowStyle}>
              <div style={heroMetricStyle}>
                <div style={heroMetricLabelStyle}>Last Price</div>
                <div style={heroMetricValueStyle}>
                  {formatMoney(quote?.price ?? lastClose)}
                </div>
              </div>

              <div style={heroMetricStyle}>
                <div style={heroMetricLabelStyle}>Trend Context</div>
                <div style={heroMetricValueStyle}>{trend}</div>
              </div>

              <div style={heroMetricStyle}>
                <div style={heroMetricLabelStyle}>RSI (14)</div>
                <div style={heroMetricValueStyle}>
                  {typeof lastRsi === "number" ? lastRsi.toFixed(1) : "—"}
                </div>
              </div>
            </div>

            <div style={heroCtaRowStyle}>
              <a
                href={`/api/go/tradingview?symbol=${encodeURIComponent(upper)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={heroPrimaryCtaStyle}
              >
                OPEN ON TRADINGVIEW ↗
              </a>

              <Link href="/pickers" style={heroSecondaryCtaStyle}>
                TRADE THIS STOCK
              </Link>
            </div>

            <div style={heroSubCopyStyle}>
              Full chart, indicators and drawing tools on TradingView. Use Pickers to explore
              setups and related opportunities.
            </div>
          </div>

          <div style={heroRightStyle}>
            <div style={scorePanelStyle(newsScore.tone)}>
              <div style={scorePanelKickerStyle}>NEWS SCORE</div>
              <div style={scoreValueStyle}>{newsScore.score}/100</div>
              <div style={scoreLabelStyle(newsScore.tone)}>{newsScore.label}</div>
              <p style={scoreReasonStyle}>{newsScore.reason}</p>
            </div>

            <div style={miniScoreGridStyle}>
              <div style={miniScoreCardStyle(earningsScore.tone)}>
                <div style={miniScoreTitleStyle}>Earnings Tone</div>
                <div style={miniScoreNumberStyle}>{earningsScore.score}</div>
                <div style={miniScoreLabelStyle}>{earningsScore.label}</div>
              </div>

              <div style={miniScoreCardStyle(newsScore.tone)}>
                <div style={miniScoreTitleStyle}>Confidence</div>
                <div style={miniScoreNumberStyle}>{newsScore.confidence}</div>
                <div style={miniScoreLabelStyle}>Headline depth</div>
              </div>
            </div>
          </div>
        </section>

        <section className="newsGrid" style={newsGridStyle}>
          <div style={{ display: "grid", gap: 18 }}>
            <section style={editorialCardStyle}>
              <div style={sectionEyebrowStyle}>Latest briefing</div>
              <h2 style={sectionTitleStyle}>What’s happening with {upper}</h2>

              <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
                {detailedNews.length ? (
                  detailedNews.map((item, index) => (
                    <article
                      key={`${item.link}-${index}`}
                      style={{
                        ...newsLeadCardStyle,
                        borderLeft:
                          index === 0
                            ? "3px solid rgba(59,130,246,0.75)"
                            : "3px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div style={newsMetaRowStyle}>
                        <span style={newsSourcePillStyle}>{compactSource(item.source)}</span>
                        <span style={newsDateStyle}>{formatDate(item.pubDate)}</span>
                      </div>

                      <h3 style={newsHeadlineStyle}>{item.title}</h3>
                      <p style={newsSummaryStyle}>{buildNewsSummary(item, upper)}</p>

                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={readOriginalLinkStyle}
                      >
                        Read original coverage ↗
                      </a>
                    </article>
                  ))
                ) : (
                  <div style={newsLeadCardStyle}>
                    <h3 style={{ ...newsHeadlineStyle, marginTop: 0 }}>No fresh headline set available</h3>
                    <p style={newsSummaryStyle}>
                      This page still works as a stock-news analysis hub, but the current news feed
                      is light. In that case, the page leans more on structure, levels, and what
                      traders may watch next.
                    </p>
                  </div>
                )}
              </div>

              {compactNews.length ? (
                <div style={{ marginTop: 16 }}>
                  <div style={compactFeedLabelStyle}>Older updates drop into a lighter feed</div>

                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {compactNews.map((item, index) => (
                      <article key={`${item.link}-compact-${index}`} style={compactNewsRowStyle}>
                        <div style={{ minWidth: 88 }}>
                          <div style={compactSourceStyle}>{compactSource(item.source)}</div>
                          <div style={compactDateStyle}>{formatDate(item.pubDate)}</div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={compactHeadlineStyle}>{item.title}</div>
                        </div>

                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={compactReadStyle}
                        >
                          ↗
                        </a>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section style={featuredInsightShellStyle}>
              <div style={sectionEyebrowStyle}>Beyond the headline</div>
              <h2 style={sectionTitleStyle}>A deeper look for beginners</h2>
              <p style={bodyCopyStyle}>{beyondHeadline}</p>
            </section>
          </div>

          <aside style={{ display: "grid", gap: 18 }}>
            <section style={sidebarCardStyle}>
              <div style={sectionEyebrowStyle}>Why the score looks like this</div>
              <h2 style={sectionTitleSmallStyle}>News Score Breakdown</h2>

              <p style={bodyCopyStyle}>{newsScore.reason}</p>

              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                <div style={signalBoxStyle("green")}>
                  <div style={signalBoxTitleStyle}>Positive drivers</div>
                  {newsScore.positives.length ? (
                    newsScore.positives.map((item) => (
                      <div key={item} style={signalBoxItemStyle}>
                        {item}
                      </div>
                    ))
                  ) : (
                    <div style={signalBoxEmptyStyle}>No strong positive keyword cluster in the latest set.</div>
                  )}
                </div>

                <div style={signalBoxStyle("red")}>
                  <div style={signalBoxTitleStyle}>Negative drivers</div>
                  {newsScore.negatives.length ? (
                    newsScore.negatives.map((item) => (
                      <div key={item} style={signalBoxItemStyle}>
                        {item}
                      </div>
                    ))
                  ) : (
                    <div style={signalBoxEmptyStyle}>No strong negative keyword cluster in the latest set.</div>
                  )}
                </div>
              </div>
            </section>

            <section style={sidebarCardStyle}>
              <div style={sectionEyebrowStyle}>What this could mean</div>
              <h2 style={sectionTitleSmallStyle}>Going Forward</h2>

              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {whatItMeans.map((line) => (
                  <div key={line} style={bulletRowStyle}>
                    <div style={bulletDotStyle} />
                    <div style={bulletTextStyle}>{line}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16 }}>
                <Link href="/pickers" style={midPageCtaStyle}>
                  TRADE THIS STOCK
                </Link>
              </div>
            </section>

            <section style={sidebarCardStyle}>
              <div style={sectionEyebrowStyle}>Chart context</div>
              <h2 style={sectionTitleSmallStyle}>Technical Picture</h2>

              <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                <p style={bodyCopyStyle}>{technicalRead.trendText}</p>
                <p style={bodyCopyStyle}>{technicalRead.momentumText}</p>
                <p style={bodyCopyStyle}>{technicalRead.levelText}</p>
              </div>
            </section>

            <section style={sidebarCardStyle}>
              <div style={sectionEyebrowStyle}>Watch list</div>
              <h2 style={sectionTitleSmallStyle}>Levels Traders May Watch</h2>

              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {watchList.map((item) => (
                  <div key={item} style={bulletRowStyle}>
                    <div style={bulletDotStyle} />
                    <div style={bulletTextStyle}>{item}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={sidebarCardStyle}>
              <div style={sectionEyebrowStyle}>Next actions</div>
              <h2 style={sectionTitleSmallStyle}>Explore More</h2>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                <Link href={`/stock/${encodeURIComponent(upper)}`} style={sideLinkStyle("blue")}>
                  Open full {upper} stock page
                </Link>

                <a
                  href={`/api/go/tradingview?symbol=${encodeURIComponent(upper)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={sideLinkStyle("green")}
                >
                  OPEN ON TRADINGVIEW ↗
                </a>

                <Link href="/pickers" style={sideLinkStyle("red")}>
                  TRADE THIS STOCK
                </Link>

                <Link href="/learn" style={sideLinkStyle("blue")}>
                  Read beginner learn guides
                </Link>
              </div>
            </section>
          </aside>
        </section>

        <section style={bottomStripStyle}>
          <div>
            <div style={bottomStripTitleStyle}>Continue your {upper} research</div>
            <div style={bottomStripTextStyle}>
              Use the chart page for a fuller technical read, TradingView for external charting, and
              Pickers to explore related setups on MyStockHarbor.
            </div>
          </div>

          <div style={bottomStripActionsStyle}>
            <Link href={`/stock/${encodeURIComponent(upper)}`} style={bottomActionStyle("blue")}>
              Full Stock Page
            </Link>

            <a
              href={`/api/go/tradingview?symbol=${encodeURIComponent(upper)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={bottomActionStyle("green")}
            >
              OPEN ON TRADINGVIEW ↗
            </a>

            <Link href="/pickers" style={bottomActionStyle("red")}>
              TRADE THIS STOCK
            </Link>
          </div>
        </section>
      </div>

      <style>{`
        .newsWrap {
          max-width: 1240px;
          margin: 0 auto;
          padding: 24px 40px 42px;
        }

        .newsGrid {
          display: grid;
          grid-template-columns: minmax(0, 1.22fr) minmax(320px, 0.78fr);
          gap: 22px;
          margin-top: 22px;
          align-items: start;
        }

        @media (max-width: 1080px) {
          .newsWrap {
            padding: 20px 18px 36px;
          }

          .newsGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

const topNavRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 18,
};

const heroShellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.24fr) minmax(280px, 0.76fr)",
  gap: 18,
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 28,
  padding: 22,
  background:
    "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,9,15,0.98))",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 54px rgba(0,0,0,0.36)",
};

const heroLeftStyle: CSSProperties = {
  minWidth: 0,
};

const heroRightStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  alignContent: "start",
};

const newsDeskTagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.28)",
  background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.08))",
  color: "#dbeafe",
  fontSize: 12,
  fontWeight: 950,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const heroMetricRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
  marginTop: 18,
};

const heroMetricStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
};

const heroMetricLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(191,219,254,0.86)",
};

const heroMetricValueStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 24,
  lineHeight: 1.08,
  fontWeight: 950,
  letterSpacing: "-0.04em",
  color: "#f8fafc",
};

const heroCtaRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  marginTop: 18,
};

const heroPrimaryCtaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 46,
  padding: "12px 16px",
  borderRadius: 14,
  border: "1px solid rgba(59,130,246,0.34)",
  background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
  color: "#dbeafe",
  textDecoration: "none",
  fontWeight: 900,
  fontSize: 13,
  letterSpacing: "0.04em",
};

const heroSecondaryCtaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 46,
  padding: "12px 16px",
  borderRadius: 14,
  border: "1px solid rgba(34,197,94,0.30)",
  background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
  color: "#dcfce7",
  textDecoration: "none",
  fontWeight: 900,
  fontSize: 13,
  letterSpacing: "0.04em",
};

const heroSubCopyStyle: CSSProperties = {
  marginTop: 10,
  fontSize: 13,
  lineHeight: 1.6,
  color: "rgba(241,245,249,0.62)",
};

function scorePanelStyle(tone: ScoreTone): CSSProperties {
  if (tone === "green") {
    return {
      border: "1px solid rgba(34,197,94,0.26)",
      borderRadius: 20,
      padding: 18,
      background: "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(7,16,12,0.96))",
    };
  }

  if (tone === "red") {
    return {
      border: "1px solid rgba(248,113,113,0.24)",
      borderRadius: 20,
      padding: 18,
      background: "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(18,10,10,0.96))",
    };
  }

  return {
    border: "1px solid rgba(250,204,21,0.24)",
    borderRadius: 20,
    padding: 18,
    background: "linear-gradient(135deg, rgba(250,204,21,0.14), rgba(18,16,8,0.96))",
  };
}

const scorePanelKickerStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 950,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.76)",
};

const scoreValueStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 42,
  lineHeight: 1,
  fontWeight: 950,
  letterSpacing: "-0.06em",
};

function scoreLabelStyle(tone: ScoreTone): CSSProperties {
  return {
    marginTop: 8,
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 11px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color:
      tone === "green"
        ? "#dcfce7"
        : tone === "red"
        ? "#fee2e2"
        : "#fef3c7",
    background:
      tone === "green"
        ? "rgba(34,197,94,0.18)"
        : tone === "red"
        ? "rgba(248,113,113,0.16)"
        : "rgba(250,204,21,0.14)",
    border:
      tone === "green"
        ? "1px solid rgba(34,197,94,0.28)"
        : tone === "red"
        ? "1px solid rgba(248,113,113,0.24)"
        : "1px solid rgba(250,204,21,0.22)",
  };
}

const scoreReasonStyle: CSSProperties = {
  margin: "12px 0 0 0",
  fontSize: 14,
  lineHeight: 1.7,
  color: "rgba(241,245,249,0.82)",
};

const miniScoreGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

function miniScoreCardStyle(tone: ScoreTone): CSSProperties {
  return {
    border:
      tone === "green"
        ? "1px solid rgba(34,197,94,0.22)"
        : tone === "red"
        ? "1px solid rgba(248,113,113,0.20)"
        : "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: 14,
    background: "rgba(255,255,255,0.03)",
  };
}

const miniScoreTitleStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(241,245,249,0.66)",
};

const miniScoreNumberStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 24,
  lineHeight: 1.05,
  fontWeight: 950,
  letterSpacing: "-0.04em",
};

const miniScoreLabelStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  color: "rgba(241,245,249,0.76)",
};

const newsGridStyle: CSSProperties = {};

const editorialCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 20,
  background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const featuredInsightShellStyle: CSSProperties = {
  border: "1px solid rgba(59,130,246,0.22)",
  borderRadius: 24,
  padding: 20,
  background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(7,12,22,0.96))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const sidebarCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const sectionEyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 950,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(147,197,253,0.82)",
};

const sectionTitleStyle: CSSProperties = {
  margin: "8px 0 0 0",
  fontSize: 28,
  lineHeight: 1.08,
  letterSpacing: "-0.04em",
};

const sectionTitleSmallStyle: CSSProperties = {
  margin: "8px 0 0 0",
  fontSize: 22,
  lineHeight: 1.12,
  letterSpacing: "-0.03em",
};

const bodyCopyStyle: CSSProperties = {
  margin: "14px 0 0 0",
  fontSize: 15,
  lineHeight: 1.72,
  color: "rgba(241,245,249,0.82)",
};

const newsLeadCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.028)",
};

const newsMetaRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const newsSourcePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(59,130,246,0.12)",
  border: "1px solid rgba(59,130,246,0.22)",
  color: "#dbeafe",
  fontSize: 12,
  fontWeight: 800,
};

const newsDateStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(241,245,249,0.58)",
};

const newsHeadlineStyle: CSSProperties = {
  margin: "12px 0 0 0",
  fontSize: 22,
  lineHeight: 1.32,
  letterSpacing: "-0.02em",
  color: "#f8fafc",
};

const newsSummaryStyle: CSSProperties = {
  margin: "10px 0 0 0",
  fontSize: 15,
  lineHeight: 1.72,
  color: "rgba(241,245,249,0.82)",
};

const readOriginalLinkStyle: CSSProperties = {
  display: "inline-flex",
  marginTop: 12,
  color: "#93c5fd",
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 800,
};

const compactFeedLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 850,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(241,245,249,0.56)",
};

const compactNewsRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "88px minmax(0, 1fr) 32px",
  gap: 12,
  alignItems: "start",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 14,
  padding: 12,
  background: "rgba(255,255,255,0.02)",
};

const compactSourceStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#dbeafe",
};

const compactDateStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  color: "rgba(241,245,249,0.56)",
};

const compactHeadlineStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.55,
  color: "rgba(241,245,249,0.84)",
};

const compactReadStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.22)",
  color: "#93c5fd",
  textDecoration: "none",
  fontWeight: 900,
};

function signalBoxStyle(tone: "green" | "red"): CSSProperties {
  return {
    border:
      tone === "green"
        ? "1px solid rgba(34,197,94,0.22)"
        : "1px solid rgba(248,113,113,0.20)",
    borderRadius: 14,
    padding: 12,
    background:
      tone === "green"
        ? "rgba(34,197,94,0.06)"
        : "rgba(248,113,113,0.05)",
  };
}

const signalBoxTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(241,245,249,0.8)",
};

const signalBoxItemStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  lineHeight: 1.55,
  color: "rgba(241,245,249,0.78)",
};

const signalBoxEmptyStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  lineHeight: 1.55,
  color: "rgba(241,245,249,0.58)",
};

const bulletRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "10px minmax(0, 1fr)",
  gap: 12,
  alignItems: "start",
};

const bulletDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  marginTop: 7,
  background: "linear-gradient(135deg, #60a5fa, #22c55e)",
  boxShadow: "0 0 0 4px rgba(59,130,246,0.10)",
};

const bulletTextStyle: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.7,
  color: "rgba(241,245,249,0.84)",
};

const midPageCtaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 42,
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(34,197,94,0.30)",
  background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
  color: "#dcfce7",
  textDecoration: "none",
  fontWeight: 900,
  fontSize: 13,
  letterSpacing: "0.04em",
};

function sideLinkStyle(tone: "blue" | "green" | "red"): CSSProperties {
  const tones = {
    blue: {
      border: "1px solid rgba(59,130,246,0.24)",
      background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.08))",
      color: "#dbeafe",
    },
    green: {
      border: "1px solid rgba(34,197,94,0.24)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(21,128,61,0.08))",
      color: "#dcfce7",
    },
    red: {
      border: "1px solid rgba(248,113,113,0.22)",
      background: "linear-gradient(135deg, rgba(248,113,113,0.14), rgba(185,28,28,0.08))",
      color: "#fee2e2",
    },
  } as const;

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    padding: "10px 14px",
    borderRadius: 12,
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 850,
    ...tones[tone],
  };
}

const bottomStripStyle: CSSProperties = {
  marginTop: 22,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 22,
  padding: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))",
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  alignItems: "center",
};

const bottomStripTitleStyle: CSSProperties = {
  fontSize: 22,
  lineHeight: 1.1,
  fontWeight: 900,
  letterSpacing: "-0.03em",
};

const bottomStripTextStyle: CSSProperties = {
  marginTop: 8,
  maxWidth: 760,
  fontSize: 14,
  lineHeight: 1.65,
  color: "rgba(241,245,249,0.76)",
};

const bottomStripActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
};

function bottomActionStyle(tone: "blue" | "green" | "red"): CSSProperties {
  return {
    ...sideLinkStyle(tone),
    borderRadius: 999,
    minHeight: 44,
    padding: "11px 15px",
  };
}

function topNavBtnStyle(type: "dashboard" | "blue" | "green" | "pickers"): CSSProperties {
  if (type === "dashboard") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 40,
      padding: "9px 13px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.04)",
      color: "#f8fafc",
      textDecoration: "none",
      fontSize: 13,
      fontWeight: 850,
      lineHeight: 1,
      whiteSpace: "nowrap",
    };
  }

  if (type === "blue") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 40,
      padding: "9px 13px",
      borderRadius: 999,
      border: "1px solid rgba(59,130,246,0.24)",
      background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.08))",
      color: "#dbeafe",
      textDecoration: "none",
      fontSize: 13,
      fontWeight: 850,
      lineHeight: 1,
      whiteSpace: "nowrap",
    };
  }

  if (type === "green") {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 40,
      padding: "9px 13px",
      borderRadius: 999,
      border: "1px solid rgba(34,197,94,0.22)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(21,128,61,0.08))",
      color: "#dcfce7",
      textDecoration: "none",
      fontSize: 13,
      fontWeight: 850,
      lineHeight: 1,
      whiteSpace: "nowrap",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 40,
    padding: "9px 13px",
    borderRadius: 999,
    border: "1px solid rgba(248,113,113,0.22)",
    background: "linear-gradient(135deg, rgba(248,113,113,0.14), rgba(185,28,28,0.08))",
    color: "#fee2e2",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 850,
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
}
