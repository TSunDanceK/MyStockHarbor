// THE PICKERS/TIINGO UNIVERSE IN THE SEC SEED (#552 COWORK #158, CODE-A #165
// option 1).
//
// sec-daily-index now unions the warm targets ∪ the Tiingo universe into its
// manifest seed, so sec-facts' populate queue reaches the 1,675 eligible stocks
// that had no set and no entry. What has to stay true:
//   1. the warm-targets keys this job reads by value still match warmTargets.ts,
//      and the read never goes through getWarmTargetSymbols (it can BUILD);
//   2. a stored warm-targets value is parsed as a list only when it is one;
//      the union keeps the warm targets first and de-duplicates;
//   3. THE GATE STILL HOLDS ON THE WIDER SEED, run on the committed ticker map
//      and the shipped gate: funds (SPY, GLD), notes and warrants (BIPI, STRK,
//      CCXIW) and a no-CIK symbol get no entry; common shares do;
//   4. the wiring: the route reads the universe once, unions it LAST, seeds
//      through secSeedRefusal, and counts its commands.
// A mutation for each.
//
//   node scripts/check-sec-seed-universe.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  if (src.split(from).length !== 2) throw new Error(`mutation anchor must match once: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const UNI_PATH = "lib/server/secSeedUniverse.ts";
const UNI = readCodeOnly(UNI_PATH);
const ROUTE = readCodeOnly("app/api/jobs/sec-daily-index/route.ts");
const WT_RAW = fs.readFileSync("lib/server/warmTargets.ts", "utf8");
const MAN = await import("../lib/server/secManifest.ts");
const TICKERS = await import("../lib/server/secTickerMap.ts");

const liftUni = (src) => lift(
  [grabFunction(src, "warmSymbolsOf"), grabFunction(src, "safeParse"), grabFunction(src, "unionSeedUniverse")].join("\n") +
    "\nexport { warmSymbolsOf, unionSeedUniverse };",
  "", "seed-universe");

/** The gate module, optionally mutated, imported for real (a sibling temp file, so its relative imports resolve). */
const GATE_RAW = fs.readFileSync("lib/server/secSeedGate.ts", "utf8");
async function loadGate(mutate = (s) => s) {
  const src = mutate(GATE_RAW);
  if (src === GATE_RAW) return import("../lib/server/secSeedGate.ts");
  const tmp = `lib/server/.check-seed-universe-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, src);
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

const tickerMap = (await TICKERS.loadTickerMap?.())?.map ?? null;
const cikOf = (s) => (tickerMap ? MAN.dotDashSpellings(s).map((k) => tickerMap.get(k)?.cik).find(Boolean) : null) ?? null;

// ── 1. The keys, and no build ──────────────────────────────────────────────
const wtKey = (name) => (WT_RAW.match(new RegExp(`export const ${name} = "([^"]+)";`)) ?? [])[1] ?? null;
const keysRule = (src) => {
  const m = src.match(/SEED_WARM_TARGETS_KEYS = \["([^"]+)", "([^"]+)"\]/);
  return Boolean(m) && m[1] === wtKey("WARM_TARGETS_KEY") && m[2] === wtKey("WARM_TARGETS_FALLBACK_KEY");
};
const noBuildRule = (src) => !/getWarmTargetSymbols|getPickersData|from "\.\/warmTargets"|from "\.\/pickersBuilder"/.test(src);

// ── 2. Parsing and the union (lifted from the shipped file) ────────────────
const PURE_RULES = {
  "a stored object's symbols are read": (U) => U.warmSymbolsOf({ symbols: ["AAPL", "MSFT"], displayed: 2 })?.join() === "AAPL,MSFT",
  "...and a JSON string's": (U) => U.warmSymbolsOf(JSON.stringify({ symbols: ["NVDA"] }))?.join() === "NVDA",
  "an empty list, a missing key, garbage, null and a list with no usable symbol are NOT a list": (U) =>
    U.warmSymbolsOf({ symbols: [] }) === null && U.warmSymbolsOf({}) === null &&
    U.warmSymbolsOf("not json") === null && U.warmSymbolsOf(null) === null &&
    U.warmSymbolsOf({ symbols: [3, ""] }) === null,
  "non-string members are dropped": (U) => U.warmSymbolsOf({ symbols: ["AAPL", 3, "", null] })?.join() === "AAPL",
  "the union keeps the warm targets first and de-duplicates": (U) =>
    U.unionSeedUniverse(["AAPL", "MSFT"], ["MSFT", "COE", "AAPL", "VS"]).join() === "AAPL,MSFT,COE,VS",
};

// ── 3. The gate on the wider seed, on the committed map ────────────────────
const WIDE = ["AAPL", "SPY", "GLD", "STRK", "BIPI", "CCXIW", "ZZZZQ", "MSFT", "COE"];
const seedWide = (G) => {
  const map = new Map(WIDE.filter((s) => cikOf(s)).map((s) => [s, { cik: cikOf(s), exchange: null }]));
  const m = MAN.emptyManifest();
  const r = MAN.seedManifest(m, WIDE, map, true, G.secSeedRefusal);
  return { keys: Object.keys(m.symbols).sort().join(), r };
};
const GATE_RULES = {
  "the committed ticker map loads, so the cases below are real": async () =>
    Boolean(tickerMap) && ["AAPL", "SPY", "STRK", "COE"].every((s) => cikOf(s) !== null) && cikOf("ZZZZQ") === null,
  "of the wider seed only the common shares (AAPL, COE, MSFT) get an entry": async (G) => seedWide(G).keys === "AAPL,COE,MSFT",
  "funds are refused (SPY, GLD)": async (G) => seedWide(G).r.refused.etf?.slice().sort().join() === "GLD,SPY",
  "notes and warrants are refused (BIPI, STRK, CCXIW)": async (G) =>
    seedWide(G).r.refused["non-equity"]?.slice().sort().join() === "BIPI,CCXIW,STRK",
  "a no-CIK symbol is refused (ZZZZQ)": async (G) => seedWide(G).r.refused["no-cik"]?.join() === "ZZZZQ",
};

// ── 4. The wiring ──────────────────────────────────────────────────────────
const UNION_RE = /\.\.\.\(await readDynamicUniverse\(\)\)\.map\(\(e\) => e\.symbol\), \.\.\.seedUniverse\.symbols\]\)/;
const wiringRules = {
  "the route reads the seed universe once, before the union": (r) => {
    const read = r.indexOf("const seedUniverse = await readSecSeedUniverse();");
    return read !== -1 && r.split("readSecSeedUniverse()").length === 2 && read < r.search(UNION_RE);
  },
  "...unions it LAST, after the dynamic pool": (r) => UNION_RE.test(r),
  "...seeds the whole union through the gate": (r) =>
    /seedManifest\(manifest, universe, tickers\.map, tickers\.source !== "none", secSeedRefusal\)/.test(r),
  "...and counts its Redis commands": (r) => /\+ marker\.commands \+ seedUniverse\.commands,/.test(r),
};

console.log("1. the warm-targets keys, read-only");
check("the keys match warmTargets.ts's WARM_TARGETS_KEY and WARM_TARGETS_FALLBACK_KEY", keysRule(UNI));
check("the read never goes through getWarmTargetSymbols / the pickers builder", noBuildRule(UNI));

console.log("\n2. parsing and the union");
const U0 = await liftUni(UNI);
for (const [name, rule] of Object.entries(PURE_RULES)) check(name, Boolean(rule(U0)));

console.log("\n3. the gate on the wider seed");
const G0 = await loadGate();
for (const [name, rule] of Object.entries(GATE_RULES)) {
  let ok = false; try { ok = Boolean(await rule(G0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}

console.log("\n4. the wiring");
for (const [name, rule] of Object.entries(wiringRules)) check(name, Boolean(rule(ROUTE)));

console.log("\nmutants: each must break a rule");
check("MUTATION: a key renamed → caught", !keysRule(UNI.replace('"msh:warm-targets:v1:last-good"', '"msh:warm-targets:v2:last-good"')));
check("MUTATION: the warm read goes through getWarmTargetSymbols → caught",
  !noBuildRule(UNI + '\nimport { getWarmTargetSymbols } from "./warmTargets";'));
{
  let caught = false;
  try {
    const U = await liftUni(once("return clean.length ? clean : null;", "return clean;")(UNI));
    caught = !Object.values(PURE_RULES).every((r) => r(U));
  } catch (e) { console.log(`    ${e.message}`); }
  check("MUTATION: a list with no usable symbol read as a list → caught", caught);
}
{
  let caught = false;
  try {
    const U = await liftUni(once("return [...new Set([...warm, ...tiingo])];", "return [...new Set([...tiingo, ...warm])];")(UNI));
    caught = !Object.values(PURE_RULES).every((r) => r(U));
  } catch (e) { console.log(`    ${e.message}`); }
  check("MUTATION: the Tiingo universe put first → caught", caught);
}
const GATE_MUTANTS = [
  ["funds admitted", once('if (ETFS.has(toDashed(clean))) return "etf";', "")],
  ["notes and warrants admitted", once('if (nonEquityListingOf(clean)) return "non-equity";', "")],
  ["no-CIK symbols admitted", once('if (!cik) return "no-cik";', "")],
];
for (const [label, mutate] of GATE_MUTANTS) {
  let caught = false;
  try {
    const G = await loadGate(mutate);
    for (const rule of Object.values(GATE_RULES)) { let ok = false; try { ok = Boolean(await rule(G)); } catch { ok = false; } if (!ok) { caught = true; break; } }
  } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, caught);
}
const ROUTE_MUTANTS = [
  ["the seed universe dropped from the union", once(", ...seedUniverse.symbols]", "]")],
  ["the wider seed bypasses the gate", once('tickers.source !== "none", secSeedRefusal)', 'tickers.source !== "none")')],
  ["its commands not counted", once("+ marker.commands + seedUniverse.commands,", "+ marker.commands,")],
];
for (const [label, mutate] of ROUTE_MUTANTS) {
  let caught = false;
  try { const r = mutate(ROUTE); caught = !Object.values(wiringRules).every((rule) => rule(r)); } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, caught);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
