import { NextResponse } from "next/server";
import { getAllPosts } from "@/lib/blog";
import { getBottleneckCompanyCounts } from "@/lib/bottlenecks";
import { getStockNewsData } from "@/lib/stock-news-data";

export const runtime = "nodejs";
export const revalidate = 900;

// Backs the homepage "What's happening across MyStockHarbor" discovery strip.
// Pulls a small, cheap live snippet from each of the site's main sections
// (Bottlenecks, Insights, AI News, Pickers, Earnings) so the homepage shows
// real breadth instead of just a nav bar. Every source here is either a
// build-time/static-file read (bottlenecks, insights) or already-cached
// (stock news, 15 min) - nothing here triggers a fresh AI generation per
// homepage visit.

const PICKERS_SETUP_COUNT = 17;
const NEWS_SYMBOL = "SPY";
const FALLBACK_EARNINGS_SYMBOL = "AAPL";

export async function GET() {
  let bottleneck: { name: string; ticker: string | null; count: number } | null = null;
  try {
    const counts = getBottleneckCompanyCounts();
    if (counts.length > 0) {
      bottleneck = {
        name: counts[0].name,
        ticker: counts[0].ticker,
        count: counts[0].count,
      };
    }
  } catch {
    bottleneck = null;
  }

  let insight: { title: string; slug: string; symbol: string | null; date: string } | null = null;
  try {
    const posts = getAllPosts();
    if (posts.length > 0) {
      const latest = posts[0];
      insight = {
        title: latest.title,
        slug: latest.slug,
        symbol: latest.symbol ?? null,
        date: latest.date,
      };
    }
  } catch {
    insight = null;
  }

  let news: { symbol: string; scoreLabel: string; headline: string | null } | null = null;
  try {
    const newsData = await getStockNewsData(NEWS_SYMBOL, {
      maxDetailedItems: 1,
      includeInsight: false,
    });
    news = {
      symbol: newsData.symbol,
      scoreLabel: newsData.newsScore.label,
      headline: newsData.detailedNews?.[0]?.title ?? null,
    };
  } catch {
    news = null;
  }

  const earningsSymbol = insight?.symbol || FALLBACK_EARNINGS_SYMBOL;

  return NextResponse.json(
    {
      bottleneck,
      insight,
      news,
      pickers: { count: PICKERS_SETUP_COUNT },
      earnings: { symbol: earningsSymbol },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    }
  );
}
