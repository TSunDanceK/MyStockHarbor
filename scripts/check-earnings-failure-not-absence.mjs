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

const wroteItems = (h) => h.cmd.some(([c, k]) => c === "set" && String(k).startsWith("msh:earnings-day-items:v1:"));
const wroteComplete = (h) => h.cmd.some(([c, k]) => c === "set" && String(k).startsWith("msh:earnings-day-complete:v2:"));
const wroteFrontier = (h) => h.cmd.some(([c, k]) => c === "set" && k === "msh:earnings-fill-frontier:v2");

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
  const store = new Map([[`msh:earnings-day-items:v1:${DATE}`, []]]);
  harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES, store });
  const m = await loadModule();
  const r = await m.getFullDayEarnings(DATE, { bypassCap: true });
  check("the poisoned [] is not served", r.items.length === 3, `got ${r.items.length} rows`);
  check("and the rebuilt rows replace it", Array.isArray(store.get(`msh:earnings-day-items:v1:${DATE}`)) && store.get(`msh:earnings-day-items:v1:${DATE}`).length === 3);
}

// ── 4. F2 — the write guard, independent of F1 ─────────────────────────────
console.log("\n4. F2 — an empty result that contradicts its own candidates is never written");
{
  // Quotes SUCCEED but every company is off-exchange, so items is empty for a
  // reason that is not failure. The guard is on the contradiction itself, so this
  // must still refuse to cache -- that is the property, and it is what makes the
  // guard hold even if a future failure mode slips past `failed`.
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  h.fmpFetch = async (url) => {
    h.calls.push(url);
    if (url.includes("/stable/quote")) {
      return jsonResponse([{ symbol: "X", price: 1, marketCap: 1, exchange: "LSE" }], 200);
    }
    if (url.includes("/stable/stock-list")) return jsonResponse(Object.entries(NAMES).map(([symbol, companyName]) => ({ symbol, companyName })), 200);
    return jsonResponse(MONTH_ROWS, 200);
  };
  const m = await loadModule();
  const r = await m.getFullDayEarnings(DATE, { forceRefresh: true, bypassCap: true });
  check("zero rows against three candidates", r.items.length === 0 && r.totalCandidates === 3);
  check("is not written", !wroteItems(h));
  check("and is not marked complete", !wroteComplete(h) && r.complete === false);
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
  check("the fill frontier is NOT advanced", !wroteFrontier(h), h.cmd.filter(([, k]) => k === "msh:earnings-fill-frontier:v2").map(([c]) => c).join(","));
}
{
  // The other half: a window that genuinely has work still parks/advances
  // normally. Without this, F6 could be "never write the frontier" and pass.
  const h = harness({ mode: "ok", monthRows: MONTH_ROWS, names: NAMES });
  const m = await loadModule();
  await m.populateNextMissingDate({ bypassCap: true, maxDates: 1 });
  check("but a window WITH candidates still advances it", wroteFrontier(h));
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
