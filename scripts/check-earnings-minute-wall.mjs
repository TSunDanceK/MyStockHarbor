// warm-earnings must not abandon itself on one exhausted minute.
//
// THE DEFECT THIS LOCKS DOWN, and it is the second time this repo has had it.
// The loop read:
//
//     const hasCapacity = await hasFmpCapacity(1, EARNINGS_MIN_HEADROOM_CALLS);
//     if (!hasCapacity) { deferred.push(symbol); break; }
//
// `break`, not wait. The headroom is 90 against a 200 guard, so a run stopped
// at 110 calls inside ONE MINUTE and reported the remainder as `deferred` --
// a clean-looking record for a run that quit early. #396 fixed the identical
// shape in warmPricePool, where it had pinned priceRefreshed at 128-136 for
// days while two other changes were designed around the selector instead.
//
// RUN, DO NOT GREP. "The run waits for the next bucket instead of ending" is a
// claim about behaviour over time, and a regex cannot tell a wait from a break
// -- both are a call to hasFmpCapacity followed by a control-flow keyword.
//
//   node scripts/check-earnings-minute-wall.mjs
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const cron = readCodeOnly("app/api/jobs/warm-earnings/route.ts");
const history = readCodeOnly("lib/server/historyCache.ts");

const lift = async (src, extra = "") => {
  const js = ts.transpileModule(`${extra}\n${src}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};

const num = (src, name) =>
  Number(
    Function(
      `"use strict"; return (${(src.match(new RegExp(`${name} = ([0-9_ *]+);`)) ?? [])[1] ?? "0"});`
    )()
  );

const waitFn = (cron.match(/async function waitForEarningsBudget\([\s\S]*?\n\}/) ?? [])[0];
const budgetMs = num(cron, "EARNINGS_RUN_BUDGET_MS");
const pollMs = num(cron, "EARNINGS_BUDGET_POLL_MS");
const batchSize = num(cron, "EARNINGS_BATCH_SIZE");
const headroom = num(cron, "EARNINGS_MIN_HEADROOM_CALLS");
const lockTtl = num(cron, "EARNINGS_LOCK_TTL_SECONDS");
const maxDuration = num(cron, "maxDuration");
const safePerMinute = num(history, "FMP_SAFE_CALLS_PER_MINUTE");

if (!waitFn || !budgetMs || !pollMs || !batchSize || !headroom || !lockTtl || !maxDuration || !safePerMinute) {
  console.error(
    `FAIL: could not extract waitForEarningsBudget (${!!waitFn}) or one of the ` +
      `constants — budget ${budgetMs}, poll ${pollMs}, batch ${batchSize}, headroom ` +
      `${headroom}, lock ${lockTtl}, maxDuration ${maxDuration}, safe/min ` +
      `${safePerMinute}. This script would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

// ── 1. The wait ────────────────────────────────────────────────────────────
console.log("\n1. An exhausted minute is a pause, not the end of the run");

// The poll is shortened to 1ms IN THE FIXTURE ONLY: what is being asserted is
// the control flow, and a 5s poll would make the third case a 5-second test.
//
// THE STUB IS RESOLVED PER CALL, NOT BOUND AT IMPORT. `import()` of a data URL
// caches by source text, so three lifts of the SAME text are one module -- the
// first draft here lifted three times with three different stubs and got one
// module wired to the first stub. Two of its three assertions then passed by
// coincidence and the third failed, which is the only reason it was noticed.
const waited = await lift(
  `export ${waitFn}`,
  `const EARNINGS_MIN_HEADROOM_CALLS = ${headroom};
const EARNINGS_BUDGET_POLL_MS = 1;
const hasFmpCapacity = (...args) => globalThis.__EARNINGS_CAPACITY(...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));`
);

// BOUNDED, because the failure this guards against is a LOOP. Dropping the
// deadline test turns the wait into an infinite one, and an assertion that
// awaits it forever HANGS the suite instead of failing it -- a red check that
// never prints is worse than a red check. The timeout loses the race only when
// the function is already broken; process.exit at the bottom reaps whatever is
// still sleeping.
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(`never-returned:${label}`), ms)),
  ]);

let calls = 0;
globalThis.__EARNINGS_CAPACITY = async () => ++calls > 3;
const farDeadline = Date.now() + 60_000;
const r1 = await withTimeout(waited.waitForEarningsBudget(farDeadline), 5_000, "r1");
check(
  "a busy minute is waited out, not treated as the end of the batch",
  r1 === "ok" && calls === 4,
  `${calls} capacity checks before proceeding — the old code took the first ` +
    `false as final and broke out of the loop at ${safePerMinute - headroom} calls, ` +
    `reporting the rest as \`deferred\``
);

calls = 0;
globalThis.__EARNINGS_CAPACITY = async () => {
  calls++;
  return false;
};
const r2 = await withTimeout(waited.waitForEarningsBudget(Date.now() - 1), 2_000, "r2");
check(
  "a run past its own deadline does end",
  r2 === "out-of-time" && calls === 1,
  "the run's clock is the ONLY thing that ends it — but it must actually end " +
    "it, or a permanently exhausted bucket is an infinite loop inside a " +
    "serverless function"
);

calls = 0;
const started = Date.now();
const r3 = await withTimeout(waited.waitForEarningsBudget(Date.now() + 40), 2_000, "r3");
check(
  "it polls repeatedly before giving up, rather than giving up on the first no",
  r3 === "out-of-time" && calls > 1,
  `${calls} checks over ${Date.now() - started}ms — one check followed by ` +
    `"out-of-time" would be the original break wearing a longer name`
);

// ── 2. The route uses it, and the old wall is gone ─────────────────────────
console.log("\n2. The route ends on its own clock, and says so when it does");

check(
  "the capacity break is gone and the wait is wired to the run deadline",
  !/if \(!hasCapacity\)/.test(cron) &&
    /const runDeadlineMs = now \+ EARNINGS_RUN_BUDGET_MS;/.test(cron) &&
    /\(await waitForEarningsBudget\(runDeadlineMs\)\) === "out-of-time"/.test(cron),
  "the deadline is computed once from the run's start; a per-symbol deadline " +
    "would give every symbol a fresh four minutes"
);
check(
  "the loop also checks the run clock before starting a symbol",
  /if \(Date\.now\(\) >= runDeadlineMs\)/.test(cron),
  "a symbol begun at the deadline still gets to finish; one begun past it " +
    "would push the queue bookkeeping and the run record past maxDuration"
);
check(
  "`deferred` means one thing again",
  (cron.match(/deferred\.push\(symbol\);/g) ?? []).length === 1,
  "it used to collect both 'not due yet' and 'the minute was busy', so a run " +
    "that stopped at the wall reported the same field as one with nothing to do"
);
// SLICED TO THE recordJobRun CALL. The first version of this tested the whole
// file for `outOfTime,` — which the RESPONSE BODY also contains, so deleting
// the field from the stored record left the assertion green. An assertion that
// cannot fail, found by breaking it. The record is the half that matters: the
// response is read by a browser that is gone a second later, the record is
// what /cache-health shows tomorrow.
// lastIndexOf, NOT indexOf: this route records a run TWICE -- the lock-skip
// near the top records { skipped: true, reason: "locked" } -- and slicing from
// the first match read a two-field object that could never contain the field,
// so both halves failed even on correct code. The sibling-field guards below
// are what turned that into a legible failure instead of a puzzling one.
const sliceCall = (anchor) => {
  const start = cron.lastIndexOf(anchor);
  if (start === -1) return "";
  const end = cron.indexOf("});", start);
  return end === -1 ? "" : cron.slice(start, end);
};
const recordCall = sliceCall('recordJobRun("warm-earnings", true, {\n');
const responseCall = sliceCall("NextResponse.json({\n");
check(
  "a run that ran out of budget is distinguishable on the STORED record",
  /checked: cleanQueue\.length/.test(recordCall) &&
    /\boutOfTime,/.test(recordCall) &&
    /let outOfTime = false;/.test(cron),
  /checked: cleanQueue\.length/.test(recordCall)
    ? "without it, quitting early and draining the queue produce the same " +
      "record — which is how the break stayed invisible for as long as it did"
    : `sliced the wrong recordJobRun call (${recordCall.length} chars) — this ` +
      `route records twice, and the lock-skip one has neither field`
);
check(
  "and on the response the two callers actually read",
  /fetchedCount:/.test(responseCall) && /\boutOfTime,/.test(responseCall),
  "the GitHub Actions warm-up and the pickers button both read this body; a " +
    "shortfall they cannot see is a shortfall nobody chases"
);

// ── 3. The arithmetic the batch will be raised against ─────────────────────
console.log("\n3. The run can actually spend the batch it is given");

check(
  "maxDuration is declared rather than inherited from the platform default",
  /export const maxDuration = \d+;/.test(cron),
  `${maxDuration}s — the Vercel default is 300s for a Pro team WITH Fluid ` +
    `compute and 15s without, and that is a dashboard toggle that changes with ` +
    `no commit. A loop that waits cannot be sized against a number the repo ` +
    `does not state`
);
check(
  "the run budget leaves a tail inside maxDuration",
  budgetMs < maxDuration * 1000,
  `${budgetMs / 1000}s of ${maxDuration}s — a run that spends all of it has ` +
    `nothing left for the queue bookkeeping, the run record and the response, ` +
    `and is killed mid-write`
);
check(
  "the lock outlives the longest run it has to cover",
  lockTtl * 1000 > maxDuration * 1000,
  `${lockTtl / 60}min against a ${maxDuration}s ceiling — a TTL at or under it ` +
    `expires while the overrunning run still holds it, which is failing open in ` +
    `exactly the case the lock exists for`
);

const usable = safePerMinute - headroom;
const maxPerRun = Math.floor(usable * (budgetMs / 60_000));
check(
  "the derived per-run ceiling matches the constants it is derived from",
  /EARNINGS_USABLE_CALLS_PER_MINUTE \* \(EARNINGS_RUN_BUDGET_MS \/ 60_000\)/.test(cron) &&
    /FMP_SAFE_CALLS_PER_MINUTE - EARNINGS_MIN_HEADROOM_CALLS/.test(cron),
  `${safePerMinute} - ${headroom} = ${usable}/min over ${budgetMs / 60_000}min = ` +
    `${maxPerRun} calls. Derived, not typed: the pool's 220 stopped being true ` +
    `when its run budget changed and nothing said so`
);
check(
  "the batch fits inside what one run can reach",
  batchSize <= maxPerRun,
  `${batchSize} of ${maxPerRun} — this is the assertion the batch will be raised ` +
    `against. Above it, the run cannot finish the batch it was handed and the ` +
    `shortfall is back where this change took it from`
);

console.log(
  failures === 0
    ? "\nwarm-earnings spans minutes.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
