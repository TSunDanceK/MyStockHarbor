// STEP 2: PICKERS' HISTORY ON TIINGO, VIA THE EOD JOB'S onBars (#553 COWORK #57 §4, #71).
//
// What must hold, and how each is shown:
//   1. The history tiers (pickerHistory.ts), EXECUTED: in-memory bars first,
//      then the Data Cache, then FMP only for the residual; one source per
//      symbol; results under the universe's own spelling; a failing tier is a
//      miss, never a throw.
//   2. The builder (source): Tiingo is read only when PRICE_PROVIDER_PICKERS
//      says so; FMP is never the fallback without FMP_API_KEY; a dry run makes
//      none of the build's writes.
//   3. The EOD route (source): it hands runTiingoEod the onBars hook, which
//      builds only with the provider on tiingo and time left in the function.
//      (That jobs.ts calls onBars on a COMPLETE night only is executed in
//      check-tiingo-step1.)
//   4. Mutants: each rule above broken once, and caught.
//
//   node scripts/check-pickers-onbars.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const HISTORY = "lib/server/marketData/pickerHistory.ts";
const BUILDER = "lib/server/pickersBuilder.ts";
const ROUTE = "app/api/jobs/tiingo-eod/route.ts";
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let seq = 0;
async function loadCopy(src) {
  const file = path.join(ROOT, "lib/server/marketData", `.check-onbars-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// ── 1. the tiers, executed ──────────────────────────────────────────────────
const bar = (d, c) => [d, c, c, c, c, 100];
async function historySuite(H) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  const pts = H.eodBarsToPoints([bar("2026-09-28", 10), ["bad"], ["2026-09-29", 1, 1, 1, NaN, 1], bar("2026-09-29", 11)]);
  want("eodBarsToPoints maps [date,o,h,l,c,v] and drops junk rows", pts.length === 2 && pts[1].date === "2026-09-29" && pts[1].close === 11 && pts[1].volume === 100, JSON.stringify(pts));

  const universe = ["AAPL", "BRK.B", "MSFT", "NEW", "GONE"];
  const inMemory = new Map([["AAPL", [bar("2026-09-29", 1)]], ["BRK-B", [bar("2026-09-29", 2)]]]);
  const reads = [];
  const readOne = async (s) => { reads.push(s); return s === "MSFT" || s === "AAPL" ? { asOf: "x", fetchedAt: 0, basis: "split", bars: [bar("2026-09-29", s === "AAPL" ? 99 : 3)] } : null; };
  const fmpAsked = [];
  const fmpBulk = async (syms) => { fmpAsked.push(...syms); return new Map([["NEW", [{ date: "2026-09-29", close: 4 }]]]); };
  const r = await H.tiingoPickerHistory(universe, inMemory, { readOne, fmpBulk });
  want("tiers: 2 from memory, 1 from the cache, 1 from FMP, 1 missing", JSON.stringify(r.stats) === JSON.stringify({ memory: 2, cache: 1, fmpFallback: 1, missing: 1 }), JSON.stringify(r.stats));
  want("memory wins over the cache (AAPL is tonight's bar, not the cached one)", r.bySymbol.get("AAPL")?.[0]?.close === 1);
  want("the cache is not read for a symbol memory served", !reads.includes("AAPL") && !reads.includes("BRK-B"), reads.join());
  want("BRK.B is found under Tiingo's BRK-B and returned as BRK.B", r.bySymbol.get("BRK.B")?.[0]?.close === 2 && !r.bySymbol.has("BRK-B"));
  want("FMP is asked only for the residual", fmpAsked.sort().join() === "GONE,NEW", fmpAsked.join());

  const noKey = await H.tiingoPickerHistory(universe, inMemory, { readOne, fmpBulk: null });
  want("with no FMP fallback the residual is missing, not fetched", noKey.stats.fmpFallback === 0 && noKey.stats.missing === 2, JSON.stringify(noKey.stats));

  const broken = await H.tiingoPickerHistory(["MSFT", "NEW"], null, {
    readOne: async () => { throw new Error("redis down"); },
    fmpBulk: async () => { throw new Error("fmp down"); },
  });
  want("a failing tier is a miss, never a throw", broken.stats.missing === 2 && broken.bySymbol.size === 0, JSON.stringify(broken.stats));
  return fails;
}

const historySrc = read(HISTORY);
const H = await loadCopy(historySrc);
const real = await historySuite(H);
for (const f of real) check(f, false);
check("the history tiers pass on the real module", real.length === 0);

// ── 2. the builder's rules, on its code (comments stripped) ─────────────────
function builderRules(src) {
  const code = stripComments(src, { file: BUILDER });
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const start = code.indexOf("async function buildPickersPayload(");
  const body = start >= 0 ? code.slice(start, code.indexOf("\n}\n", start)) : "";
  want("buildPickersPayload found", body.length > 0);
  want("the provider comes from PRICE_PROVIDER_PICKERS", /priceProviderFor\("PICKERS"\)/.test(body));
  want("the Tiingo path goes through tiingoPickerHistory with the EOD job's bars", /historyProvider === "tiingo"\)\s*\{[\s\S]*?tiingoPickerHistory\(universe, opts\.eodBars/.test(body));
  want("FMP is the fallback only with FMP_API_KEY set, else null", /fmpBulk: process\.env\.FMP_API_KEY\s*\?[\s\S]*?:\s*null/.test(body));
  for (const call of ["addToDynamicUniverse(", "queueEarningsWarmupSymbols(", "registerSymbols("]) {
    let i = -1, n = 0, guarded = 0;
    while ((i = body.indexOf(call, i + 1)) >= 0) {
      n++;
      const before = body.slice(0, i).replace(/\s+/g, " ").slice(-200);
      if (/!dryRun/.test(before)) guarded++;
    }
    want(`a dry run skips every ${call.slice(0, -1)} (${guarded}/${n} guarded)`, n > 0 && guarded === n);
  }
  want("the history override is honoured only in a dry run", /opts\.historyOverride && dryRun/.test(body));
  want("getPickersData passes the EOD bars to the build", /buildPickersPayload\(origin, \{ forceHistoryRefresh, eodBars: opts\.eodBars \}\)/.test(code));
  return fails;
}
const builderSrc = read(BUILDER);
const b = builderRules(builderSrc);
for (const f of b) check(f, false);
check("the builder's rules hold", b.length === 0);

// The nightly window must hold what the build slices: `const days = N` bars.
{
  const jobs = stripComments(read("lib/server/marketData/jobs.ts"), { file: "lib/server/marketData/jobs.ts" });
  // The window moved to eodWindow.ts (shared with the stock-page cold fill, #553 COWORK #121).
  const bars = Number(/export const EOD_WINDOW_BARS = (\d+);/.exec(read("lib/server/marketData/eodWindow.ts"))?.[1]);
  const days = Number(/const days = (\d+);/.exec(stripComments(builderSrc, { file: BUILDER }))?.[1]);
  check("the nightly window (bars) holds every bar the build slices", bars >= days && days > 0, `${bars} >= ${days}`);
}

// ── 3. the EOD route ────────────────────────────────────────────────────────
function routeRules(src) {
  const code = stripComments(src, { file: ROUTE });
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  // #563 COWORK #96: optionally wrapped by Market Mood's withMood, which runs first and then calls it.
  want("the route hands runTiingoEod the Pickers onBars hook", /runTiingoEod\(Date\.now\(\), (?:withMood\()?pickersOnBars\(req, startedAt, onBars\)(?:, mood\))?\)/.test(code));
  want("the hook builds only with PRICE_PROVIDER_PICKERS=tiingo", /priceProviderFor\("PICKERS"\) !== "tiingo"\)\s*\{[\s\S]*?return;/.test(code));
  want("...and only with time left in the function", /left < PICKERS_BUILD_MIN_LEFT_MS\)\s*\{[\s\S]*?return;/.test(code));
  want("...as one forced build over the in-memory bars", /getPickersData\([\s\S]{0,80}?\{ forceRefresh: true, eodBars: bars \}\)/.test(code));
  want("a failed build never fails the night (caught inside the hook)", /catch \(error\)\s*\{\s*out\.pickersBuild = `threw:/.test(code));
  return fails;
}
const routeSrc = read(ROUTE);
const rr = routeRules(routeSrc);
for (const f of rr) check(f, false);
check("the EOD route's rules hold", rr.length === 0);

// ── 4. mutants ──────────────────────────────────────────────────────────────
const HISTORY_MUTANTS = [
  ["the in-memory bars are ignored", "const mem = inMemory?.get(dashed) ?? inMemory?.get(symbol);", "const mem = undefined as readonly EodBar[] | undefined;"],
  ["results are keyed by Tiingo's spelling", "bySymbol.set(symbol, pts);\n            stats.memory++;", "bySymbol.set(dashed, pts);\n            stats.memory++;"],
  ["the residual never reaches FMP", "if (residual.length && deps.fmpBulk) {", "if (false && deps.fmpBulk) {"],
];
for (const [label, from, to] of HISTORY_MUTANTS) {
  if (!historySrc.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  let fails;
  try { fails = await historySuite(await loadCopy(historySrc.replace(from, to))); } catch (err) { fails = [String(err)]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const SOURCE_MUTANTS = [
  ["FMP is the fallback even without a key", BUILDER, builderRules, /fmpBulk: process\.env\.FMP_API_KEY\s*\?/, "fmpBulk: true ?"],
  ["a dry run still queues earnings", BUILDER, builderRules, "if (!dryRun) await queueEarningsWarmupSymbols(", "await queueEarningsWarmupSymbols("],
  ["the hook ignores the provider switch", ROUTE, routeRules, 'priceProviderFor("PICKERS") !== "tiingo"', 'priceProviderFor("PICKERS") === "never"'],
  ["the hook ignores the time left", ROUTE, routeRules, "left < PICKERS_BUILD_MIN_LEFT_MS", "left < 0"],
];
for (const [label, file, rules, from, to] of SOURCE_MUTANTS) {
  const src = file === BUILDER ? builderSrc : routeSrc;
  const m = src.replace(from, to);
  if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules(m);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
