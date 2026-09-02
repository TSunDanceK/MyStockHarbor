import { NextRequest, NextResponse } from "next/server";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
import { warmFundamentals } from "../../../../lib/server/fundamentalsCache";
import { recordJobRun } from "../../../../lib/server/jobRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The warm can now wait out a busy FMP minute rather than abandoning a stage,
// and falls back to per-symbol quotes on plans without batch-quote, so give it
// room. Bounded internally by the shared wait budget in fundamentalsCache.
export const maxDuration = 300;

// Hourly cron (see vercel.json) that refreshes the Redis-cached fundamentals
// (market cap, PE ratio, industry) for the current picker universe, so the
// screener list view can show those columns with zero FMP calls per page
// render. Reads the universe from the already-cached pickers payload rather
// than recomputing it, then hands the symbol list to warmFundamentals(),
// which does the FMP work under the shared 300/min budget guard.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CADENCE IS HOURLY ON PURPOSE. DO NOT "RESTORE" `*/30`.
//
// This block said `0 * * * *` until 2026-09-02, which stopped being true when
// #374 staggered the crons off minute :00. The JOBS registry (jobRuns.ts) is
// the source of truth and a check already asserts it against vercel.json --
// this comment was simply never updated, and a comment that confidently states
// the wrong value is worse than no comment, because it is what the next reader
// trusts. It names no minute now for the same reason.
//
// It was written as */30 in the same change that added the quote-rotation
// offset, and dialled back to hourly before merge. The reason is not the call
// budget, which is why nothing in the code stops you:
//
//   FMP Starter carries TWO limits -- 300 calls/MINUTE, and a 30-day rolling
//   BANDWIDTH cap (FMP_BANDWIDTH_CAP_BYTES in lib/server/fmpUsage.ts). On
//   2026-08-22 the account was at 14.72 GB, 73.6% of the 20 GB the plan carried
//   before the data boost. reserveFmpCallSlot()/hasFmpCapacity() count
//   CALLS. Nothing anywhere counts BYTES.
//
// Calls and bytes are wildly non-proportional -- ~0.3 KB for /stable/quote
// against ~66 KB for /stable/news/stock, a ~200x spread -- so a run that is
// comfortably inside the call guard can still be the thing eating the cap. The
// guard cannot see the limit that is actually close.
//
// So the cadence is held at hourly until there is a byte meter to raise it
// against.
//
// THE COVERAGE ARGUMENT THAT USED TO BE HERE IS OBSOLETE. It read "with the
// rotation offset that is still a full lap of the universe every ~2-3 hours".
// The quote stage no longer laps anything: marketCap and P/E come from the
// price pool in one HMGET, so every symbol is covered every run and FMP is
// asked only about pool misses. See the note above fetchQuoteFundamentals.
//
// When byte accounting exists (a rolling 30-day counter bucketed by endpoint,
// beside the per-minute call counter), re-derive this number from measured
// bytes per run rather than restoring the old one.
// ─────────────────────────────────────────────────────────────────────────────

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
    console.log(`[warm-fundamentals] targets: ${symbols.length} (displayed ${displayed}, universe ${universe})`);

    const result = await warmFundamentals(symbols);
    // Logged as well as returned: the cron invokes this and discards the body,
    // so without this line the run's coverage is invisible in Vercel logs.
    console.log("[warm-fundamentals]", JSON.stringify(result));
    // Same summary, written where something can READ IT BACK. Every one of
    // these jobs already logged its outcome, and every failure on 22 Aug still
    // went unnoticed -- a log line is only seen by someone who goes looking in
    // the right window.
    await recordJobRun("warm-fundamentals", result.ok !== false, {
      universe: result.universe ?? null,
      quotesFetched: result.quotesFetched ?? null,
      // Where marketCap/P-E came from. poolHits is the FMP calls not made;
      // poolMisses climbing toward the universe means warm-price-pool has
      // stopped maintaining the pool, and fallbackDeferred non-zero means this
      // stage has turned back into the per-symbol rotation it replaced.
      poolHits: result.poolHits ?? null,
      poolMisses: result.poolMisses ?? null,
      fallbackDeferred: result.fallbackDeferred ?? null,
      industryMissing: result.industryMissing ?? null,
      screenerCovered: result.screenerCovered ?? null,
      selection: result.quoteSelection ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "warm-fundamentals failed";
    // A THROWN run must be recorded too, or the health page shows the last
    // SUCCESSFUL run's timestamp and reads as healthy while the job has been
    // failing for days -- stale-green, the exact failure this page exists for.
    await recordJobRun("warm-fundamentals", false, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
