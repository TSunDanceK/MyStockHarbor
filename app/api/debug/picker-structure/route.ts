import { NextResponse } from "next/server";
import { buildPickerStructureDiagnostics } from "@/lib/server/pickersBuilder";

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

export async function GET() {
  try {
    const data = await buildPickerStructureDiagnostics();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "picker-structure failed" },
      { status: 500 }
    );
  }
}
