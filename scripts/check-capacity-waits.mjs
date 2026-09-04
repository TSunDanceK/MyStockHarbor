// Two places in this codebase make a caller WAIT for capacity someone else
// holds: reserveFmpCallSlot waits for room in the current minute's FMP budget,
// and a pickers request that loses the build lock waits for the winner. Both
// had the same defect, and it is the kind that gets worse exactly when load is
// highest.
//
// THE DEFECT: A WAIT THAT COSTS WHAT IT IS WAITING FOR.
//
//   reserveFmpCallSlot polled with INCR, so every waiter raised the number it
//   was waiting to see fall -- up to 50 increments per FMP call, none given
//   back. The 07:01 warm showed http-429 and capacity-timeout together, which
//   is the tell: FMP refusing calls we had not actually made.
//
//   A pickers lock loser with no cached payload ran its own full ~2,900-command
//   build rather than waiting for the winner's. With the payload key absent for
//   everyone at once -- post-outage, or after a cache-key version bump -- every
//   concurrent request did that simultaneously.
//
// Neither is expressible as a unit test without a live Redis and real
// contention, so both are asserted against the source. Comments are stripped
// first: the code below is explained in prose that names INCR and DECR, and a
// grep that counted those would pass on the explanation alone.
//
//   node scripts/check-capacity-waits.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const history = readCodeOnly("lib/server/historyCache.ts");
const pickers = readCodeOnly("lib/server/pickersBuilder.ts");

/** Body of a top-level function, up to the next top-level declaration. */
const bodyOf = (src, signature) => {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  const rest = src.slice(start + signature.length);
  const end = rest.search(/\n(?:export |async function |function |const )/);
  return end === -1 ? rest : rest.slice(0, end);
};

const reserve = bodyOf(history, "export async function reserveFmpCallSlot");

console.log("\n=== 1. The FMP slot wait must not be a write ===\n");

check(
  "reserveFmpCallSlot was found",
  reserve.length > 0,
  "every assertion below reads this body, so an empty slice would pass them all vacuously"
);

const incrCount = (reserve.match(/redis\.incr\(/g) ?? []).length;
check(
  "the reservation is a SINGLE incr, not one per poll",
  incrCount === 1,
  `a second incr site is how the wait starts inflating the counter it polls — found ${incrCount}`
);

check(
  "a reservation that does not fit is handed back",
  /redis\.decr\(/.test(reserve),
  "an over-ceiling attempt is a call that will not be made, so leaving it counted charges the minute for nothing"
);

check(
  "the wait itself polls through getFmpMinuteUsage",
  /getFmpMinuteUsage\(\)/.test(reserve),
  "that helper is a plain GET, which is what makes the wait unable to affect the number it reads"
);

check(
  "the backoff grows rather than stepping at a fixed interval",
  /FMP_WAIT_STEP_MAX_MS/.test(reserve) && /waitMs\s*\*\s*2/.test(reserve),
  "a flat step is what turned one FMP call into fifty polls across the wait budget"
);

check(
  "the capacity timeout still throws, and still classifies as capacity-timeout",
  /throw new FmpHistoryError\([^)]*"capacity-timeout"\)/s.test(reserve),
  "that reason is what distinguishes our own limiter holding us back from FMP refusing us"
);

// RE-TARGETED when the working limit was lowered to 200. The invariant this
// assertion was written for -- "the plan's ceiling is a fact, not a tuning
// knob" -- is unchanged and still asserted; it just no longer lives in
// FMP_SAFE_CALLS_PER_MINUTE, because that constant is now our own headroom
// choice and is SUPPOSED to be tunable. Pinning the tunable number would have
// meant this check blocked the very change it was written to permit.
check(
  "the plan's 300/min ceiling is still recorded as a fact",
  /const FMP_PLAN_CALLS_PER_MINUTE = 300;/.test(history),
  "this fixes how we wait, not what we wait for — the ceiling is a property of the FMP plan"
);
check(
  "the working limit is a separate, lower number",
  (() => {
    const plan = Number(history.match(/FMP_PLAN_CALLS_PER_MINUTE = (\d+);/)?.[1]);
    const safe = Number(history.match(/FMP_SAFE_CALLS_PER_MINUTE = (\d+);/)?.[1]);
    return Number.isFinite(plan) && Number.isFinite(safe) && safe < plan;
  })(),
  "running the working limit AT the ceiling leaves nothing for boundary drift, which is what a 21% http-429 rate looks like"
);

check(
  "the wait budget is unchanged",
  /const FMP_MAX_WAIT_MS = 20_000;/.test(history),
  "raising it would mask the contention rather than remove it"
);

console.log("\n=== 2. A pickers lock loser must wait, not build ===\n");

const waitFn = bodyOf(pickers, "async function waitForPickersPayload");

check(
  "waitForPickersPayload exists",
  waitFn.length > 0,
  "without it a lock loser has nowhere to go but a duplicate build"
);

const loserSites = (pickers.match(/!lockToken && !forceRefresh && !cached\?\.data/g) ?? []).length;
check(
  "BOTH lock-loser paths wait when nothing is cached",
  loserSites === 2,
  `getPickersData and the route handler duplicate this logic, so a fix applied to one leaves the other stampeding — found ${loserSites}`
);

check(
  "the poll is exists(), not a full payload read",
  /redis\.exists\(/.test(waitFn),
  "readPickersCache re-attaches the off-payload chart series, so polling it would pay that hydration on every pass"
);

check(
  "the wait is bounded",
  /PICKERS_MAX_WAIT_MS/.test(waitFn),
  "an unbounded wait on a winner that never publishes is a hang, which is worse than the duplicate build"
);

check(
  "the waiter never builds for itself",
  !/buildPickersPayload\(/.test(waitFn),
  "building inside the wait would reintroduce exactly the duplicate this removes"
);

check(
  "a forced run is excluded from the wait",
  loserSites === 2 && !/!lockToken && !cached\?\.data/.test(pickers),
  "a forced run must actually refresh, and the winner it would adopt may not be refreshing history at all"
);

// ── The abandon-on-capacity shape, across every warm job ────────────────────
//
// FOUR INSTANCES OF ONE DEFECT, FIXED ONE AT A TIME: #396 (price pool), #406
// (earnings), #416 (stock data) and now the forced history refetch. Each time
// the shape was "this minute is spent, so give up the rest of the run's work"
// -- and each time it was found by reading the next job rather than by anything
// failing. Three fixes did not prevent the fourth.
//
// THE JOB LIST IS SCANNED, NEVER HAND-TYPED. A hand-typed list is how the
// fourth survived three fixes; it is also how a hand-listed six debug routes
// became nine when the directory was actually scanned. The scan walks
// app/api/jobs/ for routes and follows the lib/server modules they import, so a
// job added next month is covered by existing.
console.log("\n=== Abandon-on-capacity: no job gives up the run for one minute ===\n");

const jobsDir = path.join(ROOT, "app/api/jobs");
const jobNames = fs
  .readdirSync(jobsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

check(
  "the job directory was scanned",
  jobNames.length >= 5,
  `${jobNames.join(", ")} — a scan finding nothing passes trivially, which is the ` +
    `failure mode of a derived list`
);

// Every file a job can reach that could contain the shape: the route itself
// plus the lib/server modules it imports directly.
const reachable = new Set();
for (const job of jobNames) {
  const rel = `app/api/jobs/${job}/route.ts`;
  if (!fs.existsSync(path.join(ROOT, rel))) continue;
  reachable.add(rel);
  const src = readCodeOnly(rel, { minRetainedFraction: 0.005 });
  for (const m of src.matchAll(/from "(?:[./]*)(?:lib\/)?server\/([a-zA-Z]+)"/g)) {
    const dep = `lib/server/${m[1]}.ts`;
    if (fs.existsSync(path.join(ROOT, dep))) reachable.add(dep);
  }
  for (const m of src.matchAll(/from "@\/lib\/server\/([a-zA-Z]+)"/g)) {
    const dep = `lib/server/${m[1]}.ts`;
    if (fs.existsSync(path.join(ROOT, dep))) reachable.add(dep);
  }
}
check(
  "the scan reached the modules the jobs actually use",
  reachable.size >= 8,
  `${reachable.size} files — routes plus the lib/server modules they import`
);

// THE SHAPE IS THE NEGATION, NOT THE `break` NEXT TO IT.
//
// The first draft matched `if (!(await hasFmpCapacity(...))) break|return` --
// the give-up keyword adjacent to the test. Calibration killed it: rewriting the
// site to set a flag and THEN return, three lines down, walked straight past the
// regex. An abandon spelled over four lines is still an abandon.
//
// So the rule is the NEGATED test itself. Every legitimate use in this codebase
// is POSITIVE and sits inside a waitFor…Budget loop -- `if (await
// hasFmpCapacity(n, headroom)) return "ok";` -- because the question there is
// "may I proceed", asked repeatedly. Asking "am I out of room" and branching on
// yes is the abandon, whatever the branch then does.
const ABANDON = /if\s*\(\s*(?:[A-Za-z_$][\w$]*\s*&&\s*)?!\s*\(?\s*await\s+hasFmpCapacity\(/g;

// ONE EXEMPTION, AND IT IS NAMED RATHER THAN REGEXED AWAY.
//
// This scan found a FIFTH site the brief did not know about -- which is the
// argument for scanning, and also the moment to be careful: the tempting move
// is to narrow the pattern until the inconvenient hit disappears, and that
// turns a rule into a rule-shaped thing.
//
// fetchMoverBuckets is a genuine exception on the merits. It makes THREE calls
// TOTAL regardless of universe size, they are a best-effort enrichment of the
// tier-1 signal, and warmPricePool runs every five minutes. "Remaining work"
// here is at most two optional calls that the next run retries in five minutes.
// Waiting a run budget for them would push warmPricePool past its own cron tick
// to enrich a signal whose base (presets + dollar volume) does not depend on it.
//
// The defect is "give up the run's REMAINING WORK for one minute". Three calls
// that retry in five minutes is not that.
const EXEMPT = new Map([
  [
    "lib/server/pricePool.ts:fetchMoverBuckets",
    "3 calls total, best-effort tier-1 enrichment, retried by the next 5-minute run",
  ],
]);

const abandons = [];
const exemptedFound = new Set();
for (const rel of [...reachable].sort()) {
  const src = readCodeOnly(rel, { minRetainedFraction: 0.005 });
  for (const m of src.matchAll(ABANDON)) {
    const line = src.slice(0, m.index).split("\n").length;
    // Attributed to the ENCLOSING FUNCTION, not the line number: an exemption
    // keyed by line silently moves to whatever code arrives at that line next.
    const before = src.slice(0, m.index);
    const fnMatch = [...before.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].pop();
    const key = `${rel}:${fnMatch ? fnMatch[1] : `line-${line}`}`;
    if (EXEMPT.has(key)) {
      exemptedFound.add(key);
      continue;
    }
    abandons.push(`${key} (line ${line})`);
  }
}
check(
  "no warm job abandons its remaining work when the minute is spent",
  abandons.length === 0,
  abandons.length
    ? `${abandons.join(", ")} — the minute's exhaustion is a PAUSE. Port the ` +
      `waitFor…Budget(deadlineMs) shape from #416 rather than adding a fifth answer.`
    : `${reachable.size} reachable files clean — #396, #406, #416 and the forced ` +
      `history refetch all fixed the same line, and three fixes did not prevent ` +
      `the fourth`
);

// AN EXEMPTION THAT NO LONGER MATCHES ANYTHING IS AN EXEMPTION OUTLIVING ITS
// REASON -- and the next site to land in that function inherits a pass nobody
// granted it.
const staleExemptions = [...EXEMPT.keys()].filter((k) => !exemptedFound.has(k));
check(
  "every exemption still describes a site that exists",
  staleExemptions.length === 0,
  staleExemptions.length
    ? `stale: ${staleExemptions.join(", ")} — the code changed and the exemption did not`
    : [...EXEMPT].map(([k, why]) => `${k}: ${why}`).join(" · ")
);

// The detector has to be able to fire, or this section is decoration.
// FOUR FIXTURES, because the first draft passed against one and missed the real
// rewrite. Two must fire and two must not.
const FIRES = [
  // the literal line #396/#406/#416 removed
  "if (!(await hasFmpCapacity(calls, HEADROOM))) break;",
  // the same abandon spelled over several lines, which the adjacent-keyword
  // regex walked straight past
  "if (force && !(await hasFmpCapacity(1, HEADROOM))) {\n  ranOut = true;\n  return;\n}",
];
const SPARED = [
  // the wait, which is what the fix looks like
  'if ((await waitForHistoryBudget(d)) === "out-of-time") break;',
  // the POSITIVE test inside a waitFor loop -- the legitimate use
  'if (await hasFmpCapacity(calls, HEADROOM)) return "ok";',
];
check(
  "the detector fires on both spellings of the abandon and spares the fix",
  FIRES.every((f) => [...f.matchAll(ABANDON)].length === 1) &&
    SPARED.every((f) => [...f.matchAll(ABANDON)].length === 0),
  "run against fixtures rather than assumed — the first draft of this rule " +
    "passed on the one-line form and missed the multi-line one, which is the " +
    "form the calibration actually produced"
);

// ── The wait cannot outlive the function that is doing it ───────────────────
//
// THE ONE FAILURE MODE THIS CHANGE COULD INTRODUCE. Waiting instead of
// abandoning makes runs longer, and a run that waits past its own maxDuration
// is killed by the platform: no run record, no counters, no reason. That is
// strictly worse than abandoning, which at least reports what it gave up on.
console.log("\n=== The run budget fits inside the function timeout ===\n");

const budgetMs = Number(
  Function(
    `"use strict"; return (${
      (history.match(/HISTORY_RUN_BUDGET_MS = ([0-9_ *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
const warmRoute = readCodeOnly("app/api/jobs/warm-picker-universe/route.ts");
const maxDurationSec = Number((warmRoute.match(/maxDuration = (\d+)/) ?? [])[1]);
check(
  "both numbers were read from source, not typed here",
  budgetMs > 0 && maxDurationSec > 0,
  `budget ${budgetMs / 1000}s, maxDuration ${maxDurationSec}s — typed here, this ` +
    `assertion would compare two numbers this file invented`
);
check(
  "the history budget leaves a tail inside maxDuration",
  budgetMs / 1000 <= maxDurationSec - 60,
  `${budgetMs / 1000}s budget against a ${maxDurationSec}s timeout — the 60s tail ` +
    `covers the indicator pass, the payload write, the chart-hash write and 36 ` +
    `revalidatePath calls. A wait that outlives the function records NOTHING, ` +
    `which is worse than the abandon it replaces`
);
check(
  "the budget is long enough to be worth having",
  budgetMs > 60_000,
  `${budgetMs / 1000}s against a flat 20s per-call ceiling — a budget shorter ` +
    `than a few per-call waits would not change the outcome it exists to change`
);
check(
  "the run record says WHICH clock ended the pass",
  /historyRanOutOfTime: barAge\.ranOutOfTime,/.test(warmRoute) &&
    /historyDeferredOutOfTime: barAge\.deferredOutOfTime,/.test(warmRoute),
  "a symbol abandoned by a 20-second per-call wait and one deferred because the " +
    "run spent its budget are different facts wanting opposite responses; folded " +
    "into forcedRefetchFailures they read identically"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
