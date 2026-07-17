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
  /**
   * Thumbnail image URL, when the upstream source provides one. FMP's
   * stock-news endpoint usually includes this; the Google News RSS fallback
   * does not, so this is null for those items.
   */
  image?: string | null;
  /**
   * Ticker symbols supplied by the upstream FMP stock-news endpoint.
   * These are used as the strongest relevance signal before falling back
   * to text/company-name matching.
   */
  fmpSymbols?: string[];
  /** True when the item came back from a symbol-specific FMP request. */
  fmpSymbolMatched?: boolean;
};

type FmpStockNewsItem = {
  symbol?: string;
  symbols?: string[] | string;
  ticker?: string;
  tickers?: string[] | string;
  publishedDate?: string;
  date?: string;
  publisher?: string;
  title?: string;
  image?: string;
  site?: string;
  text?: string;
  content?: string;
  description?: string;
  url?: string;
  link?: string;
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
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

// Some upstream sources (mainly the Google News RSS fallback used for
// thin-coverage / freshly-listed tickers) occasionally hand back a
// title/description that is itself a raw HTML snippet -- e.g.
// `<a href="...">Headline</a>&nbsp;<font color="#6f6f6f">Source</font>` --
// rather than plain text. Since titles/descriptions are rendered as plain
// React text (never dangerouslySetInnerHTML'd), any literal "<...>" that
// slips through shows up as visible, broken-looking markup on the page.
// stripHtmlTags is the one place that unwraps CDATA, strips tags, and
// collapses whitespace; both cleanRssDescription (below) and the title
// handling in parseRss/fetchFmpStockNews route through it so there's a
// single implementation to keep in sync.
function stripHtmlTags(value: string) {
  return decodeHtml(
    value
      .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// A legitimate headline never contains a literal HTML tag. When one does
// (see stripHtmlTags' comment above), that's a strong signal the whole item
// is a malformed auto-generated snippet rather than real editorial content
// -- better to drop it than show a "cleaned" but still nonsensical
// duplicate-of-itself headline.
function containsHtmlMarkup(value: string) {
  return /<[a-z][^>]*>/i.test(value);
}

function cleanRssDescription(value: string | null) {
  if (!value) return null;
  const cleaned = stripHtmlTags(value);
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

    if (title && link && !containsHtmlMarkup(title)) {
      items.push({
        title: stripHtmlTags(title.replace(/\s+-\s+Google News$/i, "").trim()),
        link: link.trim(),
        pubDate,
        source: source ? decodeHtml(source.trim()) : null,
        description: cleanRssDescription(description),
      });
    }
  }

  return items;
}

// Live quote: FMP is the primary source (same endpoint/key already used
// elsewhere on the site for metadata + company profile - reliable, and a
// real API key is configured). Stooq is the next fallback for when
// FMP_API_KEY is missing or the FMP call fails outright. Yahoo Finance's
// unofficial chart endpoint (no key required) is the final fallback -- it
// tends to pick up freshly-listed/thin-coverage tickers (new IPOs, SPAC
// units) days before Stooq does, so a ticker that would otherwise show
// "DATA UNAVAILABLE" right after listing often gets a real price/history
// from here instead.
//
// All three paths require price > 0, not just a finite number: Stooq's CSV
// feed is known to return a literal "0" (not "N/D"/blank) for some tickers
// instead of failing cleanly, which previously rendered as a real "$0.00"
// price on the page (formatMoney only shows "-" for null/undefined, not
// for an actual zero). Treating a non-positive price as "no data" avoids
// that class of bug regardless of which upstream returns it.
async function fetchQuote(symbol: string): Promise<Quote | null> {
  const fmpQuote = await fetchFmpQuote(symbol);
  if (fmpQuote) return fmpQuote;

  const stooqQuote = await fetchStooqQuote(symbol);
  if (stooqQuote) return stooqQuote;

  return fetchYahooQuote(symbol);
}

async function fetchFmpQuote(symbol: string): Promise<Quote | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      next: { revalidate: 60 },
      headers: { accept: "application/json" },
    });

    if (!res.ok) return null;

    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    const price = typeof row?.price === "number" && Number.isFinite(row.price) ? row.price : null;
    if (price == null || price <= 0) return null;

    const timestampMs = typeof row?.timestamp === "number" ? row.timestamp * 1000 : Date.now();
    const d = new Date(timestampMs);

    return {
      symbol,
      price,
      date: Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10),
      time: Number.isNaN(d.getTime()) ? null : d.toISOString().slice(11, 19),
      source: "FMP",
    };
  } catch {
    return null;
  }
}

async function fetchStooqQuote(symbol: string): Promise<Quote | null> {
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
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      symbol,
      price,
      date: row[1] ?? null,
      time: row[2] ?? null,
      source: "Stooq",
    };
  } catch {
    return null;
  }
}

// Yahoo Finance's unofficial "v8 chart" endpoint. No API key, widely used
// (it's what the `yfinance` Python library and many other unofficial
// integrations call under the hood). A realistic desktop-browser User-Agent
// avoids the occasional 429 Yahoo returns to bare/no-UA requests. Kept as
// the last-resort fallback (after FMP and Stooq) specifically because it
// tends to have quote/history for freshly-listed tickers sooner than Stooq
// does -- it's not more authoritative than FMP, just faster to pick up new
// listings including SPAC unit/warrant tickers.
const YAHOO_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "application/json",
};

async function fetchYahooChart(
  symbol: string,
  range: string
): Promise<any | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=${range}`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 60 },
      headers: YAHOO_FETCH_HEADERS,
    });

    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    return result ?? null;
  } catch {
    return null;
  }
}

async function fetchYahooQuote(symbol: string): Promise<Quote | null> {
  const result = await fetchYahooChart(symbol, "5d");
  if (!result) return null;

  const meta = result.meta ?? {};
  const price =
    typeof meta.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : null;
  if (price == null || price <= 0) return null;

  const timestampMs =
    typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : Date.now();
  const d = new Date(timestampMs);

  return {
    symbol,
    price,
    date: Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10),
    time: Number.isNaN(d.getTime()) ? null : d.toISOString().slice(11, 19),
    source: "Yahoo",
  };
}

// Daily history: Stooq first (existing behavior, unchanged), then Yahoo
// Finance's chart endpoint as a fallback for tickers Stooq has nothing for
// yet -- same freshly-listed-ticker rationale as fetchYahooQuote above.
async function fetchHistory(symbol: string): Promise<Point[]> {
  const stooqPoints = await fetchStooqHistory(symbol);
  if (stooqPoints.length) return stooqPoints;

  return fetchYahooHistory(symbol);
}

async function fetchStooqHistory(symbol: string): Promise<Point[]> {
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

      // Same zero-price guard as fetchStooqQuote above: a finite-but-zero
      // close from Stooq's daily feed would otherwise corrupt lastClose /
      // moving averages / RSI for this symbol.
      if (!date || !Number.isFinite(close) || close <= 0) continue;

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

async function fetchYahooHistory(symbol: string): Promise<Point[]> {
  const result = await fetchYahooChart(symbol, "2y");
  if (!result) return [];

  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const closes: (number | null)[] = Array.isArray(quote.close) ? quote.close : [];
  const highs: (number | null)[] = Array.isArray(quote.high) ? quote.high : [];
  const lows: (number | null)[] = Array.isArray(quote.low) ? quote.low : [];
  const volumes: (number | null)[] = Array.isArray(quote.volume) ? quote.volume : [];

  const points: Point[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const close = closes[i];

    if (typeof ts !== "number" || typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
      continue;
    }

    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    const high = highs[i];
    const low = lows[i];
    const volume = volumes[i];

    points.push({
      date,
      close,
      high: typeof high === "number" && Number.isFinite(high) ? high : undefined,
      low: typeof low === "number" && Number.isFinite(low) ? low : undefined,
      volume: typeof volume === "number" && Number.isFinite(volume) ? volume : undefined,
    });
  }

  return points.slice(-320);
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

function extractFmpSymbols(item: FmpStockNewsItem, requestedSymbol: string): string[] {
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

  // The FMP request itself is symbol-specific. Some FMP responses include the
  // symbol field, some do not. Keep the requested symbol as a trusted upstream
  // relevance signal so display cards do not disappear after text filtering.
  addValue(requestedSymbol);

  return [...symbols];
}

function articleMatchesRequestedSymbol(item: NewsItem, symbol: string) {
  const target = symbol.trim().toUpperCase();
  if (!target) return false;

  if (item.fmpSymbolMatched) return true;

  return (item.fmpSymbols ?? [])
    .map((value) => String(value).trim().toUpperCase())
    .some((value) => value === target);
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
          const link =
            typeof item.url === "string" && item.url.trim()
              ? item.url.trim()
              : typeof item.link === "string"
                ? item.link.trim()
                : "";

          if (!title || !link) return null;
          if (containsHtmlMarkup(title)) return null;

          const fmpSymbols = extractFmpSymbols(item, symbol);
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
              typeof item.image === "string" && item.image.trim()
                ? item.image.trim()
                : null,
            fmpSymbols,
            fmpSymbolMatched: fmpSymbols.includes(symbol.toUpperCase()),
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

/**
 * Fallback source used only when FMP has nothing for a symbol (missing
 * FMP_API_KEY, or thin coverage on a small/obscure ticker). FMP is the
 * site's paid primary data source and is preferred because, unlike this
 * Google News RSS feed, it returns article thumbnail images.
 */
async function fetchGoogleNewsFallback(
  symbol: string,
  companyName: string
): Promise<NewsItem[]> {
  const baseQuery = companyName ? `${companyName} ${symbol} stock` : `${symbol} stock`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    baseQuery
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
}

async function fetchNews(symbol: string, companyName: string): Promise<NewsItem[]> {
  const fmpNews = await fetchFmpStockNews(symbol);
  const filteredFmp = fmpNews.filter((item) => !isVideoOrLowQualitySource(item));

  if (filteredFmp.length) {
    return mergeNewsPools([filteredFmp]).slice(0, 50);
  }

  // FMP returned nothing usable for this symbol — fall back to Google News
  // RSS so the page still shows headlines. These items will have no image.
  const googleNews = await fetchGoogleNewsFallback(symbol, companyName);

  return mergeNewsPools([
    googleNews.filter((item) => !isVideoOrLowQualitySource(item)),
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

async function fetchEarningsNews(symbol: string, _companyName: string): Promise<NewsItem[]> {
  const fmpNews = await fetchFmpStockNews(symbol);

  return mergeNewsPools([
    fmpNews
      .filter((item) => !isVideoOrLowQualitySource(item))
      .filter(isEarningsNewsItem),
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
  if (articleMatchesRequestedSymbol(item, symbol)) {
    return true;
  }

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

  if (cleanedCompany && cleanedCompany.length >= 4 && text.includes(cleanedCompany)) {
    return true;
  }

  if (companyWords.length >= 2 && companyWords.every((word) => text.includes(word))) {
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
    // Google News RSS occasionally attributes thin-coverage tickers'
    // auto-generated search-result snippets (stock-quote-page titles, not
    // real editorial articles) to "TradingView" as the source.
    "tradingview",
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
  const symbolConfirmedNews = symbol
    ? news.filter((item) => articleMatchesRequestedSymbol(item, symbol))
    : [];

  const textRelevantNews =
    symbol && companyName
      ? news.filter((item) => isClearlyAboutRequestedCompany(item, symbol, companyName))
      : news;

  const relevantNews = symbolConfirmedNews.length
    ? symbolConfirmedNews
    : textRelevantNews.length
      ? textRelevantNews
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

  const displayNewsPool = rankedNews.length ? rankedNews : dedupeNews(news);
  const highValueNews = displayNewsPool.filter((item) => !isLowValueNewsItem(item));
  const fallbackNews = displayNewsPool.filter((item) => isLowValueNewsItem(item));

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
  ["msh-stock-news-base-data-v25-yahoo-fallback"],
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
