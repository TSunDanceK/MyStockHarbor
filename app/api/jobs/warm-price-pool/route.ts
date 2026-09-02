import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
import { warmPricePool } from "../../../../lib/server/pricePool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60 WAS NOT ENOUGH. Confirmed live 2026-08-06 16:45:17Z:
//   GET /api/jobs/warm-price-pool 504
//   Vercel Runtime Timeout Error: Task timed out after 60 seconds
//
// The slice was ceil(universe/4) at the time, so as the universe grew
// (416 -> 663) the per-run work grew with it: priceCap 166 means 166 SEQUENTIAL
// stable/quote calls plus up to PE_MAX_PER_RUN (20) ratios-ttm calls, each
// awaited one at a time and paced by reserveFmpCallSlot. Most runs finished
// just inside 60s; that one did not, and the whole run was discarded -- so
// those symbols kept stale prices until the rotation came round again.
//
// The slice is now TTL-selected rather than a fixed fraction, and skipped
// entirely outside market hours, so a typical run is far smaller. PRICE_MAX_PER_RUN
// still bounds the worst case -- the first run after the overnight gap, when
// every symbol is due at once -- which is the run this limit has to survive.
//
// 300 (the Pro ceiling) rather than a smaller bump: the run is paced by the FMP
// budget guard, not by CPU, so the honest fix is to stop cutting it off
// mid-rotation. The real fix is bounded-concurrency fetching, but that needs
// hasFmpCapacity to become a reservation first (it is currently a TOCTOU-racy
// plain GET), so it is not a one-liner and does not belong in an urgent fix.
export const maxDuration = 300;

// Cron-driven refresh of the shared price pool (msh:price-pool:v1). PRICE is
// refreshed for whichever symbols are past their own tier's TTL -- 15 minutes
// for the attention tier, 30 for the rest -- and only inside the buffered US
// session; PE trickles on its own slower rotation (see lib/server/pricePool.ts,
// lib/server/priceTiers.ts, lib/server/marketHours.ts). READ-ONLY on page
// renders, so a page load never spends an FMP call. Reads the symbol set from
// the already-cached pickers payload. The cadence itself is in the JOBS
// registry (jobRuns.ts) -- this comment used to name it and was still saying
// "every 3 min" long after #374 moved it to */5.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const PRICE_POOL_LOCK_KEY = "msh:price-pool:v1:warm-lock";

// MUST EXCEED maxDuration. The cron fires every 300s and a run may take all 300s
// of its budget, so the two can touch exactly -- which is the whole reason this
// lock exists. A TTL at or under maxDuration would expire the lock right as the
// overrunning run is still going, i.e. it would fail open in precisely the case
// it was added for. Six minutes leaves a margin and still self-heals within one
// cron period if a run dies without releasing.
const PRICE_POOL_LOCK_TTL_SECONDS = 6 * 60;

async function acquireLock() {
  if (!redis) return "no-redis";

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(PRICE_POOL_LOCK_KEY, token, {
    nx: true,
    ex: PRICE_POOL_LOCK_TTL_SECONDS,
  });

  return result === "OK" ? token : null;
}

async function releaseLock(token: string | null) {
  if (!redis || !token || token === "no-redis") return;

  try {
    // Compare before deleting: if this run overran its TTL the lock now belongs
    // to a successor, and deleting it would hand a third run the door key.
    const current = await redis.get<string>(PRICE_POOL_LOCK_KEY);
    if (current === token) await redis.del(PRICE_POOL_LOCK_KEY);
  } catch {
    // fail open
  }
}

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

  const lock = await acquireLock();
  if (!lock) {
    // RECORDED, NOT SILENT. Mirrors warm-earnings: a skip is a healthy outcome,
    // but an unrecorded one is indistinguishable on /cache-health from the job
    // having stopped running at all.
    await recordJobRun("warm-price-pool", true, { skipped: true, reason: "locked" });
    return NextResponse.json({ ok: true, skipped: true, reason: "locked" });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com";

  try {
    // Displayed symbols UNION the rolling dynamic universe, so a symbol that
    // rotates into the scan is already warm rather than arriving cold.
    // See lib/server/warmTargets.ts for why this must not be a replacement.
    const { symbols, displayed, universe, tier1 } = await getWarmTargetSymbols(base);
    console.log(
      `[warm-price-pool] targets: ${symbols.length} (displayed ${displayed}, universe ${universe}, tier1 ${tier1})`
    );

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
      // A market-closed run is a healthy skip, not a failure -- but an
      // UNRECORDED skip is indistinguishable on /cache-health from the job
      // having stopped. Same reasoning as the lock skip above.
      skipped: result.skipped ?? null,
      // The tier policy, made visible. `due` at or below `priceCap` with
      // `deferredByCap` at 0 means freshness is actually governed by the TTLs;
      // a persistent non-zero deferral means the per-run cap is the real policy
      // and the TTLs are aspirational. Recording it is what makes the worst
      // case observable rather than assumed.
      tier1: result.tier1 ?? null,
      due: result.due ?? null,
      deferredByCap: result.deferredByCap ?? null,
      quoteFailures: result.quoteFailures ?? null,
      // Was `capacityStopped`, which meant "the current minute filled up" and
      // was true on essentially every run. The loop now waits out a full minute
      // bucket instead of ending on one, so the only thing that stops a run
      // early is its own time budget -- rarer, and the signal worth an alert.
      outOfTime: result.outOfTime ?? null,
      reason: result.reason ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "warm-price-pool failed";
    // Recorded on the throw too. Without this the page shows the last
    // SUCCESSFUL run and reads healthy while the job has been failing.
    await recordJobRun("warm-price-pool", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await releaseLock(lock);
  }
}
