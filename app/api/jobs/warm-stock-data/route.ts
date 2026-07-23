import { NextRequest, NextResponse } from "next/server";
import { getPickersData } from "../../../../lib/server/pickersBuilder";
import { warmStockData } from "../../../../lib/server/stockDataCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Each refreshed symbol costs ~7 FMP calls; let a full slice finish under the
// shared 300/min budget guard without being cut short.
export const maxDuration = 60;

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
    const payload = await getPickersData(base);
    const symbols = Array.from(
      new Set((payload.signalRecords ?? []).map((r) => r.symbol).filter(Boolean))
    );

    const result = await warmStockData(symbols, Date.now());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "warm-stock-data failed" },
      { status: 500 }
    );
  }
}
