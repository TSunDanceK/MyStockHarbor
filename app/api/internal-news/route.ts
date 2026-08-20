import { NextResponse } from "next/server";
import {
  getInternalNewsPayload,
  normaliseInternalNewsSymbol,
  INTERNAL_NEWS_CACHE_CONTROL,
} from "@/lib/server/internalNews";

export const runtime = "nodejs";
export const revalidate = 900;

// Was getStockNewsData() (base data + AI-generated "why it matters" line per
// article via an OpenAI call, cached 1h per symbol). Per owner request:
// no automatic AI generation on the dashboard's news cards -- show the
// real article excerpt (FMP's own description/text, already trimmed to
// ~650 chars in lib/stock-news-data.ts) instead of an AI summary/"why this
// matters" line. getStockNewsBaseData() is the same underlying data source
// with zero LLM calls.
//
// The payload construction itself now lives in lib/server/internalNews.ts so
// app/dashboard/page.tsx can build the same object in-process instead of
// HTTP self-fetching this route. This handler is the public HTTP face of that
// function and nothing more -- see that file for why the self-fetch went.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = normaliseInternalNewsSymbol(searchParams.get("symbol"));

  const payload = await getInternalNewsPayload(symbol);

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": INTERNAL_NEWS_CACHE_CONTROL,
    },
  });
}
