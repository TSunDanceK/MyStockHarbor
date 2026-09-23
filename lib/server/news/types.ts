// The news data model and the provider seam.
//
// Design of record: claude/news-adapter-spec-2026-09-13.md. This file plus
// ./index.ts are step 1 of that spec's build order -- the interface and the
// NEWS_PROVIDER flag, with the existing FMP path moved behind them and NOTHING
// else changed. No new adapter ships in step 1.
//
// THIS MODULE IMPORTS NOTHING, for the same reason newsMerge.ts imports nothing:
// it is the one place the adapters (lib/server/news/*) and the consumers
// (lib/stock-news-data.ts, lib/sector-news-data.ts) can both depend on without a
// cycle. NewsItem used to live in lib/stock-news-data.ts, which is also the
// module that now calls the adapters -- leaving the type there would have made
// every adapter import its own caller.

/**
 * One news article, as every consumer of the feed sees it.
 *
 * MOVED HERE FROM lib/stock-news-data.ts UNCHANGED in step 1. The fields below
 * the divider are additions; every one of them is optional, so an item built by
 * the FMP adapter -- which populates only what FMP actually sends -- is still a
 * valid NewsItem and still renders exactly as it did before.
 */
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
   * says whether `limit=50` is buying anything -- see logNewsDepth in
   * lib/stock-news-data.ts, which is what reads this field.
   */
  sourceIndex?: number;

  // --------------------------------------------------------------- additions
  // Added in step 1 so later steps are adapter work rather than a type change
  // rippling through every consumer. ALL OPTIONAL, AND THE FMP ADAPTER LEAVES
  // THEM UNSET except where FMP already supplies the data -- populating them
  // from nothing would be inventing fields, and step 1 must not move the page.

  /**
   * The upstream's own stable identifier. Google News RSS carries one and it is
   * the primary dedup key there (spec §1); FMP does not send one, so FMP items
   * keep deduping by link exactly as they do today.
   */
  guid?: string | null;
  /**
   * Tickers the upstream attributes the story to. The wires carry these in
   * `<category>` / `dc:subject`; FMP's equivalent is the existing `fmpSymbols`,
   * which is left in place rather than renamed so nothing downstream shifts.
   */
  tickers?: string[];
  /** Upstream category/subject labels, verbatim. Wire feeds only. */
  categories?: string[];
  /** What kind of event the article reports. Derivation is step 7 of the spec. */
  eventType?: "earnings" | "filing" | "analyst" | "deal" | "macro" | null;
  /** Path to generated art, chosen when no publisher image may be used (spec §6). */
  art?: string | null;
  /** Outcome of the image cascade (spec §6). Default deny; decided in step 6. */
  imageVerdict?: "allow" | "deny" | null;
  /** Which adapter produced the item. Set by the adapter, not inferred. */
  provider?: NewsProviderId;
  /**
   * The feed's own language tag (dc:language), wires only; null when the feed
   * sends none. /headlines and sector pages keep English items only (#553
   * COWORK #11: FEMSA's Spanish release sat beside its English one).
   */
  language?: string | null;
  /** The issuing company as the wire names it (dc:contributor). Wires only. */
  issuer?: string | null;
};

/**
 * FMP's wire shape for a stock-news row.
 *
 * Stays a shared export because lib/sector-news-data.ts parses the same payload
 * from its own endpoint and must not grow a second description of it.
 */
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

// "marketwatch" | "cnbc" (2026-09-23): the /headlines-only feeds in
// ./headlineFeeds.ts. They are not NewsProviders -- no per-symbol leg -- but
// their items still say where they came from.
export type NewsProviderId = "gnews" | "wire" | "sec" | "fmp" | "marketwatch" | "cnbc";

/**
 * A news source, behind one interface.
 *
 * THE FLICK-BACK REQUIREMENT is what this exists for, and it is the owner's:
 * if FMP ever return with a reasonable offer, going back must be a switch, not
 * an unpick. So the FMP adapter is not deleted, gutted or commented out when the
 * free adapters arrive -- it stays in the tree implementing this interface, and
 * NEWS_PROVIDER chooses.
 */
export interface NewsProvider {
  id: NewsProviderId;
  /**
   * Per-symbol news. `sinceIso` is the incremental watermark the store computes
   * (newest stored - 6h), and null means a cold start -- fetch the upstream's
   * default window, because there is nothing stored to anchor an overlap to.
   *
   * `companyName` is here for the text-search providers: Google News has no
   * notion of a ticker and has to be queried by name (spec §1). The FMP adapter
   * queries by symbol and ignores it.
   */
  fetchForSymbol(
    symbol: string,
    companyName: string,
    sinceIso: string | null
  ): Promise<NewsItem[]>;
  /** Market-wide. Feeds the headlines page AND seeds sector pages. */
  fetchMarket(): Promise<NewsItem[]>;
}
