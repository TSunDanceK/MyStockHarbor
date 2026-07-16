import { NextResponse } from "next/server";
import { getStockNewsBaseData } from "@/lib/stock-news-data";

export const runtime = "nodejs";
export const revalidate = 900;

// Was getStockNewsData() (base data + AI-generated "why it matters" line per
// article via an OpenAI call, cached 1h per symbol). Per owner request:
// no automatic AI generation on the dashboard's news cards -- show the
// real article excerpt (FMP's own description/text, already trimmed to
// ~650 chars in lib/stock-news-data.ts) instead of an AI summary/"why this
// matters" line. getStockNewsBaseData() is the same underlying data source
// with zero LLM calls.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "SPY").trim().toUpperCase();

  const data = await getStockNewsBaseData(symbol, {
    maxDetailedItems: 3,
  });

  return NextResponse.json(
    {
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
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    }
  );
}
