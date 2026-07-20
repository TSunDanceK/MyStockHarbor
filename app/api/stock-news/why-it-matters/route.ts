import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAiNewsBriefs, type AiNewsBriefInputItem } from "@/lib/ai-news-briefs";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";

type RequestItem = {
  title?: unknown;
  link?: unknown;
  source?: unknown;
  pubDate?: unknown;
  description?: unknown;
};

type RequestBody = {
  symbol?: unknown;
  companyName?: unknown;
  trend?: unknown;
  newsScoreLabel?: unknown;
  item?: RequestItem;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

type CachedPayload = {
  symbol: string;
  companyName: string;
  trend: string;
  newsScoreLabel: string;
  item: AiNewsBriefInputItem;
};

// A given article's title/source/description never changes once published,
// so this is cached indefinitely (revalidate: false) rather than on a
// timer. The cache key is derived from the full payload below (title,
// source, pubDate, description), which is a stable, content-addressed
// identifier for the article -- unstable_cache folds the serialized
// argument into the cache key alongside the static key part.
const getCachedWhyItMatters = unstable_cache(
  async (payloadJson: string) => {
    const payload = JSON.parse(payloadJson) as CachedPayload;

    const briefs = await getAiNewsBriefs({
      symbol: payload.symbol,
      companyName: payload.companyName,
      trend: payload.trend,
      newsScoreLabel: payload.newsScoreLabel,
      items: [payload.item],
    });

    const brief = briefs[0];
    return brief?.whyItMatters?.trim() ? brief.whyItMatters.trim() : null;
  },
  ["msh-why-it-matters-v1"],
  { revalidate: false }
);

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ai: false, whyItMatters: null }, { status: 400 });
  }

  // Deep Analysis (2026-07-20): this route calls OpenAI on a cache keyed by
  // the full request payload (including attacker-controlled article
  // title/description text), so varying that text forces fresh, billed
  // OpenAI calls on every attempt -- a cheap way to run up real API cost.
  // checkLevel here MUST match the advancedOptions set for this path/method
  // in instrumentation-client.ts, or verification fails outright.
  if (await isUnwantedBot("deepAnalysis")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const symbol = str(body.symbol).toUpperCase();
  const title = str(body.item?.title);

  if (!symbol || !title) {
    return NextResponse.json({ ai: false, whyItMatters: null }, { status: 400 });
  }

  const item: AiNewsBriefInputItem = {
    title,
    source: strOrNull(body.item?.source),
    pubDate: strOrNull(body.item?.pubDate),
    description: strOrNull(body.item?.description),
  };

  const payload: CachedPayload = {
    symbol,
    companyName: str(body.companyName),
    trend: str(body.trend),
    newsScoreLabel: str(body.newsScoreLabel) || "Neutral",
    item,
  };

  try {
    const whyItMatters = await getCachedWhyItMatters(JSON.stringify(payload));
    if (whyItMatters) {
      return NextResponse.json({ ai: true, whyItMatters });
    }
  } catch {
    // Fall through -- the client already has the algorithmic fallback
    // showing and will simply keep it.
  }

  return NextResponse.json({ ai: false, whyItMatters: null });
}
