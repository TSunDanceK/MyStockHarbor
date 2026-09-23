// The two market-wide HEADLINE feeds: MarketWatch top stories and CNBC.
//
// Spec §4 of claude/news-adapter-spec-2026-09-13.md: "Headlines: MarketWatch +
// CNBC + both wires, merged, deduped, sorted." The wires already exist
// (./wireProvider.ts); these are the other two, and /headlines is their only
// reader. They are NOT a NewsProvider: they carry no ticker attribution at all,
// so wiring them into the per-symbol fan-out would put market-wide stories on
// company pages. lib/server/news/index.ts → fetchMarketHeadlines() is the one
// place they are read.
//
// ── WHY THIS EXISTS NOW (2026-09-23) ─────────────────────────────────────────
// /headlines was still reading FMP's general-news endpoint directly, outside
// NEWS_PROVIDER, ten days after the provider flip — so readers were still
// shown FMP-supplied articles on a page nothing had switched. #553 COWORK #1.
//
// ── TITLE AND LINK ONLY. NO EXCERPT, NO IMAGE. ──────────────────────────────
// Spec §2 names the wires as "the only leg where longer extracts and the
// source's own images are defensible, because releases are issued for
// republication". MarketWatch and CNBC are editorial, so their <description>
// is NOT kept and `image` is always null: the card shows the headline, the
// publisher, the time and a link to the publisher's own page. MarketWatch
// credits an agency on its images (Getty), which §6 denies anyway.
//
// ── CNBC SPONSORED ITEMS ARE DROPPED, FAIL-CLOSED ───────────────────────────
// §4: "Filter CNBC items where metadata:sponsored is not \"false\"." Read
// literally, which means an item with NO flag is dropped too: advertising
// presented as a headline is worse than one fewer headline.
import { stripHtmlTags, containsHtmlMarkup } from "./text";
import { deriveEventType } from "./eventType";
import { newsUserAgent } from "./userAgent";
import type { NewsItem } from "./types";

/** Headlines older than this are not "the latest". The page shows ~50. */
export const HEADLINE_MAX_AGE_DAYS = 7;

export type HeadlineFeed = {
  id: "marketwatch" | "cnbc";
  url: string;
  label: string;
};

/** The two URLs scripts/wire-feeds-probe.mjs measured (spec verdict table: PASS). */
export const HEADLINE_FEEDS: HeadlineFeed[] = [
  {
    id: "marketwatch",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    label: "MarketWatch",
  },
  {
    id: "cnbc",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
    label: "CNBC",
  },
];

const tag1 = (block: string, tag: string): string | null => {
  const re = new RegExp(`<${tag.replace(":", "\\:")}[^>]*>([\\s\\S]*?)</${tag.replace(":", "\\:")}>`);
  return block.match(re)?.[1] ?? null;
};
/**
 * The entities these two feeds actually send that the shared decodeHtml does
 * not cover. Measured on the 2026-09-23 relay capture: MarketWatch writes
 * dashes and curly quotes as hex references (`&#x2014;`, `&#x2019;`) and CNBC
 * writes `&apos;`. Without this a reader sees "McDonald&#x2019;s".
 */
export function decodeFeedEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&apos;/g, "'");
}
function safeCodePoint(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}
const clean = (v: string | null) => (v == null ? "" : decodeFeedEntities(stripHtmlTags(v)).trim());

/**
 * One headline feed into NewsItems. Exported for scripts/check-headline-feeds.mjs,
 * which runs it against verbatim relay captures — the sandbox cannot reach
 * either host.
 */
export function parseHeadlineFeed(xml: string, feed: HeadlineFeed, nowMs = Date.now()): NewsItem[] {
  const oldestAllowedMs = nowMs - HEADLINE_MAX_AGE_DAYS * 86_400_000;
  const items: NewsItem[] = [];

  for (const raw of xml.split(/<item[\s>]/).slice(1)) {
    const block = raw.split("</item>")[0];

    const rawTitle = tag1(block, "title") ?? "";
    if (containsHtmlMarkup(rawTitle.replace(/<!\[CDATA\[|\]\]>/g, ""))) continue;
    const title = clean(rawTitle);
    const link = clean(tag1(block, "link"));
    if (!title || !link || !/^https:\/\//.test(link)) continue;

    if (feed.id === "cnbc" && clean(tag1(block, "metadata:sponsored")).toLowerCase() !== "false") continue;

    const pubDate = clean(tag1(block, "pubDate")) || null;
    const ms = pubDate ? Date.parse(pubDate) : NaN;
    if (!Number.isFinite(ms) || ms < oldestAllowedMs || ms > nowMs + 3_600_000) continue;

    items.push({
      title,
      link,
      pubDate,
      source: feed.label,
      // Editorial feed: headline only (see the header).
      description: null,
      image: null,
      imageVerdict: "deny",
      guid: clean(tag1(block, "guid")) || null,
      eventType: deriveEventType({ title }).eventType,
      provider: feed.id,
    });
  }

  return items.sort((a, b) => Date.parse(b.pubDate ?? "") - Date.parse(a.pubDate ?? ""));
}

/**
 * Both feeds, fetched in parallel. A feed that fails contributes nothing; it
 * never throws, because /headlines treats "every source failed" as the empty
 * state and a single dead host should not decide that for the others.
 */
export async function fetchHeadlineFeeds(): Promise<NewsItem[]> {
  const batches = await Promise.all(
    HEADLINE_FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          // The same identifying User-Agent the wires send; GlobeNewswire proved
          // a missing UA can be tarpitted rather than refused.
          headers: { "user-agent": newsUserAgent() },
          next: { revalidate: 900 },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return [];
        return parseHeadlineFeed(await res.text(), feed);
      } catch {
        return [];
      }
    })
  );
  return batches.flat();
}

/**
 * GLOBENEWSWIRE ITEMS NEED A US TICKER ON /headlines. Its public-companies feed
 * is mostly non-US issuers (the 2026-09-23 capture: TSX 10, Oslo, TAI, Iceland
 * beside Nasdaq 14 and NYSE 4), which is not "the market" that page describes;
 * an item the wire itself tags with a US listing is. PR Newswire's
 * financial-services feed carries no tickers and is kept whole.
 */
export function keepForHeadlines(item: NewsItem): boolean {
  return !(item.provider === "wire" && item.source === "GlobeNewswire" && !item.tickers?.length);
}

/** A single card on /headlines. */
export type GeneralHeadline = {
  title: string;
  image: string | null;
  publishedDate: string | null;
  source: string;
  excerpt: string | null;
  url: string;
};

/** How many headlines the page lists. The FMP endpoint was asked for 50. */
export const MAX_HEADLINES = 50;

/**
 * Trims a raw excerpt down to a short "first paragraph" length, cutting at a
 * sentence or word boundary near ~400 characters. Moved unchanged from
 * lib/general-market-news.ts.
 */
function truncateExcerpt(raw: string, maxLength = 400): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const hardCut = cleaned.slice(0, maxLength);
  const sentenceEnd = Math.max(
    hardCut.lastIndexOf(". "),
    hardCut.lastIndexOf("! "),
    hardCut.lastIndexOf("? ")
  );
  if (sentenceEnd > maxLength * 0.4) return hardCut.slice(0, sentenceEnd + 1).trim();
  const wordBoundary = hardCut.lastIndexOf(" ");
  const safeCut = wordBoundary > 0 ? hardCut.slice(0, wordBoundary) : hardCut;
  return `${safeCut.trim()}…`;
}

const timeOf = (value: string | null) => {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * Spec §4's "merged, deduped, sorted", capped at MAX_HEADLINES. `dedupe` is the
 * site's one similarity dedup (dedupeNews, #343), passed in so this module keeps
 * importing nothing app-wide: the same story from CNBC and MarketWatch
 * collapses to one card.
 */
export function composeHeadlines(
  items: NewsItem[],
  dedupe: (items: NewsItem[]) => NewsItem[]
): GeneralHeadline[] {
  const newestFirst = (list: NewsItem[]) =>
    [...list].sort((a, b) => timeOf(b.pubDate) - timeOf(a.pubDate));
  return newestFirst(dedupe(newestFirst(items.filter(keepForHeadlines))))
    .slice(0, MAX_HEADLINES)
    .map((item) => ({
      title: item.title,
      image: item.image ?? null,
      publishedDate: item.pubDate,
      source: item.source?.trim() || "News",
      excerpt: item.description?.trim() ? truncateExcerpt(item.description) : null,
      url: item.link,
    }));
}
