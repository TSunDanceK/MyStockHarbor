import { keywordHits } from "@/lib/keywordMatch";
import { readOrRefreshSymbolNews } from "@/lib/server/newsStore";
import { unstable_cache } from "next/cache";
import { fmpFetch } from "@/lib/server/fmpUsage";
import { beginTiming } from "./server/timing";
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
  /**
   * Position in the raw upstream response, before any filtering or ranking.
   *
   * MEASUREMENT ONLY, and the reason it has to be stamped rather than inferred:
   * every stage between the fetch and the render filters, dedupes and re-sorts,
   * so by the time an item is displayed its position tells you nothing about how
   * deep into the fetched list it came from. That depth is the ONLY thing that
   * says whether `limit=50` is buying anything -- see logNewsDepth.
   */
  sourceIndex?: number;
};

export type FmpStockNewsItem = {
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

export type ScoreTone = "green" | "yellow" | "red";

export type NewsScoreResult = {
  // `available` is false when there was nothing to score, not when the score
  // came out neutral. Both cases previously returned 50/"Neutral", so a stock
  // with no usable headlines rendered a full sentiment gauge with the needle at
  // dead centre -- a specific reading derived from no input. Consumers should
  // branch on this flag rather than sniffing label === "Neutral", which is also
  // a real result.
  available: boolean;
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
  // null when the trend could not be established (see trendLabel below).
  trend: string | null;
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
export function stripHtmlTags(value: string) {
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
export function containsHtmlMarkup(value: string) {
  return /<[a-z][^>]*>/i.test(value);
}

export function cleanRssDescription(value: string | null) {
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
    const res = await fmpFetch(url, {
      next: { revalidate: 3600 },
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
      next: { revalidate: 3600 },
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
      next: { revalidate: 3600 },
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

/**
 * How many articles a raw FMP news response holds, and how they are spread
 * across days.
 *
 * WHAT THIS DECIDES. `limit=50` has been an open question all day, argued from
 * arithmetic rather than data: 50 articles fetched to display 15 looks like
 * obvious waste and may not be, because dedup collapses the same story reported
 * by several outlets and a busy ticker can burn 20 of those 50 on one morning.
 * The number that settles it is how many DAYS a 50-article response actually
 * spans. If a response reliably covers a week or more, 50 is buying a complete
 * window and a headline count derived from it is EXACT. If it saturates -- 50
 * articles inside two days -- then the window is truncated and any count derived
 * from it is a FLOOR that must read "50+ in N days", never a total.
 *
 * Free. Every figure here is already in a payload that has been fetched and
 * parsed; this adds no FMP call and no second request.
 *
 * MEASURED ON THE RAW RESPONSE, before any of our filtering. The question is
 * what FMP returns for a given `limit`, not what survives isLowValueNewsItem --
 * filtering first would measure our own rules and attribute the result to FMP
 * (claude/traps/measuring-the-wrong-layer.md).
 *
 * ORDERING IS TESTED, NOT ASSUMED. The whole "truncation happens at the old
 * end, so recent days are complete" argument rests on FMP returning
 * newest-first. Comparing the first and last rows does not establish that: a
 * shuffled array whose extremes happen to fall in order passes that test. Every
 * adjacent pair is checked, and the count of inversions is reported so a
 * partially-ordered response is distinguishable from a sorted one and from a
 * random one. If `monotonic=false` shows up in the logs, the analysis above does
 * not hold and the limit question reopens on different terms.
 */
export function logResponseWindow(label: string, symbol: string, rows: unknown[], limit: number): void {
  const dates: { key: string; t: number }[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const raw = String(r?.publishedDate ?? r?.date ?? "").trim();
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) continue;
    dates.push({ key: new Date(t).toISOString().slice(0, 10), t });
  }

  if (!dates.length) {
    console.log(`[news-window] ${label} ${symbol} rows=${rows.length} dated=0 — no usable dates`);
    return;
  }

  // Per-day counts, in calendar order so the shape is readable at a glance.
  const perDay = new Map<string, number>();
  for (const d of dates) perDay.set(d.key, (perDay.get(d.key) ?? 0) + 1);
  const days = [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  // Every adjacent pair, not the endpoints. See the note above.
  let inversions = 0;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].t > dates[i - 1].t) inversions += 1;
  }

  const spanDays = days.length;
  const maxDay = Math.max(...days.map(([, n]) => n));
  // Saturated = FMP gave us everything it was asked for, so there is very
  // likely more it did not send. `rows === limit` is the signal; a short
  // response means the ticker simply has no more.
  const saturated = rows.length >= limit;

  console.log(
    `[news-window] ${label} ${symbol} rows=${rows.length}/${limit}` +
      ` saturated=${saturated} distinctDays=${spanDays} maxPerDay=${maxDay}` +
      ` monotonic=${inversions === 0} inversions=${inversions}` +
      ` oldest=${days[days.length - 1][0]} newest=${days[0][0]}` +
      ` perDay=[${days.map(([d, n]) => `${d}:${n}`).join(",")}]`
  );
}

/**
 * The `limit` a single /news/stock window asks for.
 *
 * 15, DOWN FROM 50, AND ONLY SAFE BECAUSE THE STORE EXISTS. The old comment
 * below was right that cutting this on its own would lose content: with nothing
 * persisted, one request's limit WAS the entire depth available to the page.
 * Now the store accumulates up to NEWS_STORE_CAP across refreshes, so depth is
 * a property of the store rather than of any one call, and the request only has
 * to cover what is new since the last one.
 */
const FMP_NEWS_LIMIT = 15;

/**
 * The page-facing read: Redis first, FMP only when the store is cold or due.
 *
 * A RENDER MAKES NO FMP CALL inside the refresh window, which is the point.
 * Population is lazy -- first view of a symbol populates it, later views read
 * the store, and a symbol nobody views costs nothing. There is deliberately no
 * cron behind this: warming 755 symbols of news hourly would dwarf every other
 * consumer on the account.
 *
 * The store is given the pieces it must not own. The #343 similarity dedup and
 * the earnings matcher live here and are shared with the sector feed and the
 * scoring path, so they are passed in rather than reimplemented -- one
 * implementation of a rule, not two that can disagree.
 */
async function fetchFmpStockNews(symbol: string): Promise<NewsItem[]> {
  const { items } = await readOrRefreshSymbolNews<NewsItem>(symbol, {
    fetchWindow: (from) => fetchFmpStockNewsWindow(symbol, from),
    dedupe: dedupeNews,
    // The earnings pin. Once an article qualifies it survives eviction until a
    // newer qualifying one replaces it, or 7 days pass -- which is the part
    // only persistence makes possible. Today an earnings article vanishes the
    // moment it leaves FMP's latest-N window regardless of relevance.
    isEarnings: isEarningsNewsItem,
  });

  return items;
}

/**
 * One /news/stock window. `from` null means a cold start -- the endpoint's
 * default window, because there is nothing stored to anchor an overlap to.
 *
 * Verified 2026-08-22 that `from=` actually filters rather than being silently
 * ignored: from=2026-08-21 returned nothing older than 2026-08-21T03:05:00Z,
 * where the same request without it reached back to 2026-08-19T11:45:00Z. That
 * gate is the assumption the whole stored-news design rests on.
 *
 * Note the per-article cost is unchanged -- `from=` compresses nothing. The
 * saving comes entirely from not re-fetching articles already held, which is
 * only a saving once they are persisted.
 */
async function fetchFmpStockNewsWindow(
  symbol: string,
  from: string | null
): Promise<NewsItem[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  const encoded = encodeURIComponent(symbol.toUpperCase());
  const key = encodeURIComponent(apiKey);

  const fromParam = from ? `&from=${encodeURIComponent(from)}` : "";

  const endpoints = [
    `https://financialmodelingprep.com/stable/news/stock?symbols=${encoded}&limit=${FMP_NEWS_LIMIT}${fromParam}&apikey=${key}`,
    `https://financialmodelingprep.com/api/v3/stock_news?tickers=${encoded}&limit=${FMP_NEWS_LIMIT}&apikey=${key}`,
  ];

  for (const url of endpoints) {
    try {
      // The Data Cache is now the SECOND gate, not the first. newsStore decides
      // whether a refresh happens at all; this only bounds how stale an
      // individual window may be if one does. Left at 3600 rather than switched
      // to no-store deliberately -- `cache: "no-store"` opts the calling route
      // out of static rendering entirely, which is the bailout documented at
      // the FMP history call site, and it would buy nothing here because the
      // `from` value changes every refresh so consecutive windows never share a
      // cache key anyway.
      const res = await fmpFetch(url, {
        next: { revalidate: 3600 },
      });

      if (!res.ok) continue;

      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) continue;

      // Before any filtering. See logResponseWindow.
      logResponseWindow("stock", symbol.toUpperCase(), data, FMP_NEWS_LIMIT);

      const items = data
        .map((item: FmpStockNewsItem, index: number): NewsItem | null => {
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
            // Stamped here, at the only point where the upstream ordering is
            // still intact.
            sourceIndex: index,
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

export function isVideoOrLowQualitySource(item: NewsItem) {
  // THE IMAGE URL IS PART OF THE EVIDENCE, and leaving it out was a real miss.
  // Reported live: a Motley Fool podcast held the third lead card on
  // /stock/MU/news because the only place the word "Podcast" appeared was the
  // article's IMAGE -- source, link and title were all clean. A filter that
  // reads three of the four fields carrying the signal reads as "this is not a
  // podcast" rather than "I did not look there"
  // (claude/traps/measuring-the-wrong-layer.md).
  //
  // The cost, stated rather than discovered: a written article whose thumbnail
  // happens to sit at a .../podcast-... path is now filtered too. That is the
  // right side to err on for a lead card, and it is a small set.
  const combined = `${item.source ?? ""} ${item.link} ${item.title} ${item.image ?? ""}`.toLowerCase();

  // Substring, NOT keywordHits, and deliberately so. These are URL fragments,
  // not English words: "youtube.com" and "podcasts.apple.com" have no useful
  // word boundaries around them, and boundary-matching would stop catching
  // both. keywordHits is for prose; this is for hosts and paths.
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

export function isEarningsNewsItem(item: NewsItem) {
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

/**
 * How deep into the fetched list the surviving items actually came from.
 *
 * THIS EXISTS TO STOP A GUESS BEING ACTED ON. `limit=50` on
 * /stable/news/stock is the single largest line on the FMP byte meter, and the
 * obvious saving is to lower it. Obvious and unmeasured: nobody knows whether
 * the earnings items that get displayed sit at indices 0-5 (in which case 50 is
 * 45 wasted articles) or are scattered out to index 47 (in which case cutting
 * the limit empties the section on exactly the symbols with the least
 * coverage). The arithmetic reads the same either way, which is what makes it
 * dangerous (claude/traps/measuring-the-wrong-layer.md).
 *
 * `maxIndex` is the number that decides it: it is the smallest `limit` that
 * would have produced the same output for this symbol on this run.
 *
 * A LOG LINE, NOT A HEALTH SIGNAL, and the difference matters here. This is a
 * one-off measurement taken to settle one decision, not something that needs
 * reading back later -- so it does not belong in Redis beside the byte meter.
 * If it turns out to be hard to catch in the log window, that is the moment to
 * move it, not before.
 */
function logNewsDepth(label: string, symbol: string, fetched: number, kept: NewsItem[]): void {
  const indices = kept
    .map((item) => item.sourceIndex)
    .filter((i): i is number => typeof i === "number")
    .sort((a, b) => a - b);
  console.log(
    `[news-depth] ${label} ${symbol} fetched=${fetched} kept=${kept.length}` +
      ` maxIndex=${indices.length ? indices[indices.length - 1] : "none"}` +
      ` indices=[${indices.join(",")}]`
  );
}

async function fetchEarningsNews(symbol: string, _companyName: string): Promise<NewsItem[]> {
  const fmpNews = await fetchFmpStockNews(symbol);

  const kept = mergeNewsPools([
    fmpNews
      .filter((item) => !isVideoOrLowQualitySource(item))
      .filter(isEarningsNewsItem),
  ]).slice(0, 30);

  // Measured BEFORE anything is changed about `limit`. Note this reading only
  // becomes meaningful once the word-boundary matcher is deployed -- against the
  // old substring matcher the "earnings" items included every story containing
  // "headquartered", so the depth it reported was the depth of a false positive
  // rate, not of real earnings coverage.
  logNewsDepth("earnings", symbol, fmpNews.length, kept);

  return kept;
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

export function mergeNewsPools(pools: NewsItem[][]): NewsItem[] {
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
    return "Mixed / range";
  }

  // Not determinable: a stock under ~200 bars has no MA200, so none of the five
  // states above can be established. "Mixed / range" is one of those five real
  // states and must not double as the value returned when nothing was measured.
  return null;
}

// The word-boundary matcher, in lib/keywordMatch.ts. Re-exported here because
// lib/news-scoring.ts and a dozen call sites already import it from this
// module; the implementation moved, the import surface did not.
export { keywordHits };

// Benzinga and Zacks publish a lot of low-value SEO content ("stock price
// today", "price prediction"), but they are also two of the most prolific
// real earnings-result wire sources (e.g. "PLTR Q2 Earnings: Beats
// Estimates"). isLowValueNewsItem and the main-feed source gate both need
// to recognize this same pair of sources, so it's a shared constant rather
// than two independent literal arrays that could drift out of sync.
const EARNINGS_EXCEPTION_SOURCES = ["benzinga", "zacks"];

export function isEarningsExceptionSource(item: NewsItem) {
  const source = (item.source ?? "").toLowerCase();
  return EARNINGS_EXCEPTION_SOURCES.some((entry) => source.includes(entry));
}

export function isLowValueNewsItem(item: NewsItem) {
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
    "marketbeat",
    "defense world",
    "ticker report",
    "best stocks",
    // Google News RSS occasionally attributes thin-coverage tickers'
    // auto-generated search-result snippets (stock-quote-page titles, not
    // real editorial articles) to "TradingView" as the source.
    "tradingview",
  ];

  // A blanket source block was silently dropping genuine earnings coverage
  // from Benzinga/Zacks. Only treat them as low value when the headline
  // isn't an actual earnings result -- see EARNINGS_EXCEPTION_SOURCES above.
  if (keywordHits(title, lowValuePatterns)) return true;
  if (lowValueSources.some((entry) => source.includes(entry))) return true;
  if (isEarningsExceptionSource(item) && !isActualEarningsResultNews(item)) {
    return true;
  }

  return false;
}

// Small set of top-tier wire sources (matches the highest-quality tier
// scoreNewsItem already recognizes) that, together with FMP's own
// unattributed items, are allowed to compete for the "What's happening"
// main feed slots. FMP's stock-news endpoint aggregates dozens of smaller
// aggregator/opinion-blog publishers (Motley Fool, 247wallst, Investorplace,
// Finbold, non-earnings Zacks/Benzinga, etc.); when several of them cover
// the same theme at once it reads as duplicate coverage even though each
// headline is technically distinct. Those are routed to the lighter feed
// instead, alongside older items -- see mainFeedNews below.
/**
 * Publisher tiers, in one table, matched on WORD BOUNDARIES.
 *
 * TWO BUGS LIVED IN THE TWO COPIES THIS REPLACES.
 *
 * 1. THE LIST WAS TOO SHORT, and the gate and the scorer disagreed about it.
 *    isMajorWireSource accepted only reuters/bloomberg/ap, so CNBC, the WSJ,
 *    the FT, Barron's, MarketWatch, Dow Jones, Business Wire and PR Newswire
 *    were all excluded from the lead feed -- while scoreNewsItem, ten lines
 *    away in the same file, already scored several of them as second-tier
 *    quality. The same file rated CNBC highly and then refused to lead with it.
 *    Confirmed live on /stock/MU/news: all three lead cards were fool.com while
 *    a CNBC interview sat in the lighter feed.
 *
 * 2. THE MATCH WAS A SUBSTRING, which is the keywordHits bug again in a
 *    different file. `source.includes("ap")` makes capital.com and AppleInsider
 *    major wires; `source.includes("ft")` makes Microsoft, software and draft
 *    ones too. Two-letter publisher codes cannot be matched by substring, and
 *    "ap" and "ft" are both real, correct entries -- so the fix is the matcher,
 *    not the list.
 */
const WIRE_TIERS: Array<{ score: number; names: string[] }> = [
  // Top-tier wires. Dow Jones and Associated Press spelled out alongside their
  // codes, because FMP attributes both ways.
  { score: 8, names: ["reuters", "bloomberg", "ap", "associated press", "dow jones"] },
  // The publishers that actually carry market news. These were the ones missing
  // from the gate entirely.
  {
    score: 5,
    names: [
      "cnbc",
      "wsj",
      "wall street journal",
      "ft",
      "financial times",
      "barron's",
      "barrons",
      "marketwatch",
      "market watch",
      "business wire",
      "businesswire",
      "pr newswire",
      "prnewswire",
      "globenewswire",
    ],
  },
  { score: 2, names: ["yahoo"] },
];

const wireCache = new Map<string, RegExp>();

function sourceMatches(source: string, name: string): boolean {
  let re = wireCache.get(name);
  if (!re) {
    // No inflection allowance, unlike keywordHits: a publisher name is a proper
    // noun, and "aps"/"aped" are not variants of "AP".
    re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    wireCache.set(name, re);
  }
  return re.test(source);
}

/** The publisher tier score for a source string, or 0 if it is in no tier. */
export function sourceTierScore(source: string): number {
  for (const tier of WIRE_TIERS) {
    if (tier.names.some((name) => sourceMatches(source, name))) return tier.score;
  }
  return 0;
}

/**
 * Is this item from a publisher good enough to lead with?
 *
 * Tier 5 and above -- the top wires plus the market-news publishers. Tier 2
 * (Yahoo, an aggregator) is deliberately below the bar: it scores as better
 * than nothing without being lead material.
 */
export function isMajorWireSource(item: NewsItem) {
  const source = (item.source ?? "").toLowerCase();

  // FMP's own generic label when the underlying item has no specific
  // publisher attached -- treat it the same as a major wire rather than
  // routing it to the lighter feed by default.
  if (source === "fmp news") return true;

  return sourceTierScore(source) >= 5;
}

export function scoreNewsItem(item: NewsItem) {
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

  // The same tier table the lead-feed gate uses. It was two separate lists that
  // disagreed: this one already rated CNBC/MarketWatch/Barron's/WSJ/FT as
  // second tier while isMajorWireSource excluded them from the feed outright.
  score += sourceTierScore(source);

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

/**
 * The meaningful words of a headline, as a set.
 *
 * REPLACES A CURATED THEME-WORD LIST. storySignature used to keep only words
 * appearing in a hardcoded list of ~25 themes ("chip", "ai", "earnings",
 * "musk", ...) and treat two items sharing two of them as the same story. That
 * is the same maintenance-forever problem as the publisher allowlist, and it
 * deduped badly in both directions: two unrelated stories that both said "ai"
 * and "chip" collapsed into one, while two reports of the SAME story collapsed
 * only if their shared words happened to be on the list.
 *
 * Token overlap needs no list. It compares what the headlines actually say.
 */
function titleTokens(item: NewsItem): Set<string> {
  return new Set(
    normaliseTitleForDedupe(item.title)
      .split(" ")
      .filter((word) => word.length > 2)
  );
}

/**
 * Overlap coefficient: shared tokens over the SMALLER set.
 *
 * Not Jaccard, deliberately. Wire services and aggregators run the same story
 * at wildly different headline lengths ("Micron beats on revenue" vs "Micron
 * Technology tops Q3 revenue estimates as memory demand accelerates, shares
 * rise"), and Jaccard punishes that difference as if it were a difference in
 * subject. Dividing by the smaller set asks "is the shorter headline contained
 * in the longer one", which is the question.
 */
function titleOverlap(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  if (!smaller.size) return 0;
  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared += 1;
  return shared / smaller.size;
}

/**
 * Two headlines are the same story at this much overlap.
 *
 * 0.6 by eyeball, and it is meant to stay eyeball-able: at 0.6 a four-word
 * shared core out of a six-word headline is a duplicate, and two genuinely
 * different stories about the same company on the same day are not. Raise it if
 * real duplicates get through; lower it if distinct stories vanish.
 */
const STORY_OVERLAP_THRESHOLD = 0.6;

/**
 * Drop repeats of the same story, keeping the first occurrence.
 *
 * Callers pass items in the order they want preferred -- newest first, or
 * highest-scoring first -- and the first of a duplicate group wins. That makes
 * "drop the weaker duplicate" a property of the caller's sort rather than a
 * second ranking rule hidden in here.
 *
 * O(n * kept) with kept bounded by the pools this runs on (<= ~120). Compared
 * against every kept item rather than a hash bucket, because near-duplicates by
 * definition do not share a key.
 */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seenLinks = new Set<string>();
  const deduped: NewsItem[] = [];
  const keptTokens: Set<string>[] = [];

  for (const item of items) {
    const linkKey = item.link.trim();
    if (!linkKey || seenLinks.has(linkKey)) continue;

    const tokens = titleTokens(item);
    // A headline with nothing left after normalisation cannot be compared, so
    // it is kept rather than silently dropped -- the link check already stops
    // exact repeats.
    if (tokens.size && keptTokens.some((kept) => titleOverlap(tokens, kept) >= STORY_OVERLAP_THRESHOLD)) {
      continue;
    }

    seenLinks.add(linkKey);
    keptTokens.push(tokens);
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

/**
 * How recent a headline has to be to count toward the news tone.
 *
 * THE SCORE HAD NO TIME WINDOW AT ALL. scoreNews took `.slice(0, 5)` of
 * rankNews output, and rankNews sorts by scoreNewsItem with date only as a
 * TIEBREAK -- so the five headlines being scored were the most dramatic ever
 * returned for the ticker, not the most recent. A six-month-old headline could
 * take the 1.35x first-position weight, and did. Meanwhile the page says the
 * tone reads "right now".
 *
 * 14 days is the starting value, chosen to be short enough that "right now" is
 * true and long enough that a normal ticker clears the minimum. It is a
 * constant rather than a literal so moving it is one edit and one number to
 * argue about.
 */
const NEWS_SCORE_WINDOW_DAYS = 14;
/**
 * How far back the FEED will walk to fill its slots. Separate from the SCORE's
 * window on purpose, and much longer: a headline from six weeks ago is still
 * worth reading and is not evidence of what the tone is right now.
 *
 * 90 days is a floor, not a target. Past a quarter a card claiming to be part of
 * the current picture is from a different one, and a short feed on a thin ticker
 * is the honest outcome.
 */
const NEWS_FEED_MAX_AGE_DAYS = 90;
/** Lighter feed size, below the large cards. */
const MAX_COMPACT_NEWS_ITEMS = 10;
/**
 * Below this many in-window headlines, the honest answer is that there is not
 * enough recent coverage -- NOT a score built by reaching further back. Reaching
 * back is what produced "High confidence" on five emotive articles from last
 * spring while a page with genuinely fresh news read "Low".
 */
const NEWS_SCORE_MIN_ITEMS = 3;
/** How many of the in-window headlines are scored, most recent first. */
const NEWS_SCORE_MAX_ITEMS = 8;

/**
 * Recency weight: 1.0 for something published now, decaying linearly to 0.35 at
 * the window edge.
 *
 * REPLACES POSITION WEIGHT. The old weights (1.35 / 1.18 / 1.02 / 0.9) keyed off
 * an item's index in a list sorted by dramatic-ness, so the loudest headline got
 * the biggest multiplier regardless of when it was published. Weighting by age
 * means the multiplier answers the question the label claims to answer.
 *
 * The 0.35 floor is deliberate: a 13-day-old headline still counts, just less.
 * A weight decaying to zero would make the window edge a cliff, where one day's
 * drift swings the score.
 */
function recencyWeight(pubDate: string | null, nowMs: number): number {
  if (!pubDate) return 0;
  const t = new Date(pubDate).getTime();
  if (!Number.isFinite(t)) return 0;
  const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
  if (ageDays > NEWS_SCORE_WINDOW_DAYS) return 0;
  return 0.35 + 0.65 * (1 - ageDays / NEWS_SCORE_WINDOW_DAYS);
}

export function scoreNews(news: NewsItem[], nowMs = Date.now()): NewsScoreResult {
  if (!news.length) {
    return {
      available: false,
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
  const pool = highValue.length ? highValue : ranked;

  // THE WINDOW, applied before anything else. An item with no publish date is
  // excluded rather than assumed recent: it cannot be SHOWN to be inside the
  // window, and assuming it is would reintroduce exactly the bug this fixes
  // (claude/traps/absence-needs-the-producer-to-have-run.md).
  const inWindow = pool.filter((item) => recencyWeight(item.pubDate, nowMs) > 0);

  if (inWindow.length < NEWS_SCORE_MIN_ITEMS) {
    return {
      available: false,
      score: 50,
      tone: "yellow",
      label: "Neutral",
      reason:
        `Only ${inWindow.length} of ${pool.length} usable headline${pool.length === 1 ? "" : "s"} ` +
        `${inWindow.length === 1 ? "was" : "were"} published in the last ${NEWS_SCORE_WINDOW_DAYS} days, ` +
        `which is not enough recent coverage to read a current tone from.`,
      positives: [],
      negatives: [],
      confidence: "Low",
    };
  }

  // MOST RECENT FIRST, not most dramatic first. This is the other half of the
  // fix: the window decides what is eligible, and recency decides which of the
  // eligible ones are actually read.
  const candidates = [...inWindow]
    .sort((a, b) => {
      const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, NEWS_SCORE_MAX_ITEMS);

  const positiveTitles: string[] = [];
  const negativeTitles: string[] = [];

  let weightedSum = 0;
  let totalWeight = 0;
  let signalCount = 0;

  for (const item of candidates) {
    const title = item.title.toLowerCase();

    // Age, not rank. See recencyWeight.
    const weight = recencyWeight(item.pubDate, nowMs);
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

    weightedSum += itemScore * weight;
    totalWeight += weight;
  }

  if (!totalWeight) {
    return {
      available: false,
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

  // CONFIDENCE IS ABOUT COVERAGE, NOT DRAMA. It used to count signalCount --
  // how many of the scored headlines tripped a keyword hard enough to register
  // as positive or negative -- so five emotive articles from last spring read
  // "High" while a ticker with genuinely fresh but measured coverage read
  // "Low". It now reports how much RECENT coverage there is, which is what a
  // reader takes it to mean.
  const confidence: "Low" | "Medium" | "High" =
    inWindow.length >= 8 ? "High" : inWindow.length >= 5 ? "Medium" : "Low";

  const windowNote = ` Based on ${candidates.length} of ${inWindow.length} headline${inWindow.length === 1 ? "" : "s"} from the last ${NEWS_SCORE_WINDOW_DAYS} days.`;

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
    available: true,
    score,
    tone,
    label,
    // The window is stated in the reason rather than left implicit. A tone that
    // claims to read "right now" should say what "now" it means.
    reason: reason + windowNote,
    positives: positiveTitles.slice(0, 3),
    negatives: negativeTitles.slice(0, 3),
    confidence,
  };
}


export function scoreToTone(score: number): ScoreTone {
  if (score >= 58) return "green";
  if (score <= 42) return "red";
  return "yellow";
}

export function scoreToNewsLabel(score: number) {
  if (score >= 66) return "Bullish";
  if (score >= 58) return "Slightly Bullish";
  if (score <= 34) return "Bearish";
  if (score <= 42) return "Slightly Bearish";
  return "Neutral";
}

export function scoreToEarningsLabel(score: number) {
  if (score >= 64) return "Positive earnings tone";
  if (score <= 36) return "Weak earnings tone";
  return "Mixed earnings tone";
}

export function getEarningsQualityGuardrails(items: NewsItem[]) {
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

export function isActualEarningsResultNews(item: NewsItem) {
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

export function rankEarningsNews(news: NewsItem[]) {
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

export function scoreEarnings(news: NewsItem[]): EarningsScoreResult {
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

/**
 * Newest-first by pubDate. Lifted from inside buildStockNewsBaseData to module
 * scope (2026-08-07) so the sector news builder can reuse the exact same feed
 * shaping rather than growing a second, drifting copy. Body unchanged.
 */
export const newestFirst = (items: NewsItem[]) =>
  [...items].sort((a, b) => {
    const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;

    return bTime - aTime;
  });

/**
 * Collapses a feed to one article per calendar date. Lifted to module scope
 * alongside newestFirst above; body unchanged.
 */
// oneArticlePerDate is gone. Its real goal was never "one per day" -- it was
// "don't show the same story twice", and a date is a bad proxy for that in both
// directions: too strict, since two genuinely different stories on the same
// Thursday collapsed into one (which is why actual earnings results needed a
// special exemption from it); and too loose, since the same story reported
// Thursday and Friday sailed through as two. dedupeNews compares what the
// headlines say instead, which needs no exemption and no calendar.

async function buildStockNewsBaseData(
  symbol: string,
  options: BuildOptions
): Promise<StockNewsBaseData> {
  const upper = symbol.trim().toUpperCase();
  // 5 large cards by default, up from 3. The feed can now walk back to fill
  // them (see NEWS_FEED_MAX_AGE_DAYS), so the old cap of 3 was a limit set by
  // how little the source gate used to clear, not by what the page wants.
  // Callers wanting fewer -- the discovery strip, internal news -- still pass
  // their own value.
  const maxDetailedItems = Math.max(1, Math.min(options.maxDetailedItems ?? 5, 5));

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

  // ---------------------------------------------------------------------------
  // THE FEED, after the source gate was removed (owner's call, 2026-08-22).
  //
  // WHAT WENT, AND WHY. There used to be a two-tier pool, a curated wire
  // allowlist, an earnings exemption for two named publishers, and a
  // gate-then-backfill split. Between them they produced the INVERSE of their
  // intent: the gate was narrow enough that most tickers cleared nothing, so
  // the backfill -- which ignored the gate entirely -- became the normal path
  // and filled the lead slots with exactly the publishers the gate existed to
  // exclude. Confirmed live on /stock/MU/news: three fool.com lead cards, one a
  // podcast, while a CNBC interview sat in the lighter feed.
  //
  // Widening the allowlist would have fixed that day's symptom and left the
  // shape: a curated publisher list maintained forever against a feed nobody
  // controls, with a fallback path that silently disagrees with it. Simple and
  // predictable beats a sorting rule that has been quietly inverted.
  //
  // WHAT IS LEFT is one ordered pass: drop junk, drop repeats, take the newest.
  // Two filters survive, and both fail visibly rather than silently --
  // isVideoOrLowQualitySource (podcasts and video, now including the article
  // image) and isLowValueNewsItem (SEO stock-quote pages). Neither is a
  // publisher allowlist; both are pattern blocklists, and a miss shows up as an
  // obviously wrong card rather than as an absence nobody can see.
  const displayNewsPool = rankedNews.length ? rankedNews : dedupeNews(news);

  // One pool, newest first, junk removed, repeats collapsed by title similarity
  // (see dedupeNews). No tiers: position in this list is the only ranking.
  const feedPool = dedupeNews(
    newestFirst(displayNewsPool.filter((item) => !isLowValueNewsItem(item)))
  );

  // OPEN-ENDED BACKFILL, with a floor. The old rule was one article per DATE,
  // which was a bad proxy for "don't show the same story twice" in both
  // directions -- too strict (two genuinely different Thursday stories became
  // one) and too loose (the same story reported Thursday and Friday became two).
  // Similarity dedup does that job properly, so the feed can simply walk back
  // until it is full.
  //
  // The floor is 90 days rather than unbounded: past a quarter a headline is
  // not news, and a card claiming to be part of the current picture should not
  // be from another one. Running short is the correct outcome for a thin
  // ticker -- fewer cards is honest, padding with year-old stories is not.
  const oldestAllowedMs = Date.now() - NEWS_FEED_MAX_AGE_DAYS * 86_400_000;
  const withinFeedWindow = feedPool.filter((item) => {
    if (!item.pubDate) return false;
    const t = new Date(item.pubDate).getTime();
    return Number.isFinite(t) && t >= oldestAllowedMs;
  });

  const detailedNews = withinFeedWindow.slice(0, maxDetailedItems);
  const compactNews = withinFeedWindow.slice(
    maxDetailedItems,
    maxDetailedItems + MAX_COMPACT_NEWS_ITEMS
  );

  // Short of target is a real state and worth being able to see, since it is now
  // the only way the feed can under-deliver -- there is no gate left to blame.
  console.log(
    `[news-feed] ${upper} pool=${displayNewsPool.length} afterFilters=${feedPool.length}` +
      ` within${NEWS_FEED_MAX_AGE_DAYS}d=${withinFeedWindow.length}` +
      ` lead=${detailedNews.length}/${maxDetailedItems} compact=${compactNews.length}/${MAX_COMPACT_NEWS_ITEMS}`
  );

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
  ["msh-stock-news-base-data-v28-main-feed-backfill"],
  {
    revalidate: 3600,
  }
);

export async function getStockNewsBaseData(
  symbol: string,
  options: BuildOptions = {}
): Promise<StockNewsBaseData> {
  const endTiming = beginTiming("news", "getStockNewsBaseData");
  try {
    return await getStockNewsBaseDataInner(symbol, options);
  } finally {
    endTiming();
  }
}

async function getStockNewsBaseDataInner(
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
