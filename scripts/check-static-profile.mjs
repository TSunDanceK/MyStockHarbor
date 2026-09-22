// The committed static-profile snapshot, and the lookup that reads it.
//
// WHAT IS AT RISK. Every failure here is silent on a page:
//   1. A LIVE-MARKET FIELD GETTING IN. marketCap, beta, the 52-week range and
//      the dividend are READINGS, not facts. A frozen reading puts a stale
//      number on a live page, which is worse than an absent row because a
//      reader cannot tell it is stale. The snapshot must contain none of them.
//   2. THE LOOKUP ORDER. Cache, then snapshot, then null. If the snapshot ever
//      won over the cache, a reclassification would need a redeploy to take
//      effect and nobody would know why the sector was wrong.
//   3. A GUESS INSTEAD OF A NULL. A symbol in neither leg must yield null. A
//      default sector is a wrong sector on every page it touches.
//   4. A MISS COSTING A REQUEST. The refresh trigger is a log line, exactly like
//      the CIK map's. If a miss ever fetched, a symbol off the snapshot would
//      hit the network on every render.
//
//   node scripts/check-static-profile.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ─────────────────────────────────────────────────────────── the module
const src = read("lib/server/staticProfile.ts")
  .replace(/^import snapshotFile from "@\/data\/static-profile.json";$/m,
    () => `const snapshotFile = ${read("data/static-profile.json")};`)
  // The CIK map, inlined for the same reason as the snapshot: the coverage
  // constants are computed from BOTH files, so a stub would make the coverage
  // number describe the stub. Real data or no assertion.
  .replace(/^import cikMap from "@\/data\/cik-map.json";$/m,
    () => `const cikMap = ${read("data/cik-map.json")};`)
  // The SIC leg's two files, inlined for the same reason: real data or no
  // assertion.
  .replace(/^import registrantsFile from "@\/data\/sec\/registrants.json";$/m,
    () => `const registrantsFile = ${read("data/sec/registrants.json")};`)
  .replace(/^import sicSectorFile from "@\/data\/sec\/sic-sector.json";$/m,
    () => `const sicSectorFile = ${read("data/sec/sic-sector.json")};`)
  .replace(/^export type StaticProfileRow = \{[\s\S]*?^\};$/m, "")
  .replace(/^type SnapshotFile = \{[\s\S]*?^\};$/m, "")
  .replace("const SNAPSHOT = snapshotFile as unknown as SnapshotFile;", "const SNAPSHOT = snapshotFile;")
  .replace("const CIK_BY_SYMBOL = cikMap as unknown as Record<string, string>;", "const CIK_BY_SYMBOL = cikMap;")
  .replace("export const SNAPSHOT_AS_OF: string = SNAPSHOT.asOf;", "export const SNAPSHOT_AS_OF = SNAPSHOT.asOf;")
  .replace("export const SNAPSHOT_SIZE: number = Object.keys(SNAPSHOT.rows ?? {}).length;",
           "export const SNAPSHOT_SIZE = Object.keys(SNAPSHOT.rows ?? {}).length;")
  .replace("const clean = (v: unknown): string | null =>", "const clean = (v) =>")
  .replace("export function staticProfileFor(symbol: string): StaticProfileRow | null {",
           "export function staticProfileFor(symbol) {")
  .replace(/^export type ResolvedProfile = StaticProfileRow & \{[\s\S]*?^\};$/m, "")
  .replace(/export function resolveProfile\(\n  symbol: string,\n  cached: \{ sector\?: string \| null; industry\?: string \| null \} \| null \| undefined\n\): ResolvedProfile \{/,
           "export function resolveProfile(symbol, cached) {");
if (/^import /m.test(src)) {
  console.error("FAIL: an import survived inlining:\n" + src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
for (const [marker, why] of [
  ["const snapshotFile = {", "the snapshot JSON was not inlined"],
  ["export function resolveProfile(symbol, cached) {", "resolveProfile was not de-typed"],
  ["export function staticProfileFor(symbol) {", "staticProfileFor was not de-typed"],
]) {
  if (!src.includes(marker)) { console.error(`FAIL: ${why} — a substitution stopped matching.`); process.exit(1); }
}
const file = path.join(ROOT, ".check-staticprofile.mjs");
fs.writeFileSync(file, ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let sp;
try { sp = await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
finally { fs.unlinkSync(file); }

const snapshot = JSON.parse(read("data/static-profile.json"));

console.log("\n=== 1. NO LIVE-MARKET FIELD IS IN THE FILE ===\n");
// A READING IS NOT A FACT. Checked against the serialised rows rather than the
// type, because the type cannot stop a regenerate script widening the payload.
const rowsText = JSON.stringify(snapshot.rows);
const BANNED = [
  ["marketCap", "moves every trading day"],
  ["beta", "recomputed from a rolling window"],
  ["lastAnnualDividend", "changes with every declaration"],
  ["range", "the 52-week range moves continuously"],
  ["price", "the most obviously live number there is"],
  ["peRatio", "a price ratio, so it moves with price"],
  ["volume", "moves every trading day"],
];
for (const [field, why] of BANNED) {
  check(`no "${field}" anywhere in rows`, !rowsText.includes(field), why);
}
check(
  "no description either — a fact store, not FMP's prose",
  !rowsText.includes("description"),
  "the 10-K Item 1 business section is the candidate replacement, via the step-5 SEC adapter"
);
check(
  "every row has ONLY sector and industry",
  Object.values(snapshot.rows).every((r) => {
    const keys = Object.keys(r).sort();
    return keys.length <= 2 && keys.every((k) => k === "sector" || k === "industry");
  }),
  "a widened row is how a live field would get in"
);
check(
  "the file names the excluded fields, so the omissions read as decisions",
  Array.isArray(snapshot.absentFields?.readings) &&
    Array.isArray(snapshot.absentFields?.blocked) &&
    snapshot.absentFields.readings.includes("marketCap") &&
    snapshot.absentFields.blocked.includes("ipoDate"),
  "readings excluded on purpose; the eight blocked ones absent for want of an FMP key"
);

console.log("\n=== 2. Coverage ===\n");
check("the snapshot is complete", snapshot.coverage?.complete === true,
  `${snapshot.coverage?.symbols} symbols, chunks ${snapshot.coverage?.chunksPresent?.join(",")}`);
check("2,619 symbols", sp.SNAPSHOT_SIZE === 2619, `${sp.SNAPSHOT_SIZE}`);
check(
  "every row carries BOTH fields, populated",
  Object.values(snapshot.rows).every((r) => r.sector && r.industry),
  "the source datasets were 100% populated for both; a null here would mean the expander lost something"
);
check(
  "wider than the 695-symbol universe, which is the point",
  sp.SNAPSHOT_SIZE > 695 * 3,
  "a symbol entering the universe later has no free source with this taxonomy to fall back on"
);
check(
  "every sector is one of the site's eleven",
  (() => {
    const slugs = new Set([...read("lib/sectors.ts").matchAll(/slug:\s*"([a-z-]+)"/g)].map((m) => m[1]));
    const labelToSlug = (s) => s.toLowerCase().replace(/\s+/g, "-");
    return [...new Set(Object.values(snapshot.rows).map((r) => r.sector))].every((s) => slugs.has(labelToSlug(s)));
  })(),
  "FMP's 11 sector labels map 1:1 onto lib/sectors.ts — if they ever stop, bucketFor silently stops matching"
);
check("spot checks against reality", 
  snapshot.rows.AAPL?.sector === "Technology" &&
  snapshot.rows.AAPL?.industry === "Consumer Electronics" &&
  snapshot.rows.JPM?.sector === "Financial Services" &&
  snapshot.rows.XOM?.sector === "Energy" &&
  snapshot.rows.MU?.industry === "Semiconductors",
  "AAPL, JPM, XOM, MU");

console.log("\n=== 2b. CIK COVERAGE — the gap that was invisible ===\n");

// A symbol with no CIK gets [] from the SEC adapter on EVERY render, forever,
// and says so only through a per-request console.warn. That is how a 73.5% gap
// survived: the map was built against the PICKERS universe while the adapter is
// called for any symbol with a stock page.
// claude/cik-map-coverage-2026-09-14.md.
const cikMap = JSON.parse(read("data/cik-map.json"));
check(
  "the coverage constants are computed from the real files, not from a stub",
  sp.CIK_MAP_SIZE === Object.keys(cikMap).length && sp.CIK_MAP_SIZE > 0,
  `${sp.CIK_MAP_SIZE} entries`
);
check(
  "covered + missing accounts for every profiled symbol",
  sp.CIK_COVERED + sp.CIK_MISSING === sp.SNAPSHOT_SIZE,
  "a coverage figure that does not sum to the denominator is not a coverage figure"
);
check(
  "coverage is counted by MEMBERSHIP, not by comparing two totals",
  (() => {
    // THIS ASSERTION USED TO BE WORTHLESS and the mutation suite said so:
    // replacing the membership count with Math.min(mapSize, profiledSize)
    // SURVIVED, because the CIK map is a strict subset of the snapshot today so
    // both give 695. Against the live data the two implementations are
    // indistinguishable, and no amount of care in phrasing the assertion changes
    // that -- the data cannot tell them apart.
    //
    // So the function is handed a case where they DO differ: a map carrying a
    // symbol the snapshot does not. Membership says 1 of 2 covered; the
    // shortcut says min(3, 2) = 2, and missing would be 0 instead of 1.
    const got = sp.cikCoverage(
      { AAA: {}, BBB: {} },
      { AAA: "1", ZZZ: "2", YYY: "3" }
    );
    return got.covered === 1 && got.missing === 1 && got.profiled === 2 && got.mapSize === 3;
  })(),
  "a difference of totals is right only while the map is a subset, and nothing enforces that"
);
check(
  "...and the constants agree with that function on the live data",
  sp.CIK_COVERED === sp.cikCoverage(snapshot.rows, cikMap).covered &&
    sp.CIK_MISSING === sp.cikCoverage(snapshot.rows, cikMap).missing &&
    sp.CIK_MAP_SIZE === Object.keys(cikMap).length,
  "necessary but NOT sufficient — see the next assertion for why"
);
check(
  "...and they are ASSIGNED from it, not recomputed beside it",
  (() => {
    // THE NUMERIC CHECK ABOVE CANNOT CATCH THIS, and pretending otherwise is how
    // an assertion ends up decorative. A mutation setting
    // CIK_COVERED = Math.min(mapSize, profiled) survived every numeric assertion
    // here, because on today's data min(695, 2619) IS 695. The two agree until
    // the map is widened, which is precisely when someone will be reading this
    // number to decide whether the widening worked.
    //
    // Structure is the only discriminator left: the constants must be plain
    // reads off the tested function's result.
    const code = readCodeOnly("lib/server/staticProfile.ts");
    return /export const CIK_MAP_SIZE: number = COVERAGE\.mapSize;/.test(code) &&
      /export const CIK_COVERED: number = COVERAGE\.covered;/.test(code) &&
      /export const CIK_MISSING: number = COVERAGE\.missing;/.test(code) &&
      /const COVERAGE = cikCoverage\(SNAPSHOT\.rows \?\? \{\}, CIK_BY_SYMBOL\);/.test(code);
  })(),
  "a tested function beside an untested inline copy is an untested page"
);
check(
  "AOS — the case this was found through — is profiled, and the count accounts for it",
  (() => {
    // DELIBERATELY NOT "AOS has no CIK". That would be a tripwire that fails the
    // day the map is regenerated, i.e. the day the problem is FIXED, and an
    // assertion you have to delete to ship the fix trains people to delete
    // assertions. What is permanent is that AOS is profiled and served, so it
    // must land on one side of the tally or the other -- never neither.
    if (!("AOS" in snapshot.rows)) return false;
    return "AOS" in cikMap ? sp.CIK_COVERED > 0 : sp.CIK_MISSING > 0;
  })(),
  "AOS" in cikMap
    ? "covered — the map has been regenerated since this was written"
    : "profiled, served, and structurally zero on the SEC leg until the map is regenerated"
);
check(
  "the misses are ordinary US common stock, not exotica",
  (() => {
    // If the gap were ADRs, funds and class shares, widening the denominator
    // would be the wrong fix and the right one would be accepting the misses.
    // It is not: 1,893 of 1,924 are plain <=4-letter tickers.
    const miss = Object.keys(snapshot.rows).filter((s) => !(s in cikMap));
    const plain = miss.filter((s) => s.length <= 4 && !/[.-]/.test(s));
    return miss.length > 0 && plain.length / miss.length > 0.9;
  })(),
  "a gap made of ADRs would be a data fact; a gap made of AAL and ADSK is a denominator mistake"
);
check(
  "the generator builds against the union, not the pickers universe alone",
  (() => {
    const probe = readCodeOnly("scripts/sec-probe.mjs");
    return /static-profile\.json/.test(probe) &&
      /new Set\(\[\.\.\.pickers, \.\.\.profileRows\]\)/.test(probe);
  })(),
  "regenerating against the old denominator would fix none of the 1,924"
);
check(
  "...and the union cannot LOSE a pickers symbol while widening",
  /\[\.\.\.pickers, \.\.\.profileRows\]/.test(readCodeOnly("scripts/sec-probe.mjs")),
  "swapping the snapshot in for the universe would drop any universe symbol the snapshot lacks"
);

console.log("\n=== 3. LOOKUP ORDER: cache, then snapshot, then null ===\n");
check(
  "a cached value WINS over the snapshot",
  (() => {
    const r = sp.resolveProfile("AAPL", { sector: "Utilities", industry: "Regulated Water" });
    return r.source === "cache" && r.sector === "Utilities";
  })(),
  "the cache is newer, and a reclassification must take effect without a redeploy"
);
check(
  "the snapshot answers when the cache is empty",
  (() => {
    const r = sp.resolveProfile("AAPL", null);
    return r.source === "snapshot" && r.sector === "Technology" && r.industry === "Consumer Electronics";
  })()
);
check(
  "...and when the cache row exists but both fields are null",
  sp.resolveProfile("AAPL", { sector: null, industry: null }).source === "snapshot",
  "a cache row of nulls is a miss, not an answer"
);
check(
  "...and when the cache row is undefined entirely",
  sp.resolveProfile("AAPL", undefined).source === "snapshot"
);
check(
  "EITHER cached field alone counts as a cache hit",
  sp.resolveProfile("AAPL", { sector: "Energy" }).source === "cache" &&
    sp.resolveProfile("AAPL", { industry: "Gold" }).source === "cache",
  "bucketFor degrades from industry to sector on its own; taking the snapshot's other half would mix two vintages"
);

console.log("\n=== 4. A MISS YIELDS NULL, NOT A GUESS ===\n");
const warnings = [];
const withWarn = (fn) => {
  const real = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try { return fn(); } finally { console.warn = real; }
};
const miss = withWarn(() => sp.resolveProfile("ZZZZNOTREAL", null));
check("both fields are null", miss.sector === null && miss.industry === null);
check("the source says so", miss.source === "none");
check(
  "NO DEFAULT SECTOR — not 'Technology', not the commonest, not anything",
  miss.sector !== "Technology" && miss.sector !== "" && miss.sector == null,
  "a default sector is a wrong sector on every page it touches"
);
check(
  "the refresh trigger fires: the symbol is logged by name",
  warnings.some((w) => w.includes("[static-profile]") && w.includes("ZZZZNOTREAL") && w.includes("static-profile.json")),
  "the same shape as the CIK map's, and for the same reason: a miss IS the event"
);
check(
  "...and the log says what the reader will see, so it is not filed as a bug",
  warnings.some((w) => /generated|sector page/i.test(w)),
  "no sector means no bucket means the generated data card, and no sector-page membership"
);
check(
  "a miss makes NO NETWORK REQUEST",
  await (async () => {
    const real = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("should not fetch"); };
    try { withWarn(() => sp.resolveProfile("ZZZZNOTREAL", null)); return !called; }
    finally { globalThis.fetch = real; }
  })(),
  "otherwise a symbol off the snapshot hits the network on every render"
);
check(
  "the module contains no fetch at all",
  !/fetch\(|await fetch/.test(readCodeOnly("lib/server/staticProfile.ts")),
  "it is a bundled lookup; there is nothing for it to call"
);
check(
  "a blank or junk symbol is a miss, not a throw",
  sp.staticProfileFor("") === null && sp.staticProfileFor("   ") === null && sp.staticProfileFor(null) === null
);
check(
  "lookup is case-insensitive on the way in",
  sp.staticProfileFor("aapl")?.sector === "Technology"
);

console.log("\n=== 5. The wire form and the committed form agree ===\n");
check(
  "re-expanding the wire form reproduces the committed file byte for byte",
  (() => {
    // THE ONLY THING THAT PROVES THE TWO FORMS HAVE NOT DRIFTED. The committed
    // file is generated; if someone hand-edits it, this is what notices.
    const before = read("data/static-profile.json");
    execFileSync("node", ["scripts/static-profile-expand.mjs"], { cwd: ROOT, stdio: "pipe" });
    const after = read("data/static-profile.json");
    if (before !== after) fs.writeFileSync(path.join(ROOT, "data/static-profile.json"), before);
    return before === after;
  })(),
  "do not hand-edit data/static-profile.json — regenerate it"
);
check(
  "no FMP call is made to build it",
  // CODE ONLY. The script's header explains at length WHY financialmodelingprep
  // is unreachable from here, so the raw text contains the host name and a grep
  // over it fails on the explanation rather than on a call.
  !/financialmodelingprep|FMP_API_KEY|fetch\(/.test(readCodeOnly("scripts/static-profile-build.mjs")),
  "the taxonomy came from the Step 0 dump, which already held it"
);

console.log("\n=== 6. Load-bearing since step 7 ===\n");
check(
  "NEWS_PROVIDER defaults to free",
  /process\.env\.NEWS_PROVIDER === "fmp" \? "fmp" : "free"/.test(readCodeOnly("lib/server/news/index.ts")),
  "which is what makes this snapshot the only floor under sector and industry"
);

console.log("\n=== 7. The SIC leg: third, never over a snapshot row, provenance per field ===\n");
{
  // A SNAPSHOT SYMBOL NEVER RESOLVES THROUGH SIC, so every symbol the snapshot
  // covers reads exactly as it did before the leg existed.
  const nv = sp.resolveProfile("NVDA", null);
  check("NVDA (in the snapshot) resolves from the snapshot, not SIC",
    nv.source === "snapshot" && nv.sectorSource === "fmp-snapshot" && nv.industrySource === "fmp-snapshot",
    JSON.stringify(nv));
  check("a cached FMP row reports fmp-cache per field, and none for a field it lacks",
    (() => { const r = sp.resolveProfile("NVDA", { sector: "Technology", industry: null });
      return r.sectorSource === "fmp-cache" && r.industrySource === "none"; })());

  // THE LEG ITSELF, on real rows: NVDA's SIC 3674 maps to Technology by
  // measured majority, and its industry is SEC's own description, not FMP's.
  const sic = sp.sicProfileFor("NVDA");
  check("the SIC leg reads the committed registrant and crosswalk",
    sic?.sector === "Technology" && sic?.industry === "Semiconductors & Related Devices",
    JSON.stringify(sic));

  // A SYMBOL IN NO FMP LEG FALLS THROUGH TO SIC. None exists in today's files
  // (registrants covers the snapshot's symbols), so NVDA's snapshot row is
  // removed in a mutated copy of the module to reach the leg.
  const orphanSrc = src.replace("const snap = staticProfileFor(symbol);", "const snap = null;");
  const f2 = path.join(ROOT, ".check-staticprofile-sic.mjs");
  fs.writeFileSync(f2, ts.transpileModule(orphanSrc, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  let orphan;
  try { orphan = await import(`${pathToFileURL(f2).href}?t=${Date.now()}`); } finally { fs.unlinkSync(f2); }
  const o = orphan.resolveProfile("NVDA", null);
  check("with no FMP row, the SIC leg answers and says so",
    o.source === "sic" && o.sector === "Technology" && o.sectorSource === "sic" && o.industrySource === "sic",
    JSON.stringify(o));
  check("an unclassified SIC code yields no sector — never a guess",
    Object.values(JSON.parse(read("data/sec/sic-sector.json")).codes).some((c) => c.sector === null),
    "unclassified codes exist and map to null");
  check("the crosswalk is regenerated, not hand-edited",
    (() => { try { execFileSync("node", ["scripts/build-sic-sector.mjs", "--check"], { cwd: ROOT, stdio: "pipe" }); return true; } catch { return false; } })(),
    "node scripts/build-sic-sector.mjs");
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
