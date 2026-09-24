import { NextResponse } from "next/server";
import { secEarningsSummary } from "@/lib/server/secEarningsSummary";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
};

function cleanSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

// THE DASHBOARD PILL'S CLIENT REFETCH. Since 2026-09-23 (#535 COWORK #18 §3)
// it returns the SEC snapshot's verdict (lib/server/secEarningsSummary.ts) —
// hasStructuredData, tone and the band label, nothing else. It used to return
// lib/latest-earnings-data.ts's FMP-based object, including FMP's exact
// `nextEarningsDate`, which the owner's 2026-09-23 ruling keeps off the site.
// DELIBERATELY NOT CDN-CACHED YET, and this is the reason rather than an
// oversight.
//
// /api/stock-valuation set the precondition for its sibling routes in its own
// comment: "a 200 that might mean 'we are broken' cannot safely be stored, so
// the distinction has to exist before anyone adds a cache header here, not
// after." THIS ROUTE STILL FAILS THAT TEST. secEarningsSummary catches its
// own errors and returns "Unavailable" with a 200, so "Redis is down" and
// "this ticker has no earnings" are the same response -- and a cache header
// would pin a failure onto every stock page for the length of the window.
//
// The fix is the status-code distinction, not the header, and that is its own
// change. Until then the client fetch stays uncached; it costs a Lambda per
// view, which is the smaller of the two wrongs.
export async function GET(_request: Request, { params }: Props) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  return NextResponse.json(await secEarningsSummary(clean));
}
