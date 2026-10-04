// THE SEC SEED GATE AND THE DOT/DASH READ (#552 COWORK #147 1a).
//
// Before sec-facts is widened to the whole universe (#139), and because
// manifest entries are never removed:
//   1. the seed gate's verdicts, RUN on the committed files: a preferred
//      or warrant sharing its issuer's CIK is refused (STRK, MicroStrategy's,
//      and CCXIW by the non-common census; FITB-PA by the security-kind test); an ETF or trust (SPY, GLD, IBIT) as an ETF; a note's
//      ticker as non-equity; a symbol with no CIK; an ordinary common share
//      (AAPL, MSTR) is admitted;
//   2. the seed, RUN: a refused NEW symbol gets no manifest entry and is
//      reported by reason; an entry already there is left as it is;
//   3. the wiring: sec-daily-index seeds through the gate (the populate side
//      is check-sec-rewindow's), and warm-pickers-sec builds no picker row for
//      a refused symbol even where a set is stored (#552 COWORK #148);
//   4. readFactSet / factSetExists find a set under either spelling: BRK-B
//      resolves to the BRK.B set and the other way round, a hit on the asked
//      spelling still costs ONE read.
// A mutation for each.
//
//   node scripts/check-sec-seed-gate.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const GATE = "lib/server/secSeedGate.ts";
const GATE_RAW = fs.readFileSync(GATE, "utf8");
const MAN = await import("../lib/server/secManifest.ts");
const TICKERS = await import("../lib/server/secTickerMap.ts");

/** The gate module, optionally mutated, imported for real (a sibling temp file, so its relative imports resolve). */
async function loadGate(mutate = (s) => s) {
  const src = mutate(GATE_RAW);
  if (src === GATE_RAW) return import("../lib/server/secSeedGate.ts");
  const tmp = `lib/server/.check-seed-gate-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, src);
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
const once = (from, to) => (src) => {
  if (src.split(from).length !== 2) throw new Error(`mutation anchor must match once: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const tickerMap = (await TICKERS.loadTickerMap?.())?.map ?? null;
const cikOf = (s) => (tickerMap ? MAN.dotDashSpellings(s).map((k) => tickerMap.get(k)?.cik).find(Boolean) : null) ?? null;

const CASES = [
  // STRK is refused twice over: the non-common census names it (checked
  // first), and the security-kind test would too. FITB-PA is a preferred
  // ONLY the security-kind test catches, so each arm has its own case.
  ["a preferred in the non-common census (STRK, MicroStrategy's)", "STRK", "non-equity"],
  ["a preferred only the security-kind test catches (FITB-PA)", "FITB-PA", "security-kind"],
  ["a warrant (CCXIW)", "CCXIW", "non-equity"],
  ["an ETF (SPY)", "SPY", "etf"],
  ["a grantor trust with a CIK (GLD)", "GLD", "etf"],
  ["a note's ticker (BIPI)", "BIPI", "non-equity"],
  ["a symbol with no CIK", "ZZZZQ", "no-cik"],
  ["an ordinary common share (AAPL)", "AAPL", null],
  ["the preferred's issuer itself (MSTR)", "MSTR", null],
];

const RULES = {
  "the committed ticker map loads, so the cases below are real": async () => Boolean(tickerMap) && cikOf("AAPL") !== null && cikOf("STRK") !== null,
  ...Object.fromEntries(CASES.map(([name, sym, want]) => [
    `${name} → ${want ?? "admitted"}`,
    async (G) => G.secSeedRefusal(sym, cikOf(sym)) === want,
  ])),
  "the seed refuses a NEW STRK and SPY, reports them by reason, and seeds AAPL": async (G) => {
    const map = new Map(["AAPL", "STRK", "SPY"].map((s) => [s, { cik: cikOf(s), exchange: null }]));
    const m = MAN.emptyManifest();
    const r = MAN.seedManifest(m, ["AAPL", "STRK", "SPY"], map, true, G.secSeedRefusal);
    return Object.keys(m.symbols).join() === "AAPL" && r.refused["non-equity"]?.join() === "STRK" && r.refused.etf?.join() === "SPY";
  },
  "an entry already in the manifest is left as it is (entries are never removed)": async (G) => {
    const map = new Map([["SPY", { cik: cikOf("SPY"), exchange: null }]]);
    const m = MAN.emptyManifest();
    m.symbols.SPY = MAN.emptyEntry(cikOf("SPY"), null);
    const r = MAN.seedManifest(m, ["SPY"], map, true, G.secSeedRefusal);
    return Boolean(m.symbols.SPY) && !r.refused.etf;
  },
  "with no gate passed, the seed behaves as before (everything with a lookup is seeded)": async () => {
    const map = new Map(["AAPL", "STRK"].map((s) => [s, { cik: cikOf(s), exchange: null }]));
    const m = MAN.emptyManifest();
    MAN.seedManifest(m, ["AAPL", "STRK"], map, true);
    return Object.keys(m.symbols).sort().join() === "AAPL,STRK";
  },
  "warm-pickers-sec's filter: STRK, SPY and FITB-PA get no picker row; AAPL and a no-CIK symbol are kept": async (G) => {
    const r = G.admittedForSec(["AAPL", "STRK", "SPY", "FITB-PA", "ZZZZQ"], cikOf);
    return r.admitted.join() === "AAPL,ZZZZQ" && r.refused["non-equity"]?.join() === "STRK"
      && r.refused.etf?.join() === "SPY" && r.refused["security-kind"]?.join() === "FITB-PA";
  },
  "warm-pickers-sec reads only the admitted symbols (stored sets that fail the gate become no row)": async () => {
    const w = readCodeOnly("app/api/jobs/warm-pickers-sec/route.ts");
    return /const gate = admittedForSec\(universe, cikForSymbol\);\s*const symbols = gate\.admitted;/.test(w)
      && w.indexOf("const symbols = gate.admitted;") < w.indexOf("await warmPickersSec(symbols,");
  },
  "sec-daily-index seeds through the gate": async () =>
    /seedManifest\(manifest, universe, tickers\.map, tickers\.source !== "none", secSeedRefusal\)/.test(readCodeOnly("app/api/jobs/sec-daily-index/route.ts")),
};

// ── 4. THE DOT/DASH READ, on the shipped readFactSet / factSetExists ───────
const STORE = readCodeOnly("lib/server/secFactStore.ts");
globalThis.__dotDash = MAN.dotDashSpellings;
const STORE_PRE = `
const redis = new Proxy({}, { get: (_, k) => { const r = globalThis.__fakeRedis; const f = r && r[k]; return typeof f === "function" ? f.bind(r) : f; } });
const dotDashSpellings = (s) => globalThis.__dotDash(s);
const factKey = (s) => "msh:sec:facts:v1:" + s.toUpperCase();
const secFieldsHash = () => "H";
`;
const loadStore = (src) => lift(
  [grabFunction(src, "readFactSet"), grabFunction(src, "factSetExists")].join("\n") + "\nexport { readFactSet, factSetExists };",
  STORE_PRE, "seed-gate-store");
const fakeStore = (keys) => {
  const gets = [];
  return {
    gets,
    async get(k) { gets.push(k); return keys.includes(k) ? { h: "H", quarters: [], key: k } : null; },
    async exists(...ks) { return ks.filter((k) => keys.includes(k)).length; },
  };
};
const STORE_RULES = {
  "BRK-B resolves to the BRK.B set": async (S) => {
    globalThis.__fakeRedis = fakeStore(["msh:sec:facts:v1:BRK.B"]);
    return (await S.readFactSet("BRK-B"))?.key === "msh:sec:facts:v1:BRK.B";
  },
  "BRK.B resolves to a set written as BRK-B": async (S) => {
    globalThis.__fakeRedis = fakeStore(["msh:sec:facts:v1:BRK-B"]);
    return (await S.readFactSet("BRK.B"))?.key === "msh:sec:facts:v1:BRK-B";
  },
  "a hit on the asked spelling costs ONE read": async (S) => {
    const r = fakeStore(["msh:sec:facts:v1:AAPL"]); globalThis.__fakeRedis = r;
    return Boolean(await S.readFactSet("AAPL")) && r.gets.length === 1;
  },
  "factSetExists answers for either spelling": async (S) => {
    globalThis.__fakeRedis = fakeStore(["msh:sec:facts:v1:BRK.B"]);
    return (await S.factSetExists("BRK-B")) === true;
  },
};

const G0 = await loadGate();
const S0 = await loadStore(STORE);
console.log("1–3. the gate, the seed and the wiring");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(await rule(G0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}
console.log("\n4. the dot/dash read");
for (const [name, rule] of Object.entries(STORE_RULES)) {
  let ok = false; try { ok = Boolean(await rule(S0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}

console.log("\nmutants: each must break a rule");
const bites = async (rules, load) => {
  for (const rule of Object.values(rules)) {
    let ok = false;
    try { ok = Boolean(await rule(await load())); } catch { ok = false; }
    if (!ok) return true;
  }
  return false;
};
const GATE_MUTANTS = [
  ["the security-kind test dropped (FITB-PA seeded with Fifth Third's figures)", once('if (!admitSymbolForExtraction(clean, cik).admit) return "security-kind";', "")],
  ["ETFs admitted", once('if (ETFS.has(toDashed(clean))) return "etf";', "")],
  ["notes admitted", once('if (nonEquityListingOf(clean)) return "non-equity";', "")],
  ["no-CIK symbols admitted", once('if (!cik) return "no-cik";', "")],
  ["warm-pickers-sec's filter ignores the gate", once("const why = cik ? secSeedRefusal(s, cik) : null;", "const why = null;")],
];
for (const [label, mutate] of GATE_MUTANTS) {
  let caught = false;
  try { const G = await loadGate(mutate); caught = await bites(RULES, async () => G); } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, caught);
}
{
  const W = readCodeOnly("app/api/jobs/warm-pickers-sec/route.ts");
  const mutated = W.replace("const symbols = gate.admitted;", "const symbols = universe;");
  check("MUTATION: warm-pickers-sec reads the whole universe again → caught",
    mutated !== W && !/const gate = admittedForSec\(universe, cikForSymbol\);\s*const symbols = gate\.admitted;/.test(mutated));
}
{
  const DI = readCodeOnly("app/api/jobs/sec-daily-index/route.ts");
  const mutated = DI.replace('tickers.source !== "none", secSeedRefusal)', 'tickers.source !== "none")');
  check("MUTATION: sec-daily-index seeds without the gate → caught",
    mutated !== DI && !/seedManifest\(manifest, universe, tickers\.map, tickers\.source !== "none", secSeedRefusal\)/.test(mutated));
}
const STORE_MUTANTS = [
  ["readFactSet tries only the asked spelling", once("for (const spelling of dotDashSpellings(symbol)) {", "for (const spelling of [symbol]) {")],
  ["factSetExists checks only the asked spelling", once("(await redis.exists(...dotDashSpellings(symbol).map(factKey))) > 0", "(await redis.exists(factKey(symbol))) > 0")],
];
for (const [label, mutate] of STORE_MUTANTS) {
  let caught = false;
  try { const S = await loadStore(mutate(STORE)); caught = await bites(STORE_RULES, async () => S); } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, caught);
}
delete globalThis.__fakeRedis;

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
