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

// ── 2b. A refusal is not evidence about the ticker ─────────────────────────
console.log("\n2b. Only an EMPTY body can park a symbol; a refusal cannot");

// THE DEFECT THIS SECTION EXISTS FOR. fetchStableQuote returned
// `QuoteLite | null` and every failure collapsed into the null: 429, 402, 5xx,
// network throw, parse failure, and reserveFmpCallSlot's own capacity-timeout.
// Harmless until failStreak attached a consequence -- "this ticker is dead" --
// to a signal that mostly means "we are being rate-limited right now".
// Production: http-429:155 on 08-30, 670 on 08-31 (700 of 700 symbols),
// 171 on 09-01, capacity-timeout:40 on 09-02, a healthy day.
//
// Asserted by RUNNING the classifier against fake responses, because the whole
// point is which BRANCH a given response reaches -- something a regex cannot
// see at all.
const quoteFn = (pool.match(/async function fetchStableQuote\([\s\S]*?\n\}/) ?? [])[0];
if (!quoteFn) {
  console.error("FAIL: could not extract fetchStableQuote — measuring nothing.");
  process.exit(1);
}
const classifier = await lift(
  `export ${quoteFn}`,
  `const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
   const isFmpErrorEnvelope = (j) =>
     !!j && typeof j === "object" && !Array.isArray(j) &&
     Object.keys(j).some((k) => ["error message", "error"].includes(k.toLowerCase()));
   let RESERVE_THROWS = false;
   const reserveFmpCallSlot = async () => { if (RESERVE_THROWS) throw new Error("capacity-timeout"); };
   let NEXT;
   const fmpFetch = async () => { if (NEXT instanceof Error) throw NEXT; return NEXT; };
   export const setReserveThrows = (v) => { RESERVE_THROWS = v; };
   export const setNext = (v) => { NEXT = v; };`
);
const res = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const outcome = async (next, reserveThrows = false) => {
  classifier.setReserveThrows(reserveThrows);
  classifier.setNext(next);
  return classifier.fetchStableQuote("X", "k");
};

check(
  "a 429 is a refusal, not evidence about the ticker",
  (await outcome(res(429, []))).kind === "refused",
  "670 of 700 symbols failed this way on 08-31 — counting that as a streak " +
    "would have parked the entire universe"
);
check(
  "402, 5xx, a network throw and a parse failure are all refusals",
  (await outcome(res(402, []))).kind === "refused" &&
    (await outcome(res(503, []))).kind === "refused" &&
    (await outcome(new Error("ECONNRESET"))).kind === "refused" &&
    (await outcome(res(200, null))).kind === "refused",
  "every one of these used to be the same `null` as a genuine delisting"
);
check(
  "our OWN capacity-timeout is a refusal, caught before the fetch",
  (await outcome(res(200, [{ price: 1 }]), true)).kind === "refused",
  "waitForPriceBudget's comment already said this throw 'would show up as a " +
    "quote failure rather than as the pacing it actually is' — 8a attached a " +
    "consequence to exactly that mislabel"
);
check(
  "HTTP 200 with no row is EMPTY — the one outcome that is about the ticker",
  (await outcome(res(200, []))).kind === "empty",
  "this is what a delisted symbol actually returns"
);
check(
  "a real row is a row",
  (await outcome(res(200, [{ price: 10, volume: 5 }]))).kind === "row",
  ""
);

// THE HOLE THIS PATH HAD AFTER hasRows WAS FIXED, on the one path #404's
// eviction gate depends on. FMP answers a rate limit or a bad key with HTTP
// 200 and {"Error Message": "..."}: res.ok is true, the body is non-null, and
// `Array.isArray(json) ? json[0] : json` hands the envelope back AS A ROW. The
// call site then read seven nulls as a successful quote -- overwriting a live
// price, stamping ts fresh, and CLEARING failStreak and failAt, so a genuinely
// delisted ticker answered this way could never accumulate toward eviction.
check(
  "an FMP error envelope is a REFUSAL, not a row and not an empty",
  (await outcome(res(200, { "Error Message": "Limit Reach" }))).kind === "refused" &&
    (await outcome(res(200, { error: "Invalid API KEY" }))).kind === "refused",
  "classifying it 'empty' would fix the price corruption and keep the eviction " +
    "half — an envelope must not park a symbol either"
);
// A BARE {} IS A REFUSAL, and the reason is asymmetry rather than certainty.
// FMP says "no such symbol" with [], not with {}; a keyless object is far more
// likely a truncated body. Calling it refused costs one retry; calling it empty
// feeds a deferral and, through #404, an eviction. Ties go to the
// non-destructive branch.
check(
  "a bare {} is a refusal, because ties go to the non-destructive branch",
  (await outcome(res(200, {}))).kind === "refused",
  "[] is how FMP says 'nothing for this symbol'; {} is how a response arrives " +
    "broken"
);
check(
  "the envelope test is shared, not a second copy",
  /isFmpErrorEnvelope/.test(pool) && /hasFmpRows/.test(stock),
  "hasRows and this are the same question about the same API — two copies is " +
    "the 'eight chances for the ninth endpoint' argument applied to itself, and " +
    "it is exactly how this path was missed the first time"
);
check(
  "an error envelope INSIDE AN ARRAY is a refusal too",
  (await outcome(res(200, [{ "Error Message": "Limit Reach" }]))).kind === "refused",
  "isFmpErrorEnvelope returns false for an array, so this used to become `row`, " +
    "have keys, and be accepted as data — clearing failStreak and failAt, which " +
    "is #404's eviction evidence erased. hasFmpRows keeps the array carve-out " +
    "because its cost there is one mislabelled refresh, not a ticker that can " +
    "never be removed"
);

// ── 2c. Which fields carry forward, and which must not ─────────────────────
console.log("\n2c. Last-known-good carries forward; session-scoped does not");

// RUN THE MERGE. The previous version of this regexed one ternary out of seven,
// which cannot see the distinction that matters: whether a field takes the
// `prev` branch. The instruction that produced the regression said "give the
// quote branch a prev fallback" and it was applied to all seven fields.
// BRACE-MATCHED, NOT REGEXED. `/export function mergePoolRow\([\s\S]*?\n\}/`
// stops at the FIRST `}` in column 0 -- which is the closing brace of the
// inline parameter TYPE (`}): PricePoolRow {`), not the function's. It lifted a
// truncated fragment that would not even parse. A lazy match plus an anchor
// that appears twice is the same shape as the [\s\S]*? failures this file
// keeps recording.
const braceBlock = (src, decl) => {
  const start = src.indexOf(decl);
  if (start === -1) return null;
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
};
const mergeFn = braceBlock(pool, "export function mergePoolRow(");
if (!mergeFn) {
  console.error("FAIL: could not extract mergePoolRow — measuring nothing.");
  process.exit(1);
}
const merge = (await lift(mergeFn)).mergePoolRow;

const PREV = {
  price: 100, marketCap: 5e9, changePct: 1.5, volume: 900,
  open: 99, dayHigh: 101, dayLow: 98, pe: 20, ts: 1, peTs: 1, failStreak: 0,
};
// A quote that LANDED but carried only price -- num() nulls every absent or
// non-finite field, so this is what a degraded stable/quote response becomes.
const thin = {
  price: 123, marketCap: null, changePct: null, volume: null,
  open: null, dayHigh: null, dayLow: null,
};
const merged = merge({
  quote: thin, already: undefined, prev: PREV,
  quoteAt: 1000, peFetched: false, peValue: null, nowMs: 1000,
});

check(
  "session-scoped fields are NULL, not yesterday's numbers",
  merged.open === null && merged.dayHigh === null && merged.dayLow === null &&
    merged.volume === null && merged.changePct === null,
  `open ${merged.open}, dayHigh ${merged.dayHigh}, dayLow ${merged.dayLow}, ` +
    `volume ${merged.volume}, changePct ${merged.changePct} — yesterday's dayHigh ` +
    `is not an unknown-but-similar version of today's, it is a DIFFERENT ` +
    `SESSION'S NUMBER written under today's ts`
);
check(
  "and PricePoolRow's own doc still says why",
  /NULL IS MEANINGFUL AND MUST STAY VISIBLE/.test(
    fs.readFileSync(path.join(ROOT, "lib/server/pricePool.ts"), "utf8")
  ),
  "ATR spike and the support/resistance detector read high/low and are " +
    "DESIGNED to stop firing on null — a fallback turns that into silent wrong " +
    "values, and in the 'the plan stopped sending OHLC' scenario it would not " +
    "decay but FREEZE, since every later run falls back too"
);
check(
  "last-known-good fields DO carry forward",
  merge({
    quote: { ...thin, price: null }, already: undefined, prev: PREV,
    quoteAt: 1000, peFetched: false, peValue: null, nowMs: 1000,
  }).price === PREV.price &&
    merged.marketCap === PREV.marketCap &&
    merged.pe === PREV.pe,
  "price, marketCap and pe describe a company rather than a session, so a " +
    "value FMP did not send is unknown and the previous one is the best answer"
);
check(
  "ts advances either way, because the quote itself landed",
  merged.ts === 1000 &&
    merge({
      quote: { ...thin, price: null }, already: undefined, prev: PREV,
      quoteAt: 1000, peFetched: false, peValue: null, nowMs: 1000,
    }).ts === 1000,
  "a landed quote is a real refresh even when its fields are thin"
);
check(
  "a run with NO quote leaves ts and the streak alone",
  merge({
    quote: null, already: undefined, prev: { ...PREV, failStreak: 2 },
    quoteAt: 1000, peFetched: true, peValue: 21, nowMs: 1000,
  }).ts === PREV.ts,
  "the PE trickle must not stamp a price refresh that did not happen"
);
check(
  "only an empty increments the streak",
  /lastOutcome === "empty"/.test(pool) && /if \(wantPrice && lastOutcome === "empty"\)/.test(pool),
  "a refusal is counted and never acted on"
);
check(
  "quotesRefused is reported alongside quoteFailures rather than replacing it",
  /quoteFailures,/.test(pool) && /quotesRefused,/.test(pool),
  "quoteFailures keeps meaning 'attempted and did not land' so historical run " +
    "records stay comparable; the new field says WHY"
);
check(
  "deferrals are buffered and discarded whole above the empty-rate line",
  /pendingDefers\.push/.test(pool) &&
    /emptyRate > PRICE_EMPTY_RATE_ABORT/.test(pool) &&
    /deferSuppressed = true/.test(pool),
  "dead tickers do not arrive 300 at a time — a run that empty on more than " +
    "half its attempts has no trustworthy evidence in it, so the whole buffer " +
    "goes rather than the least confident part of it"
);

// ── 3. Nothing landed must not read as fresh ───────────────────────────────
console.log("\n3. A symbol where no endpoint answered is not marked refreshed");

// THE SHARED HELPER, not stockDataCache's one-line delegate. The logic moved
// to lib/server/fmpResponse.ts when the quote path turned out to need the same
// test, so lifting hasRows would now be lifting a call to something that is not
// in scope -- and a check that tests a wrapper rather than the thing it wraps
// is measuring the import statement.
const shared = readCodeOnly("lib/server/fmpResponse.ts", { minRetainedFraction: 0.005 });
const envelopeFn = (shared.match(/export function isFmpErrorEnvelope\([\s\S]*?\n\}/) ?? [])[0];
const hasRowsFn = (shared.match(/export function hasFmpRows\([\s\S]*?\n\}/) ?? [])[0];
if (!envelopeFn || !hasRowsFn) {
  console.error(
    "FAIL: could not extract isFmpErrorEnvelope/hasFmpRows from fmpResponse.ts — " +
      "measuring nothing."
  );
  process.exit(1);
}
const lifted = await lift(`${envelopeFn}\n${hasRowsFn}\nexport { hasFmpRows as hasRows };`);
const rows = lifted;
check(
  "stockDataCache delegates to the shared test rather than keeping its own",
  /return hasFmpRows\(json\);/.test(stock),
  "one copy, because it is one question about one API"
);

// FMP answers a delisted ticker with HTTP 200 and [], so res.ok is true for a
// symbol that no longer exists. That is the case this has to separate.
check(
  "an empty array does not count as an answer",
  rows.hasRows([]) === false && rows.hasRows(null) === false,
  "HTTP 200 with [] is what a delisted ticker returns — counting res.ok would " +
    "mark it fresh"
);
// THE MOST LIKELY FAILURE MODE, AND IT USED TO PASS. FMP answers a rate limit
// or a bad key with HTTP 200 and {"Error Message": "..."} -- a non-null object,
// so the old `typeof json === "object"` test counted it as an answer and marked
// the symbol refreshed. The green-forever lie surviving on the very thing most
// likely to happen.
check(
  "an FMP error envelope is not an answer",
  rows.hasRows({ "Error Message": "Limit Reach" }) === false &&
    rows.hasRows({ error: "Invalid API KEY" }) === false &&
    rows.hasRows([{ "Error Message": "x" }]) === true,
  "both spellings — legacy endpoints use 'Error Message', some stable ones use " +
    "'error'. (An error inside an ARRAY is left alone: that shape is not what " +
    "FMP returns for these, and rejecting it would need to guess at row schemas.)"
);
check(
  "an empty object is not an answer either",
  rows.hasRows({}) === false,
  "it carries no data about the symbol, and it also used to pass"
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
