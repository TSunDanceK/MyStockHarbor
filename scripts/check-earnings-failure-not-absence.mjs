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
import { readPricePoolBulk } from "./pricePool";`;

const STUBS = `
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

const DATE = "2026-11-17";
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
const FILL_FRONTIER_KEY = constFromSource("FILL_FRONTIER_KEY");
console.log(`\n0. Keys under test (read from the module)\n  items    ${DAY_ITEMS_PREFIX}\n  complete ${DAY_COMPLETE_PREFIX}\n  frontier ${FILL_FRONTIER_KEY}`);

const wroteItems = (h) => h.cmd.some(([c, k]) => c === "set" && String(k).startsWith(`${DAY_ITEMS_PREFIX}:`));
const wroteComplete = (h) => h.cmd.some(([c, k]) => c === "set" && String(k).startsWith(`${DAY_COMPLETE_PREFIX}:`));
const wroteFrontier = (h) => h.cmd.some(([c, k]) => c === "set" && k === FILL_FRONTIER_KEY);

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
  await m.getMonthDaysWithEarnings(2026, 11);
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
  await m.getMonthDaysWithEarnings(2026, 11);
  const after1 = h.calls.length;
  await m.getMonthDaysWithEarnings(2026, 11);
  check(
    "a second call re-reads rather than serving a cached empty month",
    h.calls.length > after1,
    `${after1} calls then ${h.calls.length}`
  );
}

// ── 6. F6 — a window with no candidates anywhere must not park the frontier ─
console.log("\n6. F6 — an all-empty window is an outage, not a finished window");
{
  const h = harness({ mode: "ok", monthRows: [], names: NAMES });
  const m = await loadModule();
  await m.populateNextMissingDate({ bypassCap: true, maxDates: 1 });
  check("the fill frontier is NOT advanced", !wroteFrontier(h), h.cmd.filter(([, k]) => k === FILL_FRONTIER_KEY).map(([c]) => c).join(","));
}
{
  // The other half: a window that genuinely has work still parks/advances
  // normally. Without this, F6 could be "never write the frontier" and pass.
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  const m = await loadModule();
  await m.populateNextMissingDate({ bypassCap: true, maxDates: 1 });
  check("but a window WITH candidates still advances it", wroteFrontier(h));
}

// ── 6b. F6 AGAINST THE CASE THAT ACTUALLY HAPPENED ────────────────────────
//
// The production stranding is NOT the all-empty window F6 was written for. FMP
// was healthy, 59 in-window dates had candidates, and the frontier still sat at
// 2027-01-01. The shape that produces that is PARTIAL visibility: the near month
// reads fine and is already filled, the later in-window months are cold -- absent
// from Redis and unfetchable -- so every date in them looks like a day nobody
// reports, the walk runs to the end, and the pointer parks past everything.
//
// `sawAnyCandidates` is satisfied by the near month alone, so the guard does not
// fire. A month that could not be READ is UNKNOWN, not empty, and the scan must
// not advance past unknown.
console.log("\n6b. F6 against the production case — near month readable, later months cold");
{
  const pad2 = (n) => String(n).padStart(2, "0");
  const toDateStr = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const n = new Date();
  const t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  const windowStart = toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - 3)));
  const windowEnd = toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 4, 0)));
  const nearMonth = windowStart.slice(0, 7);
  // A reporting date in the near month, inside the window, already filled.
  const nearDate = toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - 2)));

  const nearRows = [{ symbol: "AAA", date: nearDate, epsEstimated: 1, epsActual: null, revenueEstimated: 1e9, revenueActual: null }];
  const store = new Map([
    // Already complete, so the walk passes over it rather than returning it.
    [`${DAY_COMPLETE_PREFIX}:${nearDate}`, 1],
    [`${DAY_ITEMS_PREFIX}:${nearDate}`, [{ symbol: "AAA", company: "Alpha Inc", date: nearDate, epsEstimated: 1, epsActual: null, revenueEstimated: 1e9, revenueActual: null, price: 1, marketCap: 1 }]],
    // The frontier starts honestly at the window's front edge.
    [FILL_FRONTIER_KEY, windowStart],
  ]);

  const h = harness({ mode: "ok", monthRows: nearRows, names: NAMES, store });
  h.fmpFetch = async (url) => {
    h.calls.push(url);
    if (url.includes("/stable/stock-list")) {
      return jsonResponse(Object.entries(NAMES).map(([symbol, companyName]) => ({ symbol, companyName })), 200);
    }
    if (url.includes("/stable/earnings-calendar")) {
      // MATCHED ON `to`, NOT `from`. fetchCalendarRange requests a SAFETY DAY
      // before the range, so `from` for the near month lands in the PREVIOUS
      // month -- matching on it starved the near month too and the scenario
      // passed because nothing was readable anywhere, which is the all-empty
      // case this scenario exists to be different from.
      const to = new URL(url).searchParams.get("to") ?? "";
      // The near month answers. Every later month is cold and unreadable.
      if (to.slice(0, 7) === nearMonth) return jsonResponse(nearRows, 200);
      return jsonResponse({ "Error Message": "Invalid API KEY." }, 401);
    }
    if (url.includes("/stable/quote")) {
      const sym = new URL(url).searchParams.get("symbol");
      return jsonResponse([{ symbol: sym, price: 10, marketCap: 1e9, exchange: "NASDAQ" }], 200);
    }
    return jsonResponse([], 200);
  };

  const m = await loadModule();
  await m.populateNextMissingDate({ bypassCap: true, maxDates: 1 });

  const parked = h.cmd.filter(([c, k]) => c === "set" && k === FILL_FRONTIER_KEY);
  const finalFrontier = store.get(FILL_FRONTIER_KEY);
  check(
    "the near month was readable, so `sawAnyCandidates` is satisfied",
    h.calls.some((u) => u.includes("earnings-calendar")),
    "this is what makes the all-empty guard inapplicable"
  );
  check(
    "the frontier is NOT advanced past the cold months",
    !(typeof finalFrontier === "string" && finalFrontier > windowEnd),
    `frontier=${JSON.stringify(finalFrontier)} windowEnd=${windowEnd} writes=${parked.length}`
  );
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
  const code = btn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
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
