// B's fixes before the FMP key is pulled (#553 COWORK #131/#132).
//
//   F1  warm-screener-fundamentals: no key is a healthy skip, and the
//       stale-bar pass (no FMP in it) runs without the screener.
//   F2  sector panels: on the Tiingo gate, the eod-last-less fallback never
//       shows msh:stockdata's frozen FMP week / month / YTD.
//   F3  price pool: an FMP-only row older than FMP_POOL_ROW_MAX_AGE_MS shows no
//       figures once POOL=tiingo or the key is unset (raw reads untouched).
//   S1  warm-stock-data: the three hidden-field analyst endpoints are retired.
//   S2  stock-news-data: no FMP quote on the NEWS_HERO=tiingo path.
// Behaviour where it can run without a network (F3), source rules elsewhere;
// a planted mutant for each.
//
//   node scripts/check-fmp-keypull-b.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
async function loadSibling(rel, src) {
  const tmp = path.join(ROOT, path.dirname(rel), `.check-kp-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
/** Each mutant must make `rules` fail. */
function sourceMutants(label, src, rules, list) {
  for (const [name, from, to] of list) {
    const m = src.replace(from, to);
    if (m === src) { check(`${label}: mutant "${name}" applies`, false, "matched nothing"); continue; }
    check(`${label}: mutant "${name}" is caught`, rules(m).length > 0);
  }
}

// ── F1 ────────────────────────────────────────────────────────────────────
console.log("\n=== F1. warm-screener-fundamentals without the key ===\n");
const SCREENER = "app/api/jobs/warm-screener-fundamentals/route.ts";
const f1 = (s) => {
  const fails = [];
  if (!/const noFmpKey = !result\.ok && result\.reason === "no-fmp-key";/.test(s)) fails.push("no-key is recognised");
  if (!/recordJobRun\("warm-screener-fundamentals", result\.ok \|\| noFmpKey, \{/.test(s)) fails.push("no-key is recorded as a healthy run");
  if (!/screenerSkipped: noFmpKey \? "no FMP_API_KEY" : null,/.test(s)) fails.push("the record says why");
  const noKeyBranch = s.slice(s.indexOf('sweep.skipped = noFmpKey ? "no-fmp-key" : "screener-unavailable";'), s.indexOf("} else {", s.indexOf('sweep.skipped = noFmpKey')));
  if (!/await staleBarPass\(universe, Date\.now\(\)\);/.test(noKeyBranch)) fails.push("the stale-bar pass runs without the screener");
  if (!/if \(sweep\.evicted\.length\) await deregisterSymbols\(sweep\.evicted\);/.test(noKeyBranch)) fails.push("its evictions are deregistered there too");
  if (!/await staleBarPass\(universe, nowMs\);/.test(s)) fails.push("the stale-bar pass still runs on a screener day");
  if ((s.match(/const stamps = await readNewestBarStamps\(\);/g) ?? []).length !== 1) fails.push("one stale-bar pass, not a copy");
  if (/financialmodelingprep|fmpFetch/.test(s.slice(s.indexOf("const staleBarPass"), s.indexOf("const noFmpKey")))) fails.push("the stale-bar pass reaches FMP");
  return fails;
};
const sSrc = raw(SCREENER);
const f1f = f1(sSrc);
for (const f of f1f) check(f, false);
check("F1: no key is a healthy skip; the stale-bar pass runs with or without the screener", f1f.length === 0);
sourceMutants("F1", sSrc, f1, [
  ["no-key recorded as a failure", /result\.ok \|\| noFmpKey, \{/, "result.ok, {"],
  ["the stale-bar pass skipped without the screener", /\n\s*await staleBarPass\(universe, Date\.now\(\)\);/, ""],
]);

// ── F2 ────────────────────────────────────────────────────────────────────
console.log("\n=== F2. Sector week / month / YTD on the Tiingo gate ===\n");
const PANELS = "lib/server/sectorPanels.ts";
const f2 = (s) => {
  const fails = [];
  if (!/onTiingo \? Promise\.resolve\(new Map\(\)\) : readCachedStockDataBulk\(allSymbols\)/.test(s)) fails.push("the FMP perf is not read on the Tiingo gate");
  if (!/week: weightedAverage\(entries\(\(r\) => r\.w\)\)\.value,/.test(s) || !/ytd: weightedAverage\(entries\(\(r\) => r\.y\)\)\.value,/.test(s)) fails.push("the eod-last path reads w / m / y");
  if (s.indexOf("const onTiingo = poolOnTiingo();") > s.indexOf(": readCachedStockDataBulk(allSymbols).catch(")) fails.push("the gate is known before the read");
  return fails;
};
const pSrc = raw(PANELS);
const f2f = f2(pSrc);
for (const f of f2f) check(f, false);
check("F2: the Tiingo gate never shows msh:stockdata's frozen week / month / YTD", f2f.length === 0);
sourceMutants("F2", pSrc, f2, [
  ["the frozen FMP perf read on Tiingo", /onTiingo \? Promise\.resolve\(new Map\(\)\) : readCachedStockDataBulk\(allSymbols\)/, "readCachedStockDataBulk(allSymbols)"],
]);

// ── F3 ────────────────────────────────────────────────────────────────────
console.log("\n=== F3. Stale FMP pool rows ===\n");
const POOL = "lib/server/pricePool.ts";
const NOW = Date.UTC(2026, 9, 6, 15);
const row = (over) => ({ price: 10, changePct: 1, volume: 5, marketCap: 1e9, open: 9, dayHigh: 11, dayLow: 8, pe: 20, ts: NOW, peTs: 0, failStreak: 2, failAt: 0, ...over });
async function f3(P) {
  const fails = [];
  const want = (l, ok) => { if (!ok) fails.push(l); };
  const D = P.FMP_POOL_ROW_MAX_AGE_MS;
  want("the cut-off is one constant, 3 days", D === 3 * 24 * 60 * 60 * 1000);
  const fresh = row({ ts: NOW - D });
  want("an FMP row at the cut-off keeps its figures", P.withoutStaleFmpFigures(fresh, NOW) === fresh);
  const old = P.withoutStaleFmpFigures(row({ ts: NOW - D - 1 }), NOW);
  want("an older FMP row loses every figure (the reader shows \"—\")",
    ["price", "changePct", "volume", "marketCap", "open", "dayHigh", "dayLow", "pe"].every((k) => old[k] === null));
  want("...and keeps its bookkeeping (ts, failStreak)", old.ts === NOW - D - 1 && old.failStreak === 2);
  const tiingo = row({ ts: 0, source: "tiingo" });
  want("a Tiingo row is never cut", P.withoutStaleFmpFigures(tiingo, NOW) === tiingo);
  return fails;
}
const poolSrc = raw(POOL);
const P = await loadSibling(POOL, poolSrc);
const f3f = await f3(P);
for (const f of f3f) check(f, false);
check("F3: an FMP-only row older than 3 days shows no figures; Tiingo rows untouched", f3f.length === 0);
for (const [name, from, to] of [
  ["the cut-off widened", /export const FMP_POOL_ROW_MAX_AGE_MS = 3 \* 24 \* 60 \* 60 \* 1000;/, "export const FMP_POOL_ROW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;"],
  ["Tiingo rows cut too", /if \(row\.source === "tiingo" \|\| nowMs - row\.ts <= FMP_POOL_ROW_MAX_AGE_MS\) return row;/, "if (nowMs - row.ts <= FMP_POOL_ROW_MAX_AGE_MS) return row;"],
]) {
  const m = poolSrc.replace(from, to);
  if (m === poolSrc) { check(`F3: mutant "${name}" applies`, false, "matched nothing"); continue; }
  check(`F3: mutant "${name}" is caught`, (await f3(await loadSibling(POOL, m))).length > 0);
}
const f3wiring = (s) => {
  const fails = [];
  if (!/return priceProviderFor\("POOL"\) === "tiingo" \|\| !process\.env\.FMP_API_KEY;/.test(s)) fails.push("the cut applies on the Tiingo gate or with no key");
  if (!/return cutStaleFmpRows\(await overlayTiingoPool\(out, symbols, Date\.now\(\)\), Date\.now\(\)\);/.test(s)) fails.push("the overlaid rows are cut");
  if (!/return opts\.raw \? out : cutStaleFmpRows\(out, Date\.now\(\)\);/.test(s)) fails.push("raw reads are never cut; plain reads are");
  return fails;
};
const f3w = f3wiring(poolSrc);
for (const f of f3w) check(f, false);
check("F3: wired into readPricePoolBulk (overlaid and plain reads; raw untouched)", f3w.length === 0);
sourceMutants("F3", poolSrc, f3wiring, [
  ["raw reads cut", /return opts\.raw \? out : cutStaleFmpRows\(out, Date\.now\(\)\);/, "return cutStaleFmpRows(out, Date.now());"],
  ["the overlay path not cut", /return cutStaleFmpRows\(await overlayTiingoPool\(out, symbols, Date\.now\(\)\), Date\.now\(\)\);/, "return await overlayTiingoPool(out, symbols, Date.now());"],
]);

// ── S1 ────────────────────────────────────────────────────────────────────
console.log("\n=== S1. The hidden-field analyst endpoints are retired ===\n");
const STOCK = "lib/server/stockDataCache.ts";
const s1 = (s) => {
  const fails = [];
  for (const e of ["price-target-summary", "grades-consensus", "analyst-estimates"]) {
    if (!new RegExp(`"${e}": "retired",`).test(s)) fails.push(`${e} is retired`);
    if (!new RegExp(`if \\(endpointOn\\("${e}"\\)\\) try \\{`).test(s)) fails.push(`${e}'s fetch is gated`);
  }
  if (!/const CLOCK_CALLS = Object\.values\(ENDPOINT_TRIGGERS\)\.filter\(\(t\) => t === "clock"\)\.length;/.test(s)) fails.push("retired endpoints are not counted in a symbol's cost");
  if (!/lib\/pickerHiddenFields\.ts/.test(s)) fails.push("the reason (hidden columns) stays beside the list");
  return fails;
};
const stSrc = raw(STOCK);
const s1f = s1(stSrc);
for (const f of s1f) check(f, false);
check("S1: grades-consensus, price-target-summary and analyst-estimates are not called", s1f.length === 0);
sourceMutants("S1", stSrc, s1, [
  ["an analyst endpoint back on the clock", /"grades-consensus": "retired",/, '"grades-consensus": "clock",'],
  ["a retired fetch ungated", /if \(endpointOn\("analyst-estimates"\)\) try \{/, "try {"],
]);
// The hidden fields are still hidden (else retiring their source would blank a visible column).
const hidden = raw("lib/pickerHiddenFields.ts");
check("S1: the fields those endpoints fed are still hidden columns",
  ["rating", "analystCount", "priceTarget"].every((k) => hidden.includes(k)) && /forward|Forward/.test(hidden));

// ── S2 ────────────────────────────────────────────────────────────────────
console.log("\n=== S2. No FMP quote on the NEWS_HERO=tiingo path ===\n");
const NEWS = "lib/stock-news-data.ts";
const s2 = (s) => {
  const fails = [];
  const body = s.slice(s.indexOf("async function fetchQuote(symbol: string)"), s.indexOf("async function fetchFmpQuote("));
  if (!/if \(priceProviderFor\("NEWS_HERO"\) === "tiingo"\) return null;\s*return fetchFmpQuote\(symbol\);/.test(body)) fails.push("the FMP quote is gated on NEWS_HERO");
  if ((s.match(/fetchFmpQuote\(/g) ?? []).length !== 2) fails.push("fetchQuote is fetchFmpQuote's only caller");
  return fails;
};
const nSrc = raw(NEWS);
const s2f = s2(nSrc);
for (const f of s2f) check(f, false);
check("S2: the news base data makes no FMP quote call on the Tiingo hero path", s2f.length === 0);
sourceMutants("S2", nSrc, s2, [
  ["the gate removed", /if \(priceProviderFor\("NEWS_HERO"\) === "tiingo"\) return null;\n/, ""],
]);

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
