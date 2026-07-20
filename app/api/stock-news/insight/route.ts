import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAiNewsInsight } from "@/lib/ai-news-briefs";
import { buildBeyondHeadline, buildWhatItMeans, type ScoreTone } from "@/lib/stock-news-templates";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";

type RequestItem = {
  title?: unknown;
  source?: unknown;
  pubDate?: unknown;
  description?: unknown;
};

type RequestBody = {
  symbol?: unknown;
  companyName?: unknown;
  trend?: unknown;
  newsScore?: { score?: unknown; tone?: unknown; label?: unknown };
  earningsScore?: { label?: unknown };
  lastRsi?: unknown;
  priceVs50?: unknown;
  priceVs200?: unknown;
  recentHigh?: unknown;
  recentLow?: unknown;
  items?: RequestItem[];
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tone(value: unknown): ScoreTone {
  return value === "green" || value === "red" ? value : "yellow";
}

type CleanItem = {
  title: string;
  source: string | null;
  pubDate: string | null;
  description: string | null;
  summary: string | null;
  whyItMatters: string | null;
};

type CachedPayload = {
  symbol: string;
  companyName: string;
  trend: string;
  newsScoreLabel: string;
  newsScoreValue: number;
  earningsTone: string;
  rsi: number | null;
  priceVs50: number | null;
  priceVs200: number | null;
  recentHigh: number | null;
  recentLow: number | null;
  items: CleanItem[];
};

// The cache key is derived from the full payload below, which includes the
// current top-article set (title/source/pubDate/description for each). As
// long as that article set is unchanged, repeated clicks across every
// visitor hit the same cached AI read -- this is a shared, effectively
// indefinite cache (revalidate: false). The moment a new article enters the
// top set (or an old one drops out), the serialized payload changes, so
// unstable_cache naturally produces a fresh cache key and a fresh AI call.
// No manual invalidation is needed.
const getCachedInsight = unstable_cache(
  async (payloadJson: string) => {
    const payload = JSON.parse(payloadJson) as CachedPayload;
    return getAiNewsInsight(payload);
  },
  ["msh-news-insight-route-v1"],
  { revalidate: false }
);

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ai: false, beyondHeadline: "", whatItMeans: [] }, { status: 400 });
  }

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const symbol = str(body.symbol).toUpperCase();
  if (!symbol) {
    return NextResponse.json({ ai: false, beyondHeadline: "", whatItMeans: [] }, { status: 400 });
  }

  const companyName = str(body.companyName);
  const trend = str(body.trend);
  const newsScoreTone = tone(body.newsScore?.tone);
  const newsScoreLabel = str(body.newsScore?.label) || "Neutral";
  const newsScoreValue = num(body.newsScore?.score) ?? 50;
  const earningsToneLabel = str(body.earningsScore?.label) || "Unavailable";
  const rsi = num(body.lastRsi);
  const priceVs50 = num(body.priceVs50);
  const priceVs200 = num(body.priceVs200);
  const recentHigh = num(body.recentHigh);
  const recentLow = num(body.recentLow);

  const items: CleanItem[] = Array.isArray(body.items)
    ? body.items
        .filter((item) => typeof item?.title === "string" && item.title.trim())
        .slice(0, 5)
        .map((item) => ({
          title: str(item.title),
          source: strOrNull(item.source),
          pubDate: strOrNull(item.pubDate),
          description: strOrNull(item.description),
          summary: strOrNull(item.description),
          whyItMatters: null,
        }))
    : [];

  const fallbackBeyondHeadline = buildBeyondHeadline({
    symbol,
    newsScore: { tone: newsScoreTone },
    trend,
    recentHigh,
    recentLow,
  });
  const fallbackWhatItMeans = buildWhatItMeans({
    symbol,
    trend,
    newsScore: { tone: newsScoreTone },
    rsi,
    priceVs50,
  });

  if (!items.length) {
    return NextResponse.json({ ai: false, beyondHeadline: fallbackBeyondHeadline, whatItMeans: fallbackWhatItMeans });
  }

  const payload: CachedPayload = {
    symbol,
    companyName,
    trend,
    newsScoreLabel,
    newsScoreValue,
    earningsTone: earningsToneLabel,
    rsi,
    priceVs50,
    priceVs200,
    recentHigh,
    recentLow,
    items,
  };

  try {
    const insight = await getCachedInsight(JSON.stringify(payload));
    if (insight?.beyondHeadline?.trim() && insight.whatItMeans?.length) {
      return NextResponse.json({ ai: true, beyondHeadline: insight.beyondHeadline, whatItMeans: insight.whatItMeans });
    }
  } catch {
    // Fall through to the algorithmic fallback below.
  }

  return NextResponse.json({ ai: false, beyondHeadline: fallbackBeyondHeadline, whatItMeans: fallbackWhatItMeans });
}
