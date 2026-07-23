import { NextRequest, NextResponse } from "next/server";
import { getPickersData } from "../../../../lib/server/pickersBuilder";
import { warmPricePool } from "../../../../lib/server/pricePool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow a full-coverage price run (stalest slice of the whole universe, paced
// under the 300/min FMP budget guard) to finish without being cut short.
export const maxDuration = 60;

// Every-3-min cron (see vercel.json) that refreshes the shared price pool
// (msh:price-pool:v1). PRICE is refreshed for a stalest slice sized so the
// whole displayed universe is covered every ~15 min; PE trickles on its own
// slower rotation (see lib/server/pricePool.ts). READ-ONLY on page renders, so
// a page load never spends an FMP call. Reads the symbol set from the already-
// cached pickers payload.

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
