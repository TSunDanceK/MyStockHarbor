import { NextResponse } from "next/server";
import { getAllPosts } from "@/lib/blog";
import { getStockNewsData } from "@/lib/stock-news-data";

export const runtime = "nodejs";
export const revalidate = 900;

// Backs the homepage "What's happening across MyStockHarbor" discovery
// strip. The strip's tile copy is fixed (see DiscoveryStrip.tsx) - this
// route only resolves *where* each tile links to, so visitors land on
// today's actual latest content (the newest insight post, its symbol's
// earnings page) instead of a generic section index. Bottlenecks and
// Pickers link to their static index pages and don't need any data here.

const NEWS_SYMBOL = "SPY";
const FALLBACK_EARNINGS_SYMBOL = "AAPL";

export async function GET() {
  let insight: { slug: string; symbol: string | null } | null = null;
  try {
    const posts = getAllPosts();
    if (posts.length > 0) {
      const latest = posts[0];
      insight = {
        slug: latest.slug,
        symbol: latest.symbol ?? null,
      };
    }
  } catch {
    insight = null;
  }

  let newsSymbol: string | null = null;
  try {
    const newsData = await getStockNewsData(NEWS_SYMBOL, {
      maxDetailedItems: 1,
      includeInsight: false,
    });
    newsSymbol = newsData.symbol;
  } catch {
    newsSymbol = null;
  }

  const earningsSymbol = insight?.symbol || FALLBACK_EARNINGS_SYMBOL;

  return NextResponse.json(
    {
      insight,
      newsSymbol,
      earningsSymbol,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    }
  );
}
