// Two measured command savings (#553 COWORK #53; CODE-B #39 "cheap wins").
//
//   1. clearAbsence: ~850 pipelined DELs a day (one per present symbol, most
//      of them for keys that do not exist) -> one multi-key DEL per 500 keys.
//      Upstash bills a pipeline per command and a multi-key DEL as one.
//   2. warm-fundamentals: ~850 SETs every hour -> only rows whose values
//      changed, or that were last written 12h+ ago (so the 26h TTL never runs
//      low). One chunked MGET decides.
//
// Section 1 runs the real pure decision; each mutant must be caught.
//
//   node scripts/check-cheap-wins.mjs
// fundamentalsCache reaches modules that use the "@/" alias and JSON imports.
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const MODULE = "lib/server/fundamentalsCache.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "lib/server", `.check-cw-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const NOW = Date.parse("2026-09-25T20:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3.6e6).toISOString();
const NEXT = { marketCap: 100, peRatio: 20, industry: "Semiconductors", sector: "Technology" };

async function suite(M, src) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const w = M.fundamentalRowNeedsWrite;
  ok("no stored row: write", w(null, NEXT, NOW) === true);
  ok("identical row written 1h ago: skip", w({ ...NEXT, updatedAt: hoursAgo(1) }, NEXT, NOW) === false);
  ok("identical row written 12h ago: rewrite (keeps the 26h TTL above 14h)", w({ ...NEXT, updatedAt: hoursAgo(12) }, NEXT, NOW) === true);
  ok("changed market cap: write", w({ ...NEXT, marketCap: 99, updatedAt: hoursAgo(1) }, NEXT, NOW) === true);
  ok("changed P/E: write", w({ ...NEXT, peRatio: 21, updatedAt: hoursAgo(1) }, NEXT, NOW) === true);
  ok("changed sector or industry: write",
    w({ ...NEXT, sector: "Energy", updatedAt: hoursAgo(1) }, NEXT, NOW) === true && w({ ...NEXT, industry: null, updatedAt: hoursAgo(1) }, NEXT, NOW) === true);
  ok("an unreadable updatedAt: write", w({ ...NEXT, updatedAt: "garbage" }, NEXT, NOW) === true);
  ok("the rewrite age is 12h", M.ROW_REWRITE_AFTER_MS === 12 * 3.6e6);
  ok("the warm uses the decision before every SET",
    /if \(!fundamentalRowNeedsWrite\(stored\.get\(sym\), row, Date\.parse\(now\)\)\) \{\s*unchanged\+\+;\s*continue;\s*\}\s*writePipeline\.set\(/.test(src));
  return fails;
}

let failures = 0;
const src = read(MODULE);
const base = await suite(await load(src), src);
console.log("=== 1. warm-fundamentals writes only what changed ===");
if (!base.length) console.log("  PASS  every assertion");
for (const f of base) console.log(`  FAIL  ${f}`);
failures += base.length;

console.log("\n=== 2. clearAbsence is one multi-key DEL per 500 ===");
const evict = read("lib/server/symbolEviction.ts");
const body = evict.slice(evict.indexOf("export async function clearAbsence"), evict.indexOf("export async function clearAbsence") + 1200);
const delOk = /await redis\.del\(\.\.\.keys\);/.test(body) && !/p\.del\(/.test(body) && /i \+= 500/.test(body);
console.log(`  ${delOk ? "PASS" : "FAIL"}  one DEL command per 500 keys, no per-key pipeline`);
if (!delOk) failures++;

console.log("\n=== 3. mutants (each must be caught) ===");
const MUTANTS = [
  ["unchanged rows are never rewritten (the TTL lapses)", "  if (!Number.isFinite(at) || nowMs - at >= ROW_REWRITE_AFTER_MS) return true;", "  if (!Number.isFinite(at)) return true;"],
  ["a market-cap change is missed", "    (prev.marketCap ?? null) !== next.marketCap ||\n", ""],
  ["every row is skipped", "    if (!fundamentalRowNeedsWrite(stored.get(sym), row, Date.parse(now))) {", "    if (true) {"],
  ["a missing row is skipped", "  if (!prev || typeof prev !== \"object\") return true;", "  if (!prev || typeof prev !== \"object\") return false;"],
];
for (const [label, from, to] of MUTANTS) {
  if (!src.includes(from)) {
    console.log(`  FAIL  mutant "${label}" no longer matches the source`);
    failures++;
    continue;
  }
  const mutated = src.replace(from, to);
  const fails = await suite(await load(mutated), mutated);
  console.log(`  ${fails.length ? "PASS" : "FAIL"}  mutant caught: ${label}${fails.length ? ` (${fails[0]})` : " — NOTHING FAILED"}`);
  if (!fails.length) failures++;
}
console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
