import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
import { warmPricePool } from "../../../../lib/server/pricePool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60 WAS NOT ENOUGH. Confirmed live 2026-08-06 16:45:17Z:
//   GET /api/jobs/warm-price-pool 504
//   Vercel Runtime Timeout Error: Task timed out after 60 seconds
//
// The slice is ceil(universe/4), so as the universe grew (416 -> 663) the
// per-run work grew with it: priceCap 166 means 166 SEQUENTIAL stable/quote
// calls plus up to PE_MAX_PER_RUN (20) ratios-ttm calls, each awaited one at a
// time and paced by reserveFmpCallSlot. Most runs finished just inside 60s;
// that one did not, and the whole run was discarded -- so those symbols kept
// stale prices until the rotation came round again.
//
// 300 (the Pro ceiling) rather than a smaller bump: the run is paced by the FMP
// budget guard, not by CPU, so the honest fix is to stop cutting it off
// mid-rotation. The real fix is bounded-concurrency fetching, but that needs
// hasFmpCapacity to become a reservation first (it is currently a TOCTOU-racy
// plain GET), so it is not a one-liner and does not belong in an urgent fix.
export const maxDuration = 300;

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
    await recordJobRun("warm-price-pool", result.ok !== false, {
      targets: symbols.length,
      written: result.written ?? null,
      // Surfaced on the cache health page next to priceRefreshed. Zero opens
      // against a non-zero refresh count means stable/quote stopped carrying
      // OHLC -- a degradation that is otherwise completely invisible, since
      // every consumer treats those fields as optional.
      priceRefreshed: result.priceRefreshed ?? null,
      openCarried: result.openCarried ?? null,
      reason: result.reason ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "warm-price-pool failed";
    // Recorded on the throw too. Without this the page shows the last
    // SUCCESSFUL run and reads healthy while the job has been failing.
    await recordJobRun("warm-price-pool", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
