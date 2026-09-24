// Sector and industry lookup (lib/server/staticProfile.ts), after the FMP
// snapshot was removed (2026-09-23, #552, COWORK #4).
//
//   1. NO FMP SNAPSHOT. data/static-profile.json is gone, and no file under
//      app/ or lib/ imports it. MUTATION: the import put back into the module.
//   2. LOOKUP ORDER. Cache, then the filing override, then the SIC table (or the
//      major group's sector), then null; every Pickers label reachable.
//      MUTATIONS: an FMP-style leg ahead of SIC; the override leg removed; a
//      label's only rule emptied.
//   3. A MISS IS NULL, logged by name, and makes no network request.
//   4. CIK COVERAGE is counted by membership over registrants.json's rows.
//   5. THE CLASSIFICATION DATE is the answering leg's own. MUTATION: the SIC
//      leg borrowing another date.
//
//   node scripts/check-static-profile.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ─────────────────────────────────────────────────────────── the module
// The data files are INLINED, not stubbed: the coverage and SIC answers are
// computed from them, so a stub would make the assertions describe the stub.
globalThis.__symbolSpellings = await import("../lib/symbolSpellings.mjs");
const SOURCE = read("lib/server/staticProfile.ts");
const inline = (text) => text
  .replace(/^import cikMap from "@\/data\/cik-map.json";$/m, () => `const cikMap = ${read("data/cik-map.json")};`)
  .replace(/^import registrantsFile from "@\/data\/sec\/registrants.json";$/m,
    () => `const registrantsFile = ${read("data/sec/registrants.json")};`)
  .replace(/^import classificationFile from "@\/data\/sec\/sic-classification.json";$/m,
    () => `const classificationFile = ${read("data/sec/sic-classification.json")};`)
  .replace(/^import overridesFile from "@\/data\/sec\/classification-overrides.json";$/m,
    () => `const overridesFile = ${read("data/sec/classification-overrides.json")};`)
  .replace(/^import \{ lookupSpellingIn \} from "@\/lib\/symbolSpellings\.mjs";$/m,
    "const { lookupSpellingIn } = globalThis.__symbolSpellings;");

let n = 0;
async function load(text) {
  const src = inline(text);
  if (/^import /m.test(src)) {
    throw new Error("an import survived inlining:\n" + src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  }
  const f = path.join(ROOT, `.check-staticprofile-${process.pid}-${n++}.mjs`);
  fs.writeFileSync(f, ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  try { return await import(`${pathToFileURL(f).href}?t=${Date.now()}`); } finally { fs.unlinkSync(f); }
}
const once = (text, from, to) => {
  const k = text.split(from).length - 1;
  if (k !== 1) throw new Error(`mutation anchor matched ${k} times: ${from.slice(0, 70)}`);
  return text.replace(from, to);
};
const sp = await load(SOURCE);

console.log("\n=== 1. NO FMP SNAPSHOT ===\n");
const importsSnapshot = (code) => /static-profile\.json/.test(code);
check("data/static-profile.json does not exist", !fs.existsSync(path.join(ROOT, "data/static-profile.json")));
check("staticProfile.ts does not import it", !importsSnapshot(readCodeOnly("lib/server/staticProfile.ts")));
{
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx|mjs|js)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
  const readers = [...walk("app"), ...walk("lib")].filter((f) => importsSnapshot(readCodeOnly(f)));
  check("no file under app/ or lib/ reads it", readers.length === 0, readers.join(", "));
  const mutated = once(SOURCE, 'import cikMap from "@/data/cik-map.json";',
    'import snapshotFile from "@/data/static-profile.json";\nimport cikMap from "@/data/cik-map.json";');
  check("MUTATION: the import put back is caught", importsSnapshot(mutated));
}

console.log("\n=== 2. LOOKUP ORDER: cache, then SEC SIC, then null ===\n");
check("a cached value wins",
  (() => { const r = sp.resolveProfile("AAPL", { sector: "Utilities", industry: "Regulated Water" });
    return r.source === "cache" && r.sector === "Utilities" && r.sectorSource === "fmp-cache"; })());
check("either cached field alone counts as a cache hit",
  sp.resolveProfile("AAPL", { sector: "Energy" }).source === "cache" &&
    sp.resolveProfile("AAPL", { industry: "Gold" }).source === "cache");
const aapl = sp.resolveProfile("AAPL", null);
check("no cache row → the SIC table answers in the Pickers label set (AAPL, SIC 3571)",
  aapl.source === "sic" && aapl.sector === "Technology" && aapl.industry === "Computer Hardware" &&
    aapl.sectorSource === "sic" && aapl.industrySource === "sic", JSON.stringify(aapl));
check("...likewise for a cache row of nulls, and an undefined one",
  sp.resolveProfile("AAPL", { sector: null, industry: null }).source === "sic" &&
    sp.resolveProfile("AAPL", undefined).source === "sic");
const nvda = sp.resolveProfile("NVDA", null);
check("SIC 3674 → Technology / Semiconductors (the preset's label)",
  nvda.source === "sic" && nvda.sector === "Technology" && nvda.industry === "Semiconductors", JSON.stringify(nvda));
// THE OVERRIDE LEG FIRST: a filer whose own 10-K text placed it.
const OV = JSON.parse(read("data/sec/classification-overrides.json")).overrides;
const pypl = sp.resolveProfile("PYPL", null);
check("an override from the filer's own text wins over the table (PYPL, SIC 7389 → payments)",
  pypl.source === "filing" && pypl.industry === OV.PYPL.industry && pypl.industry === "Financial - Credit Services" &&
    pypl.filedOn === OV.PYPL.filedOn, JSON.stringify(pypl));
{
  const M = await load(once(SOURCE, "  if (o && (clean(o.sector) || clean(o.industry))) {", "  if (false) {"));
  check("MUTATION: without the override leg PYPL is no longer placed by its filing", M.resolveProfile("PYPL", null).source !== "filing");
}
{
  // A CODE THE TABLE DOES NOT LIST takes its 2-digit major group's sector.
  const T = JSON.parse(read("data/sec/sic-classification.json"));
  const REG = JSON.parse(read("data/sec/registrants.json")).rows;
  const sym = Object.keys(REG).sort().find((k) => REG[k].sic && !T.codes[REG[k].sic] && !OV[k] && T.majorGroups[REG[k].sic.slice(0, 2)]);
  const r = sp.resolveProfile(sym, null);
  check(`an unlisted code takes its major group's sector (${sym}, SIC ${REG[sym].sic})`,
    r.source === "sic" && r.sector === T.majorGroups[REG[sym].sic.slice(0, 2)] && r.industry === null, JSON.stringify(r));
  // EVERY PICKERS LABEL REACHABLE (COWORK #22 condition 1).
  const rules = JSON.parse(read("data/sec/classification-rules.json")).rules;
  const reach = new Set([...Object.values(T.codes).map((c) => c.industry).filter(Boolean), ...rules.filter((x) => x.phrases.length).map((x) => x.industry)]);
  const missing = Object.keys(T.labels).filter((l) => !reach.has(l));
  check(`every one of the ${Object.keys(T.labels).length} Pickers labels is reachable from the table or a rule`, missing.length === 0, missing.join(", "));
  check("every table and rule label is in the label list (no stray names)",
    [...reach].every((l) => l in T.labels) && Object.values(T.codes).every((c) => !c.sector || Object.values(T.labels).includes(c.sector)));
  const mutated = rules.map((x) => (x.industry === "Uranium" ? { ...x, phrases: [] } : x));
  const reach2 = new Set([...Object.values(T.codes).map((c) => c.industry).filter(Boolean), ...mutated.filter((x) => x.phrases.length).map((x) => x.industry)]);
  check("MUTATION: a label's only rule emptied is caught", Object.keys(T.labels).some((l) => !reach2.has(l)));
}
check("BRK.B reaches registrants' BRK-B row (the dot/dash bridge)",
  sp.sicProfileFor("BRK.B") !== null && JSON.stringify(sp.sicProfileFor("BRK.B")) === JSON.stringify(sp.sicProfileFor("BRK-B")));
{
  const M = await load(once(SOURCE, "  const sec = sicProfileFor(symbol);",
    '  if (String(symbol).toUpperCase() === "AAPL") return { sector: "Technology", industry: "Consumer Electronics", source: "cache", sectorSource: "fmp-cache", industrySource: "fmp-cache" };\n  const sec = sicProfileFor(symbol);'));
  check("MUTATION: an FMP-style leg ahead of SIC changes the answering leg", M.resolveProfile("AAPL", null).source !== "sic");
}

console.log("\n=== 3. A MISS YIELDS NULL, NOT A GUESS ===\n");
{
  const warnings = [];
  const real = console.warn;
  const realFetch = globalThis.fetch;
  let fetched = false;
  console.warn = (m) => warnings.push(String(m));
  globalThis.fetch = async () => { fetched = true; throw new Error("should not fetch"); };
  let miss;
  try { miss = sp.resolveProfile("ZZZZNOTREAL", null); } finally { console.warn = real; globalThis.fetch = realFetch; }
  check("both fields null, source none", miss.sector === null && miss.industry === null && miss.source === "none");
  check("the miss is logged by name", warnings.some((w) => w.includes("[static-profile]") && w.includes("ZZZZNOTREAL")));
  check("...and the log no longer points at the removed file", !warnings.some((w) => w.includes("static-profile.json")));
  check("a miss makes no network request", !fetched);
  check("the module contains no fetch at all", !/fetch\(/.test(readCodeOnly("lib/server/staticProfile.ts")));
  check("a blank symbol is a miss, not a throw", sp.sicProfileFor("") === null && sp.sicProfileFor(null) === null);
}

console.log("\n=== 4. CIK COVERAGE, over registrants.json ===\n");
{
  const cikMap = JSON.parse(read("data/cik-map.json"));
  const rows = JSON.parse(read("data/sec/registrants.json")).rows;
  check("counted by MEMBERSHIP, not by comparing totals",
    (() => { const g = sp.cikCoverage({ AAA: {}, BBB: {} }, { AAA: "1", ZZZ: "2", YYY: "3" });
      return g.covered === 1 && g.missing === 1 && g.profiled === 2 && g.mapSize === 3; })());
  check("the constants agree with the function on the live files",
    sp.CIK_COVERED === sp.cikCoverage(rows, cikMap).covered && sp.PROFILED_SIZE === Object.keys(rows).length &&
      sp.CIK_COVERED + sp.CIK_MISSING === sp.PROFILED_SIZE, `${sp.CIK_COVERED}/${sp.PROFILED_SIZE}`);
  const code = readCodeOnly("lib/server/staticProfile.ts");
  check("...and are assigned from it, not recomputed beside it",
    /const COVERAGE = cikCoverage\(REGISTRANTS, CIK_BY_SYMBOL\);/.test(code) &&
      /export const CIK_COVERED: number = COVERAGE\.covered;/.test(code) &&
      /export const CIK_MISSING: number = COVERAGE\.missing;/.test(code));
}

console.log("\n=== 5. The classification date is the answering leg's own ===\n");
{
  const regAsOf = JSON.parse(read("data/sec/registrants.json")).asOf;
  check("SIC leg → registrants.json's asOf", sp.classificationAsOf(aapl, null) === regAsOf, `${sp.classificationAsOf(aapl, null)}`);
  check("cache leg → the row's updatedAt",
    sp.classificationAsOf({ source: "cache" }, "2026-09-21T04:10:00.000Z") === "2026-09-21");
  check("a cache row with no updatedAt yields no date", sp.classificationAsOf({ source: "cache" }, "") === null);
  check("no leg, no date", sp.classificationAsOf({ source: "none" }, "2026-09-21T00:00:00Z") === null);
  const M = await load(once(SOURCE, 'if (resolved.source === "sic") return day(REGISTRANTS_SIC_AS_OF);',
    'if (resolved.source === "sic") return day("2026-01-01");'));
  check("MUTATION: the SIC leg borrowing another date is caught", M.classificationAsOf({ source: "sic" }, null) !== regAsOf);
  check("filing leg → the filing date of the text it came from", sp.classificationAsOf(pypl, null) === OV.PYPL.filedOn);
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
