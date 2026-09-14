// The FMP news adapter.
//
// Step 1 of claude/news-adapter-spec-2026-09-13.md: the FMP news path, moved
// behind the NewsProvider interface with its behaviour untouched. Everything
// below the imports came out of lib/stock-news-data.ts verbatim apart from the
// two edits the interface forces -- fetchFmpStockNewsWindow is now
// fetchForSymbol, so it takes the `companyName` it does not use and calls the
// watermark `sinceIso`.
//
// IT IS NOT DELETED WHEN THE FREE ADAPTERS ARRIVE. The owner's requirement is
// that going back to FMP is a switch and not an unpick, so this file stays in
// the tree, compiling and exercised, and NEWS_PROVIDER chooses (see ./index.ts).
//
// THE ADDITIVE NewsItem FIELDS ARE LEFT UNSET HERE, deliberately. guid,
// categories, eventType, art and imageVerdict have no FMP equivalent, and
// filling them with a guess is how a "pure refactor" moves the page. The one
// that looks like an exception is `tickers`: FMP does send tickers, but they
// already arrive as `fmpSymbols` and every consumer plus every record already in
// Redis reads that name, so step 1 leaves it alone rather than writing the same
// list twice under two names. `provider` is adapter identity rather than FMP
// data and is likewise left for the step that needs it.
import { fmpFetch } from "@/lib/server/fmpUsage";
import { fetchFmpGeneralNews } from "@/lib/general-market-news";
import { cleanRssDescription, containsHtmlMarkup, stripHtmlTags } from "./text";
import { logResponseWindow } from "./responseWindow";
import type { FmpStockNewsItem, NewsItem, NewsProvider } from "./types";

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

/**
 * One /news/stock window. A null `sinceIso` means a cold start -- the
 * endpoint's default window, because there is nothing stored to anchor an
 * overlap to.
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
async function fetchForSymbol(
  symbol: string,
  _companyName: string,
  sinceIso: string | null
): Promise<NewsItem[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  const encoded = encodeURIComponent(symbol.toUpperCase());
  const key = encodeURIComponent(apiKey);

  const fromParam = sinceIso ? `&from=${encodeURIComponent(sinceIso)}` : "";

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
            // STAMPED AT STEP 7's FOLLOW-UP, and it is not decoration. Step 1
            // deliberately left this unset because nothing read it. The card
            // footer now does — lib/news-attribution.ts says what a card's text
            // actually is rather than claiming an FMP excerpt on every card —
            // and an unstamped item cannot be told apart from one whose adapter
            // forgot. Nothing filters on this field; it only labels.
            provider: "fmp",
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

/**
 * Market-wide headlines, as NewsItem.
 *
 * REUSES THE SHIPPING GENERAL-NEWS FETCH rather than restating its endpoint
 * pair and its parsing: lib/general-market-news.ts already owns both, and a
 * second copy is how the two come to disagree about which endpoint is tried
 * first. The only thing added here is the mapping from that module's
 * display-shaped GeneralHeadline onto NewsItem.
 *
 * NOTHING CALLS THIS YET, and that is the point of it shipping now. The
 * interface requires it, so the FMP adapter implements it and keeps compiling;
 * /headlines still reads getGeneralMarketHeadlines directly and is untouched.
 * Spec §4 is what moves the headlines and sector pages onto this, and it is a
 * later step -- rewiring them here would change the excerpt they render, since
 * GeneralHeadline truncates at 400 characters and NewsItem carries 650.
 */
async function fetchMarket(): Promise<NewsItem[]> {
  const headlines = await fetchFmpGeneralNews();

  return headlines.map((headline) => ({
    title: headline.title,
    link: headline.url,
    pubDate: headline.publishedDate,
    source: headline.source,
    description: headline.excerpt,
    image: headline.image,
    provider: "fmp" as const,
  }));
}

export const fmpNewsProvider: NewsProvider = {
  id: "fmp",
  fetchForSymbol,
  fetchMarket,
};
