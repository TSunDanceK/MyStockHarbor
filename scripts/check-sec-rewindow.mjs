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
 * `needsReread` lives in lib/server/secStaleness, not in the cron route, so
 * this check can lift THE SHIPPED FUNCTION instead of a transcription of it.
 * A rule inside a route handler is a rule every other caller has to copy.
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
      // READ FROM THE ROUTE like the others. Omitting it is not a silent
      // default: populationQueues names it in a default parameter, so a lift
      // without it throws ReferenceError the moment the function is called —
      // which is how this was caught rather than passing with a wrong ceiling.
      `const SEC_POPULATE_SLACK_CEILING = ${allowance("SEC_POPULATE_SLACK_CEILING")};`,
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

// ── REWINDOW BORROWS UNUSED SLACK, AND ONLY WHILE POPULATE IS QUIET ───────
//
// A chain edit makes the whole populated universe eligible at once. Measured on
// 01ea371a: 431 SYMBOLS eligible against a 25/run floor is EIGHTEEN DAYS of the
// store serving values the shipped code would not write. Meanwhile reverify's
// allowance of 150 was taking ONE.
//
// BUILT FROM A GENERATED MANIFEST, not the seven-symbol one above: this is a
// question about ARITHMETIC OVER QUEUE LENGTHS, and seven entries cannot
// exercise a 150-slot allowance. The counts below are the input, and the limit
// the function returns is the claim — no fixture supplies the expected number.
const bulk = (n, make) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => make(i)));
const bulkManifest = (opts) => ({
  symbols: {
    ...bulk(opts.reverify, (i) => [`RV${i}`, {
      cik: String(900000 + i).padStart(10, "0"), contentHash: "h",
      needsReverify: true, enqueuedAt: i,
    }]),
    ...bulk(opts.populate, (i) => [`PP${i}`, {
      cik: String(800000 + i).padStart(10, "0"), contentHash: null, needsReverify: false,
    }]),
    ...bulk(opts.rewindow, (i) => [`RW${i}`, {
      cik: String(700000 + i).padStart(10, "0"), contentHash: "h", needsReverify: false,
    }]),
  },
});
const LIM = {
  reverify: Number((ROUTE.match(/SEC_REVERIFY_PER_RUN = (\d+)/) ?? [])[1]),
  populate: Number((ROUTE.match(/SEC_POPULATE_PER_RUN = (\d+)/) ?? [])[1]),
  rewindow: Number((ROUTE.match(/SEC_REWINDOW_PER_RUN = (\d+)/) ?? [])[1]),
};
const CEILING = Number((ROUTE.match(/SEC_POPULATE_SLACK_CEILING = (\d+)/) ?? [])[1]);
check("the allowances and the slack ceiling are read from the route, not retyped",
  LIM.reverify > 0 && LIM.populate > 0 && LIM.rewindow > 0 && CEILING > 0,
  `reverify ${LIM.reverify}, populate ${LIM.populate}, rewindow ${LIM.rewindow}, ceiling ${CEILING}`);

// THE LIVE SHAPE, from the census on 01ea371a: reverify 1, populate 323,
// rewindow 431.
{
  const live = M.populationQueues(bulkManifest({ reverify: 1, populate: 323, rewindow: 431 }));
  const expectedSlack = LIM.reverify - 1 + (LIM.populate - Math.min(323, LIM.populate));
  check("rewindow borrows exactly what the other two queues left unused",
    live.rewindowLimit === LIM.rewindow + expectedSlack,
    `rewindow limit ${live.rewindowLimit} = floor ${LIM.rewindow} + slack ${expectedSlack} ` +
      `(reverify took 1 of ${LIM.reverify}, populate took ${Math.min(323, LIM.populate)} of ${LIM.populate})`);
  check("...so the drain is days rather than weeks",
    Math.ceil(431 / live.rewindowLimit) <= 3,
    `431 SYMBOLS at ${live.rewindowLimit}/run -> ${Math.ceil(431 / live.rewindowLimit)} days, ` +
      `against ${Math.ceil(431 / LIM.rewindow)} at the floor alone`);
  // THE PROPERTY THAT MAKES THIS NEED NO NEW BUDGET MEASUREMENT.
  const total = live.reverify.length + live.populate.length + live.rewindow.length;
  check("the three queues together still fit the allowance they had before",
    total <= LIM.reverify + LIM.populate + LIM.rewindow,
    `${live.reverify.length} + ${live.populate.length} + ${live.rewindow.length} = ${total} ` +
      `against ${LIM.reverify + LIM.populate + LIM.rewindow} — reallocation, not an increase`);
}

// THE CEILING, DRIVEN FROM BOTH SIDES. One below and one above, so the
// assertion is about the boundary rather than about one arbitrary backlog.
{
  const under = M.populationQueues(bulkManifest({ reverify: 0, populate: CEILING - 1, rewindow: 500 }));
  const over = M.populationQueues(bulkManifest({ reverify: 0, populate: CEILING, rewindow: 500 }));
  check(`below the ceiling (${CEILING - 1} in populate) rewindow still borrows`,
    under.rewindowLimit > LIM.rewindow,
    `limit ${under.rewindowLimit}`);
  check(`at the ceiling (${CEILING} in populate) it drops back to the guaranteed floor`,
    over.rewindowLimit === LIM.rewindow && over.rewindow.length === LIM.rewindow,
    `limit ${over.rewindowLimit}, took ${over.rewindow.length} — a page reading "not loaded yet" ` +
      `outranks one reading a figure from an older policy`);
}

// AND THE FLOOR IS A FLOOR: populate full, reverify full, nothing to lend.
{
  // BOTH QUEUES ACTUALLY FULL. The first version of this used populate: 10 and
  // called it "full" — populate then took 10 of 300, lent 290, and rewindow's
  // limit came out 315. The assertion failed and was right to: the fixture did
  // not build the state its own name described.
  const FULL = { reverify: LIM.reverify, populate: LIM.populate, rewindow: 500 };
  const busy = M.populationQueues(bulkManifest(FULL));
  check("with both queues full there is no slack, and rewindow still gets its floor",
    busy.rewindowLimit === LIM.rewindow && busy.rewindow.length === LIM.rewindow,
    `reverify ${busy.reverify.length}/${LIM.reverify}, populate ${busy.populate.length}/${LIM.populate} ` +
      `-> rewindow limit ${busy.rewindowLimit} — borrowing can only ever ADD, never take the floor away`);
}

{
  // MUTATION: the slack added WITHOUT the floor, so a full run starves rewindow
  // to nothing — the "ordered last" design the original note rejected.
  // THE ROUTE IS loadRewindow's FIRST ARGUMENT. Passing these as the second
  // mutates secStaleness instead, which contains neither string — so both
  // mutations silently no-opped and their "actually applied" guards caught it.
  // That guard is the only reason this was not reported as a passing check.
  const FULL = { reverify: LIM.reverify, populate: LIM.populate, rewindow: 500 };
  const noFloor = await loadRewindow((src) =>
    src.replace(
      "const rewindowLimit = Math.max(limits.rewindow, limits.rewindow + slack);",
      "const rewindowLimit = slack;"
    ));
  check("the no-floor mutation actually applied",
    noFloor.populationQueues(bulkManifest(FULL)).rewindowLimit !== LIM.rewindow);
  check("MUTATION: without the floor, a busy run re-reads NOTHING",
    noFloor.populationQueues(bulkManifest(FULL)).rewindow.length === 0,
    "which is exactly the starvation the guaranteed slice exists to prevent, and it is " +
      "invisible from a total: the run still fetches its full allowance");

  // MUTATION: the ceiling removed, so rewindow borrows while populate is
  // drowning and readers keep seeing "not loaded yet".
  const noCeiling = await loadRewindow((src) =>
    src.replace("populate.length < slackCeiling", "true"));
  const drowning = { reverify: 0, populate: CEILING * 3, rewindow: 500 };
  check("the no-ceiling mutation actually applied",
    noCeiling.populationQueues(bulkManifest(drowning)).rewindowLimit !== LIM.rewindow);
  check("MUTATION: without the ceiling, rewindow borrows even with populate drowning",
    noCeiling.populationQueues(bulkManifest(drowning)).rewindowLimit ===
      LIM.rewindow + LIM.reverify,
    `it takes reverify's whole unused slice at a ${CEILING * 3}-SYMBOL populate backlog, ` +
      `where the shipped rule gives it ${M.populationQueues(bulkManifest(drowning)).rewindowLimit}`);
}

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
// TARGETS `rewindowLimit`, WHICH IS WHERE THE SLICE READS ITS SIZE NOW. It
// used to replace `limits.rewindow` at the slice; the slack change moved that
// to a computed `rewindowLimit`, so the old string stopped matching and the
// mutation silently no-opped. Its "actually applied" guard is what caught it —
// without that guard this would have gone on reporting a pass for a mutation
// that never ran.
const shareTheBudget = (src) =>
  src.replace(
    "const rewindowLimit = Math.max(limits.rewindow, limits.rewindow + slack);",
    "const rewindowLimit = Math.max(0, limits.populate - populate.length);"
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

// ── CONDITION 5: every script that lifts these functions can still lift them ─
//
// THE REGRESSION THIS EXISTS FOR ALREADY HAPPENED, TWICE, AND THE SECOND TIME
// NOBODY SAW IT. `needsRewindow` changed from an arrow const to a declaration.
// This check hit it, failed loudly, and moved to grabFunction. The OTHER
// lifter — scripts/annual-filer-census.mjs — kept
// /export const needsRewindow = [^;]+;/, which then matched nothing, so
// `(match ?? [])[0]` was undefined and `.replace` on it threw a TypeError. It
// went unnoticed because the census is a CREDENTIALLED relay task and does not
// run under check-all: the only way to find out was to run it, and running it
// needs the database.
//
// So the lift targets are asserted here instead, where they are free. This does
// not run the census — it asserts that the functions it names are findable by
// the means it uses, which is the exact thing that broke.
console.log("\n5. the other lifters of these functions still resolve");

const CENSUS = readCodeOnly("scripts/annual-filer-census.mjs");
check("the census no longer matches the arrow form that stopped existing",
  !/export const needsRewindow = \[\^;\]/.test(CENSUS) && !CENSUS.includes("needsRewindow"),
  "a regex that matches nothing returns undefined and throws on .replace");
for (const [name, src, where] of [
  ["needsReread", STALE, "lib/server/secStaleness.ts"],
  ["staleReasons", STALE, "lib/server/secStaleness.ts"],
  ["populationQueues", ROUTE, "the route"],
  ["restatedPeriods", ROUTE, "the route"],
]) {
  check(`grabFunction finds ${name} in ${where}`, Boolean(grabFunction(src, name)));
}
// AND THE CENSUS ASKS FOR EXACTLY THOSE. A lifter naming a function that no
// longer exists is the same failure one step removed.
for (const name of ["needsReread", "staleReasons", "populationQueues"]) {
  check(`the census lifts ${name} by name`, CENSUS.includes(`grabFunction(STALE, "${name}")`) ||
    CENSUS.includes(`grabFunction(ROUTE, "${name}")`),
    `so a rename moves this check with it`);
}
// A FAILED LIFT MUST EXIT, NOT THROW. The TypeError was unreadable; a named
// FATAL says what could not be lifted.
check("the census exits with a FATAL rather than throwing when a lift fails",
  /if \(!needs \|\| !queues\)/.test(CENSUS) && /FATAL: could not lift/.test(CENSUS),
  "an undefined match should report itself, not surface as .replace of undefined");

console.log(
  failures
    ? `\n${failures} assertion(s) failed.\n`
    : "\nThe rewindow migration selects what it should and logs only what changed.\n"
);
process.exit(failures ? 1 : 0);
