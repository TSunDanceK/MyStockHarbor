import { NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import { fetchQuoteSnapshot, emptyQuote } from "@/lib/server/quoteData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();

  // Deep Analysis: this route calls FMP live on every single request with
  // no caching (see fetchQuoteSnapshot in lib/server/quoteData.ts), so every
  // hit is a real, billed upstream call — it's the highest-value target on
  // the site for the deeper check. checkLevel here MUST match the
  // advancedOptions set for "/api/quote" in instrumentation-client.ts, or
  // verification fails outright.
  if (await isUnwantedBot("deepAnalysis")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    return NextResponse.json(emptyQuote(symbol), { status: 500 });
  }

  // Fetch/parse logic lives in lib/server/quoteData.ts so it can also be
  // called in-process (no HTTP self-fetch, no BotID header needed) by
  // server-rendered callers like lib/insightSnapshots.ts. See that module's
  // fetchQuoteSnapshot doc comment for the full reasoning.
  const payload = await fetchQuoteSnapshot(symbol);

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
