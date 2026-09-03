// EARNINGS_BATCH_SIZE is derived, and raising the universe cap must move it.
//
// WHAT IT WAS. A typed 40, which was never a decision -- it predates every
// measurement in this thread and survived because the minute wall (#406) meant
// nothing above ~110 worked anyway. Today's universe needs 144 calls on the
// busiest day of the season and the job could make 40.
//
// WHY TYPING THE MEASURED NUMBER WOULD HAVE BEEN THE SAME BUG. This rebuild has
// removed that shape twice: PRICE_TARGET_RUNS stated coverage in a unit that
// silently changed meaning when the cron moved, and `priceCap` was derived from
// one tier while the universe sat on two. A batch typed once against a
// measurement taken once is right today and silently wrong the moment
// ANALYSIS_UNIVERSE_CAP moves -- wrong in the direction that just quietly does
// less work, which is the direction nothing alerts on.
//
// THREE THINGS ASSERTED HERE:
//
//   the constant comes from planEarningsDay, not from a literal
//   the recorded peak-day share still reproduces the probe run it came from
//   one pass covers the CURRENT caps -- and the moment it does not, this fails
//   and says how many passes the arithmetic needs
//
// RUN, NOT GREPPED. The plan is a pure function over six constants, and every
// number below comes out of running it against the real ones. Two assertions in
// this series were regexes that ran past the block they claimed to assert; a
// grep cannot tell 262 derived from 262 typed.
//
//   node scripts/check-earnings-batch.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { loadEarningsPlan, grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const route = readCodeOnly("app/api/jobs/warm-earnings/route.ts");
const planSrc = readCodeOnly("lib/server/earningsPlan.ts");
const { inputs, missing, planAt, plan } = await loadEarningsPlan();

if (missing.length || !planAt || !plan) {
  console.error(
    `FAIL: could not derive the plan — missing ${missing.join(", ") || "planAt/plan"}. ` +
      `Inputs read: ${JSON.stringify(inputs)}. This script would otherwise pass by ` +
      `measuring nothing.`
  );
  process.exit(1);
}

// ── 1. The constant is derived ─────────────────────────────────────────────
console.log("\n1. The batch size comes from the plan, not from a literal");

check(
  "EARNINGS_BATCH_SIZE is not a typed number",
  !/const EARNINGS_BATCH_SIZE = \d/.test(route) &&
    /const EARNINGS_BATCH_SIZE = EARNINGS_PLAN\?\.batchPerPass \?\? EARNINGS_BATCH_FALLBACK;/.test(
      route
    ),
  `${plan.batchPerPass} today, from planEarningsDay — a literal is right until ` +
    `the cap moves, and then it is wrong with nothing to say so`
);
check(
  "the basis is the UNION of the two universe caps",
  /const EARNINGS_UNIVERSE_BASIS = ANALYSIS_UNIVERSE_CAP \+ MAX_DYNAMIC_UNIVERSE_SIZE;/.test(
    route
  ),
  `${inputs.analysisCap} analysed + ${inputs.dynamicCap} dynamic = ${inputs.basis}. ` +
    `getWarmTargetSymbols hands this job the union of two separately-capped ` +
    `pools, which is why the live figure is 762 against a 700 analysis cap. ` +
    `check-price-tiers uses this same sum for the pre-open buffer: worst-case ` +
    `work inside ONE RUN, where either cap alone understates it`
);
check(
  "the plan is not null at the current caps, so the fallback is unreachable",
  plan !== null && plan.batchPerPass > 0,
  `the fallback exists so the job still runs if somebody edits an input to ` +
    `nonsense; this is what says it is not quietly in use today`
);
// AND THE FALLBACK IS LOUD, asserted separately. The line above claimed
// loudness and tested only non-nullness -- deleting the console.error left it
// green. Two claims in one assertion is one claim unchecked.
const fallbackIdx = route.indexOf("if (!EARNINGS_PLAN) {");
const fallbackBlock =
  fallbackIdx === -1 ? "" : route.slice(fallbackIdx, route.indexOf("\n}", fallbackIdx));
check(
  "...and if it is ever reached, it says so",
  fallbackBlock.includes("console.error("),
  fallbackIdx === -1
    ? "could not find the fallback guard to slice"
    : "falling back to 40 in silence is the absence-reads-as-health defect this " +
      "series keeps finding — the job would do a sixth of a peak day and report " +
      "a clean run"
);
check(
  "the derived batch is a real raise, not a coincidence that matches 40",
  plan.batchPerPass > 40,
  `${plan.batchPerPass} against the old 40 — today's universe needs ` +
    `${planAt(762).callsOnPeakRun} calls on the busiest day, so 40 was ` +
    `structurally behind before #408 took two thirds of the passes away on top`
);

// ── 2. The recorded share carries, and keeps, its provenance ──────────────
console.log("\n2. The measured share still reproduces the run it came from");

check(
  "the share is dated",
  /EARNINGS_PEAK_SHARE_MEASURED_AT = "\d{4}-\d{2}-\d{2}"/.test(planSrc),
  "a bare 0.0935 with no history is exactly as bad as a typed batch size"
);
// AS DATA, NOT AS PROSE. This assertion first read the comment block that
// carried the provenance -- and readCodeOnly strips comments, so it failed
// against a provenance the build cannot see. Right failure: a fact worth
// asserting has to be a value, so the months and the probe are now constants.
check(
  "and names the months and the probe that produced it",
  /months: \["2026-01", "2026-02"\]/.test(planSrc) &&
    /probe: "\/api\/debug\/earnings-concentration\?fresh=1"/.test(planSrc),
  "which months, which probe run, and — via requiresSlicing — that #411 had to " +
    "land first or February came back truncated to 4,000 rows. Universe growth " +
    "does NOT require a re-take: the share is per-symbol, which is the whole " +
    "reason it is a share"
);

// THE WITNESSES. The probe printed impliedPeakDayRefreshes for three universe
// sizes; the recorded share has to still produce them. A share edited without
// re-running the probe fails the build against its own provenance, which is the
// difference between a measurement and a number.
const witnesses = await lift(
  grabFunction(planSrc, "planEarningsDay") &&
    `export const EARNINGS_PEAK_SHARE_WITNESSES = ${
      (planSrc.match(/EARNINGS_PEAK_SHARE_WITNESSES[^=]*=\s*(\[[\s\S]*?\]);/) ?? [])[1] ?? "[]"
    };`
);
check(
  "the witnesses were recorded at all",
  Array.isArray(witnesses.EARNINGS_PEAK_SHARE_WITNESSES) &&
    witnesses.EARNINGS_PEAK_SHARE_WITNESSES.length >= 3,
  `${witnesses.EARNINGS_PEAK_SHARE_WITNESSES?.length ?? 0} of them — with none, ` +
    `the assertion below measures nothing and the provenance is prose`
);
const mismatches = (witnesses.EARNINGS_PEAK_SHARE_WITNESSES ?? []).filter(
  (w) => planAt(w.universe).peakDayReporters !== w.reporters
);
check(
  "the recorded share reproduces every one of them",
  mismatches.length === 0,
  mismatches.length
    ? `mismatched: ${mismatches
        .map((w) => `${w.universe} -> ${planAt(w.universe).peakDayReporters}, recorded ${w.reporters}`)
        .join("; ")}`
    : `share ${inputs.share} gives ${(witnesses.EARNINGS_PEAK_SHARE_WITNESSES ?? [])
        .map((w) => `${w.universe}->${w.reporters}`)
        .join(", ")} — the probe's own impliedPeakDayRefreshes, re-derived`
);

// ── 3. The coupling ───────────────────────────────────────────────────────
console.log("\n3. One pass covers the caps as configured — and must keep doing so");

check(
  "one daily pass covers the busiest day at the current caps",
  plan.passesNeeded === 1,
  `${plan.callsOnPeakRun} calls at a basis of ${inputs.basis} against a ` +
    `${inputs.ceiling}/run ceiling = ${Math.round(
      (plan.callsOnPeakRun / inputs.ceiling) * 100
    )}%. If this fails, the fix is NOT to raise the batch: it is ` +
    `${plan.passesNeeded} passes, and multi-pass is not implemented. Either add ` +
    `the passes or lower ANALYSIS_UNIVERSE_CAP`
);
check(
  "the derived batch is what one pass can actually finish",
  plan.batchPerPass <= inputs.ceiling,
  `${plan.batchPerPass} of ${inputs.ceiling} — batchPerPass is the peak day ` +
    `divided by the pass count, so it fits by construction while passesNeeded ` +
    `is 1 and stops fitting the moment the run budget shrinks`
);

// THE GROWTH STEPS, COMPUTED. This is how "3,000 needs two passes" gets
// recorded without anybody having to remember it: the arithmetic is run here
// and printed, so the growth sequence reads it off a PASS line rather than off
// a comment somebody wrote in September.
const steps = [700, 1500, 3000].map((analysed) => {
  const p = planAt(analysed + inputs.dynamicCap);
  return { analysed, basis: analysed + inputs.dynamicCap, ...p };
});
const at1500 = steps.find((s) => s.analysed === 1500);
const at3000 = steps.find((s) => s.analysed === 3000);

check(
  "the 1,500 step still fits one pass, and how tightly is on the record",
  at1500.passesNeeded === 1,
  `${at1500.callsOnPeakRun} calls at a basis of ${at1500.basis} = ` +
    `${Math.round((at1500.callsOnPeakRun / inputs.ceiling) * 100)}% of the ceiling. ` +
    `Tight: batch ${at1500.batchPerPass}. Raising ANALYSIS_UNIVERSE_CAP to 1,500 ` +
    `needs no new passes, and this line is what will say so when it stops being true`
);
check(
  "the 3,000 step needs TWO passes, computed rather than stated",
  at3000.passesNeeded === 2,
  `${at3000.callsOnPeakRun} calls at a basis of ${at3000.basis} against ` +
    `${inputs.ceiling}/run = ${Math.round(
      (at3000.callsOnPeakRun / inputs.ceiling) * 100
    )}%. THIS IS THE GROWTH BLOCKER: multi-pass is not implemented, so 3,000 ` +
    `cannot be reached by raising the cap alone. Derived here so nobody has to ` +
    `remember it`
);
check(
  "demand rises with the cap, so the coupling has something to couple to",
  steps[0].callsOnPeakRun < at1500.callsOnPeakRun &&
    at1500.callsOnPeakRun < at3000.callsOnPeakRun,
  steps
    .map((s) => `${s.analysed}->${s.callsOnPeakRun} calls/${s.passesNeeded}p`)
    .join("  ")
);

// ── 4. The run says what sized it ─────────────────────────────────────────
console.log("\n4. A batch that came from arithmetic reads as arithmetic afterwards");

const recordIdx = route.lastIndexOf('recordJobRun("warm-earnings", true, {\n');
const recordCall = recordIdx === -1 ? "" : route.slice(recordIdx, route.indexOf("});", recordIdx));
check(
  "the run record carries the batch and the basis it was derived from",
  /checked: cleanQueue\.length/.test(recordCall) &&
    /\bbatchSize: EARNINGS_BATCH_SIZE,/.test(recordCall) &&
    /\bbatchBasisUniverse: EARNINGS_UNIVERSE_BASIS,/.test(recordCall) &&
    /\bpassesNeeded:/.test(recordCall),
  recordCall
    ? "or the next person wondering why it is 262 has to re-derive it from six " +
      "constants in four files"
    : "sliced the wrong recordJobRun call — this route records twice, and the " +
      "lock-skip one carries neither field"
);

console.log(
  failures === 0
    ? "\nThe batch is derived, the share carries its provenance, and one pass still covers the caps.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
