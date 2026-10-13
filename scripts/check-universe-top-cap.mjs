// THE ANALYSIS UNIVERSE'S SIZE SLICE (#553 COWORK #182, ruled in #186).
//
// Runtime, on lib/server/topByCap.ts with fixtures:
//   1. ranked by SEC cover shares x the stored close (A's marketCap), largest
//      first; a refused share basis (ADS ratio, no cover count) and a missing
//      close are not ranked; ties A-Z; at most n;
//   2. the dashed spelling (BRK-B), each symbol once whatever the field's
//      spelling; the dated hold-outs (SPCX) never ranked.
// Source:
//   3. the build fills the preset, THEN the size slice, then searches, then the
//      dynamic universe; a slot is taken once whatever the spelling;
//   4. MS is in the preset (dated). The cap is NOT this check's: it stays
//      under check-redis-bandwidth's and check-screener-pool's gates.
// Every rule has a planted mutant.
//
//   node scripts/check-universe-top-cap.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const LIB = "lib/server/topByCap.ts";
const BUILDER = "lib/server/pickersBuilder.ts";
const CAP_FILE = "lib/server/dynamicUniverseCache.ts";
const PRESET = "lib/server/presetUniverse.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function load(src) {
  const f = path.join(ROOT, "lib", "server", `.check-utc-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

const USD = { reporting: "USD", converted: false };
const row = (shares, refusals = []) => ({ v: 1, unit: USD, at: Date.now(), inputs: { shares: shares === null ? null : { val: shares, asOf: "2026-07-20" }, refusals } });
const bar = (c) => ({ d: "2026-10-05", o: c, h: c, l: c, c, v: 1 });
const ROWS = {
  AAA: row(1e9), // 100 x 1e9 = 1e11
  "BRK.B": row(2e9), // dotted field, 2e11 -> BRK-B
  CCC: row(5e8), // 1e11, ties AAA -> A-Z
  ADS1: row(9e9, ["ads-ratio-makes-shares-incomparable"]),
  NOCOVER: row(null, ["no-cover-share-count"]),
  NOCLOSE: row(9e9),
  SPCX: row(9e10),
  DDD: row(1e8),
};
const EOD = { AAA: bar(100), "BRK-B": bar(100), CCC: bar(200), ADS1: bar(100), NOCOVER: bar(100), SPCX: bar(100), DDD: bar(100) };

function rules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const r = L.rankByCap(ROWS, EOD, 10);
  want("largest first by shares x close, ties A-Z", r.join() === "BRK-B,AAA,CCC,DDD");
  want("a refused share basis, no cover count or no close is not ranked", !r.includes("ADS1") && !r.includes("NOCOVER") && !r.includes("NOCLOSE"));
  want("SPCX is held out (dated)", !r.includes("SPCX") && L.CAP_RANK_HOLD_OUT.has("SPCX"));
  want("at most n", L.rankByCap(ROWS, EOD, 2).join() === "BRK-B,AAA");
  want("the dashed spelling, once", r.filter((s) => s === "BRK-B").length === 1 && !r.includes("BRK.B"));
  want("the slice is the top 300", L.TOP_BY_CAP === 300);
  return fails;
}

function sourceRules({ builder, cap, preset }) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const b = stripComments(builder, { file: BUILDER });
  const order = ["fillSlots(PRESET_UNIVERSE, PRESET_UNIVERSE.length);", "fillSlots(topByCap, TOP_BY_CAP);", "fillSlots(popularSearchSymbols, POPULAR_SEARCH_QUOTA);", "fillSlots(dynamicUniverse, UNIVERSE_CAP);"].map((x) => b.indexOf(x));
  want("preset, then the size slice, then searches, then dynamic", order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]));
  want("the slice is read from topByCap", /const topByCap = await readTopByCap\(TOP_BY_CAP\);/.test(b));
  want("one slot per symbol whatever its spelling", /if \(slotSpellings\.has\(toDashed\(s\)\)\) continue;/.test(b) && /slotSpellings\.add\(toDashed\(s\)\)/.test(b));
  want("MS is in the preset", /"MS"/.test(stripComments(preset, { file: PRESET })));
  return fails;
}

try {
  const libSrc = read(LIB);
  console.log("\n1. The ranking, on fixtures");
  const l = rules(await load(libSrc));
  check("shares x close, refusals out, SPCX held out, dashed, top n", l.length === 0, l.join("; "));
  console.log("\n2. Source");
  const srcs = { builder: read(BUILDER), cap: read(CAP_FILE), preset: read(PRESET) };
  const s = sourceRules(srcs);
  check("fill order; one slot per spelling; MS in the preset", s.length === 0, s.join("; "));

  console.log("\n3. Planted mutants");
  const LM = [
    ["SPCX ranked", 'new Set(["SPCX"])', "new Set([])"],
    ["a refused basis ranked on raw shares", "    const cap = secCapAndPe(row, close).marketCap;", "    const cap = (row.inputs.shares?.val ?? 0) * close;"],
    ["smallest first", "  capped.sort((a, b) => b.cap - a.cap || a.sym.localeCompare(b.sym));", "  capped.sort((a, b) => a.cap - b.cap || a.sym.localeCompare(b.sym));"],
    ["the store's dotted spelling kept", "    const sym = toDashed(field);", "    const sym = field;"],
  ];
  for (const [label, from, to] of LM) {
    if (!libSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = rules(await load(libSrc.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SM = [
    ["the size slice after the dynamic universe", "builder", "  fillSlots(topByCap, TOP_BY_CAP);\n  fillSlots(popularSearchSymbols, POPULAR_SEARCH_QUOTA);", "  fillSlots(popularSearchSymbols, POPULAR_SEARCH_QUOTA);"],
    ["spellings counted twice", "builder", "      if (slotSpellings.has(toDashed(s))) continue;\n", ""],
    ["MS dropped from the preset", "preset", '  "MS",\n', ""],
  ];
  for (const [label, which, from, to] of SM) {
    if (!srcs[which].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let m = srcs[which].replace(from, to);
    if (label === "the size slice after the dynamic universe") m = m.replace("  fillSlots(dynamicUniverse, UNIVERSE_CAP);", "  fillSlots(dynamicUniverse, UNIVERSE_CAP);\n  fillSlots(topByCap, TOP_BY_CAP);");
    const f = sourceRules({ ...srcs, [which]: m });
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
