// A RE-CONVERTED SET IS NOT A SILENT RESTATEMENT (#552 COWORK #157 §3).
//
// On 5 Oct the FRED switch moved six foreign filers' converted values by
// 0.01–0.05% (KEP, HMY, WF, SHG, VNET, XPEV) and sec-facts logged each as a
// SILENT RESTATEMENT with `from` equal to `to`: the content hash, taken on the
// reporting-currency figures, had not moved. RUN here on the shipped
// isSilentRestatement and restatedPeriods (lifted from the route), with two
// fixtures built from the committed AAPL fact set:
//   1. FX ONLY: the same reported figures (so the same contentHash) with every
//      stored value re-converted by +0.03% — the overlap moves, the warning
//      does NOT fire;
//   2. A REAL RESTATEMENT (RMD-style): one net income moved, so the hash moves
//      (recomputed with the shipped contentHashOf) — the warning DOES fire;
//   3. the existing exclusions still hold: no prior, an empty overlap, or a
//      symbol already queued for reverify (needsReverify) never fire;
//   4. the route logs through it, and only through it.
// A mutation for each.
//
//   node scripts/check-silent-restatement.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  if (src.split(from).length !== 2) throw new Error(`mutation anchor must match once: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const ROUTE = "app/api/jobs/sec-facts/route.ts";
const RAW = readCodeOnly(ROUTE);
const load = (src) => {
  const restated = grabFunction(src, "restatedPeriods");
  const silent = grabFunction(src, "isSilentRestatement");
  if (!restated || !silent) throw new Error("could not lift restatedPeriods / isSilentRestatement");
  return lift([readCodeOnly("lib/server/secFields.ts"), restated.replace("export function", "function"),
    silent.replace("export function", "function"), "export { restatedPeriods, isSilentRestatement };"].join("\n"));
};
const { contentHashOf } = await import("../lib/server/secFactCodec.ts");

const prior = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
// 1. FX ONLY: stored values re-converted, reported figures (and so the hash) unchanged.
const fxOnly = clone(prior);
for (const list of [fxOnly.quarters, fxOnly.years, fxOnly.instants]) for (const p of list ?? []) p.v = p.v.map((v) => (typeof v === "number" ? v * 1.0003 : v));
// 2. A REAL RESTATEMENT: one filed net income moved; the hash moves with it.
const restated = clone(prior);
{
  const q = restated.quarters.at(-1);
  const idx = q.v.findIndex((v) => typeof v === "number" && v > 1e9);
  q.v[idx] = q.v[idx] - 293000;
  const { contentHash: _h, ...rest } = restated;
  restated.contentHash = contentHashOf(rest);
}

const RULES = {
  "1. FX only (same hash, overlap moved by +0.03%): NOT logged": (M) =>
    M.restatedPeriods(prior, fxOnly).length > 0 && fxOnly.contentHash === prior.contentHash
    && M.isSilentRestatement(prior, fxOnly, M.restatedPeriods(prior, fxOnly), false) === false,
  "2. a real restatement (one filed figure moved, hash moved): logged": (M) =>
    restated.contentHash !== prior.contentHash && M.restatedPeriods(prior, restated).length > 0
    && M.isSilentRestatement(prior, restated, M.restatedPeriods(prior, restated), false) === true,
  "3. no prior, an empty overlap, or already queued for reverify: never logged": (M) =>
    M.isSilentRestatement(null, restated, ["x"], false) === false
    && M.isSilentRestatement(prior, restated, [], false) === false
    && M.isSilentRestatement(prior, restated, M.restatedPeriods(prior, restated), true) === false,
};
const SOURCE_RULES = {
  "4. the route logs SILENT RESTATEMENT only through isSilentRestatement": (src) =>
    /if \(isSilentRestatement\(prior, set, movedPeriods, Boolean\(entry\?\.needsReverify\)\)\) \{\s*console\.warn\(\s*"\[sec-facts\] SILENT RESTATEMENT"/.test(src)
    && (src.match(/SILENT RESTATEMENT"/g) ?? []).length === 1,
};

const M0 = await load(RAW);
console.log("the shipped rule, on fixtures from the committed AAPL set");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(M0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}
for (const [name, rule] of Object.entries(SOURCE_RULES)) check(name, rule(RAW));

console.log("\nmutants: each must break a rule");
const MUTANTS = [
  ["the hash test removed (FX noise logged again)", once("  return prior.contentHash !== next.contentHash;", "  return true;")],
  ["the warning silenced outright", once("  return prior.contentHash !== next.contentHash;", "  return false;")],
  ["needsReverify ignored", once("if (!prior || !movedPeriods.length || needsReverify) return false;", "if (!prior || !movedPeriods.length) return false;")],
];
for (const [label, mutate] of MUTANTS) {
  let bites = false;
  try {
    const M = await load(mutate(RAW));
    bites = Object.values(RULES).some((r) => { try { return !r(M); } catch { return true; } });
  } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, bites);
}
check("MUTATION: the route back to the old condition → caught",
  !SOURCE_RULES["4. the route logs SILENT RESTATEMENT only through isSilentRestatement"](
    RAW.replace("if (isSilentRestatement(prior, set, movedPeriods, Boolean(entry?.needsReverify))) {", "if (prior && movedPeriods.length && !entry?.needsReverify) {")));

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
