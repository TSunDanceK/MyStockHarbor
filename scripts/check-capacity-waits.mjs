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
import { readCodeOnly } from "./lib/source-code.mjs";

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

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
