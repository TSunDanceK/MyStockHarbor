// THE REWINDOW MIGRATION, RUN RATHER THAN READ.
//
// Widening the stored window from 8 quarters to 12 is a migration over the
// populated universe, and it has two ways to go quietly wrong. Both are
// behaviours of pure functions in app/api/jobs/sec-facts/route.ts, so both can
// be executed here against a fixture pair and a hand-held manifest — no
// network, no store.
//
//   1. A WINDOW CHANGE IS NOT A RESTATEMENT. The re-read of a symbol adds four
//      older quarters. Compared whole, every one of the SYMBOLS in the universe
//      reports as a silent restatement and the log that exists to surface real
//      restatements becomes 759 lines of migration noise — which is the same as
//      not having it. restatedPeriods() must compare the OVERLAP.
//
//   2. A MISSING WINDOW FIELD MEANS 8. Every manifest entry written before `w`
//      existed has no `w`, and those are exactly the entries that need
//      re-reading. Reading absence as "current" is how a migration completes
//      without doing anything at all.
//
// EACH ASSERTION IS RUN UNDER A MUTATION that breaks the property, and the
// mutation must make it FAIL. An assertion nothing can break is not an
// assertion. The mutations are applied to the SOURCE TEXT and re-lifted, so
// what is tested is the shipped function, not a copy of it.
//
// The fixture pair is derived from data/sec/factset-fixture-AAPL.json — a real
// captured set — by DROPPING its four oldest quarters to stand in for the
// narrower set that is already stored. Nothing here writes an expected value:
// the "old" side is the real set minus rows, and case (a)'s expected answer is
// "empty", which the fixture cannot supply.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const ROUTE = readCodeOnly("app/api/jobs/sec-facts/route.ts");

/**
 * Lift the three rewindow functions out of the route, optionally mutated first.
 *
 * The constants they close over are read from the source too, so a change to
 * SEC_QUARTER_WINDOW or to an allowance moves this with it rather than leaving
 * a stale literal behind that quietly agrees with itself.
 */
const WINDOW = Number(
  (readCodeOnly("lib/server/secExtract.ts").match(/SEC_QUARTER_WINDOW = (\d+)/) ?? [])[1]
);
const allowance = (name) =>
  Number((ROUTE.match(new RegExp(`${name} = (\\d+)`)) ?? [])[1]);

const loadRewindow = async (mutate = (s) => s) => {
  const src = mutate(ROUTE);
  const needs = (src.match(/export const needsRewindow = [^;]+;/) ?? [])[0];
  const restated = grabFunction(src, "restatedPeriods");
  const queues = grabFunction(src, "populationQueues");
  if (!needs || !restated || !queues) {
    throw new Error("could not lift needsRewindow / restatedPeriods / populationQueues");
  }
  return lift(
    [
      `const SEC_QUARTER_WINDOW = ${WINDOW};`,
      `const SEC_REVERIFY_PER_RUN = ${allowance("SEC_REVERIFY_PER_RUN")};`,
      `const SEC_POPULATE_PER_RUN = ${allowance("SEC_POPULATE_PER_RUN")};`,
      `const SEC_REWINDOW_PER_RUN = ${allowance("SEC_REWINDOW_PER_RUN")};`,
      needs.replace("export const", "const"),
      restated.replace("export function", "function"),
      queues.replace("export function", "function"),
      "export { needsRewindow, restatedPeriods, populationQueues };",
    ].join("\n")
  );
};

console.log("\n0. the subject lifts and the constants are real");

const M = await loadRewindow();
check("SEC_QUARTER_WINDOW read from secExtract", WINDOW === 12, `window is ${WINDOW}`);
check(
  "all three per-run allowances read from the route",
  [allowance("SEC_REVERIFY_PER_RUN"), allowance("SEC_POPULATE_PER_RUN"), allowance("SEC_REWINDOW_PER_RUN")]
    .every((n) => Number.isFinite(n) && n > 0),
  `reverify ${allowance("SEC_REVERIFY_PER_RUN")}, populate ${allowance("SEC_POPULATE_PER_RUN")}, rewindow ${allowance("SEC_REWINDOW_PER_RUN")}`
);

// ── CONDITION 1: a window change is not a restatement ───────────────────────

console.log("\n1. a window change is not a restatement (overlap, not whole-set)");

const AAPL = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** The narrower set that is already stored: the real set minus its four oldest quarters. */
const narrow = clone(AAPL);
narrow.quarters = narrow.quarters.slice(0, narrow.quarters.length - 4);
narrow.w = 8;

const widened = clone(AAPL);

check(
  "the pair differs ONLY by four older quarters",
  narrow.quarters.length === widened.quarters.length - 4 &&
    narrow.quarters.every((p, i) => JSON.stringify(p) === JSON.stringify(widened.quarters[i])) &&
    JSON.stringify(narrow.years) === JSON.stringify(widened.years) &&
    JSON.stringify(narrow.instants) === JSON.stringify(widened.instants),
  `${narrow.quarters.length} -> ${widened.quarters.length} quarters, years and instants identical`
);

const aMoved = M.restatedPeriods(narrow, widened);
check(
  "(a) four newly added older quarters log NOTHING",
  aMoved.length === 0,
  aMoved.length ? `logged ${aMoved.join(" ")}` : "0 periods logged"
);

/** The same pair with ONE overlapping value changed — a real restatement. */
const restatedSet = clone(widened);
const hit = restatedSet.quarters.find((p) => (p.v ?? []).some((v) => typeof v === "number"));
if (!hit) { console.error("FATAL: no numeric value in any overlapping quarter to perturb"); process.exit(2); }
const idx = hit.v.findIndex((v) => typeof v === "number");
const wasValue = hit.v[idx];
hit.v[idx] = wasValue + 1;

const bMoved = M.restatedPeriods(narrow, restatedSet);
check(
  "(b) one CHANGED overlapping value IS logged",
  bMoved.length === 1 && bMoved[0].startsWith(hit.e),
  bMoved.length ? `logged ${bMoved.join(" ")} (field ${idx}: ${wasValue} -> ${hit.v[idx]})` : "logged nothing"
);

check(
  "...and the changed period is one BOTH sets hold, not one only the wide set has",
  narrow.quarters.some((p) => p.e === hit.e),
  `${hit.e} is in the narrow set too`
);

// THE MUTATION: compare the sets whole, the way a hash would.
const toWholeHash = (src) =>
  src.replace(
    /if \(before && JSON\.stringify\(before\.v\) !== JSON\.stringify\(p\.v\)\) \{/,
    "if (JSON.stringify(was) !== JSON.stringify(now)) {"
  );
const mutated1 = await loadRewindow(toWholeHash);
check(
  "the whole-hash mutation actually applied",
  toWholeHash(ROUTE) !== ROUTE
);
const aUnderMutation = mutated1.restatedPeriods(narrow, widened);
check(
  "MUTATION: under whole-set comparison, (a) FAILS — the migration reports itself",
  aUnderMutation.length > 0,
  `${aUnderMutation.length} periods would be logged as silent restatements for this ONE symbol`
);
check(
  "...and (b) still logs, so the mutation is not simply blind",
  mutated1.restatedPeriods(narrow, restatedSet).length > 0
);

// ── CONDITION 2: a missing window field means 8, and 8 is eligible ───────────

console.log("\n2. a legacy entry with no window field is eligible");

/** A manifest with one entry of each shape. Nothing else differs between them. */
const manifest = {
  symbols: {
    LEGACY: { cik: "0000000001", contentHash: "h", needsReverify: false },              // no w at all
    NARROW: { cik: "0000000002", contentHash: "h", needsReverify: false, w: 8 },
    CURRENT: { cik: "0000000003", contentHash: "h", needsReverify: false, w: WINDOW },
    UNPOPULATED: { cik: "0000000004", contentHash: null, needsReverify: false },        // populate's, not rewindow's
    STALE: { cik: "0000000005", contentHash: "h", needsReverify: true, enqueuedAt: 1 }, // reverify's, not rewindow's
  },
};

const q = M.populationQueues(manifest);
check(
  "an entry with NO window field is selected",
  q.rewindow.includes("LEGACY"),
  `rewindow = [${q.rewindow.join(" ")}]`
);
check(
  `an entry already at w=${WINDOW} is NOT selected`,
  !q.rewindow.includes("CURRENT")
);
check("an explicit w=8 is selected", q.rewindow.includes("NARROW"));
check(
  "a never-populated entry goes to populate, not rewindow",
  q.populate.includes("UNPOPULATED") && !q.rewindow.includes("UNPOPULATED")
);
check(
  "an entry awaiting reverify goes to reverify, not rewindow",
  q.reverify.includes("STALE") && !q.rewindow.includes("STALE")
);

// THE MUTATION: read a missing field as "already current".
const absentMeansCurrent = (src) =>
  src.replace("(e.w ?? 8) < SEC_QUARTER_WINDOW", "(e.w ?? SEC_QUARTER_WINDOW) < SEC_QUARTER_WINDOW");
const mutated2 = await loadRewindow(absentMeansCurrent);
check("the absent-means-current mutation actually applied", absentMeansCurrent(ROUTE) !== ROUTE);
const qm = mutated2.populationQueues(manifest);
check(
  "MUTATION: reading an absent window as current DROPS the legacy entry",
  !qm.rewindow.includes("LEGACY") && qm.rewindow.includes("NARROW"),
  `rewindow becomes [${qm.rewindow.join(" ")}] — the migration would skip every pre-window entry and look finished`
);

// ── CONDITION 3: the allowance is guaranteed, not a remainder ────────────────

console.log("\n3. the rewindow allowance is its own slice, not what is left over");

/** A backlog big enough that a remainder-based rewindow would get nothing. */
const flooded = { symbols: {} };
for (let i = 0; i < 400; i++) {
  flooded.symbols[`P${i}`] = { cik: `c${i}`, contentHash: null, needsReverify: false };
}
for (let i = 0; i < 200; i++) {
  flooded.symbols[`R${i}`] = { cik: `d${i}`, contentHash: "h", needsReverify: true, enqueuedAt: i };
}
for (let i = 0; i < 50; i++) {
  flooded.symbols[`W${i}`] = { cik: `e${i}`, contentHash: "h", needsReverify: false };
}
const qf = M.populationQueues(flooded);
check(
  "a full populate and reverify backlog does NOT starve rewindow",
  qf.rewindow.length === allowance("SEC_REWINDOW_PER_RUN"),
  `populate ${qf.populate.length}/${qf.populateBacklog}, reverify ${qf.reverify.length}/${qf.reverifyBacklog}, rewindow ${qf.rewindow.length}/${qf.rewindowBacklog} SYMBOLS`
);

// THE MUTATION: give rewindow whatever is left of a shared per-run budget.
const shareTheBudget = (src) =>
  src.replace(
    "rewindow: rewindow.slice(0, limits.rewindow),",
    "rewindow: rewindow.slice(0, Math.max(0, limits.populate - populate.length)),"
  );
const mutated3 = await loadRewindow(shareTheBudget);
check("the shared-budget mutation actually applied", shareTheBudget(ROUTE) !== ROUTE);
check(
  "MUTATION: a remainder-based allowance gives rewindow ZERO on a full day",
  mutated3.populationQueues(flooded).rewindow.length === 0,
  "which is every day of earnings season, when the migration most needs to run"
);

console.log(
  failures
    ? `\n${failures} assertion(s) failed.\n`
    : "\nThe rewindow migration selects what it should and logs only what changed.\n"
);
process.exit(failures ? 1 : 0);
