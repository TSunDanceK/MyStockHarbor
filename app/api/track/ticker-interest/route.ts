// POST /api/track/ticker-interest
//
// Public, fire-and-forget endpoint hit by the client-side beacon when a user
// deliberately SELECTS a ticker from a search result (see
// app/lib/trackTickerInterest.ts). Counting only from this client event is the
// core bot defense: server-side crawlers that never run JS never call this.
//
// Always returns 204 fast and never blocks -- validation, dedup and rate-limit
// all live in recordTickerInterest(). No auth (it's a demand counter), no
// personal data stored (the IP is only hashed into a rate-limit key).

import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/server/backfillAuth";
import { recordTickerInterest } from "@/lib/server/searchDemand";
import { canWriteDemandState } from "@/lib/server/demandWriteGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // OUT BEFORE THE BODY IS EVEN READ. recordTickerInterest refuses on its own
  // too — this is the same answer given one layer earlier, so a preview beacon
  // costs a 204 rather than a parse and three Redis round trips it will
  // discard. Same status either way: the beacon must not be able to tell.
  if (!canWriteDemandState()) return new NextResponse(null, { status: 204 });
  try {
    // The beacon sends a small JSON string ({"symbol":"AAPL"}); req.json() reads
    // the body as text and parses it regardless of the beacon's content-type.
    const body = (await req.json().catch(() => null)) as { symbol?: unknown } | null;
    const symbol = body && typeof body.symbol === "string" ? body.symbol : "";
    if (symbol) {
      await recordTickerInterest(symbol, getClientIp(req));
    }
  } catch {
    // Never surface anything to a fire-and-forget beacon.
  }

  return new NextResponse(null, { status: 204 });
}
