import { NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import { fetchQuoteSnapshot, emptyQuote } from "@/lib/server/quoteData";
import {
  QUOTE_TOKEN_HEADER,
  verifyQuoteToken,
  isQuoteTokenEnforced,
} from "@/lib/server/quoteToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();

  // Deep Analysis: fetchQuoteSnapshot() (lib/server/quoteData.ts) now sits
  // behind a short (60s) Redis cache + in-flight request dedupe -- see that
  // module's comment for why -- but this route is still the primary public
  // entry point for quote data and any cache miss is still a real, billed
  // FMP hit, so it stays on the deeper check. checkLevel here MUST match the
  // advancedOptions set for "/api/quote" in instrumentation-client.ts, or
  // verification fails outright.
  if (await isUnwantedBot("deepAnalysis")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Page-token gate. BotID above answers "is this a real browser?"; this
  // answers "did this request come from someone who actually loaded one of
  // our pages?" -- the gap the 2026-07-21 audit's scripted ticker-walk sat in.
  //
  // LOG-ONLY BY DEFAULT. verifyQuoteToken() returns ok for everyone until
  // QUOTE_TOKEN_SECRET is set, and even then nothing is blocked until
  // QUOTE_TOKEN_ENFORCE=1. Deploying this with no env vars set changes
  // nothing. Read these log lines first: a steady trickle of "expired" means
  // QUOTE_TOKEN_TTL_SECONDS is too short for real sessions, and "missing"
  // from real visitors means a call site was left unwired -- either would
  // become a visible outage if enforcement were switched on blind. This is
  // the same staged rollout BotID and the AI Bots rule got.
  const tokenResult = verifyQuoteToken(req.headers.get(QUOTE_TOKEN_HEADER));
  if (!tokenResult.ok) {
    if (isQuoteTokenEnforced()) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    console.warn(
      `[quote-token] would-block symbol=${symbol} reason=${tokenResult.reason} (log-only; set QUOTE_TOKEN_ENFORCE=1 to enforce)`
    );
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
