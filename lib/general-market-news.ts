import { unstable_cache } from "next/cache";

import { dedupeNews } from "@/lib/news-scoring";
import { composeHeadlines, type GeneralHeadline } from "@/lib/server/news/headlineFeeds";
import { fetchMarketHeadlines, marketHeadlineSourceLabels } from "@/lib/server/news/marketHeadlines";

export type { GeneralHeadline };

// WHERE THE HEADLINES COME FROM (2026-09-23, #553 COWORK #1): through the
// NEWS_PROVIDER seam, lib/server/news/marketHeadlines.ts. This module used to
// call FMP's general-news endpoint itself, outside that switch, so the step-7
// flip to the free stack never reached /headlines. The FMP fetch now lives in
// the FMP adapter and runs only under NEWS_PROVIDER=fmp. What reaches the page
// (merge, dedup, order, cap, excerpt trim) is composeHeadlines in
// lib/server/news/headlineFeeds.ts, which is pure and checked by
// scripts/check-headlines-off-fmp.mjs.
//
// No AI briefs, scoring or "why it matters" commentary here -- a plain,
// reverse-chronological list with an excerpt where the source supplies one.

// v2: the v1 entry holds an FMP payload. A new key means the first render after
// deploy reads the new sources instead of serving FMP articles for up to 30 min.
const getCachedGeneralMarketHeadlines = unstable_cache(
  async () => composeHeadlines(await fetchMarketHeadlines(), dedupeNews),
  ["msh-general-market-headlines-v2"],
  {
    revalidate: 1800,
  }
);

/** Used by app/headlines/page.tsx. */
export async function getGeneralMarketHeadlines(): Promise<GeneralHeadline[]> {
  try {
    return await getCachedGeneralMarketHeadlines();
  } catch {
    return [];
  }
}

/**
 * The footer's source phrase, from the same switch as the feed:
 * "the MarketWatch, CNBC, GlobeNewswire and PR Newswire public feeds" on the
 * free stack, "Financial Modeling Prep" under the NEWS_PROVIDER=fmp rollback.
 */
export function headlineSourcesText(): string {
  const labels = marketHeadlineSourceLabels();
  if (labels.length <= 1) return labels[0] ?? "the news feeds";
  return `the ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} public feeds`;
}
