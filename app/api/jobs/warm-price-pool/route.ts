import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
import { warmPricePool, keepPricePoolAlive } from "../../../../lib/server/pricePool";
import { isActiveMarketWindow } from "../../../../lib/server/marketHours";

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
    // THE GATE COMES FIRST, AND IT DID NOT.
    //
    // warmPricePool's own market-hours check is inside warmPricePool, so this
    // route derived its target list -- the single most expensive thing it does
    // -- and only then discovered there was nothing to do. Observed in
    // production overnight on 2026-09-04: a warm-targets miss at 01:00, 02:05
    // and 03:10 UTC, each rebuilding the entire picker universe, each followed
    // immediately by `{"skipped":true,"reason":"market-closed","written":0}`.
    //
    // The window is shut for ~15 hours a day plus weekends, which is over half
    // of this job's 288 daily runs doing work for a run that cannot use it.
    //
    // CHECKED AGAINST THE SAME PREDICATE warmPricePool uses, not a second copy
    // of the hours -- two answers to "is the market open" is
    // claude/traps/two-validators-for-one-value.md, and /api/history already
    // paid for that once.
    if (!isActiveMarketWindow()) {
      // THE TTL RESET COMES WITH THE GATE, OR THE GATE IS #395 AGAIN.
      //
      // warmPricePool's own market gate resets PRICE_POOL_HASH_TTL_SECONDS
      // before returning -- that reset IS #398, and it exists because HSET does
      // not extend an existing TTL, so a pool nothing writes to across a
      // 15-hour weeknight gap simply expires. Returning here means
      // warmPricePool is never called, which puts that reset on an unreachable
      // path and empties the pool overnight exactly as #395 did.
      //
      // Caught in review of #419, before it shipped. The saving is real and the
      // gate stays; the reset is hoisted to the same decision instead, through
      // the single exported keep-alive so there is no second expire to drift.
      const poolKeptAlive = await keepPricePoolAlive();
      await recordJobRun("warm-price-pool", true, {
        skipped: true,
        reason: "market-closed",
        written: 0,
        // RECORDED, because a keep-alive nobody can see is how the last one hid
        // for a fortnight. `false` here on a market-closed run means the pool is
        // now counting down to an expiry with nothing to stop it.
        poolKeptAlive,
        // NAMED SO THE SKIP IS DISTINGUISHABLE FROM THE OLD ONE. The previous
        // market-closed record was written after a full target derivation; this
        // one is written instead of it. Without the flag the two are the same
        // line on /cache-health and the saving is invisible.
        targetsSkipped: true,
      });
      // No releaseLock here: the `finally` below owns it, and releasing twice
      // means the second call can delete a token a LATER run has already taken.
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "market-closed",
        targetsSkipped: true,
      });
    }

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
      // WHY a quote did not land, which is the difference between a delisting
      // and a bad afternoon. quotesRefused spiking with empties flat is an FMP
      // incident and nothing should be parked; empties rising on their own is
      // what a delisting actually looks like. deferSuppressed true means the
      // run discarded its deferrals wholesale as untrustworthy.
      quotesRefused: result.quotesRefused ?? null,
      empties: result.empties ?? null,
      priceAttempts: result.priceAttempts ?? null,
      deferSuppressed: result.deferSuppressed ?? null,
      // Repeatedly-failing symbols parked this run, and the standing total. A
      // flat newlyDeferred with a steady deferredSymbols is a settled set of
      // dead tickers doing no harm; a rising newlyDeferred is something
      // breaking that is not about delistings.
      newlyDeferred: result.newlyDeferred ?? null,
      deferredSymbols: result.deferredSymbols ?? null,
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
