// Daily: the picker pages' SEC fundamentals (lib/server/pickersSecFundamentals.ts).
//
// 05:35 UTC, after sec-facts' 04:20 refresh of the fact sets it reads and clear
// of the other SEC jobs (04:00 / 04:20 / 04:40 / 05:10). It makes NO upstream
// call -- it reads the stored fact sets and writes one Redis hash -- so it does
// not need FMP_API_KEY and keeps working when that key is gone.
//
// COST: ~860 Redis commands a run (one GET per symbol, one HSET per 100, one
// EXPIRE), hard-capped by MAX_SYMBOLS_PER_RUN; the first write error stops it.
import { NextRequest, NextResponse } from "next/server";
import { recordJobRun } from "../../../../lib/server/jobRuns";
import { getWarmTargetSymbols } from "../../../../lib/server/warmTargets";
import { warmPickersSec } from "../../../../lib/server/pickersSecFundamentals";
import { registrantFor } from "../../../../lib/server/stockProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mystockharbor.com";

  try {
    const { symbols } = await getWarmTargetSymbols(base);
    const result = await warmPickersSec(symbols, registrantFor);
    console.log("[warm-pickers-sec]", JSON.stringify(result));
    await recordJobRun("warm-pickers-sec", result.ok, {
      targets: result.symbols,
      written: result.written,
      noFactSet: result.noFactSet,
      stoppedEarly: result.stoppedEarly,
      commands: result.commands,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordJobRun("warm-pickers-sec", false, { error: message.slice(0, 200) });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
