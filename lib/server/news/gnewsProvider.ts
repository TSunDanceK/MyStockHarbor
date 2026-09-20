// The Google News adapter — the per-symbol primary for the free stack.
//
// Step 3 of claude/news-adapter-spec-2026-09-13.md, behind NEWS_PROVIDER — which
// step 7 flipped to default "free", so this is now the per-symbol primary on the
// live site rather than a path waiting to be switched on.
//
// ── THE QUERY IS THE ENTIRE RELEVANCE MECHANISM ────────────────────────────
// Google News is a plain text search with no notion of a ticker, so what is
// asked for is all that decides what comes back. Measured:
//
//   q=MU                        85% precision  (Missouri Tigers football, a
//                                               Ugandan BBC story, a college
//                                               soccer box score)
//   q="Micron Technology" stock 98% precision, 95-day span   <- this one
//
// The bare ticker is not used. The quoted company name comes from the step-2
// normaliser, which is why that step shipped first.
import { normaliseCompanyName, assessCompanyName } from "./companyName";
import { stripHtmlTags, containsHtmlMarkup, decodeHtml } from "./text";
import { deriveEventType } from "./eventType";
import type { NewsItem, NewsProvider } from "./types";

const FEED_URL = "https://news.google.com/rss/search";

/**
 * How far back the adapter will keep an article.
 *
 * NOT COSMETIC. CYRX returned 55 items spanning 3,453 days, one of them from
 * 2017: thin-coverage names backfill with whatever the index still holds. The
 * store caps at 40 by recency, so without this an ancient article can occupy a
 * slot a real one needed, and the earnings pin could pin something from 2017.
 *
 * 120 DAYS HERE, 45 AT DISPLAY, and the gap is deliberate — the store holds
 * deeper than the page shows because the earnings pin may reach back. The
 * display window lives in lib/stock-news-data.ts, which is where the feed is
 * composed.
 */
export const GNEWS_STORE_MAX_AGE_DAYS = 120;

/** Google's own cap is about 100; asking is free and the store decides what to keep. */
const FEED_LOCALE = "hl=en-US&gl=US&ceid=US:en";

export function buildQuery(cleanName: string): string {
  return `"${cleanName}" stock`;
}

export function feedUrlFor(cleanName: string): string {
  return `${FEED_URL}?q=${encodeURIComponent(buildQuery(cleanName))}&${FEED_LOCALE}`;
}

/**
 * Strip the " - Publisher" suffix Google appends to every headline.
 *
 * ── THIS IS NOT A DISPLAY TIDY-UP. IT IS THE DEDUP. ────────────────────────
 * It happens here, in the adapter, before the item is stored or deduped —
 * because dedupeNews compares TOKEN SETS of the title. Its normaliser strips
 * punctuation and a list of stopwords, but "reuters" is not a stopword, so the
 * publisher survives as a real token.
 *
 * The overlap coefficient divides shared tokens by the SMALLER set, so a stray
 * token in the shorter headline lowers the ratio directly: a pair sharing 2 of
 * 3 tokens scores 0.67 and collapses, and the same pair with a publisher token
 * added scores 0.5 and does not. Exact-link dedup cannot help — a Google
 * redirect and a GlobeNewswire URL are never equal — so this strip is the only
 * thing standing between a reader and the same story twice.
 *
 * ANCHORED TO THE END and requiring the spaced hyphen Google actually uses, so
 * a headline whose own text contains " - " keeps everything before the LAST
 * one. A publisher name with a hyphen in it ("U.S. News - World Report") is why
 * the match is non-greedy on the tail rather than cutting at the first dash.
 */
export function stripPublisherSuffix(title: string): string {
  // No comma/period requirement: publisher names are short and unpunctuated in
  // this feed. Bounded to 40 characters so a headline ending in a genuine
  // clause ("...- and that is before tariffs bite") is not amputated.
  const stripped = title.replace(/\s+-\s+[^-]{1,40}$/, "").trim();
  // Never return nothing: a headline that is ENTIRELY " - Publisher" shaped is
  // more likely a parse accident than a real title, and dropping the text would
  // hand dedupeNews an empty token set, which it keeps rather than compares.
  return stripped.length >= 3 ? stripped : title.trim();
}

/** The `<source>` element is authoritative for the publisher; the title suffix is not. */
function extractSource(block: string): string | null {
  const raw =
    block.match(/<source[^>]*><!\[CDATA\[(.*?)\]\]><\/source>/)?.[1] ??
    block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ??
    null;
  const cleaned = raw ? decodeHtml(stripHtmlTags(raw)).trim() : "";
  return cleaned || null;
}

/**
 * One RSS payload into NewsItems.
 *
 * EXPORTED FOR THE HARNESS. scripts/check-gnews-adapter.mjs runs this against
 * captured feed shapes; the sandbox cannot reach news.google.com, so the parser
 * is the part that has to be testable without the network.
 */
export function parseGoogleNewsFeed(xml: string, symbol: string, nowMs = Date.now()): NewsItem[] {
  const oldestAllowedMs = nowMs - GNEWS_STORE_MAX_AGE_DAYS * 86_400_000;
  const items: NewsItem[] = [];

  for (const block of xml.split("<item>").slice(1)) {
    const rawTitle =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ??
      "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const guid = (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ?? "").trim() || null;
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "").trim() || null;

    if (!rawTitle || !link) continue;
    if (containsHtmlMarkup(rawTitle)) continue;

    const title = stripPublisherSuffix(stripHtmlTags(rawTitle));
    if (!title) continue;

    // THE DATE FILTER, applied before anything downstream sees the item.
    const ms = pubDate ? Date.parse(pubDate) : NaN;
    if (!Number.isFinite(ms) || ms < oldestAllowedMs) continue;

    items.push({
      title,
      // LEFT AS THE REDIRECT, deliberately. Resolving it to the publisher URL
      // costs one extra request per item, breaks whenever Google changes the
      // encoding, and buys nothing: the redirect still lands the reader on the
      // publisher's page.
      link,
      pubDate,
      source: extractSource(block),
      // Google News carries no usable description — the <description> element is
      // a block of related-article links, not a summary. The page already
      // renders the algorithmic line from lib/stock-news-templates.ts for any
      // item without one, so this stays null rather than being filled with an
      // AI call per item.
      description: null,
      guid,
      // The query was for this company, so the attribution is honest. NOT
      // written to fmpSymbols/fmpSymbolMatched: those drive
      // articleMatchesRequestedSymbol, and marking every item symbol-confirmed
      // would switch off the text-relevance filter that catches the residual
      // 2-3% of off-topic results this feed returns.
      tickers: [symbol.toUpperCase()],
      // Step 6: the TITLE leg, which is the only one a headline can reach and
      // the weakest in §7's cascade. It is null far more often than not, and
      // that is the intended behaviour — null selects sector art, which asserts
      // nothing, where a wrong event type asserts something false.
      eventType: deriveEventType({ title }).eventType,
      provider: "gnews",
    });
  }

  // NEWEST-FIRST AFTER FILTERING, NEVER BEFORE. Sorting first and filtering
  // second reads the same and is not: the filter can remove items from
  // anywhere in the order, so a sort that preceded it says nothing about what
  // survived.
  return items.sort((a, b) => Date.parse(b.pubDate ?? "") - Date.parse(a.pubDate ?? ""));
}

/**
 * Per-symbol news.
 *
 * `sinceIso` IS ACCEPTED AND NOT USED, and that is a property of the endpoint
 * rather than an oversight: Google News RSS exposes no date-range parameter, so
 * every refresh reads the same window. The incremental saving the stored-dataset
 * design describes comes from what mergeNewsItems discards, not from what is
 * requested — the request is the same size either way. The store still
 * distinguishes cold from incremental for its own stats.
 */
async function fetchForSymbol(
  symbol: string,
  companyName: string,
  _sinceIso: string | null
): Promise<NewsItem[]> {
  const cleanName = normaliseCompanyName(companyName);

  // AN EMPTY NAME IS THE ONE CASE THAT MUST NOT QUERY. `"" stock` matches the
  // entire market, which is worse than returning nothing.
  if (!cleanName) {
    console.warn(`[gnews] ${symbol}: no usable company name from ${JSON.stringify(companyName)} — skipped`);
    return [];
  }

  // Everything else queries, and says so when the name is weak. The alternative
  // is the bare ticker, which measured 85%; a generic-but-real name beats it and
  // the text-relevance filter downstream still has to agree. The log line is
  // what the manual override list gets built from -- MSTR ("Strategy") and POST
  // ("Post") are the known cases.
  //
  // AND `fund-or-note` IS DELIBERATELY NOT AN EXCEPTION TO THAT, which is worth
  // saying here because assessCompanyName's marker list reads like a skip list.
  // 90 committed names carry the verdict; relay run 199 measured 20 of them
  // live and 17 returned news. The verdict fires on real operating companies
  // (every MLP trips `Units?`; PFBC is a bank named "Preferred Bank") as well as
  // on genuine notes, so a skip would delete a working news leg to save a fetch.
  // The cost of querying anyway is a handful of content-farm items on the
  // genuine instruments -- real, and much smaller than the alternative.
  // claude/fund-or-note-stays-a-warning-2026-09-20.md has the per-symbol table.
  const verdict = assessCompanyName(cleanName);
  if (!verdict.ok) {
    console.warn(`[gnews] ${symbol}: weak query name ${JSON.stringify(cleanName)} (${verdict.reason}) — override candidate`);
  }

  try {
    const res = await fetch(feedUrlFor(cleanName), {
      // Unchanged from the FMP path. The store decides whether a refresh happens
      // at all; this only bounds how stale one window may be if it does.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];

    const items = parseGoogleNewsFeed(await res.text(), symbol);
    console.log(`[gnews] ${symbol} q=${JSON.stringify(buildQuery(cleanName))} items=${items.length}`);
    return items;
  } catch {
    // Serve nothing rather than throwing: newsStore treats a throw as "upstream
    // failed, keep what is stored", and an empty result here means the same
    // thing to the merge, which keys by link and drops nothing.
    return [];
  }
}

/**
 * Market-wide: NOT THIS ADAPTER'S JOB, and empty is the honest answer.
 *
 * §4 gives the headlines page to MarketWatch, CNBC and the two wires, which is
 * step 4. A Google News query broad enough to stand in for that would be
 * unmeasured, and this returns [] rather than inventing one. Nothing calls it
 * yet — the registry only reaches fetchForSymbol.
 */
async function fetchMarket(): Promise<NewsItem[]> {
  return [];
}

export const gnewsProvider: NewsProvider = {
  id: "gnews",
  fetchForSymbol,
  fetchMarket,
};
