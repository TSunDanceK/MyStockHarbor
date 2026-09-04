// The price pool's TTL survives every path that skips a warm run.
//
// THIS CHECK EXISTS BECAUSE THE SAME DEFECT HAS NOW BEEN INTRODUCED TWICE.
//
//   #395  warmPricePool's market gate returned before redis.expire. HSET does
//         not extend an existing TTL, PRICE_POOL_HASH_TTL_SECONDS is 12h, and
//         the active window is shut for 15 hours on a weeknight and 63 across a
//         weekend -- so the pool expired at ~05:00 ET every weekday, every
//         picker page fell back to end-of-day closes, and it took a fortnight
//         to notice. Fixed in #398 by resetting the TTL on the skip path.
//
//   #419  a NEW gate in the route returned before warmPricePool was called at
//         all, which put #398's reset on a path the cron could no longer reach.
//         Identical failure, one level up, and invisible in exactly the same
//         way: a healthy-looking `{"skipped":true,"reason":"market-closed"}`.
//         Caught in review, before it shipped.
//
// The second time is what makes this a check rather than a comment. The rule is
// not "warmPricePool resets the TTL" -- that rule was true and still broke. The
// rule is: ANY path that decides not to warm must keep the pool alive.
//
// RUN, NOT GREPPED. The route's GET is lifted and executed with the window shut
// against spies, because the property is about which branch runs -- and a regex
// cannot tell a keep-alive that is called from one that is merely present.
//
//   node scripts/check-pool-keepalive.mjs
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const routeSrc = readCodeOnly("app/api/jobs/warm-price-pool/route.ts");
const poolSrc = readCodeOnly("lib/server/pricePool.ts");

const grab = (src, file, name) => {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  let out = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      out = n.getText(sf).replace(/^export\s+/, "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

const getFn = grab(routeSrc, "route.ts", "GET");
const keepAliveFn = grab(poolSrc, "pricePool.ts", "keepPricePoolAlive");
if (!getFn || !keepAliveFn) {
  console.error(
    `FAIL: could not extract GET (${!!getFn}) or keepPricePoolAlive ` +
      `(${!!keepAliveFn}) — every assertion below would measure nothing.`
  );
  process.exit(1);
}

// THE TTL AND THE KEY READ FROM SOURCE, not retyped. A check that asserts
// against its own copy of a constant passes while the constant is wrong.
const ttlSeconds = Number(
  Function(
    `"use strict"; return (${
      (poolSrc.match(/PRICE_POOL_HASH_TTL_SECONDS = ([0-9 *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
const poolKey = (poolSrc.match(/PRICE_POOL_KEY = "([^"]+)"/) ?? [])[1];
if (!ttlSeconds || !poolKey) {
  console.error(`FAIL: could not read the TTL (${ttlSeconds}) or the key (${poolKey}).`);
  process.exit(1);
}

console.log("\n1. The keep-alive extends the real key, by the real TTL");

// Run keepPricePoolAlive against a Redis stub and inspect the call it made.
const aliveJs = ts.transpileModule(
  `const PRICE_POOL_KEY = ${JSON.stringify(poolKey)};
const PRICE_POOL_HASH_TTL_SECONDS = ${ttlSeconds};
const redis = {
  expire: async (key, seconds) => {
    globalThis.__POOL_EXPIRE_CALLS.push({ key, seconds });
    return 1;
  },
};
${keepAliveFn}
export { keepPricePoolAlive };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;
// Assigned BEFORE the import: the module body binds `redis` at import time, and
// a store handed over afterwards is `undefined` inside it.
globalThis.__POOL_EXPIRE_CALLS = [];
const alive = await import(
  `data:text/javascript;base64,${Buffer.from(aliveJs).toString("base64")}`
);
const ok = await alive.keepPricePoolAlive();
check(
  "it EXPIREs the pool hash and reports that it landed",
  ok === true &&
    globalThis.__POOL_EXPIRE_CALLS.length === 1 &&
    globalThis.__POOL_EXPIRE_CALLS[0].key === poolKey &&
    globalThis.__POOL_EXPIRE_CALLS[0].seconds === ttlSeconds,
  `${JSON.stringify(globalThis.__POOL_EXPIRE_CALLS)} — ${ttlSeconds / 3600}h on ${poolKey}`
);
// THE FIRST DRAFT OF THIS ASSERTION WAS WRONG, AND THE WAY IT WAS WRONG MATTERS.
//
// It read `ttlSeconds > 15 * 3600` -- "the TTL must outlast the weeknight gap"
// -- and went red, because the TTL is 12h and the gap is 15h. But that is not
// the rule. The pool survives the night because EVERY SKIPPED RUN resets the
// TTL, five minutes apart, so 12h means "twelve hours with no run at all". A
// TTL sized to the gap would be a second, redundant answer to the same
// question, and would have hidden a cron that stopped for fourteen hours.
//
// The real coupling is against the CRON PERIOD, and it is asserted below
// against the schedule the JOBS registry actually ships rather than a typed 5.
const cron = (readCodeOnly("lib/server/jobRuns.ts").match(
  /"warm-price-pool":\s*\{[\s\S]{0,300}?cron:\s*"([^"]+)"/
) ?? [])[1];
const periodMinutes = Number((cron?.match(/^\*\/(\d+) /) ?? [])[1]);
check(
  "the cron period was read from the JOBS registry",
  Number.isFinite(periodMinutes) && periodMinutes > 0,
  `${cron ?? "NOT FOUND"} — typed here instead, the coupling below would compare ` +
    `the TTL against a number this file made up`
);
check(
  "the TTL survives many consecutive missed runs, not just one",
  ttlSeconds > periodMinutes * 60 * 50,
  `${ttlSeconds / 3600}h against a ${periodMinutes}-minute cron — ` +
    `${Math.round(ttlSeconds / (periodMinutes * 60))} missed runs of slack. The ` +
    `TTL means "the cron has stopped", not "the market is shut": every skipped ` +
    `run resets it, so it must be sized against the schedule, not the session`
);

console.log("\n2. The route's market-closed path keeps the pool alive");

// THE ROUTE, RUN. Every import is replaced by a spy, the window is forced shut,
// and the assertions are about which spies were called.
const routeJs = ts.transpileModule(
  `const S = () => globalThis.__ROUTE_SPY;
// The route logs its own progress; the lift is a test harness, not a run.
const console = { log: () => {}, warn: () => {}, error: () => {} };
const NextResponse = { json: (body, init) => ({ body, init }) };
const isAuthorized = () => true;
const acquireLock = async () => "token";
const releaseLock = async () => { S().released += 1; };
const recordJobRun = async (job, ok, summary) => { S().records.push({ job, ok, summary }); };
const getWarmTargetSymbols = async () => { S().derivedTargets += 1; return { symbols: ["AAPL"], displayed: 1, universe: 1, tier1: 1 }; };
const warmPricePool = async () => { S().warmed += 1; return { ok: true, written: 1 }; };
const isActiveMarketWindow = () => S().marketOpen;
const keepPricePoolAlive = async () => { S().keptAlive += 1; return true; };
const process = { env: { FMP_API_KEY: "x", NEXT_PUBLIC_SITE_URL: "https://x" } };
${getFn}
export { GET };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;

const freshSpy = (marketOpen) => ({
  marketOpen,
  keptAlive: 0,
  derivedTargets: 0,
  warmed: 0,
  released: 0,
  records: [],
});

// Imported ONCE. A data: URL module is cached by its source text, so importing
// the identical text twice returns the SAME module wired to the first stub --
// a trap this repo has already paid for.
//
// AND THE STUBS RESOLVE THE SPY PER CALL, NOT AT MODULE LOAD. The first draft
// bound `const S = globalThis.__ROUTE_SPY` once; reassigning the global for the
// second run left every stub still writing to the first object, so four
// assertions reported zeroes that had nothing to do with the route. Same shape
// as the store-assigned-after-the-lift trap, in the check written knowing about
// it.
globalThis.__ROUTE_SPY = freshSpy(false);
const route = await import(
  `data:text/javascript;base64,${Buffer.from(routeJs).toString("base64")}`
);

const shut = freshSpy(false);
globalThis.__ROUTE_SPY = shut;
await route.GET({ headers: { get: () => null } });

check(
  "with the window shut, the pool TTL is extended",
  shut.keptAlive === 1,
  `keepPricePoolAlive called ${shut.keptAlive}x — this is #398, and the route ` +
    `gate put it on an unreachable path until this assertion existed`
);
check(
  "...and the expensive work is genuinely skipped",
  shut.derivedTargets === 0 && shut.warmed === 0,
  `getWarmTargetSymbols ${shut.derivedTargets}x, warmPricePool ${shut.warmed}x — ` +
    `the saving is the point of the gate; a gate that still derives targets is ` +
    `the old behaviour with extra code`
);
check(
  "...and the skip is recorded with the keep-alive's outcome",
  shut.records.length === 1 &&
    shut.records[0].summary?.reason === "market-closed" &&
    shut.records[0].summary?.poolKeptAlive === true,
  `${JSON.stringify(shut.records[0]?.summary ?? null)} — a keep-alive nobody can ` +
    `see is how the #395 regression hid for a fortnight`
);
check(
  "...and the lock is released exactly once",
  shut.released === 1,
  `${shut.released}x — the finally owns the lock; releasing twice can delete a ` +
    `token a LATER run already holds`
);

console.log("\n3. With the window open, nothing is skipped");

const open = freshSpy(true);
globalThis.__ROUTE_SPY = open;
await route.GET({ headers: { get: () => null } });
check(
  "the gate does not fire during the session",
  open.keptAlive === 0 && open.derivedTargets === 1 && open.warmed === 1,
  `keptAlive ${open.keptAlive}, targets ${open.derivedTargets}, warmed ${open.warmed} ` +
    `— a gate that cannot be passed is a job that never runs, which is the ` +
    `opposite error and worse`
);
check(
  "warmPricePool still owns the keep-alive on its own skip path",
  /if \(!isActiveMarketWindow\(new Date\(nowMs\)\)\) \{[\s\S]{0,1200}?await keepPricePoolAlive\(\);/.test(
    poolSrc
  ),
  "the route is not the only caller — /api/pickers and the diagnostics routes " +
    "reach warmPricePool directly, and a keep-alive only the cron performs is " +
    "one the other callers silently skip"
);
check(
  "there is exactly ONE expire on the pool key in the module",
  (poolSrc.match(/redis\.expire\(PRICE_POOL_KEY/g) ?? []).length === 1,
  `${(poolSrc.match(/redis\.expire\(PRICE_POOL_KEY/g) ?? []).length} — two copies ` +
    `is two answers to "how long may the pool live", which is exactly the shape ` +
    `claude/traps/two-validators-for-one-value.md is about`
);

console.log(
  failures === 0
    ? "\nAll pool keep-alive assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
