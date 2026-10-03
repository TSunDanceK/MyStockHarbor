// Daily: the picker pages' SEC fundamentals (lib/server/pickersSecFundamentals.ts).
//
// 05:35 UTC, after sec-facts' 04:20 refresh of the fact sets it reads and clear
// of the other SEC jobs (04:00 / 04:20 / 04:40 / 05:10). It makes NO upstream
// call -- it reads the stored fact sets and writes one Redis hash -- so it does
// not need FMP_API_KEY and keeps working when that key is gone.
//
// COST: ~2,630 Redis commands a run (one GET per symbol over ~2,600 symbols,
// one HSET per 100, one EXPIRE, +1 GET for the universe), hard-capped by
// MAX_SYMBOLS_PER_RUN; the first write error stops it.
import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { guardJob } from "../../../../lib/server/jobGuard";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
import { readTiingoUniverseSymbols } from "../../../../lib/server/tiingoUniverse";
import { warmPickersSec } from "../../../../lib/server/pickersSecFundamentals";
import { registrantFor } from "../../../../lib/server/stockProfile";
import { adsRatioFor } from "../../../../lib/server/secAdsMap";
import { nonEquityListingOf } from "../../../../lib/server/secPrimaryListing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

async function handleGET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com";

  try {
    const { symbols: warm } = await getWarmTargetSymbols(base);
    // PLUS THE TIINGO UNIVERSE (#553 COWORK #110, 2026-10-03): the pool overlay
    // (earnings calendar, sector weights) caps a row from this hash only, so it
    // must hold every symbol the overlay prices. Warm targets first, so the run
    // cap can never drop a Pickers symbol. +1 GET for the universe key.
    const symbols = [...new Set([...warm, ...(await readTiingoUniverseSymbols())])];
    // The cited ADS ratio (#553 COWORK #44), as the stock and earnings pages
    // pass it: absent keeps the depositary-share refusal. A committed file, so
    // no Redis cost. And A's non-common listings (#553 COWORK #67): a note,
    // preferred or unit ticker on a common filer's CIK (SOMN, CCZ, STRK...) is
    // refused a cap and P/E, naming the common stock, as on the stock page.
    const result = await warmPickersSec(symbols, (s) => ({
      annualForm: registrantFor(s)?.annualForm ?? null,
      ads: adsRatioFor(s),
      nonEquity: nonEquityListingOf(s),
    }));
    console.log("[warm-pickers-sec]", JSON.stringify(result));
    await recordJobRun("warm-pickers-sec", result.ok, {
      targets: result.symbols,
      written: result.written,
      noFactSet: result.noFactSet,
      stoppedEarly: result.stoppedEarly,
      commands: result.commands,
      pruned: result.pruned ?? null,
      pruneSkipped: result.pruneSkipped ?? null,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordJobRun("warm-pickers-sec", false, { error: message.slice(0, 200) });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// RUNAWAY-COST GUARD (#553 COWORK #51 item 3): kill switch, daily circuit
// breaker, per-run command budget, stop on Redis errors. See lib/server/jobGuard.ts.
export const GET = guardJob("warm-pickers-sec", handleGET);
