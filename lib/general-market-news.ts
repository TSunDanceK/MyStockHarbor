import { unstable_cache } from "next/cache";

import { fmpFetch } from "@/lib/server/fmpUsage";
/**
 * A single general market headline, already trimmed down to exactly what
 * the /headlines page needs. Deliberately NOT reusing NewsItem from
 * lib/stock-news-data.ts (or anything from lib/ai-news-briefs.ts) -- this
 * feed has no AI scoring, briefs, "why it matters" commentary, or
 * sentiment tone-coloring. It's a plain, reverse-chronological list of
 * headlines pulled straight from FMP with an excerpt and a link out.
 */
export type GeneralHeadline = {
  title: string;
  image: string | null;
  publishedDate: string | null;
  source: string;
  excerpt: string | null;
  url: string;
};

// Mirrors the shape FMP's news endpoints share across their stock-news and
// general-news variants (see FmpStockNewsItem in lib/stock-news-data.ts).
type FmpGeneralNewsItem = {
  title?: string;
  publishedDate?: string;
  date?: string;
  publisher?: string;
  site?: string;
  image?: string;
  text?: string;
  content?: string;
  description?: string;
  url?: string;
  link?: string;
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Trims a raw FMP excerpt down to a short "first paragraph" length. FMP's
 * `text`/`content` field is usually already a short excerpt, but this
 * guards against the occasional full-length blob by cutting at a sentence
 * or word boundary near ~400 characters rather than dumping a wall of text
 * on the card.
 */
function truncateExcerpt(raw: string, maxLength = 400): string {
  const cleaned = decodeHtml(raw.replace(/\s+/g, " ").trim());
  if (cleaned.length <= maxLength) return cleaned;

  const hardCut = cleaned.slice(0, maxLength);

  // Prefer cutting at the end of a sentence within the window.
  const sentenceEnd = Math.max(
    hardCut.lastIndexOf(". "),
    hardCut.lastIndexOf("! "),
    hardCut.lastIndexOf("? ")
  );
  if (sentenceEnd > maxLength * 0.4) {
    return `${hardCut.slice(0, sentenceEnd + 1).trim()}`;
  }

  // Otherwise fall back to the last whole word before the cutoff.
  const wordBoundary = hardCut.lastIndexOf(" ");
  const safeCut = wordBoundary > 0 ? hardCut.slice(0, wordBoundary) : hardCut;
  return `${safeCut.trim()}…`;
}

/**
 * Fetches general, market-wide headlines from FMP -- not tied to any one
 * ticker. Tries the current `stable` endpoint first, falling back to the
 * legacy `v4` endpoint if that fails, mirroring the stable-then-legacy
 * pattern used by fetchFmpStockNews in lib/stock-news-data.ts. No AI
 * processing of any kind happens here -- this is a plain pass-through of
 * FMP's own fields.
 */
async function fetchFmpGeneralNews(): Promise<GeneralHeadline[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  const key = encodeURIComponent(apiKey);

  const endpoints = [
    `https://financialmodelingprep.com/stable/news/general-latest?limit=50&apikey=${key}`,
    `https://financialmodelingprep.com/api/v4/general_news?page=0&apikey=${key}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fmpFetch(url, {
        next: { revalidate: 900 },
      });

      if (!res.ok) continue;

      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) continue;

      const items = data
        .map((item: FmpGeneralNewsItem): GeneralHeadline | null => {
          const title = typeof item.title === "string" ? item.title.trim() : "";
          const url =
            typeof item.url === "string" && item.url.trim()
              ? item.url.trim()
              : typeof item.link === "string"
                ? item.link.trim()
                : "";

          if (!title || !url) return null;

          const excerptSource =
            typeof item.text === "string" && item.text.trim()
              ? item.text
              : typeof item.content === "string" && item.content.trim()
                ? item.content
                : typeof item.description === "string"
                  ? item.description
                  : "";

          return {
            title: decodeHtml(title),
            image:
              typeof item.image === "string" && item.image.trim()
                ? item.image.trim()
                : null,
            publishedDate:
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
                  : "News",
            excerpt: excerptSource.trim() ? truncateExcerpt(excerptSource) : null,
            url,
          };
        })
        .filter((item): item is GeneralHeadline => Boolean(item));

      if (items.length) return items;
    } catch {
      continue;
    }
  }

  return [];
}

const getCachedGeneralMarketHeadlines = unstable_cache(
  async () => fetchFmpGeneralNews(),
  ["msh-general-market-headlines-v1"],
  {
    revalidate: 1800,
  }
);

/**
 * Plain, reverse-chronological general market headlines -- no AI briefs,
 * no scoring, no "why it matters" commentary. Used by app/headlines/page.tsx.
 */
export async function getGeneralMarketHeadlines(): Promise<GeneralHeadline[]> {
  try {
    return await getCachedGeneralMarketHeadlines();
  } catch {
    return [];
  }
}
