// Market-wide headlines for /headlines, from whichever stack NEWS_PROVIDER picks.
//
// ADDED 2026-09-23 (#553 COWORK #1). /headlines read FMP's general-news
// endpoint directly (lib/general-market-news.ts), outside NEWS_PROVIDER, so the
// step-7 flip to the free stack never reached it and readers kept being shown
// FMP-supplied articles. This is the seam it reads through now, and it honours
// the same rollback: NEWS_PROVIDER=fmp restores the FMP general feed.
//
// A SEPARATE MODULE FROM ./index.ts ON PURPOSE. index.ts is the per-symbol
// registry, and scripts/check-news-feed.mjs pins that it contains no `catch`
// (a swallowed failure there would read to newsStore as a successful empty
// fetch). Market headlines have the opposite contract -- no store, so a failed
// leg must simply contribute nothing -- and keeping them out of index.ts keeps
// that pin meaningful.
import { activeNewsProviders, ADAPTER_TIMEOUT_MS, newsProviderMode } from "./index";
import { fmpNewsProvider } from "./fmpProvider";
import { fetchHeadlineFeeds, HEADLINE_FEEDS } from "./headlineFeeds";
import type { NewsItem } from "./types";

function settleWithin<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

/**
 * FREE = spec §4: MarketWatch + CNBC (./headlineFeeds.ts) plus every free
 * provider's fetchMarket(). Today that is the wires; gnews and sec return []
 * for market-wide by design and cost nothing to ask.
 *
 * Which of these reach the page is decided by composeHeadlines in
 * ./headlineFeeds.ts (the GlobeNewswire US-ticker rule among them).
 *
 * Never rejects: each leg is bounded by the adapters' 5 s budget and a failed
 * leg contributes nothing. The page's empty state is every leg failing.
 */
export async function fetchMarketHeadlines(): Promise<NewsItem[]> {
  if (newsProviderMode() === "fmp") {
    return settleWithin(fmpNewsProvider.fetchMarket(), ADAPTER_TIMEOUT_MS, []);
  }

  const legs = [
    fetchHeadlineFeeds(),
    ...activeNewsProviders().map((provider) => provider.fetchMarket()),
  ].map((leg) => settleWithin(leg, ADAPTER_TIMEOUT_MS, [] as NewsItem[]));

  return (await Promise.all(legs)).flat();
}

/**
 * Who the /headlines footer credits, derived from the same switch as the feed
 * so the attribution cannot disagree with the articles above it.
 */
export function marketHeadlineSourceLabels(): string[] {
  if (newsProviderMode() === "fmp") return ["Financial Modeling Prep"];
  return [...HEADLINE_FEEDS.map((feed) => feed.label), "GlobeNewswire", "PR Newswire"];
}
