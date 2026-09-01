// How this codebase paces itself against FMP's per-minute limit, and the two
// ways that pacing was wrong.
//
// 1. THE WORKING LIMIT WAS THE CEILING. FMP_SAFE_CALLS_PER_MINUTE was 300, which
//    is the plan's limit exactly, so there was no headroom for the ways real
//    traffic drifts across a minute boundary -- our counter buckets per UTC
//    minute, FMP's window rolls. The 07:02 warm fired ~600 history calls in one
//    minute and lost 21% to http-429.
//
// 2. QUOTES WERE INVISIBLE TO THE COUNTER. 575 calls in a 15-minute window
//    spent the plan limit while every warm job read a number that said there
//    was room. That is not neutral: the warm jobs' backoff is computed FROM
//    that number, so the invisibility made their pacing wrong in the direction
//    of overspending.
//
// THE ONE THAT MUST NOT BE "FIXED" BY THE OBVIOUS ROUTE. Routing quotes through
// reserveFmpCallSlot would count them AND make them wait up to 20 seconds, on
// the render path. That trades a budget problem for an availability one. The
// assertions below pin the non-blocking door specifically, because the
// blocking one is the change a future reader is most likely to make.
//
//   node scripts/check-fmp-pacing.mjs
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const history = readCodeOnly("lib/server/historyCache.ts");
const quote = readCodeOnly("lib/server/quoteData.ts");

console.log("\n=== 1. The working limit sits under the plan ceiling ===\n");

const plan = Number(history.match(/FMP_PLAN_CALLS_PER_MINUTE = (\d+);/)?.[1]);
const safe = Number(history.match(/FMP_SAFE_CALLS_PER_MINUTE = (\d+);/)?.[1]);

check(
  "the plan ceiling is still recorded as 300",
  plan === 300,
  "it is a fact about the subscription, not a tuning knob -- lowering our headroom must not erase it"
);
check(
  "the working limit is strictly below it",
  Number.isFinite(safe) && safe < plan,
  `running at the ceiling leaves nothing for boundary drift, which is what the 21% http-429 rate looked like — ${safe} of ${plan}`
);
check(
  "the headroom is meaningful, not token",
  safe <= plan * 0.75,
  `the calls the counter cannot see have to fit in the gap — ${Math.round((1 - safe / plan) * 100)}% headroom`
);

console.log("\n=== 2. Quotes are counted, and never queued ===\n");

check(
  "the quote fetch reserves a slot",
  /tryReserveFmpCallSlot\(\)/.test(quote),
  "575 uncounted calls in 15 minutes is what made every warm job's backoff read a number that was not true"
);
check(
  "it uses the NON-BLOCKING door",
  !/\breserveFmpCallSlot\(\)/.test(quote),
  "the waiting variant blocks up to FMP_MAX_WAIT_MS on a render, which trades a budget problem for an availability one"
);
check(
  "a refusal degrades rather than throws",
  /if \(!\(await tryReserveFmpCallSlot\(\)\)\) \{[\s\S]{0,400}return emptyQuote\(symbol\);/.test(quote),
  "the minute is spent, so FMP would answer with a 429 anyway -- the same outcome sooner, without deepening the shortage"
);

console.log("\n=== 3. The non-blocking door behaves ===\n");

const tryBlock = history.slice(
  history.indexOf("export async function tryReserveFmpCallSlot"),
  history.indexOf("\n}", history.indexOf("export async function tryReserveFmpCallSlot"))
);

check(
  "it never sleeps",
  tryBlock.length > 0 && !/sleep\(|await new Promise/.test(tryBlock),
  "a single await of a wait would silently reintroduce the 20-second render"
);
check(
  "an over-ceiling reservation is handed back",
  /redis\.decr\(key\)/.test(tryBlock),
  "a refused reservation is not a call anyone will make, and leaving it counted charges the minute for nothing"
);
check(
  "it fails OPEN on a Redis error",
  /catch \{[\s\S]{0,200}return true;/.test(tryBlock),
  "the counter is a pacing aid; a Redis blip must not stop a page rendering a price"
);

console.log("\n=== 4. The warm path is untouched ===\n");

check(
  "FMP_MAX_WAIT_MS is unchanged at 20s",
  /const FMP_MAX_WAIT_MS = 20_000;/.test(history),
  "the brief is explicit that the warm path's wait budget stays as it is"
);
check(
  "reserveFmpCallSlot still waits",
  /export async function reserveFmpCallSlot/.test(history) &&
    /FMP_MAX_WAIT_MS/.test(history),
  "warm jobs have nothing better to do and a universe to get through -- waiting is right for them"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
