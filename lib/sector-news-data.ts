import { unstable_cache } from "next/cache";

import { getSectorBySlug, type SectorDef } from "@/lib/sectors";
import { getSectorConstituents, getSectorIndex } from "@/lib/server/sectorUniverse";
import { hasFmpCapacity, reserveFmpCallSlot } from "@/lib/server/historyCache";
import {
  cleanRssDescription,
  containsHtmlMarkup,
  dedupeNews,
  isActualEarningsResultNews,
  isEarningsExceptionSource,
  isEarningsNewsItem,
  isLowValueNewsItem,
  isMajorWireSource,
  isVideoOrLowQualitySource,
  mergeNewsPools,
  newestFirst,
  scoreEarnings,
  scoreNews,
  scoreNewsItem,
  scoreToEarningsLabel,
  scoreToNewsLabel,
  scoreToTone,
  stripHtmlTags,
  type EarningsScoreResult,
  type FmpStockNewsItem,
  type NewsItem,
  type NewsScoreResult,
} from "@/lib/news-scoring";

// ---------------------------------------------------------------------------
// Sector news: the per-stock news engine, pointed at a basket instead of a
// ticker.
//
// The scoring, filtering and feed-shaping are NOT reimplemented here -- they
// are imported from lib/news-scoring.ts, which re-exports the live
// implementations out of lib/stock-news-data.ts. Only the two genuinely
// symbol-bound steps are replaced:
//
//   1. THE FETCH. FMP's stock-news endpoint takes `symbols=` as a LIST; the
//      per-stock path just happens to pass one. So a sector feed is the same
//      endpoint called with the sector's largest constituents, chunked.
//   2. THE RELEVANCE GATE. rankNews() in the stock path spends most of its
//      effort proving an article is really about the requested company
//      (fmpSymbols match, then company-name text matching). Here that gate is
//      redundant by construction -- every article came back from a query for a
//      constituent -- so ranking is purely quality + recency.
//
// One further deliberate divergence, in limitPerDate() below: the stock feed
// collapses to ONE article per calendar date, because several same-day stories
// about one company are usually the same story. A sector feed aggregating 40
// companies has genuinely distinct same-day stories about different companies,
// so the sector cap is per-date AND per-company instead.
//
// COST. SECTOR_NEWS_SYMBOL_LIMIT / SECTOR_NEWS_CHUNK_SIZE = 2 FMP calls per
// sector per cache miss, and the cache holds for an hour: ~22 calls/hour across
// all 11 sectors, against a 300-calls-per-MINUTE ceiling. Every call still goes
// through reserveFmpCallSlot() so it shares the same guard as the crons rather
// than sitting outside the budget.
// ---------------------------------------------------------------------------

/** How many of the sector's largest names the feed is drawn from. */
const SECTOR_NEWS_SYMBOL_LIMIT = 40;
/** Symbols per FMP request. Keeps the URL short and the call count at 2. */
const SECTOR_NEWS_CHUNK_SIZE = 20;
/** Articles requested per chunk. */
const SECTOR_NEWS_LIMIT_PER_CHUNK = 100;
/** Leave room for the price-pool / history / earnings warmers. */
const FMP_MIN_HEADROOM_CALLS = 40;

const MAX_POOL_ITEMS = 120;
const MAX_DETAILED_ITEMS = 6;
const MAX_COMPACT_ITEMS = 10;
const MAX_ARTICLES_PER_DATE = 3;

export type SectorMention = {
  symbol: string;
  count: number;
};

export type SectorNewsBaseData = {
  slug: string;
  sectorName: string;
  /** Symbols the feed was built from, largest market cap first. */
  constituents: string[];
  news: NewsItem[];
  rankedNews: NewsItem[];
  detailedNews: NewsItem[];
  compactNews: NewsItem[];
  newsScore: NewsScoreResult;
  earningsScore: EarningsScoreResult;
  /** Most-mentioned constituents across the ranked feed, busiest first. */
  mentions: SectorMention[];
  /** True when FMP returned nothing usable for the whole basket. */
  isDataUnavailable: boolean;
  /** Universe classification counts, so the page can be honest about coverage. */
  coverage: { classified: number; total: number };
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Ticker symbols FMP attached to an article. Unlike the per-stock path's
 * extractFmpSymbols, this does NOT inject a requested symbol -- there isn't
 * one -- so the result is purely what upstream claimed the article is about.
 */
function extractSymbols(item: FmpStockNewsItem): string[] {
  const symbols = new Set<string>();

  const addValue = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(addValue);
      return;
    }

    if (typeof value !== "string") return;

    value
      .split(/[,.|\s]+/)
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean)
      .forEach((part) => symbols.add(part));
  };

  addValue(item.symbol);
  addValue(item.symbols);
  addValue(item.ticker);
  addValue(item.tickers);

  return [...symbols];
}

function mapFmpItem(item: FmpStockNewsItem, constituentSet: Set<string>): NewsItem | null {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const link =
    typeof item.url === "string" && item.url.trim()
      ? item.url.trim()
      : typeof item.link === "string"
        ? item.link.trim()
        : "";

  if (!title || !link) return null;
  if (containsHtmlMarkup(title)) return null;

  const fmpSymbols = extractSymbols(item);

  const descriptionSource =
    typeof item.text === "string" && item.text.trim()
      ? item.text
      : typeof item.content === "string" && item.content.trim()
        ? item.content
        : typeof item.description === "string"
          ? item.description
          : "";

  return {
    title: stripHtmlTags(title),
    link,
    pubDate:
      typeof item.publishedDate === "string" && item.publishedDate.trim()
        ? item.publishedDate
        : typeof item.date === "string" && item.date.trim()
          ? item.date
          : null,
    source:
      typeof item.site === "string" && item.site.trim()
        ? item.site.trim()
        : typeof item.publisher === "string" && item.publisher.trim()
          ? item.publisher.trim()
          : "FMP News",
    description: descriptionSource.trim()
      ? cleanRssDescription(descriptionSource.slice(0, 650))
      : null,
    image:
      typeof item.image === "string" && item.image.trim() ? item.image.trim() : null,
    fmpSymbols,
    fmpSymbolMatched: fmpSymbols.some((symbol) => constituentSet.has(symbol)),
  };
}

async function fetchFmpSectorNews(symbols: string[]): Promise<NewsItem[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || !symbols.length) return [];

  const key = encodeURIComponent(apiKey);
  const constituentSet = new Set(symbols);
  const pools: NewsItem[][] = [];

  for (const group of chunk(symbols, SECTOR_NEWS_CHUNK_SIZE)) {
    // Respect the same per-minute guard the crons use. If the budget is tight
    // right now, stop early and render with whatever came back rather than
    // queueing behind a warm run and blowing the request's time budget.
    try {
      if (!(await hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS))) break;
      await reserveFmpCallSlot();
    } catch {
      break;
    }

    const encoded = encodeURIComponent(group.join(","));
    const url = `https://financialmodelingprep.com/stable/news/stock?symbols=${encoded}&limit=${SECTOR_NEWS_LIMIT_PER_CHUNK}&apikey=${key}`;

    try {
      const res = await fetch(url, { next: { revalidate: 900 } });
      if (!res.ok) continue;

      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) continue;

      const items = data
        .map((row: FmpStockNewsItem) => mapFmpItem(row, constituentSet))
        .filter((row): row is NewsItem => Boolean(row))
        .filter((row) => !isVideoOrLowQualitySource(row));

      if (items.length) pools.push(items);
    } catch {
      continue;
    }
  }

  return mergeNewsPools(pools).slice(0, MAX_POOL_ITEMS);
}

/**
 * Quality-then-recency ranking with the per-company relevance gate removed
 * (see the header note). dedupeNews still collapses the same story reported by
 * several outlets, which matters far more here than on a single-ticker page --
 * a market-wide story gets covered once per constituent it mentions.
 */
function rankSectorNews(news: NewsItem[]): NewsItem[] {
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

function primarySymbol(item: NewsItem, constituentSet: Set<string>): string | null {
  for (const symbol of item.fmpSymbols ?? []) {
    if (constituentSet.has(symbol)) return symbol;
  }
  return null;
}

/**
 * The sector analogue of the stock feed's oneArticlePerDate. Allows several
 * stories per date -- 40 companies produce genuinely distinct same-day news --
 * but never two about the SAME company on the same date, which is where
 * duplicate-feeling coverage actually comes from. Actual earnings-result
 * headlines are exempt, matching the stock path's reasoning.
 */
function limitPerDate(
  items: NewsItem[],
  constituentSet: Set<string>,
  maxPerDate = MAX_ARTICLES_PER_DATE
): NewsItem[] {
  const perDate = new Map<string, number>();
  const seenDateSymbol = new Set<string>();
  const out: NewsItem[] = [];

  for (const item of items) {
    const dateKey = item.pubDate
      ? new Date(item.pubDate).toISOString().slice(0, 10)
      : "unknown";

    const isEarningsResult = isActualEarningsResultNews(item);
    const symbol = primarySymbol(item, constituentSet);
    const symbolKey = symbol ? `${dateKey}:${symbol}` : null;

    if (!isEarningsResult) {
      if ((perDate.get(dateKey) ?? 0) >= maxPerDate) continue;
      if (symbolKey && seenDateSymbol.has(symbolKey)) continue;
    }

    perDate.set(dateKey, (perDate.get(dateKey) ?? 0) + 1);
    if (symbolKey) seenDateSymbol.add(symbolKey);
    out.push(item);
  }

  return out;
}

function countMentions(items: NewsItem[], constituentSet: Set<string>): SectorMention[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    // Count each constituent once per article, not once per mention.
    const seen = new Set<string>();
    for (const symbol of item.fmpSymbols ?? []) {
      if (!constituentSet.has(symbol) || seen.has(symbol)) continue;
      seen.add(symbol);
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol))
    .slice(0, 8);
}

async function buildSectorNewsBaseData(sector: SectorDef): Promise<SectorNewsBaseData> {
  const [constituents, index] = await Promise.all([
    getSectorConstituents(sector.slug, SECTOR_NEWS_SYMBOL_LIMIT),
    getSectorIndex(),
  ]);

  const constituentSet = new Set(constituents);
  const news = await fetchFmpSectorNews(constituents);

  const rankedNews = rankSectorNews(news);
  const earningsNews = news.filter(isEarningsNewsItem);

  const keywordNewsScore = scoreNews(news);
  const keywordEarningsScore = scoreEarnings(earningsNews);

  const hasActualEarningsHeadlines = earningsNews.some((item) =>
    isActualEarningsResultNews(item)
  );

  const newsScoreValue = keywordNewsScore.score;
  const earningsScoreValue = hasActualEarningsHeadlines ? keywordEarningsScore.score : 50;

  const newsScore: NewsScoreResult = {
    ...keywordNewsScore,
    score: newsScoreValue,
    tone: scoreToTone(newsScoreValue),
    label: scoreToNewsLabel(newsScoreValue),
    reason: news.length
      ? keywordNewsScore.reason
      : `FMP did not return recent headlines for the largest ${sector.name} names.`,
  };

  const earningsScore: EarningsScoreResult = {
    ...keywordEarningsScore,
    score: earningsScoreValue,
    tone: scoreToTone(earningsScoreValue),
    label: hasActualEarningsHeadlines
      ? scoreToEarningsLabel(earningsScoreValue)
      : "No clear earnings read",
    reason: hasActualEarningsHeadlines
      ? keywordEarningsScore.reason
      : `There are no fresh earnings-result headlines across the largest ${sector.name} names right now.`,
  };

  // Feed shaping mirrors the stock path: high-value items only in the main
  // feed, gated to major wires plus genuine Benzinga/Zacks earnings results,
  // with everything else routed to the lighter feed.
  const displayPool = rankedNews.length ? rankedNews : dedupeNews(news);
  const highValueNews = displayPool.filter((item) => !isLowValueNewsItem(item));
  const fallbackNews = displayPool.filter((item) => isLowValueNewsItem(item));

  const mainFeedNews = highValueNews.filter(
    (item) =>
      isMajorWireSource(item) ||
      (isEarningsExceptionSource(item) && isActualEarningsResultNews(item))
  );

  let detailedNews = limitPerDate(newestFirst(mainFeedNews), constituentSet).slice(
    0,
    MAX_DETAILED_ITEMS
  );

  if (detailedNews.length < MAX_DETAILED_ITEMS) {
    const usedLinks = new Set(detailedNews.map((item) => item.link));
    const backfill = limitPerDate(
      newestFirst(highValueNews).filter((item) => !usedLinks.has(item.link)),
      constituentSet
    ).slice(0, MAX_DETAILED_ITEMS - detailedNews.length);

    detailedNews = [...detailedNews, ...backfill];
  }

  const compactPool = dedupeNews([
    ...highValueNews.filter(
      (item) => !detailedNews.some((picked) => picked.link === item.link)
    ),
    ...fallbackNews,
  ]);

  const compactNews = limitPerDate(newestFirst(compactPool), constituentSet).slice(
    0,
    MAX_COMPACT_ITEMS
  );

  return {
    slug: sector.slug,
    sectorName: sector.name,
    constituents,
    news,
    rankedNews,
    detailedNews,
    compactNews,
    newsScore,
    earningsScore,
    mentions: countMentions(rankedNews, constituentSet),
    isDataUnavailable: news.length === 0,
    coverage: { classified: index.classified, total: index.total },
  };
}

const getCachedSectorNewsBaseData = unstable_cache(
  async (slug: string) => {
    const sector = getSectorBySlug(slug);
    if (!sector) return null;
    return buildSectorNewsBaseData(sector);
  },
  ["msh-sector-news-base-data-v1"],
  { revalidate: 3600 }
);

export async function getSectorNewsBaseData(
  slug: string
): Promise<SectorNewsBaseData | null> {
  return getCachedSectorNewsBaseData(String(slug ?? "").trim().toLowerCase());
}
