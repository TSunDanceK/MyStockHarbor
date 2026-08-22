import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
import { warmStockData } from "../../../../lib/server/stockDataCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Raised alongside warm-price-pool, which demonstrably 504'd at 60s once the
// universe grew. This route is arguably MORE exposed: REFRESH_SLICE_SIZE is 25
// and CALLS_PER_SYMBOL is 8, so a full slice is ~200 sequential FMP calls in
// one run -- a fixed cost that has always been close to the old 60s ceiling,
// independent of universe size. It simply had not been observed failing yet.
export const maxDuration = 300;

// Cron (see vercel.json) that refreshes the Redis-cached extended stock data
// (valuation / dividends / financials / analyst fields) for the current
// universe, so the screener list-view tabs render with zero FMP calls per page
// load. Reads the symbol set from the already-cached pickers payload, then
// hands it to warmStockData(), which refreshes the stalest slice per run under
// the shared budget guard.

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
  if (!process.env.FMP_API_KEY) {
    return NextResponse.json(
      { error: "Missing FMP_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com";

  try {
    // Displayed symbols UNION the rolling dynamic universe, so a symbol that
    // rotates into the scan is already warm rather than arriving cold.
    // See lib/server/warmTargets.ts for why this must not be a replacement.
    const { symbols, displayed, universe } = await getWarmTargetSymbols(base);
    console.log(`[warm-stock-data] targets: ${symbols.length} (displayed ${displayed}, universe ${universe})`);

    const result = await warmStockData(symbols, Date.now());
    console.log("[warm-stock-data]", JSON.stringify(result));
    await recordJobRun("warm-stock-data", result.ok !== false, {
      targets: symbols.length,
      written: result.written ?? null,
      reason: result.reason ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "warm-stock-data failed";
    await recordJobRun("warm-stock-data", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
