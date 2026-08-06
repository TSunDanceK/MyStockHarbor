import { NextRequest, NextResponse } from "next/server";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
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
    // Displayed symbols UNION the rolling dynamic universe, so a symbol that
    // rotates into the scan is already warm rather than arriving cold.
    // See lib/server/warmTargets.ts for why this must not be a replacement.
    const { symbols, displayed, universe } = await getWarmTargetSymbols(base);
    console.log(`[warm-price-pool] targets: ${symbols.length} (displayed ${displayed}, universe ${universe})`);

    const result = await warmPricePool(symbols, Date.now());
    console.log("[warm-price-pool]", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "warm-price-pool failed" },
      { status: 500 }
    );
  }
}
