// The earnings staleness policy is derived, and the job can see the page.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT. /cache-health on 2026-09-11 reported earnings as `12 / 349`,
// `337 past their TTL`, `policy 7d`, "96% of observed symbols past their own
// TTL" -- and warm-earnings, seven hours earlier on the same page, reported
// `checked 6 · fetched 6 · deferred 0 · failed 0 · outOfTime false`. Six
// against three hundred and thirty-seven, green.
//
// THE PAGE WAS THE ONE THAT WAS WRONG. Both enqueue sites gate on the same
// condition (cached rows non-empty -> skip), so the job's "due" is exactly "the
// Redis key is gone"; computeEarningsTtlSeconds holds a key for up to 95 days
// between reports; markRefreshed only fires on a refetch. So the staleness
// score tracks key expiry, key expiry is up to 95 days apart by design, and a
// 7-day policy calls a correctly cached symbol a fault for 94 days in 95.
//
// TWO THINGS ARE ASSERTED, and the second is the one that keeps a signal:
//
//   1. The policy comes from the store's own TTL ceiling plus the lag before
//      anything can act on an expiry -- RUN, not read off a constant.
//   2. The job compares its own belief against the staleness record's on every
//      run, as a SET DIFFERENCE, and goes red when the page is worried about
//      symbols the job has never heard of.
//
// RUN, DO NOT GREP. "N symbols are past TTL and the selector returns fewer"
// is a claim about a function's output, and this file's whole subject is a
// number that was believed rather than computed. Every fixture below has
// DISTINGUISHABLE parts -- the symbols in one side are not the symbols in the
// other -- because the failure this replaces is precisely a comparison of two
// counts that happened to be about different things.
//
//   node scripts/check-earnings-due-selection.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import {
  grabFunction,
  lift,
  loadEarningsPlan,
  sliceWarmEarningsRunRecord,
} from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const freshness = readCodeOnly("lib/server/earningsFreshness.ts");
const store = readCodeOnly("lib/server/earningsStore.ts");
const queue = readCodeOnly("lib/server/stalenessQueue.ts");
const route = readCodeOnly("app/api/jobs/warm-earnings/route.ts");

// EVALUATED WITH ITS DEPENDENCIES IN SCOPE, not regexed as a bare number. The
// two store ceilings are written as `95 * EARNINGS_TTL_DAY`, and the arithmetic
// below is meaningless if that resolves to 0 -- which is what the first draft
// of this script did, and what the guard underneath caught.
const numFrom = (src, name, scope = {}) => {
  const expr = (src.match(new RegExp(`${name} = ([0-9_.*+ A-Z]+);`)) ?? [])[1];
  if (!expr) return 0;
  const names = Object.keys(scope);
  try {
    return Number(
      Function(...names, `"use strict"; return (${expr});`)(...names.map((n) => scope[n]))
    );
  } catch {
    return 0;
  }
};

const ttlDay = numFrom(store, "EARNINGS_TTL_DAY");
const storeScope = { EARNINGS_TTL_DAY: ttlDay };
const maxTtl = numFrom(store, "EARNINGS_TTL_MAX_SECONDS", storeScope);
const unknownTtl = numFrom(store, "EARNINGS_TTL_UNKNOWN_SECONDS", storeScope);
const throttle = numFrom(freshness, "EARNINGS_ENQUEUE_THROTTLE_SECONDS");
const drainRuns = numFrom(freshness, "EARNINGS_DRAIN_RUNS");
const { inputs, missing } = await loadEarningsPlan();
const runPeriod = inputs.runPeriodSeconds ?? 0;

const policyFn = grabFunction(freshness, "earningsStaleAfterSeconds");
const diffFn = grabFunction(freshness, "unexplainedStaleSymbols");
const pastTtlFn = grabFunction(queue, "readPastTtl");
const recordCall = sliceWarmEarningsRunRecord(route);

// THE GUARD THAT STOPS THIS PASSING BY MEASURING NOTHING. Every number below
// comes from a regex over a source file, and a renamed constant yields 0 --
// which would make the arithmetic trivially satisfiable rather than false.
if (
  !ttlDay || !maxTtl || !unknownTtl || !throttle || !drainRuns || !runPeriod ||
  !policyFn || !diffFn || !pastTtlFn || !recordCall
) {
  console.error(
    `FAIL: could not extract the subject — ttlDay ${ttlDay}, maxTtl ${maxTtl}, ` +
      `unknownTtl ${unknownTtl}, ` +
      `throttle ${throttle}, drainRuns ${drainRuns}, runPeriod ${runPeriod}, ` +
      `earningsStaleAfterSeconds ${!!policyFn}, unexplainedStaleSymbols ${!!diffFn}, ` +
      `readPastTtl ${!!pastTtlFn}, run record ${recordCall.length} chars` +
      `${missing?.length ? `, plan inputs missing: ${missing.join(", ")}` : ""}. ` +
      `This script would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

const DAY = 24 * 60 * 60;
const mod = await lift(`${policyFn}\n${diffFn}`);

// ── 1. The policy is arithmetic over the store's own rule ──────────────────
console.log("\n1. The staleness policy is derived from the TTL rule it judges");

const derived = mod.earningsStaleAfterSeconds({
  maxTtlSeconds: maxTtl,
  unknownTtlSeconds: unknownTtl,
  enqueueThrottleSeconds: throttle,
  runPeriodSeconds: runPeriod,
  drainRuns,
});

check(
  "the registry reads the derived constant, not a literal",
  /ttlSeconds: EARNINGS_STALE_AFTER_SECONDS,/.test(queue) &&
    !/earnings: \{[\s\S]{0,400}?ttlSeconds: \d/.test(queue),
  `${(derived / DAY).toFixed(1)}d, from ${(maxTtl / DAY)}d store ceiling + ` +
    `${(throttle / 3600)}h enqueue lag + ${drainRuns} x ${(runPeriod / DAY)}d drain`
);
check(
  "the old 7-day policy is gone from the earnings entry",
  !/earnings: \{[\s\S]{0,600}?ttlSeconds: 60 \* 60 \* 24 \* 7,/.test(queue),
  "7 days was the only number in DATASETS with no argument behind it, and it " +
    "was wrong against the dataset's own cache rule by a factor of thirteen"
);

// THE INVARIANT, RUN. A policy at or below the store's own ceiling calls a
// correctly cached symbol a fault, which is the whole defect. Asserted as
// arithmetic so it survives any of the three terms changing.
check(
  "the policy exceeds the longest lifetime the store may legitimately hand out",
  derived > Math.max(maxTtl, unknownTtl),
  `${(derived / DAY).toFixed(1)}d policy against a ${(Math.max(maxTtl, unknownTtl) / DAY)}d ` +
    `ceiling — anything at or under the ceiling reports a symbol at rest as rotten`
);
check(
  "and it leaves room to notice the expiry and act on it",
  derived - Math.max(maxTtl, unknownTtl) >= throttle + runPeriod,
  `${((derived - Math.max(maxTtl, unknownTtl)) / 3600).toFixed(1)}h of slack — a key ` +
    `that expires is invisible until the throttled backfill runs, and then has to ` +
    `be picked off the queue`
);

// AND IT MOVES WITH ITS INPUTS, which a typed number would not. Run at a
// doubled ceiling and at a doubled cadence, separately, so a derivation that
// ignores either term is caught.
const atBiggerCeiling = mod.earningsStaleAfterSeconds({
  maxTtlSeconds: maxTtl * 2,
  unknownTtlSeconds: unknownTtl,
  enqueueThrottleSeconds: throttle,
  runPeriodSeconds: runPeriod,
  drainRuns,
});
const atSlowerCron = mod.earningsStaleAfterSeconds({
  maxTtlSeconds: maxTtl,
  unknownTtlSeconds: unknownTtl,
  enqueueThrottleSeconds: throttle,
  runPeriodSeconds: runPeriod * 3,
  drainRuns,
});
check(
  "raising the store's TTL ceiling raises the policy",
  atBiggerCeiling > derived && atBiggerCeiling - derived === maxTtl,
  `${(derived / DAY).toFixed(1)}d -> ${(atBiggerCeiling / DAY).toFixed(1)}d`
);
check(
  "and slowing the cron raises it too",
  atSlowerCron > derived && atSlowerCron - derived === 2 * drainRuns * runPeriod,
  `a job that runs less often takes longer to drain, and the policy has to know`
);
// THE UNKNOWN-DATE BUCKET IS AN INPUT, NOT AN ASSUMPTION. It is inside the cap
// today (10d against 95d) so it does not bind -- but if it ever exceeds the
// cap it must widen the policy rather than escape it.
check(
  "an unknown-date TTL above the cap widens the policy rather than escaping it",
  mod.earningsStaleAfterSeconds({
    maxTtlSeconds: maxTtl,
    unknownTtlSeconds: maxTtl * 4,
    enqueueThrottleSeconds: throttle,
    runPeriodSeconds: runPeriod,
    drainRuns,
  }) === derived + 3 * maxTtl,
  `${(unknownTtl / DAY)}d today, inside the ${(maxTtl / DAY)}d cap, so it does not bind`
);

// ── 2. The two beliefs, compared as sets ───────────────────────────────────
console.log("\n2. The job compares what it thinks is due against what the page says");

// THE BRIEF'S FIXTURE: N past TTL, a selector that returns fewer. Every symbol
// is distinguishable from every other, and the queue is a STRICT SUBSET of a
// DIFFERENT part of the past-TTL list -- so "returned fewer" and "returned the
// wrong ones" cannot be confused for each other.
const pastTtlFixture = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG"];
const shortSelector = ["AAA", "BBB"];
const shortfall = mod.unexplainedStaleSymbols(pastTtlFixture, shortSelector);
check(
  "N past TTL and a selector returning fewer is a failure, and names which",
  shortfall.length === 5 && shortfall.join(",") === "CCC,DDD,EEE,FFF,GGG",
  `7 past TTL, 2 queued -> ${shortfall.length} unaccounted (${shortfall.join(", ")}) — ` +
    `this is the 337-against-6 line, and it now has a number and a list`
);

// THE COUNT-COMPARISON TRAP, which is why this is a set difference. Same
// cardinality on both sides, zero overlap: a subtraction reports 0 and calls it
// healthy while nothing the page is worried about is in the job's queue.
const sameCountDifferentSymbols = mod.unexplainedStaleSymbols(
  ["AAA", "BBB", "CCC"],
  ["XXX", "YYY", "ZZZ"]
);
check(
  "equal counts of DIFFERENT symbols is still a failure",
  sameCountDifferentSymbols.length === 3,
  `3 past TTL, 3 queued, none of them the same — \`337 - 6\` cannot express this ` +
    `and an orphaned symbol looks exactly like it`
);
check(
  "a queue that covers every past-TTL symbol is clean",
  mod.unexplainedStaleSymbols(["AAA", "BBB"], ["AAA", "BBB", "CCC", "DDD"]).length === 0,
  "queued-but-not-yet-past-policy is the NORMAL case and is not reported as " +
    "anything — the asymmetry is deliberate"
);
check(
  "an empty past-TTL list is clean, and an empty queue with rot is not",
  mod.unexplainedStaleSymbols([], ["AAA"]).length === 0 &&
    mod.unexplainedStaleSymbols(["AAA"], []).length === 1,
  "the two directions are not symmetric and must not collapse into each other"
);
check(
  "case and duplicates cannot manufacture a phantom orphan",
  mod.unexplainedStaleSymbols(["aaa", "AAA", "Aaa"], ["AAA"]).length === 0,
  "the queue is cleanSymbol'd to upper case and the sorted set is not " +
    "guaranteed to be; a case mismatch would redden every run forever"
);

// ── 3. The run record carries it, and null is not zero ─────────────────────
console.log("\n3. The comparison reaches the record, and a failed read says so");

check(
  "the run's ok flag is gated on the comparison",
  /recordJobRun\("warm-earnings", !datasetRotting, \{/.test(route) &&
    /const datasetRotting = unexplained !== null && unexplained\.length > 0;/.test(route),
  "a run that checks 6 of 337 and reports ok is the line that hid this for days"
);
check(
  "both beliefs are on the record side by side",
  /checked: cleanQueue\.length,/.test(recordCall) &&
    /stalenessPastTtl: pastTtl === null \? null : pastTtl\.length,/.test(recordCall) &&
    /unexplainedStale: unexplained === null \? null : unexplained\.length,/.test(recordCall),
  "the two panels of /cache-health disagreed by a factor of 56 and neither " +
    "carried the other's number"
);
check(
  "a failed read records null rather than an all-clear zero",
  /stalenessPastTtl: pastTtl === null \? null : /.test(recordCall) &&
    /unexplainedStale: unexplained === null \? null : /.test(recordCall) &&
    !/pastTtl \?\? \[\]/.test(route) &&
    !/unexplained\?\.length \?\? 0/.test(route),
  "`?? 0` on either field would let a Redis hiccup produce the all-clear, on " +
    "the one signal whose job is to notice rot"
);

// THE ORDERING, and it is not cosmetic: read before the bookkeeping writes and
// the run reports its own fresh work as rot, every single run.
const orderOk = (() => {
  const mark = route.indexOf('markRefreshed("earnings", fetched)');
  const read = route.indexOf('readPastTtl("earnings")');
  const record = route.indexOf('recordJobRun("warm-earnings", !datasetRotting');
  return mark !== -1 && read !== -1 && record !== -1 && mark < read && read < record;
})();
check(
  "past-TTL is read AFTER the refresh stamps land and BEFORE the record",
  orderOk,
  "symbols this run just fetched must already be out of the past-TTL set, or " +
    "every run reports its own work as unaccounted-for rot"
);

// ── 4. readPastTtl fails to null, not to an empty list ─────────────────────
console.log("\n4. A failed past-TTL read is not an all-clear");

// THE STUB IS RESOLVED PER CALL, NOT BOUND AT LIFT. `import()` of a data URL
// caches by source text, so two lifts of the same function are ONE module --
// binding a stub at lift time would wire both cases to the first one, and two
// assertions would pass by coincidence.
const pastTtlMod = await lift(
  pastTtlFn,
  `const DATASETS = { earnings: { ttlSeconds: ${derived} } };
const queueKey = (d) => "msh:staleness:v1:" + d;
const redis = { zrange: (...a) => globalThis.__ZRANGE(...a) };`
);

globalThis.__ZRANGE = async () => {
  throw new Error("upstash said no");
};
const onFailure = await pastTtlMod.readPastTtl("earnings");
check(
  "a throwing read returns null",
  onFailure === null,
  "[] would mean 'nothing is rotting', which is the absence-reads-as-health " +
    "defect landing on the detector for exactly that defect"
);

globalThis.__ZRANGE = async () => null;
check(
  "a null reply returns null too, rather than being coerced to empty",
  (await pastTtlMod.readPastTtl("earnings")) === null,
  "Upstash returns null for a key that does not exist; an uninstrumented " +
    "dataset must not read as a clean one"
);

let seenArgs = null;
globalThis.__ZRANGE = async (key, min, max, opts) => {
  seenArgs = { key, min, max, opts };
  return ["GGG", "HHH"];
};
const onSuccess = await pastTtlMod.readPastTtl("earnings", 5);
check(
  "a working read returns the symbols",
  Array.isArray(onSuccess) && onSuccess.join(",") === "GGG,HHH",
  "the list, not the count — the count is what could not tell an orphan from a backlog"
);
check(
  "it excludes the never-refreshed, matching the `stale` count it is compared to",
  seenArgs?.min === 1 && seenArgs?.opts?.byScore === true,
  "readDatasetHealth counts score 0 separately as `never`; a list that " +
    "included them would over-report against the number beside it"
);
check(
  "the cutoff is the dataset's own policy, not a fixed window",
  typeof seenArgs?.max === "number" &&
    Math.abs(Date.now() - seenArgs.max - derived * 1000) < 5_000,
  `cutoff is now - ${(derived / DAY).toFixed(1)}d, read from DATASETS rather than typed`
);
check(
  "and it is bounded so it can never become a scan",
  seenArgs?.opts?.count === 5,
  "a dataset whose denominator has run away must not turn this into a full read"
);

console.log(
  failures === 0
    ? "\nThe policy is derived from the store's own rule, and the job can see the page.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
