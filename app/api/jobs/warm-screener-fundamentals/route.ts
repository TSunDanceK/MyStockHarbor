import { NextRequest, NextResponse } from "next/server";
import { refreshScreenerFundamentals } from "../../../../lib/server/screenerFundamentals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One FMP call plus one Redis pipeline. Nothing here waits on capacity the way
// warm-fundamentals does, so it does not need that route's 300s.
export const maxDuration = 60;

// Daily cron (see vercel.json), deliberately scheduled BEFORE warm-fundamentals
// so that job finds a freshly populated screener-fundamentals cache rather than
// an expired one.
//
// WHY IT EXISTS AS ITS OWN JOB. One company-screener call carries
// marketCap/sector/industry for ~1000 symbols, and caching it is what lets
// warmFundamentals skip a per-symbol `profile` fetch for most of the universe.
// That refresh used to happen ONLY as a side effect of a master-list rebuild
// inside /api/market -- a route nothing calls on a schedule. Measured
// 2026-08-22: no /api/market request in 24h, and warm-fundamentals reported
// `screenerCovered: 0` for all 755 symbols. The free industry source had
// drained past its 30h TTL with nothing to rewrite it, so every symbol fell
// through to the profile fetch, metered at 120 a day.
//
// This is the biggest lever on industry/sector coverage and it costs one FMP
// call a day.
function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshScreenerFundamentals(process.env.FMP_API_KEY);

  // Logged as well as returned: the cron invokes this and discards the body, so
  // without this line the run's coverage is invisible in Vercel logs. Same
  // reasoning as warm-fundamentals.
  //
  // `symbols` is dropped from both the log and the response -- it is ~1000
  // tickers and the count is the part anyone reads.
  const { symbols, ...summary } = result;
  const payload = { ...summary, symbolsReturned: symbols.length };
  console.log("[warm-screener-fundamentals]", JSON.stringify(payload));

  // 200 even on a failed refresh, with ok:false in the body. A 5xx here would
  // make Vercel's cron surface mark the job failed for something that is
  // routinely an upstream plan restriction, and the log line above is the
  // signal that matters. The one thing that must never happen is silence.
  return NextResponse.json(payload);
}
