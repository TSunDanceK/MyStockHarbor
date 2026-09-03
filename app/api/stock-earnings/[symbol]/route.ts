import { NextResponse } from "next/server";
import { getLatestEarningsData } from "@/lib/latest-earnings-data";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
};

function cleanSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

// Thin HTTP wrapper around the shared lib/latest-earnings-data.ts logic
// (the same computation the News page uses directly, server-side). This
// used to have its own separate FMP-endpoint-based implementation that
// diverged from the News page's numbers; see lib/latest-earnings-data.ts
// for why that was consolidated.
// DELIBERATELY NOT CDN-CACHED YET, and this is the reason rather than an
// oversight.
//
// /api/stock-valuation set the precondition for its sibling routes in its own
// comment: "a 200 that might mean 'we are broken' cannot safely be stored, so
// the distinction has to exist before anyone adds a cache header here, not
// after." THIS ROUTE STILL FAILS THAT TEST. getLatestEarningsData catches its
// own errors and returns an all-nulls object with a 200, so "FMP is down" and
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
  const data = await getLatestEarningsData(clean, "yellow");
  return NextResponse.json(data);
}
