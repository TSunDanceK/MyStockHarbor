// A dead symbol must stop costing calls, and must stop reporting green.
//
// WHAT WAS TRUE BEFORE. There is no delisting handling anywhere in this
// codebase -- `isActivelyTrading` appears in exactly one production path, the
// screener URL, and it is an ADMISSION filter that nothing re-checks. Two
// mechanisms then made a dead ticker permanent AND invisible:
//
//   THE COST. pricePool's `if (!quote && !peFetched) continue` leaves a failed
//   symbol's `ts` untouched, so it stays past its TTL and sorts to the FRONT of
//   the next run's due set. That is right for a transient -- a blip costs one
//   cron period, not one TTL, and #395 argued for it. For a permanently dead
//   ticker it is an infinite loop at up to 288 calls a day, and there was no
//   deferSymbol for pricePool anywhere.
//
//   THE LIE. stockDataCache's fetchOne wraps every endpoint in its own
//   try/catch and returns a Partial, so a symbol where nothing answered still
//   wrote a full row of carried-forward nulls with a current `updatedAt` and
//   still called markRefreshed. It reset its own staleness and reported green
//   forever. stalenessQueue.ts's header names this exact failure -- "a delisted
//   ticker would show green" -- and the deferral it describes was only ever
//   wired into `profile` and `earnings`.
//
// Both are claims about behaviour over inputs, so both are asserted by RUNNING
// the shipped functions. A regex cannot tell a threshold that is applied from
// one that is declared, and it certainly cannot tell whether a cap is reached.
//
//   node scripts/check-dead-symbol-honesty.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const pool = readCodeOnly("lib/server/pricePool.ts");
const stock = readCodeOnly("lib/server/stockDataCache.ts");
const queue = readCodeOnly("lib/server/stalenessQueue.ts");

// Lift the two pure functions rather than stubbing the modules around them.
const lift = async (src, extra = "") => {
  const js = ts.transpileModule(`${extra}\n${src}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};

const deferFn = (pool.match(/export function priceFailDeferSeconds\([\s\S]*?\n\}/) ?? [])[0];
const after = Number((pool.match(/PRICE_FAIL_DEFER_AFTER = (\d+)/) ?? [])[1]);
const base = (pool.match(/PRICE_FAIL_DEFER_BASE_SECONDS = ([0-9 *]+);/) ?? [])[1];
const maxExpr = (pool.match(/PRICE_FAIL_DEFER_MAX_SECONDS = ([0-9 *]+);/) ?? [])[1];
if (!deferFn || !after || !base || !maxExpr) {
  console.error(
    `FAIL: could not extract priceFailDeferSeconds (${!!deferFn}), the threshold ` +
      `(${after}), the base (${base}) or the cap (${maxExpr}) — this script would ` +
      `otherwise pass by measuring nothing.`
  );
  process.exit(1);
}
const evalNum = (e) => Function(`"use strict"; return (${e});`)();
const capSeconds = evalNum(maxExpr);
const baseSeconds = evalNum(base);
const mod = await lift(
  deferFn,
  `const PRICE_FAIL_DEFER_AFTER = ${after};
   const PRICE_FAIL_DEFER_BASE_SECONDS = ${baseSeconds};
   const PRICE_FAIL_DEFER_MAX_SECONDS = ${capSeconds};`
);

// ── 1. A transient is still retried next run ───────────────────────────────
console.log("\n1. A blip is still retried immediately, as #395 argued");

check(
  "one or two failures do not park the symbol",
  mod.priceFailDeferSeconds(1) === 0 && mod.priceFailDeferSeconds(2) === 0,
  `threshold ${after} — a symbol that fails once keeps its stale ts and sorts to ` +
    `the front of the next run, which is the behaviour being preserved, not fixed`
);
check(
  "the failed symbol's timestamp is deliberately NOT advanced",
  /ts: prev\?\.ts \?\? 0,/.test(pool),
  "advancing it would make a failed fetch look like a refresh — the symbol would " +
    "drop out of the due set for a full TTL while the page rendered a " +
    "carried-forward price as if it had just been checked"
);

// ── 2. A dead symbol stops costing calls ───────────────────────────────────
console.log("\n2. Repeated failure parks the symbol, with a bounded backoff");

check(
  `the ${after}rd consecutive failure parks it`,
  mod.priceFailDeferSeconds(after) > 0,
  `${mod.priceFailDeferSeconds(after) / 3600}h at streak ${after}`
);
const ladder = [3, 4, 5, 6, 7, 8, 12, 50, 1000].map((n) => [n, mod.priceFailDeferSeconds(n)]);
check(
  "the backoff grows with the streak",
  ladder.every(([, v], i) => i === 0 || v >= ladder[i - 1][1]),
  ladder.map(([n, v]) => `${n}:${v / 3600}h`).join(" ")
);

// THE ASSERTION THAT MATTERS MOST. A deferral that never expires is an eviction
// wearing a smaller name -- a halted stock, or one FMP is briefly wrong about,
// has to come back on its own.
check(
  "no streak, however long, can park a symbol permanently",
  ladder.every(([, v]) => v <= capSeconds) &&
    mod.priceFailDeferSeconds(Number.MAX_SAFE_INTEGER) <= capSeconds,
  `capped at ${capSeconds / 3600}h even at an absurd streak — the practical worst ` +
    `case for a symbol that is actually alive is that cap plus the closed hours ` +
    `the expiry lands in, ~30h of a frozen price`
);
check(
  "the deferral is READ, not merely written",
  /readDeferred\("pricePool"\)/.test(pool) && /!deferred\.has\(sym\)/.test(pool),
  "the price pool picks work by TTL rather than via claimStalest, so a deferral " +
    "nothing reads would be write-only — a record of the retry loop rather than " +
    "an end to it"
);
check(
  "readDeferred filters by expiry rather than trusting a prune",
  /zrange<string\[\]>\(deferKey\(dataset\), now, "\+inf"/.test(queue),
  "claimStalest prunes expired entries as a side effect of its own read, and a " +
    "dataset that never calls claimStalest never prunes"
);
check(
  "a success clears the streak",
  /failStreak: quote \? 0 :/.test(pool),
  "and markRefreshed already ZREMs the deferral, so one good fetch fully un-parks"
);

// ── 3. Nothing landed must not read as fresh ───────────────────────────────
console.log("\n3. A symbol where no endpoint answered is not marked refreshed");

const hasRowsFn = (stock.match(/function hasRows\([\s\S]*?\n\}/) ?? [])[0];
if (!hasRowsFn) {
  console.error("FAIL: could not extract hasRows from stockDataCache — measuring nothing.");
  process.exit(1);
}
const rows = await lift(`export ${hasRowsFn}`);

// FMP answers a delisted ticker with HTTP 200 and [], so res.ok is true for a
// symbol that no longer exists. That is the case this has to separate.
check(
  "an empty array does not count as an answer",
  rows.hasRows([]) === false && rows.hasRows(null) === false,
  "HTTP 200 with [] is what a delisted ticker returns — counting res.ok would " +
    "mark it fresh"
);
check(
  "a row that answered counts, even if its fields are null",
  rows.hasRows([{ psRatio: null }]) === true && rows.hasRows({ a: 1 }) === true,
  "a partial is LEGITIMATE — plenty of live symbols have no dividends and no " +
    "analyst coverage, and marking those stale forever is the same lie pointing " +
    "the other way"
);
check(
  "markRefreshed is gated on something having answered",
  /if \(tally\.answered > 0\) refreshedSymbols\.push\(symbol\);/.test(stock),
  "the row is still WRITTEN either way — fields fall back to prev, so a symbol " +
    "that answered on two of five endpoints keeps the other three"
);
check(
  "the count is taken at the one place every endpoint goes through",
  /async function fetchJson\(url: string, tally\?: FetchTally\)/.test(stock) &&
    (stock.match(/fetchJson\(`[^`]*`, tally\)/g) ?? []).length === 8,
  `${(stock.match(/fetchJson\(`[^`]*`, tally\)/g) ?? []).length} of fetchOne's 8 ` +
    `endpoints — counting inside each block instead would be eight chances for the ` +
    `ninth endpoint to be added without one`
);
check(
  "the gap between written and marked is on the run record",
  /noEndpointAnswered/.test(readCodeOnly("app/api/jobs/warm-stock-data/route.ts")),
  "`written` counting more than `markedRefreshed` is the difference between " +
    "storing a row and the row meaning anything, and that gap is where dead " +
    "symbols live"
);

console.log(
  failures === 0
    ? "\nAll dead-symbol assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
