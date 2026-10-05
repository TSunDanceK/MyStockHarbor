// A time budget per page source (#553 CODE-B #137, COWORK #145/#146):
// lib/server/sourceBudget.ts, its use on /dashboard, and the bounded deferred
// news-store writes.
//
// Runtime: a source that never settles resolves to its fallback once the budget
// passes, and logs one line naming the page, the source and the symbol; a fast
// source keeps its value and logs nothing; a rejection resolves to the fallback.
// Five sources raced together with one hung still give the other four values.
// Wiring: each of /dashboard's five reads goes through the budget, the history
// seed reads the cache only when FMP_API_KEY is unset, and every after() in the
// news store is bounded. Each rule gets a planted mutant.
//
//   node scripts/check-source-budget.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const LIB = "lib/server/sourceBudget.ts";
const PAGE = "app/dashboard/page.tsx";
const STORE = "lib/server/newsStore.ts";
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
const tmp = [];
async function loadLib(src) {
  const f = path.join(ROOT, "lib", "server", `.check-budget-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

// A fake clock: timers fire only when the check says so.
function fakeTimers() {
  const pending = new Map();
  let id = 0;
  return {
    setTimer: (fn, ms) => { const h = ++id; pending.set(h, { fn, ms }); return h; },
    clearTimer: (h) => { pending.delete(h); },
    fireAll: () => { const all = [...pending.values()]; pending.clear(); for (const t of all) t.fn(); },
    count: () => pending.size,
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const never = () => new Promise(() => {});

// Settles within a real 2 s or reports "hung": a mutant that drops the timeout
// must fail the check, not hang it.
const settle = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r("__HUNG__"), 2000))]);

async function runtimeRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };

  // A source that never settles: the fallback, after the budget, with one line.
  {
    const t = fakeTimers();
    const lines = [];
    const p = L.withBudget("dashboard", "quote", "ADI", never(), "MISSING", 8000, { ...t, log: (l) => lines.push(l) });
    await flush();
    t.fireAll();
    const v = await settle(p);
    want("a source that never settles resolves to its fallback once the budget passes", v === "MISSING");
    want("...with exactly one log line", lines.length === 1);
    want("...naming the page, the source and the symbol", /dashboard/.test(lines[0] ?? "") && /source=quote/.test(lines[0] ?? "") && /symbol=ADI/.test(lines[0] ?? "") && /8000ms/.test(lines[0] ?? ""));
  }

  // A fast source keeps its value, logs nothing, and clears its timer.
  {
    const t = fakeTimers();
    const lines = [];
    const v = await settle(L.withBudget("dashboard", "news", "AAPL", Promise.resolve(42), null, 8000, { ...t, log: (l) => lines.push(l) }));
    want("a source that answers in time keeps its value", v === 42);
    want("...logs nothing", lines.length === 0);
    want("...and clears its timer", t.count() === 0);
    t.fireAll();
    await flush();
    want("a late timer after the value changes nothing", lines.length === 0);
  }

  // A rejection resolves to the fallback.
  {
    const t = fakeTimers();
    const v = await settle(L.withBudget("dashboard", "earnings", "AAPL", Promise.reject(new Error("x")), null, 8000, { ...t, log: () => {} }));
    want("a rejected source resolves to its fallback", v === null);
  }

  // Five sources, one hung: the other four still arrive.
  {
    const t = fakeTimers();
    const lines = [];
    const deps = { ...t, log: (l) => lines.push(l) };
    const all = Promise.all([
      L.withBudget("dashboard", "history", "DELL", Promise.resolve("H"), "h0", 8000, deps),
      L.withBudget("dashboard", "quote", "DELL", Promise.resolve("Q"), "q0", 8000, deps),
      L.withBudget("dashboard", "benchmarks", "DELL", never(), null, 8000, deps),
      L.withBudget("dashboard", "news", "DELL", Promise.resolve("N"), null, 8000, deps),
      L.withBudget("dashboard", "earnings", "DELL", Promise.resolve("E"), null, 8000, deps),
    ]);
    await flush();
    t.fireAll();
    const v = await settle(all);
    want("five sources with one hung still render the other four", Array.isArray(v) && v.join() === "H,Q,,N,E");
    want("...and the log names the hung one", lines.length === 1 && /source=benchmarks/.test(lines[0]));
  }

  // boundedDeferred: a hung deferred write ends at its budget.
  {
    const t = fakeTimers();
    const lines = [];
    const job = L.boundedDeferred("news-store", "news:v1:ADI", () => never(), 10000, { ...t, log: (l) => lines.push(l) });
    const p = job();
    await flush();
    t.fireAll();
    const v = await settle(p);
    want("a deferred write that never answers ends at its budget", v === undefined);
    want("...and says so", lines.length === 1 && /news-store/.test(lines[0]) && /news:v1:ADI/.test(lines[0]));
  }

  // The budgets: under the platform's 300 s, and the dashboard's above its measured 4.4 s.
  want("the dashboard budget sits between the measured 4.4 s and 20 s", L.DASHBOARD_SOURCE_BUDGET_MS > 4400 && L.DASHBOARD_SOURCE_BUDGET_MS <= 20000);
  want("the deferred-write budget is well under 300 s", L.NEWS_DEFERRED_WRITE_BUDGET_MS > 0 && L.NEWS_DEFERRED_WRITE_BUDGET_MS <= 30000);
  return fails;
}

const SOURCES = ["history", "quote", "benchmarks", "news", "earnings"];
function wiringRules(pageRaw, storeRaw) {
  const page = stripComments(pageRaw, { file: PAGE });
  const store = stripComments(storeRaw, { file: STORE });
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const all = page.match(/await Promise\.all\(\[([\s\S]*?)\n {4}\]\);/);
  const body = all ? all[1] : "";
  want("the dashboard's Promise.all was found", body.length > 0);
  for (const s of SOURCES) want(`the dashboard's ${s} read goes through the budget`, new RegExp(`budget\\(\\s*"${s}",`).test(body));
  // Every top-level entry of the array is a budget(...) call: a sixth, unbudgeted read is caught.
  const entries = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { entries.push(body.slice(start, i)); start = i + 1; }
  }
  entries.push(body.slice(start));
  const code = entries.map((e) => e.trim()).filter(Boolean);
  want("the dashboard awaits exactly five sources", code.length === 5);
  want("...each of them inside budget()", code.every((e) => /^budget\(/.test(e)));
  want("the budget is DASHBOARD_SOURCE_BUDGET_MS from lib/server/sourceBudget", /withBudget\("dashboard", source, symbol, work, fallback, DASHBOARD_SOURCE_BUDGET_MS\)/.test(page) && /from "@\/lib\/server\/sourceBudget"/.test(page));
  want("with no FMP key the history seed reads the cache only",
    /process\.env\.FMP_API_KEY\s*\?\s*getDailyHistory\(symbol, \{ caller: "dashboard" \}\)\s*:\s*getCachedDailyHistory\(symbol, "dashboard"\)/.test(page));

  // The news store: no bare after() callbacks left.
  const afters = [...store.matchAll(/\bafter\(/g)].length;
  const bounded = [...store.matchAll(/\bafter\(\s*boundedDeferred\(/g)].length;
  want("the news store's deferred writes were found", afters >= 3);
  want("every after() in the news store is bounded", afters === bounded);
  want("...by NEWS_DEFERRED_WRITE_BUDGET_MS", [...store.matchAll(/NEWS_DEFERRED_WRITE_BUDGET_MS\)/g)].length === bounded);
  return fails;
}

try {
  const libSrc = raw(LIB);
  const pageSrc = raw(PAGE);
  const storeSrc = raw(STORE);

  console.log("\n1. The budget, at runtime");
  const real = await runtimeRules(await loadLib(libSrc));
  check("the real lib/server/sourceBudget.ts passes every runtime rule", real.length === 0, real.join("; "));

  console.log("\n2. The wiring");
  const realWiring = wiringRules(pageSrc, storeSrc);
  check("the real /dashboard and news store pass every wiring rule", realWiring.length === 0, realWiring.join("; "));

  console.log("\n3. Planted mutants");
  const LIB_MUTANTS = [
    ["the timeout never resolves the fallback", /log\(`\[budget\][^`]*`\);\n(\s*)resolve\(fallback\);/, (m) => m.replace("resolve(fallback);", "")],
    ["the log line drops the source", /source=\$\{source\} /, () => ""],
    ["the log line drops the symbol", /symbol=\$\{symbol\} /, () => ""],
    ["a rejection is passed on", /\(\) => \{\n(\s*)if \(settled\) return;\n\s*settled = true;\n\s*clearTimer\(handle\);\n\s*resolve\(fallback\);/, (m) => m.replace("resolve(fallback);", "")],
    ["a fast value leaves its timer set", /clearTimer\(handle\);\n(\s*)resolve\(value\);/, (m) => m.replace("clearTimer(handle);", "")],
    ["the deferred bound removed", /await withBudget\(label, "deferred", key, run\.then\(\(\) => undefined\), undefined, ms, deps\);/, () => "await run;"],
    ["the dashboard budget raised to the platform limit", /DASHBOARD_SOURCE_BUDGET_MS = 8_000;/, () => "DASHBOARD_SOURCE_BUDGET_MS = 300_000;"],
  ];
  for (const [label, from, to] of LIB_MUTANTS) {
    const m = libSrc.replace(from, to);
    if (m === libSrc) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = await runtimeRules(await loadLib(m));
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
  }
  const WIRING_MUTANTS = [
    ["the quote read unbudgeted", PAGE, /budget\("quote", getInitialQuoteAndName\(symbol\), \{ quote: null, name: "" \}\)/, "getInitialQuoteAndName(symbol)"],
    ["the news read unbudgeted", PAGE, /budget\("news", getInitialNews\(symbol\), null\)/, "getInitialNews(symbol)"],
    ["a sixth, unbudgeted source", PAGE, /budget\("earnings", getInitialEarningsSummary\(symbol\), null\),/, 'budget("earnings", getInitialEarningsSummary(symbol), null),\n      getInitialNews(symbol),'],
    ["the budget constant swapped for a literal", PAGE, /work, fallback, DASHBOARD_SOURCE_BUDGET_MS\)/, "work, fallback, 300_000)"],
    ["the no-key short-circuit removed", PAGE, /process\.env\.FMP_API_KEY\s*\?\s*getDailyHistory\(symbol, \{ caller: "dashboard" \}\)\s*:\s*getCachedDailyHistory\(symbol, "dashboard"\)/, 'getDailyHistory(symbol, { caller: "dashboard" })'],
    ["the store write left unbounded", STORE, /after\(\n\s*boundedDeferred\("news-store", key, (async \(\) => \{[\s\S]*?\n {4}\}), NEWS_DEFERRED_WRITE_BUDGET_MS\)\n {2}\);/, "after($1);"],
    ["the staleness mark left unbounded", STORE, /after\(boundedDeferred\("news-store", upper, (\(\) => markViewed\("news", upper, nowMs\)), NEWS_DEFERRED_WRITE_BUDGET_MS\)\)/, "after($1)"],
  ];
  for (const [label, file, from, to] of WIRING_MUTANTS) {
    const src = file === PAGE ? pageSrc : storeSrc;
    const m = src.replace(from, to);
    if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = file === PAGE ? wiringRules(m, storeSrc) : wiringRules(pageSrc, m);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
