// Sector and industry lookup (lib/server/staticProfile.ts), after the FMP
// snapshot was removed (2026-09-23, #552, COWORK #4).
//
//   1. NO FMP SNAPSHOT. data/static-profile.json is gone, and no file under
//      app/ or lib/ imports it. MUTATION: the import put back into the module.
//   2. LOOKUP ORDER. Cache, then SEC SIC, then null. MUTATION: a snapshot-style
//      leg reinserted ahead of SIC changes the answering leg.
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
  .replace(/^import sicSectorFile from "@\/data\/sec\/sic-sector.json";$/m,
    () => `const sicSectorFile = ${read("data/sec/sic-sector.json")};`)
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
check("no cache row → the SIC leg answers (AAPL, SIC 3571, SEC's own description)",
  aapl.source === "sic" && aapl.industry === "Electronic Computers" &&
    aapl.sectorSource === (aapl.sector ? "sic" : "none") && aapl.industrySource === "sic", JSON.stringify(aapl));
check("...likewise for a cache row of nulls, and an undefined one",
  sp.resolveProfile("AAPL", { sector: null, industry: null }).source === "sic" &&
    sp.resolveProfile("AAPL", undefined).source === "sic");
const nvda = sp.resolveProfile("NVDA", null);
check("SIC 3674 carries the one owner-decided label",
  nvda.source === "sic" && nvda.sector === "Technology" && nvda.industry === "Semiconductors", JSON.stringify(nvda));
check("the label table is one row, and records its source",
  Object.keys(sp.SIC_INDUSTRY_LABELS).length === 1 && /owner decision/.test(sp.SIC_INDUSTRY_LABELS["3674"]?.source ?? ""));
check("BRK.B reaches registrants' BRK-B row (the dot/dash bridge)",
  sp.sicProfileFor("BRK.B") !== null && JSON.stringify(sp.sicProfileFor("BRK.B")) === JSON.stringify(sp.sicProfileFor("BRK-B")));
{
  const M = await load(once(SOURCE, "  const sic = sicProfileFor(symbol);",
    '  if (String(symbol).toUpperCase() === "AAPL") return { sector: "Technology", industry: "Consumer Electronics", source: "cache", sectorSource: "fmp-cache", industrySource: "fmp-cache" };\n  const sic = sicProfileFor(symbol);'));
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
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
