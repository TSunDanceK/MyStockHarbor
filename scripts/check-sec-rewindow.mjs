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
const YEARS = Number(
  (readCodeOnly("lib/server/secExtract.ts").match(/SEC_YEAR_WINDOW = (\d+)/) ?? [])[1]
);
const allowance = (name) =>
  Number((ROUTE.match(new RegExp(`${name} = (\\d+)`)) ?? [])[1]);

const STALE = readCodeOnly("lib/server/secStaleness.ts");

/**
 * Lift the three functions the migration rests on, optionally mutated first.
 *
 * ── THE STALENESS RULE IS NO LONGER IN THE ROUTE, AND THAT IS THE POINT ───
 * `needsReread` moved to lib/server/secStaleness so refresh-on-view can import
 * the SAME function instead of a second one that agrees today. This check
 * follows it there rather than keeping a copy, for exactly that reason.
 *
 * secFields.ts is inlined WHOLE because `needsReread` now closes over
 * secChainsHash() and `restatedPeriods` over SEC_FIELD_KEYS. Pinning either to
 * a literal here would let this check keep passing against a chain list that
 * had moved underneath it — a check agreeing with itself.
 *
 * The constants are read from the source too, so a change to
 * SEC_QUARTER_WINDOW or to an allowance moves this with it rather than leaving
 * a stale literal behind.
 */
const loadRewindow = async (mutate = (s) => s, mutateStale = (s) => s) => {
  const src = mutate(ROUTE);
  // grabFunction, NOT A REGEX OVER THE ARROW FORM. This read
  // /export const needsRewindow = [^;]+;/ and broke the moment the parameter
  // gained a second field: `(e: { w?: number; y?: number })` puts a SEMICOLON
  // inside the signature, so `[^;]+;` captured half a declaration and lifted
  // `const needsRewindow = (e) => ;`. That is the same class of failure
  // grabFunction's own docblock was written about, and the reason it exists.
  const needs = grabFunction(mutateStale(STALE), "needsReread");
  const restated = grabFunction(src, "restatedPeriods");
  const queues = grabFunction(src, "populationQueues");
  if (!needs || !restated || !queues) {
    throw new Error("could not lift needsReread / restatedPeriods / populationQueues");
  }
  return lift(
    [
      readCodeOnly("lib/server/secFields.ts"),
      `const SEC_QUARTER_WINDOW = ${WINDOW};`,
      `const SEC_YEAR_WINDOW = ${YEARS};`,
      `const SEC_REVERIFY_PER_RUN = ${allowance("SEC_REVERIFY_PER_RUN")};`,
      `const SEC_POPULATE_PER_RUN = ${allowance("SEC_POPULATE_PER_RUN")};`,
      `const SEC_REWINDOW_PER_RUN = ${allowance("SEC_REWINDOW_PER_RUN")};`,
      needs.replace("export function", "function"),
      restated.replace("export function", "function"),
      queues.replace("export function", "function"),
      "export { needsReread, restatedPeriods, populationQueues, secChainsHash, SEC_FIELD_KEYS };",
    ].join("\n")
  );
};

console.log("\n0. the subject lifts and the constants are real");

const M = await loadRewindow();
const CHAINS = M.secChainsHash();
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

// THE MUTATION: treat a period the prior set does not hold as a change, which
// is what comparing the sets whole amounts to.
const toWholeHash = (src) =>
  src.replace(
    "      if (!before) continue;",
    '      if (!before) { out.push(`${p.e}(new)`); continue; }'
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

/**
 * A manifest with one entry of each shape. Nothing else differs between them.
 *
 * TWO WINDOWS NOW, so "current" means BOTH are current. An entry at w=12 with
 * no `y` is a set written before the year window existed — five years stored,
 * one short of what the five-year card needs — and it is eligible.
 */
const manifest = {
  symbols: {
    LEGACY: { cik: "0000000001", contentHash: "h", needsReverify: false },                        // neither field
    NARROW: { cik: "0000000002", contentHash: "h", needsReverify: false, w: 8, y: YEARS },        // quarters behind
    NARROW_YEARS: { cik: "0000000006", contentHash: "h", needsReverify: false, w: WINDOW },       // years behind only
    CURRENT: { cik: "0000000003", contentHash: "h", needsReverify: false, w: WINDOW, y: YEARS, c: CHAINS }, // current on all three
    OLD_CHAINS: { cik: "0000000007", contentHash: "h", needsReverify: false, w: WINDOW, y: YEARS, c: "deadbeef" }, // windows current, chains behind
    UNPOPULATED: { cik: "0000000004", contentHash: null, needsReverify: false },                  // populate's
    STALE: { cik: "0000000005", contentHash: "h", needsReverify: true, enqueuedAt: 1 },           // reverify's
  },
};

const q = M.populationQueues(manifest);
check(
  "an entry with NO window field is selected",
  q.rewindow.includes("LEGACY"),
  `rewindow = [${q.rewindow.join(" ")}]`
);
check(
  `an entry current on all three — w=${WINDOW}, y=${YEARS}, chains ${CHAINS} — is NOT selected`,
  !q.rewindow.includes("CURRENT"),
  `rewindow = [${q.rewindow.join(" ")}]`
);
check("an explicit w=8 is selected", q.rewindow.includes("NARROW"));
// ── THE YEAR WINDOW SELECTS THROUGH THE SAME QUEUE ──────────────────────────
// A set can be current on quarters and behind on years: everything written
// between the two changes is exactly that. One queue, either field.
check("an entry current on quarters but with no year window IS selected",
  q.rewindow.includes("NARROW_YEARS"),
  `w=${WINDOW} y=absent -> eligible, because absent means ${5} and the card needs ${YEARS}`);
check("...and there is only ONE queue, not a second one for years",
  !/rewindowYears|yearQueue|REWINDOW_YEARS/.test(ROUTE),
  "a second queue over the same symbols is two allowances competing for one re-read");
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
  src.replace("(e.w ?? 8) < SEC_QUARTER_WINDOW", "(e.w ?? SEC_QUARTER_WINDOW) < SEC_QUARTER_WINDOW")
     .replace("(e.y ?? 5) < SEC_YEAR_WINDOW", "(e.y ?? SEC_YEAR_WINDOW) < SEC_YEAR_WINDOW")
     .replace("(e.c ?? null) !== secChainsHash()", "(e.c ?? secChainsHash()) !== secChainsHash()");
const mutated2 = await loadRewindow((x) => x, absentMeansCurrent);
check("the absent-means-current mutation actually applied", absentMeansCurrent(STALE) !== STALE);
const qm = mutated2.populationQueues(manifest);
check(
  "MUTATION: reading an absent window as current DROPS the legacy entries",
  !qm.rewindow.includes("LEGACY") && !qm.rewindow.includes("NARROW_YEARS") &&
    qm.rewindow.includes("NARROW"),
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

// ── CONDITION 4: a CHAIN edit is not a restatement either ──────────────────
//
// THE SAME DEFECT AS CONDITION 1, ONE LEVEL FINER, and it was found by
// measuring rather than by reasoning. Condition 1 stopped a new PERIOD being
// logged as a change. A chain edit produces the same shape inside a period that
// both sets hold: one CELL goes from null to a number, because the chain gained
// a concept the filer had been publishing all along.
//
// It is not a rare shape. sec-capex-blast over 119 SYMBOLS (relay 35025749420)
// found 24 that gain a capex cell on a re-read and 14 that gain it on all 18
// periods — NVDA, AMZN, V, HD, CVX, QCOM among them — so a whole-array
// comparison would put every one of them in the restatement log the first time
// the rewindow queue reached them. Same noise, same buried real restatements.
//
// THE FIXTURE PAIR IS THE REAL ONE, MINUS THE CELLS THE CHAIN NOW READS. AAPL's
// captured set with every `capex` cell nulled IS what a set written under the
// one-deep chain looked like; nothing here supplies an expected value.

console.log("\n4. a chain edit is not a restatement (per cell, not per period)");

const CAPEX = M.SEC_FIELD_KEYS.indexOf("capex");
const REVENUE = M.SEC_FIELD_KEYS.indexOf("revenue");
check("the two field indices resolved out of the shipped key list",
  CAPEX >= 0 && REVENUE >= 0 && CAPEX !== REVENUE,
  `capex #${CAPEX}, revenue #${REVENUE} of ${M.SEC_FIELD_KEYS.length}`);

/** What the set looked like before the chain gained its second capex concept. */
const blankCapex = (p) => ({
  ...p,
  v: p.v.map((val, i) => (i === CAPEX ? null : val)),
  d: p.d.slice(0, CAPEX) + "-" + p.d.slice(CAPEX + 1),
});
const oldChains = clone(AAPL);
oldChains.quarters = oldChains.quarters.map(blankCapex);
oldChains.years = oldChains.years.map(blankCapex);
oldChains.c = "deadbeef";

const gainedCapex = clone(AAPL);

const capexCells = gainedCapex.quarters.filter((p) => p.v[CAPEX] !== null).length;
check("the pair differs ONLY by capex cells going null -> value",
  capexCells > 0 &&
    oldChains.quarters.every((p) => p.v[CAPEX] === null) &&
    oldChains.quarters.every((p, i) =>
      p.v.every((val, j) => j === CAPEX || val === gainedCapex.quarters[i].v[j])),
  `${capexCells} quarters gain a capex figure, every other cell identical`);

const cMoved = M.restatedPeriods(oldChains, gainedCapex);
check("(c) cells that go null -> value log NOTHING — the chain gained them",
  cMoved.length === 0,
  cMoved.length ? `logged ${cMoved.slice(0, 3).join(" ")}` : "0 periods logged");

/** The same pair with ONE EXISTING revenue changed — a real restatement. */
const chainPlusRestatement = clone(gainedCapex);
const rHit = chainPlusRestatement.quarters.find((p) => typeof p.v[REVENUE] === "number");
if (!rHit) { console.error("FATAL: no numeric revenue to perturb"); process.exit(2); }
const rWas = rHit.v[REVENUE];
rHit.v[REVENUE] = rWas + 1;

const dMoved = M.restatedPeriods(oldChains, chainPlusRestatement);
check("(d) a value -> different value in the SAME pair IS logged",
  dMoved.length === 1 && dMoved[0].startsWith(rHit.e) && dMoved[0].includes("revenue:"),
  dMoved.length ? `logged ${dMoved.join(" ")}` : "logged nothing");

// AND IT NAMES THE FIELD. A period identifier alone sends the reader to a
// 46-column array to find out what moved; the key is in hand and costs nothing.
check("...and it names the field that moved, not just the period",
  dMoved[0]?.includes(`revenue:${rWas}->${rWas + 1}`),
  dMoved[0] ?? "(nothing logged)");

// A VALUE THAT DISAPPEARS IS ALSO A CHANGE. This is the shape sec-capex-blast
// reports as GONE — a same-length frame displaced by one filed later under a
// newly added concept. Not hypothetical, and not the null -> value case.
const lostCell = clone(gainedCapex);
const lHit = lostCell.quarters.find((p) => typeof p.v[REVENUE] === "number");
lHit.v[REVENUE] = null;
const lMoved = M.restatedPeriods(oldChains, lostCell);
check("...and a value -> null IS logged too, which is the GONE case",
  lMoved.length === 1 && lMoved[0].includes("->null"),
  lMoved[0] ?? "(nothing logged)");

// THE MUTATION: compare every cell, the way "any difference" would.
const toAnyDifference = (src) =>
  src.replace("        if (before.v[i] == null) continue;\n", "");
check("the any-difference mutation actually applied", toAnyDifference(ROUTE) !== ROUTE);
const mutated4 = await loadRewindow(toAnyDifference);
const cUnderMutation = mutated4.restatedPeriods(oldChains, gainedCapex);
check("MUTATION: under any-difference, (c) FAILS — every gained cell reports as a restatement",
  cUnderMutation.length > 0,
  `${cUnderMutation.length} periods logged for this ONE symbol; the measured universe is 24 SYMBOLS, 14 of them on all 18 periods`);
check("...and (d) still logs, so the mutation is not simply blind",
  mutated4.restatedPeriods(oldChains, chainPlusRestatement).length > 0);

// ── AND THE ENTRY WITH OLDER CHAINS IS SELECTED FOR THE RE-READ ────────────
check("an entry current on BOTH windows but read under older chains IS selected",
  q.rewindow.includes("OLD_CHAINS"),
  `w=${WINDOW} y=${YEARS} c=deadbeef vs ${CHAINS} -> eligible`);
check("...through the SAME queue, not a second one for chains",
  !/rewindowChains|chainQueue|REWINDOW_CHAINS/.test(ROUTE),
  "one companyfacts payload carries every one of the three, so one re-read serves all three");

console.log(
  failures
    ? `\n${failures} assertion(s) failed.\n`
    : "\nThe rewindow migration selects what it should and logs only what changed.\n"
);
process.exit(failures ? 1 : 0);
