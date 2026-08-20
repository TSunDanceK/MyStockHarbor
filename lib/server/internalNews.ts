// lib/server/internalNews.ts
//
// The payload behind /api/internal-news, extracted so app/dashboard/page.tsx
// can read it IN-PROCESS instead of doing an HTTP self-fetch to its own route.
//
// Same extraction already done for playsBuilder.ts and
// descendingTrianglesBuilder.ts in PRs #262/#263, and for the quote,
// benchmarks and earnings self-fetches that used to live in
// app/dashboard/page.tsx (see the comment at the top of that file). This was
// the last self-fetch on the dashboard's render path.
//
// Four things the self-fetch cost that this removes:
//
//  1. A whole extra serverless invocation per uncached dashboard render --
//     /api/internal-news is its own function, and the runtime logs show it
//     tracking /dashboard almost 1:1.
//  2. An edge round-trip even when the target IS cached: the request leaves
//     the render, goes back out to the site's own origin, through middleware,
//     and back.
//  3. The only remaining reason app/dashboard/page.tsx called headers() --
//     getOriginFromHeaders() existed solely to build the absolute URL for
//     this fetch. headers() forces dynamic rendering on its own, so this is
//     also a prerequisite for ever putting /dashboard on ISR (not attempted
//     here).
//  4. An unauthenticated server-to-server self-fetch of exactly the class
//     documented as a past production outage in
//     claude/pickers-firewall-selfblock-2026-07-17.md and
//     claude/stock-page-earnings-selfblock-2026-07-21.md. It survived only
//     because /api/internal-news happens not to be BotID-guarded -- a
//     property someone could change without realising the dashboard's SSR
//     depended on it.
//
// The route handler now calls this too, so the public endpoint and the
// server-rendered dashboard return byte-identical payloads by construction
// rather than by two copies of the same mapping staying in sync.
//
// Caching is unchanged: getStockNewsBaseData() is wrapped in unstable_cache
// (revalidate 3600) inside lib/stock-news-data.ts, so the in-process call
// hits exactly the same cache the route handler was hitting. What goes away
// is the HTTP hop in front of it, not the cache behind it.

import { getStockNewsBaseData } from "@/lib/stock-news-data";

// Mirrors the InternalNewsCard type DashboardClient declares. `source` and
// `pubDate` are genuinely nullable upstream (lib/stock-news-data.ts builds
// them from feed fields that are not always present), so they are nullable
// here too rather than being asserted away at the boundary.
export type InternalNewsCard = {
  title: string;
  source: string | null;
  pubDate: string | null;
  summary: string;
  image: string | null;
  link: string | null;
};

export type InternalNewsPayload = {
  symbol: string;
  companyName: string;
  isInvalidTicker: boolean;
  trend: string;
  newsScoreLabel: string;
  newsScoreValue: number;
  cards: InternalNewsCard[];
  ctaHref: string;
};

// Kept in one place so the route's Cache-Control and any future caller agree.
export const INTERNAL_NEWS_CACHE_CONTROL =
  "public, s-maxage=900, stale-while-revalidate=3600";

export function normaliseInternalNewsSymbol(raw?: string | null) {
  return (raw || "SPY").trim().toUpperCase();
}

export async function getInternalNewsPayload(
  symbolInput: string
): Promise<InternalNewsPayload> {
  const symbol = normaliseInternalNewsSymbol(symbolInput);

  const data = await getStockNewsBaseData(symbol, {
    maxDetailedItems: 3,
  });

  return {
    symbol: data.symbol,
    companyName: data.companyName,
    isInvalidTicker: data.isInvalidTicker,
    trend: data.trend,
    newsScoreLabel: data.newsScore.label,
    newsScoreValue: data.newsScore.score,
    cards: data.detailedNews.map((item) => ({
      title: item.title,
      source: item.source,
      pubDate: item.pubDate,
      summary: item.description ?? "No summary available yet.",
      image: item.image ?? null,
      link: item.link ?? null,
    })),
    ctaHref: `/stock/${encodeURIComponent(data.symbol)}/news`,
  };
}
