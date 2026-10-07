import { NextResponse } from "next/server";
import { NotSettled, getDashboardEarnings } from "@/lib/server/dashboardEarnings";
import { cleanSymbol } from "@/lib/symbol";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";

type Props = { params: Promise<{ symbol: string }> };

// THE ANALYSER'S "FILED EARNINGS" CHART (#563 COWORK #154 §6): the newest 8
// filed quarters' diluted EPS and operating margin for one symbol. BotID-guarded
// (instrumentation-client.ts lists the path).
//
// CACHEABLE BECAUSE IT CAN TELL "NONE" FROM "BROKEN" (the precondition
// /api/stock-earnings' comment sets): "no figures for this symbol" is a 200 with
// available: false and is cached like any answer. "Not read yet" (which is also
// how a failed store read comes back) and any thrown error are answered with
// no-store, so a Redis outage is never pinned to the CDN or the Data Cache.
export async function GET(_request: Request, { params }: Props) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const { symbol } = await params;
  try {
    const data = await getDashboardEarnings(symbol);
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (e) {
    // Not read yet, or the store could not answer: the empty state, uncached.
    if (e instanceof NotSettled) return NextResponse.json({ symbol: cleanSymbol(symbol), available: false }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
