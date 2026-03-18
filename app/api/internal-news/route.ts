import { NextResponse } from "next/server";
import { getStockNewsData } from "@/lib/stock-news-data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "SPY").trim().toUpperCase();

  const data = await getStockNewsData(symbol, {
    maxDetailedItems: 3,
    includeInsight: false,
  });

  return NextResponse.json({
    symbol: data.symbol,
    companyName: data.companyName,
    isInvalidTicker: data.isInvalidTicker,
    trend: data.trend,
    newsScoreLabel: data.newsScore.label,
    newsScoreValue: data.newsScore.score,
    cards: data.detailedNews.map((item, index) => ({
      title: item.title,
      source: item.source,
      pubDate: item.pubDate,
      summary: data.aiBriefs[index]?.summary ?? item.description ?? "No summary available yet.",
      whyItMatters:
        data.aiBriefs[index]?.whyItMatters ??
        "This headline may matter if it changes how traders think about the stock near-term.",
      debugAiUsed: data.aiBriefs[index] ? 1 : 0,
    })),
    ctaHref: `/stock/${encodeURIComponent(data.symbol)}/news`,
  });
}
