// A missing quote must never read as a company that is not there.
//
// WHY THESE ARE RUN AND NOT PATTERN-MATCHED. Every claim here is about BEHAVIOUR
// over inputs -- "a 401 does not settle a date as complete", "an empty result
// that contradicts its own feed is not written". A regex over earningsCalendar.ts
// can see that the word `failed` appears; it cannot see whether the completeness
// test reads it. The defect being guarded against was invisible precisely because
// the code looked right: quoteOne returned a well-formed value on failure.
//
// THE FAILURE SHAPE IS A 401 CARRYING A JSON BODY, not a refused connection.
// A lapsed or downgraded FMP licence answers with a perfectly valid HTTP response
// and a JSON error document. There is no exception to catch, `res.ok` is the only
// tell, and the reproduction on 2026-09-14 used an unreachable host -- which
// exercises the `catch` arm and NOT the `!res.ok` arm. Both are asserted here,
// and fetchCalendarRange and getNameMap are exercised against the JSON-body shape
// for the first time.
//
//   node scripts/check-earnings-failure-not-absence.mjs
//
// The mutation runner that proves these assertions can FAIL is
// scripts/mutate-earnings-failure-not-absence.mjs. An assertion that passes
// against correct code proves nothing on its own (#453).
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments, assertStripKeptTheCode } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/earningsCalendar.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── The harness ────────────────────────────────────────────────────────────
//
// The module's imports are replaced with stubs so the real logic runs with no
// network and no database. Everything replaced is a BOUNDARY (fetch, Redis, the
// price pool, the FMP budget); none of the logic under test is stubbed.
const IMPORT_BLOCK = `import { Redis } from "@upstash/redis";
import {
  REFERENCE_TTL_DAILY_SECONDS,
  REFERENCE_TTL_MONTHLY_SECONDS,
  readReference,
  writeReference,
} from "./referenceCache";
import { fmpFetch } from "./fmpUsage";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { reserveFmpCallSlot } from "./historyCache";
import { readPricePoolBulk } from "./pricePool";
import { priceCoverage, type PriceCoverage } from "./gridPriceCoverage";`;

const STUBS = `
// THE REAL RULE, NOT A STUB. gridPriceCoverage is pure, imports nothing, and
// decides which rows show a price -- so stubbing it would let this harness
// assert day-building behaviour against a coverage rule the site does not use.
// It is three lines; inlining the real one costs nothing and keeps the module
// under test honest.
const priceCoverage = (i) => (i.fromPricePool ? "covered" : "outside-bar-universe");
const REFERENCE_TTL_DAILY_SECONDS = 86400;
const REFERENCE_TTL_MONTHLY_SECONDS = 2592000;
const PAGE_READ_CACHE = {};
const __h = globalThis.__EARNINGS_HARNESS__;
const readReference = async (k) => __h.reference.get(k) ?? null;
const writeReference = async (k, v) => { __h.reference.set(k, v); };
const fmpFetch = (url, init) => __h.fmpFetch(url, init);
const reserveFmpCallSlot = async () => {};
const readPricePoolBulk = async () => new Map();
class Redis {
  static fromEnv() { return new Redis(); }
  async get(k) { __h.cmd.push(["get", k]); const v = __h.store.get(k); return v === undefined ? null : v; }
  async set(k, v, o) {
    __h.cmd.push(["set", k, o ?? null]);
    if (o?.nx && __h.store.has(k)) return null;
    __h.store.set(k, v);
    return "OK";
  }
  async mget(...ks) {
    __h.cmd.push(["mget", ks]);
    // The window-completeness read is the one place a FAILED read and an EMPTY
    // result mean opposite things, so the harness has to be able to produce
    // both. mgetThrows is the failure; an absent key is the empty.
    if (__h.mgetThrows) throw new Error("upstash unreachable");
    return ks.map((k) => { const v = __h.store.get(k); return v === undefined ? null : v; });
  }
  async incr(k) { __h.cmd.push(["incr", k]); const n = Number(__h.store.get(k) ?? 0) + 1; __h.store.set(k, n); return n; }
  async expire(k, s) { __h.cmd.push(["expire", k, s]); return 1; }
}
`;

const raw = fs.readFileSync(SRC, "utf8");
if (!raw.includes(IMPORT_BLOCK)) {
  console.error(
    "FATAL: the import block in lib/server/earningsCalendar.ts is not the one this " +
      "harness knows how to stub. It must be updated deliberately -- silently falling " +
      "back would run a different module than the one shipped."
  );
  process.exit(1);
}

let loadSeq = 0;
async function loadModule() {
  // A fresh module per scenario: monthCache and candidatesCache are module-level
  // and would otherwise carry one scenario's state into the next.
  const patched = raw.replace(IMPORT_BLOCK, STUBS) + `\n//${++loadSeq}\n`;
  const js = ts.transpileModule(patched, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const jsonResponse = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Install a harness. `mode` decides what every FMP call does. */
function harness({ mode, monthRows = [], names = {}, store = new Map() }) {
  const h = {
    reference: new Map(),
    store,
    cmd: [],
    calls: [],
    mgetThrows: false,
    fmpFetch: async (url) => {
      h.calls.push(url);
      if (mode === "licence-401") {
        // THE REAL SHAPE OF A LAPSED KEY: a valid response, a JSON body, no throw.
        return jsonResponse({ "Error Message": "Invalid API KEY." }, 401);
      }
      if (mode === "plan-402") return jsonResponse({ "Error Message": "Special Endpoint" }, 402);
      if (mode === "throw") throw new TypeError("fetch failed");
      if (url.includes("/stable/quote")) {
        const sym = new URL(url).searchParams.get("symbol");
        return jsonResponse([{ symbol: sym, price: 100, marketCap: 1e12, exchange: "NASDAQ" }], 200);
      }
      if (url.includes("/stable/stock-list")) {
        return jsonResponse(Object.entries(names).map(([symbol, companyName]) => ({ symbol, companyName })), 200);
      }
      if (url.includes("/stable/earnings-calendar")) return jsonResponse(monthRows, 200);
      return jsonResponse([], 200);
    },
  };
  globalThis.__EARNINGS_HARNESS__ = h;
  return h;
}

process.env.FMP_API_KEY = "test-key";
process.env.UPSTASH_REDIS_REST_URL = "http://harness.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN = "harness";

// ── THE FIXTURE DATE IS RELATIVE, BECAUSE THE WINDOW IS ─────────────────────
// It was hardcoded to a date three months ahead, which was inside the old
// forward window and is outside the new backward one by construction. Anchored
// to today instead: two days back is inside a 90-day window on every day this
// suite will ever run, and an out-of-window fixture makes the fill scenarios
// pass by finding nothing rather than by finding the right thing.
const pad2 = (n) => String(n).padStart(2, "0");
const toDateStr = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const TODAY = (() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); })();
const daysAgo = (n) => toDateStr(new Date(TODAY.getTime() - n * 86_400_000));
const DATE = daysAgo(2);
// DATE's own month, for the calls that warm the month feed. Hardcoding it was
// only ever right because DATE was hardcoded too.
const DATE_YEAR = Number(DATE.slice(0, 4));
const DATE_MONTH = Number(DATE.slice(5, 7));
const MONTH_ROWS = [
  { symbol: "AAA", date: DATE, epsEstimated: 1, epsActual: null, revenueEstimated: 1e9, revenueActual: null },
  { symbol: "BBB", date: DATE, epsEstimated: 2, epsActual: null, revenueEstimated: 2e9, revenueActual: null },
  { symbol: "CCC", date: DATE, epsEstimated: 3, epsActual: null, revenueEstimated: 3e9, revenueActual: null },
];
const NAMES = { AAA: "Alpha Inc", BBB: "Beta Inc", CCC: "Gamma Inc" };

// ── THE KEY NAMES ARE READ FROM THE MODULE, NOT TYPED HERE ─────────────────
//
// These were hardcoded, and the v2 -> v3 bump would have walked straight past
// it: every assertion below would keep watching a key nothing writes any more,
// find nothing, and PASS. A suite that silently stops testing on a rename is the
// same failure as a dump that silently reads the wrong key shape -- which is the
// defect this whole file exists for. Extracted, and the extraction is asserted.
const constFromSource = (name) => {
  const m = new RegExp(`const ${name} = "([^"]+)"`).exec(raw);
  if (!m) {
    console.error(
      `FATAL: could not read ${name} from lib/server/earningsCalendar.ts. The suite ` +
        `would otherwise watch a key that no longer exists and pass by testing nothing.`
    );
    process.exit(1);
  }
  return m[1];
};
const DAY_ITEMS_PREFIX = constFromSource("DAY_ITEMS_PREFIX");
const DAY_COMPLETE_PREFIX = constFromSource("DAY_COMPLETE_PREFIX");
console.log(`\n0. Keys under test (read from the module)\n  items    ${DAY_ITEMS_PREFIX}\n  complete ${DAY_COMPLETE_PREFIX}`);

const wroteItems = (h) => h.cmd.some(([c, k]) => c === "set" && String(k).startsWith(`${DAY_ITEMS_PREFIX}:`));
const wroteComplete = (h) => h.cmd.some(([c, k]) => c === "set" && String(k).startsWith(`${DAY_COMPLETE_PREFIX}:`));

// ── 1. The control: healthy provider ───────────────────────────────────────
//
// FIRST, AND DELIBERATELY. Every assertion below is of the form "X does not
// happen on failure". If the harness simply never got as far as X, they would
// all pass for the wrong reason -- the exact way a suite becomes decorative.
// This proves the machinery reaches the write and the completeness flag.
console.log("\n1. Control — a healthy provider still completes and still caches");
{
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  const m = await loadModule();
  const r = await m.getFullDayEarnings(DATE, { forceRefresh: true, bypassCap: true });
  check("three candidates resolve to three US-listed rows", r.items.length === 3, `got ${r.items.length}`);
  check("the date is marked complete", r.complete === true);
  check("the rows are written to Redis", wroteItems(h));
  check("the complete flag is written to Redis", wroteComplete(h));
}

// ── 2. F1 — the lapsed-licence shape ───────────────────────────────────────
console.log("\n2. F1 — a 401 with a JSON body is a failure, not an empty market");
for (const [label, mode] of [["401 + JSON body", "licence-401"], ["402 + JSON body", "plan-402"], ["fetch throws", "throw"]]) {
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  const m = await loadModule();
  // Warm the month feed while the provider is alive, then kill it. This is the
  // real sequence: the calendar has candidates cached and the quotes stop.
  await m.getMonthDaysWithEarnings(DATE_YEAR, DATE_MONTH);
  h.fmpFetch = harness({ mode, monthRows: MONTH_ROWS, names: NAMES, store: h.store }).fmpFetch;
  globalThis.__EARNINGS_HARNESS__ = h;
  h.cmd.length = 0;

  const r = await m.getFullDayEarnings(DATE, { forceRefresh: true, bypassCap: true });
  check(`${label}: the date is NOT marked complete`, r.complete === false, `complete=${r.complete}`);
  check(`${label}: no complete flag is written`, !wroteComplete(h));
  check(`${label}: the empty result is NOT cached`, !wroteItems(h));
  check(`${label}: the candidate count is still reported`, r.totalCandidates === 3, `got ${r.totalCandidates}`);
}

// ── 2b. F1 ISOLATED — the partial failure F2 cannot see ───────────────────
//
// FOUND BY THE MUTATION RUNNER, NOT BY REVIEW. With every quote failing, `items`
// is empty and the candidate count is positive, so F2's contradiction guard
// already blocks the write and the complete flag on its own -- and all three F1
// mutants SURVIVED the suite above. The assertions passed for a reason unrelated
// to what they claimed to test, which is the #453 trap exactly.
//
// The case where F1 is the only thing standing is a PARTIAL outage: some quotes
// come back, so there are rows, nothing contradicts anything, and `items` looks
// like a normal day. Without `!anyFailed` the date is marked complete with
// companies missing -- and stays that way for 32 days, which is worse than the
// all-empty case because nothing about the page looks wrong.
console.log("\n2b. F1 isolated — a PARTIAL failure must not settle a date either");
// BOTH FAILURE ARMS, because they are separate returns in quoteOne and a mutant
// that only breaks one of them must still be caught. The 401 arm alone left the
// thrown-fetch mutant alive through a whole mutation run.
for (const [label, fail] of [
  ["401 + JSON body", () => jsonResponse({ "Error Message": "Invalid API KEY." }, 401)],
  ["fetch throws", () => { throw new TypeError("fetch failed"); }],
]) {
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  h.fmpFetch = async (url) => {
    h.calls.push(url);
    if (url.includes("/stable/quote")) {
      const sym = new URL(url).searchParams.get("symbol");
      // AAA answers; the other two fail.
      if (sym === "AAA") return jsonResponse([{ symbol: sym, price: 10, marketCap: 1e9, exchange: "NASDAQ" }], 200);
      return fail();
    }
    if (url.includes("/stable/stock-list")) return jsonResponse(Object.entries(NAMES).map(([symbol, companyName]) => ({ symbol, companyName })), 200);
    return jsonResponse(MONTH_ROWS, 200);
  };
  const m = await loadModule();
  const r = await m.getFullDayEarnings(DATE, { forceRefresh: true, bypassCap: true });

  check(`${label}: the one good quote still produces a row`, r.items.length === 1, `got ${r.items.length}`);
  check(`${label}: nothing contradicts itself, so F2's guard does not fire`, r.totalCandidates === 3 && r.items.length > 0);
  check(
    `${label}: and the date is STILL not complete — only !anyFailed can catch this`,
    r.complete === false,
    `complete=${r.complete}`
  );
  check(`${label}: no complete flag is written`, !wroteComplete(h));
  check(`${label}: but the partial rows ARE cached, as before`, wroteItems(h));
}

// ── 3. F3 — a stored [] is not a cache hit while candidates exist ──────────
console.log("\n3. F3 — an empty stored blob is rebuilt, not served");
{
  const store = new Map([[`${DAY_ITEMS_PREFIX}:${DATE}`, []]]);
  harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES, store });
  const m = await loadModule();
  const r = await m.getFullDayEarnings(DATE, { bypassCap: true });
  check("the poisoned [] is not served", r.items.length === 3, `got ${r.items.length} rows`);
  check("and the rebuilt rows replace it", Array.isArray(store.get(`${DAY_ITEMS_PREFIX}:${DATE}`)) && store.get(`${DAY_ITEMS_PREFIX}:${DATE}`).length === 3);
}

// ── 4. F2 — an empty day we could not SEE is poison; one we could is not ───
console.log("\n4. F2 — the guard is on unverifiability, not on the candidate count");
{
  // 4a. THE LEGITIMATE TERMINAL STATE. Every quote succeeds and every company is
  // off-exchange, so the day is genuinely empty and we know it. Under the old
  // candidate-count form this could never settle and was re-quoted on every
  // render forever; that cost is what this refinement removes.
  const store = new Map();
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES, store });
  const offExchange = async (url) => {
    h.calls.push(url);
    if (url.includes("/stable/quote")) {
      const sym = new URL(url).searchParams.get("symbol");
      return jsonResponse([{ symbol: sym, price: 1, marketCap: 1, exchange: "LSE" }], 200);
    }
    if (url.includes("/stable/stock-list")) return jsonResponse(Object.entries(NAMES).map(([symbol, companyName]) => ({ symbol, companyName })), 200);
    return jsonResponse(MONTH_ROWS, 200);
  };
  h.fmpFetch = offExchange;
  const m = await loadModule();

  const r = await m.getFullDayEarnings(DATE, { bypassCap: true });
  check("4a: zero US-listed rows against three candidates", r.items.length === 0 && r.totalCandidates === 3);
  check("4a: nothing failed, so the day SETTLES", r.complete === true, `complete=${r.complete}`);
  check("4a: the empty day IS cached", wroteItems(h));
  check("4a: and IS marked complete", wroteComplete(h));

  // The second render must serve it, not re-quote it. This is the cost the
  // refinement exists to remove, so it is asserted rather than assumed.
  const quotesBefore = h.calls.filter((u) => u.includes("/stable/quote")).length;
  const r2 = await m.getFullDayEarnings(DATE, { bypassCap: true });
  const quotesAfter = h.calls.filter((u) => u.includes("/stable/quote")).length;
  check("4a: a second render spends no quote calls", quotesAfter === quotesBefore, `${quotesBefore} then ${quotesAfter}`);
  check("4a: and still reports the settled empty day", r2.items.length === 0 && r2.complete === true);
}
{
  // 4b. THE POISON. Same empty result, but reached through a failure. Must not
  // be written and must not settle.
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  h.fmpFetch = async (url) => {
    h.calls.push(url);
    if (url.includes("/stable/quote")) return jsonResponse({ "Error Message": "Invalid API KEY." }, 401);
    if (url.includes("/stable/stock-list")) return jsonResponse(Object.entries(NAMES).map(([symbol, companyName]) => ({ symbol, companyName })), 200);
    return jsonResponse(MONTH_ROWS, 200);
  };
  const m = await loadModule();
  const r = await m.getFullDayEarnings(DATE, { forceRefresh: true, bypassCap: true });
  check("4b: zero rows against three candidates", r.items.length === 0 && r.totalCandidates === 3);
  check("4b: is NOT written", !wroteItems(h));
  check("4b: and is NOT marked complete", !wroteComplete(h) && r.complete === false);
}

// ── 5. F5 — an empty month is not cached in process either ─────────────────
console.log("\n5. F5 — the in-process candidate cache refuses empty, as Redis already does");
{
  harness({ mode: "ok", monthRows: [], names: NAMES });
  const h = globalThis.__EARNINGS_HARNESS__;
  const m = await loadModule();
  await m.getMonthDaysWithEarnings(DATE_YEAR, DATE_MONTH);
  const after1 = h.calls.length;
  await m.getMonthDaysWithEarnings(DATE_YEAR, DATE_MONTH);
  check(
    "a second call re-reads rather than serving a cached empty month",
    h.calls.length > after1,
    `${after1} calls then ${h.calls.length}`
  );
}

// ── 6. F6 — an all-empty window is an outage, not a finished window ────────
//
// REWRITTEN FOR A WINDOW WITH NO POINTER. F6 used to assert "the fill frontier
// is NOT advanced", because parking it past the window end stranded everything
// behind it permanently. There is no frontier now, so that assertion has no
// subject -- and deleting it without replacement would quietly drop the only
// coverage of the outage case.
//
// What survives the pointer is the thing that always mattered: an outage must
// not be recorded as a finished window. So the assertion moves onto the RECORD.
// Nothing is marked complete, nothing is written, and nothing is reported as
// populated -- and the paired control proves the machinery reaches all three
// when there IS work, so "never writes anything" cannot pass this.
console.log("\n6. F6 — an all-empty window is an outage, not a finished window");
{
  const h = harness({ mode: "ok", monthRows: [], names: NAMES });
  const m = await loadModule();
  const { populated } = await m.populateNextMissingDate({ bypassCap: true, maxDates: 1 });
  check("nothing is reported as populated", populated.length === 0, JSON.stringify(populated));
  check("no date is marked complete", !wroteComplete(h));
  check("and no items blob is written", !wroteItems(h));
}
{
  // The other half. Without this, F6 could be satisfied by a scan that never
  // does anything at all.
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  const m = await loadModule();
  const { populated } = await m.populateNextMissingDate({ bypassCap: true, maxDates: 1 });
  check("but a window WITH candidates is populated normally", populated.includes(DATE), JSON.stringify(populated));
  check("and that date IS marked complete", wroteComplete(h));
}

// ── 6b. THE PRODUCTION CASE — partial visibility ──────────────────────────
//
// The production stranding was NOT the all-empty window F6 was written for. FMP
// was healthy, 59 in-window dates had candidates, and the pointer still sat at
// 2027-01-01. The shape that produces it is PARTIAL visibility: one month reads
// fine and is already filled, other in-window months are cold -- absent from
// Redis and unfetchable -- so every date in them looks like a day nobody
// reports, and `sawAnyCandidates` is satisfied by the readable month alone.
//
// Under the inverted window the cold months are OLDER ones, and the damage is
// no longer permanent, because there is no pointer to park. So the assertion is
// now the thing that makes it recoverable: an unreadable month leaves NO
// record, and the dates in it are filled in full once the feed comes back. That
// is asserted in two phases -- cold, then recovered -- because the first phase
// alone is indistinguishable from a scan that is simply broken.
console.log("\n6b. The production case — a cold month leaves no record and recovers whole");
{
  const readableMonth = DATE.slice(0, 7);
  // A reporting date in a month far enough back to be a DIFFERENT month from
  // DATE's, and still inside a 90-day window.
  const coldDate = daysAgo(70);
  const coldMonth = coldDate.slice(0, 7);
  const readableRows = [{ symbol: "AAA", date: DATE, epsEstimated: 1, epsActual: null, revenueEstimated: 1e9, revenueActual: null }];
  const coldRows = [{ symbol: "BBB", date: coldDate, epsEstimated: 2, epsActual: null, revenueEstimated: 2e9, revenueActual: null }];

  const makeStore = () => new Map([
    // The readable month's date is already complete, so the walk passes over it
    // rather than returning it and stopping there.
    [`${DAY_COMPLETE_PREFIX}:${DATE}`, 1],
    [`${DAY_ITEMS_PREFIX}:${DATE}`, [{ symbol: "AAA", company: "Alpha Inc", date: DATE, epsEstimated: 1, epsActual: null, revenueEstimated: 1e9, revenueActual: null, price: 1, marketCap: 1 }]],
  ]);

  // MATCHED ON `to`, NOT `from`. fetchCalendarRange requests a SAFETY DAY before
  // the range, so `from` for a month lands in the PREVIOUS month -- matching on
  // it starves the month this scenario needs readable, which turns it into the
  // all-empty case §6 already covers and it passes for the wrong reason.
  const feed = (warmMonths) => async (url) => {
    if (url.includes("/stable/stock-list")) {
      return jsonResponse(Object.entries(NAMES).map(([symbol, companyName]) => ({ symbol, companyName })), 200);
    }
    if (url.includes("/stable/earnings-calendar")) {
      const to = (new URL(url).searchParams.get("to") ?? "").slice(0, 7);
      if (to === readableMonth) return jsonResponse(readableRows, 200);
      if (warmMonths.includes(to)) return jsonResponse(coldRows, 200);
      return jsonResponse({ "Error Message": "Invalid API KEY." }, 401);
    }
    if (url.includes("/stable/quote")) {
      const sym = new URL(url).searchParams.get("symbol");
      return jsonResponse([{ symbol: sym, price: 10, marketCap: 1e9, exchange: "NASDAQ" }], 200);
    }
    return jsonResponse([], 200);
  };

  // Phase 1: the older month is cold.
  const coldStore = makeStore();
  const h1 = harness({ mode: "ok", monthRows: readableRows, names: NAMES, store: coldStore });
  h1.fmpFetch = async (url) => { h1.calls.push(url); return feed([])(url); };
  const m1 = await loadModule();
  const r1 = await m1.populateNextMissingDate({ bypassCap: true, maxDates: 1 });

  check(
    "the readable month answered, so the all-empty guard is inapplicable",
    h1.calls.some((u) => u.includes("earnings-calendar")),
    "this is what makes 6b a different scenario from 6"
  );
  check("the cold month's date is NOT populated", !r1.populated.includes(coldDate), JSON.stringify(r1.populated));
  check(
    "and nothing records it as done, so it is not lost",
    coldStore.get(`${DAY_COMPLETE_PREFIX}:${coldDate}`) == null,
    `complete=${JSON.stringify(coldStore.get(`${DAY_COMPLETE_PREFIX}:${coldDate}`))}`
  );

  // Phase 2: the feed recovers. The SAME store carries forward, so this is the
  // real question -- did phase 1 leave anything behind that skips this date?
  const h2 = harness({ mode: "ok", monthRows: readableRows, names: NAMES, store: coldStore });
  h2.fmpFetch = async (url) => { h2.calls.push(url); return feed([coldMonth])(url); };
  const m2 = await loadModule();
  const r2 = await m2.populateNextMissingDate({ bypassCap: true, maxDates: 1 });
  check("once the feed recovers the cold date IS filled", r2.populated.includes(coldDate), JSON.stringify(r2.populated));
  check("and only then is it marked complete", coldStore.get(`${DAY_COMPLETE_PREFIX}:${coldDate}`) != null);
}

// ── 6c. THE WALK RUNS NEWEST FIRST ────────────────────────────────────────
//
// Inverting the window inverts the priority with it, and this is the half that
// a flip of two constants leaves behind. A front-to-back walk over a backward
// window is not broken -- every date still fills eventually -- it just spends
// the hourly quote budget on a date three months old while TODAY sits empty,
// which is invisible in every assertion about correctness.
console.log("\n6c. The walk spends the budget on the newest outstanding date");
{
  const recent = daysAgo(1);
  const old = daysAgo(80);
  const rows = [
    { symbol: "AAA", date: old, epsEstimated: 1, epsActual: null, revenueEstimated: 1e9, revenueActual: null },
    { symbol: "BBB", date: recent, epsEstimated: 2, epsActual: null, revenueEstimated: 2e9, revenueActual: null },
  ];
  harness({ mode: "ok", monthRows: rows, names: NAMES });
  const m = await loadModule();
  const { populated } = await m.populateNextMissingDate({ bypassCap: true, maxDates: 1 });
  check(
    "the newer of two outstanding dates is filled first",
    populated[0] === recent,
    `filled ${JSON.stringify(populated)}; newer=${recent} older=${old}`
  );
}

// ── 6d. AN UNREADABLE COMPLETENESS MAP IS NOT AN EMPTY ONE ────────────────
//
// The pointer's replacement is one MGET over the window's completeness keys,
// which introduces the same trap one level up: a failed read that is treated as
// "nothing is complete" sends the scan to re-quote all 91 dates on a Redis blip.
// Same defect class as the one this whole file exists for, in the code written
// to remove it.
console.log("\n6d. A failed completeness read does not mean an empty window");
{
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  h.mgetThrows = true;
  const m = await loadModule();
  const { populated } = await m.populateNextMissingDate({ bypassCap: true, maxDates: 1 });
  check("nothing is populated when completeness cannot be read", populated.length === 0, JSON.stringify(populated));
  check("and no quote call is spent", !h.calls.some((u) => u.includes("/stable/quote")), h.calls.filter((u) => u.includes("/stable/quote")).length + " quote calls");
  check("the read was actually attempted", h.cmd.some(([c]) => c === "mget"));
}

// ── 7. F7 — the TTL is established before the counter moves ────────────────
console.log("\n7. F7 — the hourly counter cannot be created without an expiry");
{
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  const m = await loadModule();
  await m.getFullDayEarnings(DATE, { forceRefresh: true });
  const idxSet = h.cmd.findIndex(([c, k, o]) => c === "set" && String(k).startsWith("msh:earnings-quote-calls:v1") && o?.ex && o?.nx);
  const idxIncr = h.cmd.findIndex(([c, k]) => c === "incr" && String(k).startsWith("msh:earnings-quote-calls:v1"));
  check("a SET NX with an EX precedes the INCR", idxSet !== -1 && idxIncr !== -1 && idxSet < idxIncr, `set@${idxSet} incr@${idxIncr}`);
  check("and the old unguarded EXPIRE-after-INCR is gone", !h.cmd.some(([c, k]) => c === "expire" && String(k).startsWith("msh:earnings-quote-calls:v1")));
}

// ── 8. F4 — structural, because it lives in a client component ─────────────
console.log("\n8. F4 — the manual override does not read the flag the bug corrupts");
{
  const btn = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/BackfillButton.tsx"), "utf8");
  const page = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/page.tsx"), "utf8");
  // THROUGH THE SHARED STRIPPER, not a hand-rolled one. #483 shipped the naive
  // line filter below and check-comment-stripper has been failing on it since --
  // that PR ran tsc, eslint and this suite, but not check-all, which is exactly
  // the gap that let it through.
  //
  // It matters here specifically: both assertions in this block are NEGATIVE
  // ("takes no prop", "no longer renders"), and a strip that eats too much makes
  // a negative assertion pass by deleting the text it searches. The naive filter
  // also missed /* */ blocks entirely, so a commented-out prop would have
  // satisfied the first check while still being commented out.
  const code = stripComments(btn, { file: "app/earnings-calendar/BackfillButton.tsx" });
  assertStripKeptTheCode(btn, code, "app/earnings-calendar/BackfillButton.tsx");
  check("BackfillButton takes no `complete` prop", !/\bcomplete\s*[,:]/.test(code.split("export default")[1] ?? ""), "the override must not be gated on completeness");
  // MATCHED ON THE BUTTON LABEL, NOT THE PHRASE. "fully populated" also appears
  // in the post-success message, which is legitimate and should stay -- the first
  // cut of this assertion failed on that and would have been "fixed" by deleting
  // a correct line.
  check(
    "and no longer renders a 'fully populated' disabled state",
    !code.includes("Backfill (this date is fully populated)")
  );
  check("page.tsx does not pass complete= to BackfillButton", !/<BackfillButton[^>]*complete=/s.test(page));
  check("but still gates on there being candidates", /<BackfillButton[^>]*hasEarnings=/s.test(page));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
