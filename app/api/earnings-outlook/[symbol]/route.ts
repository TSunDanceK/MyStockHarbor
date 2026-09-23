import { NextResponse } from "next/server";
import { getSymbolOutlook } from "@/lib/server/symbolOutlook";
import { isUnwantedBot } from "@/lib/botid-guard";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
};

function cleanSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

// The ticker search's answer to "when does this report next", from the SEC
// filing record rather than FMP's calendar.
//
// ── WHY IT IS NOT A FIELD ON /api/stock-earnings/[symbol] ─────────────────
// That route is a thin wrapper over lib/latest-earnings-data.ts, which the
// News page and the stock page also call for actuals, surprises and revisions.
// Hanging this off it would mean every search pulled a full FMP earnings
// payload to read one estimate computed from a different source entirely --
// and would leave the FMP call on the page's critical path after the whole
// point of this change was taking it off. Separate question, separate route.
//
// ── THIS ONE *DOES* PASS THE CACHEABILITY TEST ITS SIBLING FAILS ──────────
// /api/stock-valuation set the precondition for these routes: "a 200 that might
// mean 'we are broken' cannot safely be stored, so the distinction has to exist
// before anyone adds a cache header here, not after." /api/stock-earnings still
// fails it -- getLatestEarningsData swallows its own errors into an all-nulls
// 200, so "FMP is down" and "no earnings" are the same response.
//
// getSymbolOutlook does not: an unreadable store is `kind: "unavailable"` and
// leaves here as a 503, distinguishable by status alone. A cache header is
// therefore SAFE to add and is still deliberately not added, because nothing
// has measured what window is right for it. The precondition is met; the
// decision is a separate one, and this comment exists so the next person finds
// the gate already open rather than re-deriving why it was shut.
export async function GET(_request: Request, { params }: Props) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  if (!clean) {
    return NextResponse.json({ error: "Bad symbol" }, { status: 400 });
  }

  // The estimator's "today" is UTC, the same day boundary every date in the
  // stored record and in dueToReport is measured against. A local-time "today"
  // here would shift the band by a day for half the world's readers.
  const today = new Date().toISOString().slice(0, 10);
  const outlook = await getSymbolOutlook(clean, today);
  return NextResponse.json(outlook, { status: outlook.kind === "unavailable" ? 503 : 200 });
}
