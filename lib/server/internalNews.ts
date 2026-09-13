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
import { readCachedFundamentalsBulk } from "@/lib/server/fundamentalsCache";
import { sectorSlugFromLabel } from "@/lib/sectors";
import { bucketFor, planCardArt, type CardArt } from "@/lib/server/news/art";
import type { NewsItem } from "@/lib/server/news/types";

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
  /**
   * What this card shows, already decided.
   *
   * ── WHY THE DECISION HAPPENS HERE AND NOT IN THE BROWSER ──────────────────
   * The dashboard strip is a client component, so it cannot read the cached
   * fundamentals the bucket comes from. It could be handed the bucket NAME and
   * run the selection itself — but that would put the manifest, the hash and
   * the no-repeat rule in the bundle, and give the rule two implementations to
   * keep in step. Decided server-side, the client stays purely presentational.
   */
  art: CardArt;
};

export type InternalNewsPayload = {
  symbol: string;
  companyName: string;
  isInvalidTicker: boolean;
  trend: string | null;
  // null when scoreNews had nothing to score (see NewsScoreResult.available).
  // Carrying "Neutral"/50 through here is what made /dashboard render
  // "Neutral tone" for a stock with no headlines at all.
  newsScoreLabel: string | null;
  newsScoreValue: number | null;
  cards: InternalNewsCard[];
  ctaHref: string;
  /**
   * For the generated card, when a card has no library art. The same two
   * numbers the stock news page feeds it, from the same history — so the
   * dashboard's fallback is the real data card rather than a flat placeholder.
   */
  changePct: number | null;
  sparkPoints: number[];
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

  // THE SAME PATH THE STOCK NEWS PAGE USES, and the same cost: an mget that
  // never fetches on a miss and never throws, so the worst case is no bucket
  // and the generated card. It adds no FMP call to a route that is already
  // cached for 15 minutes.
  const fundamentals = (await readCachedFundamentalsBulk([symbol])).get(symbol) ?? null;
  const sectorBucket = bucketFor(
    sectorSlugFromLabel(fundamentals?.sector ?? null),
    fundamentals?.industry ?? null
  );

  // Per bucket, as everywhere else: three cards can draw from three different
  // buckets once eventType is live, and index 2 of one is not index 2 of another.
  const takenByBucket = new Map<string, Set<number>>();
  const artFor = (item: Pick<NewsItem, "eventType" | "guid" | "link">) =>
    planCardArt({
      // LEAD, not compact. These cards carry a headline, a four-line summary
      // and a link — the lead shape — and they render the art full card width
      // rather than in the 104px square the publisher thumbnail used to take.
      variant: "lead",
      eventType: item.eventType,
      sectorBucket,
      key: item.guid ?? item.link,
      taken: takenByBucket,
      // Always a ticker here: the whole strip is about one symbol.
      canGenerate: true,
    });

  // The sparkline window, matching the stock news page: last ~30 sessions, long
  // enough to have a shape and short enough that "recent" is honest.
  const sparkPoints = data.history.slice(-30).map((point) => point.close).filter(Number.isFinite);
  const sparkFirst = sparkPoints[0];
  const sparkLast = sparkPoints[sparkPoints.length - 1];
  const changePct =
    sparkPoints.length >= 2 && typeof sparkFirst === "number" && sparkFirst > 0
      ? ((sparkLast - sparkFirst) / sparkFirst) * 100
      : null;

  return {
    symbol: data.symbol,
    companyName: data.companyName,
    isInvalidTicker: data.isInvalidTicker,
    trend: data.trend,
    newsScoreLabel: data.newsScore.available ? data.newsScore.label : null,
    newsScoreValue: data.newsScore.available ? data.newsScore.score : null,
    cards: data.detailedNews.map((item) => ({
      title: item.title,
      source: item.source,
      pubDate: item.pubDate,
      summary: item.description ?? "No summary available yet.",
      image: item.image ?? null,
      link: item.link ?? null,
      art: artFor(item),
    })),
    ctaHref: `/stock/${encodeURIComponent(data.symbol)}/news`,
    changePct,
    sparkPoints,
  };
}
