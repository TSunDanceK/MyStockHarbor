import { NextResponse } from "next/server";
import {
  buildPickerStructureDiagnostics,
  buildPickerJitterDiagnostics,
} from "@/lib/server/pickersBuilder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Debug-only route (same shape as the other app/api/debug/* routes).
//
// Why it exists: computeOversoldCandidate substitutes structureScore = 50 when
// buildTrendScoreFromHistory returns null (fewer than 220 usable closes), and
// its structural-weakness penalty is written `if (trendScore && ...)`, so an
// unassessable trend also skips a 10-point penalty. Deciding what to do about
// that needs the size of the affected population and the actual rank movement,
// not an estimate -- and a sandbox cannot reach FMP or production to get either.
//
// Read this for:
//   affectedBand          how many symbols the composites DO score (>= 60
//                         closes) but the trend score refuses (< 220). This is
//                         the population the question is about; if it is 0
//                         today the issue is latent, not live.
//   affectedBandSymbols   those symbols with their close counts, shortest
//                         history first.
//   oversold/overbought   per symbol: rank under the shipped scoring, under
//                         the structure term dropped and weights renormalised,
//                         and under that plus the penalty applied to an
//                         unassessable trend. rankDeltaPenalised is positive
//                         when a symbol falls.
//
// A symbol with rankLive set and rankNoStructurePenalised null has dropped off
// that list entirely under the stricter mode.
//
// Scores come from the same computeOversoldCandidate/computeOverboughtCandidate
// the builder calls -- three times per symbol with different modes -- so this
// cannot drift from what ships. It is also READ-ONLY: unlike a real build it
// never calls addToDynamicUniverse, so looking does not change the universe.

// ?jitter=1 switches to the perturbation instrument. Defaults off, so the
// existing structure-mode output is unchanged.
//
//   ?jitter=1                       20 trials, seed 1, 10 bps (0.1%), mode=all
//   ?jitter=1&scaled=1              magnitude = 5% of each symbol's own 20-day
//                                   mean absolute daily move (fairness check)
//   ?jitter=1&mode=each             one symbol at a time, competitors frozen
//   ?jitter=1&seed=7&trials=50&bps=5
//
// Deterministic: same seed, same result. It reuses the universe and history
// this route already loads, so it costs no extra Redis and no FMP calls.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const int = (key: string, dflt: number, min: number, max: number) => {
      const raw = Number(params.get(key));
      return Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.trunc(raw))) : dflt;
    };

    if (params.get("jitter") === "1") {
      const data = await buildPickerJitterDiagnostics({
        trials: int("trials", 20, 1, 200),
        seed: int("seed", 1, 0, 2 ** 31 - 1),
        bps: int("bps", 10, 1, 500),
        mode: params.get("mode") === "each" ? "each" : "all",
        scaled: params.get("scaled") === "1",
      });
      return NextResponse.json(data);
    }

    const data = await buildPickerStructureDiagnostics();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "picker-structure failed" },
      { status: 500 }
    );
  }
}
