import { NextRequest, NextResponse } from "next/server";
import { getPickersData } from "../../../../lib/server/pickersBuilder";
import { warmPricePool } from "../../../../lib/server/pricePool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every-15-min cron (see vercel.json) that refreshes the shared price pool
// (msh:price-pool:v1) for the symbols the screener displays, so the list view
// can show ~15-min-fresh price / % change / volume / market cap / PE with zero
// FMP calls per page render. Reads the symbol set from the already-cached
// pickers payload, then hands it to warmPricePool() (one full-quote batch per
// ~100 symbols, under the shared 300/min FMP budget guard).

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

    const result = await warmPricePool(symbols, Date.now());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "warm-price-pool failed" },
      { status: 500 }
    );
  }
}
