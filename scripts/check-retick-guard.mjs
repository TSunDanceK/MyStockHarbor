// A RETICKERED SYMBOL IS NEVER SENT TO TIINGO (#553 COWORK #70).
//
// BK and EQR sat in the price pool after SEC moved their CIKs to BNY and VMRK.
// Tiingo answered the dead tickers with an empty series and 5 stale rows, and
// we listed them as "tiingo-gap". The Tiingo universe now resolves each symbol
// SEC no longer lists through the rename sweep's rule (#593,
// planListingChanges): if the CIK it was last seen under lists another ticker,
// it is not sent.
//
//   1. retickeredOut, on SEC's committed ticker file: BK and EQR dropped (BNY,
//      VMRK named); AAPL, BNY, VMRK kept; a symbol with no CIK on record kept;
//      no ticker map -> guard off, nothing dropped.
//   2. jobs.ts's universe() sends only what retickeredOut keeps, and both jobs
//      record the dropped symbols.
//   MUTANTS: the guard returns every symbol (a dead ticker is sent); the
//   universe ignores the guard. Each must be caught.
//
//   node scripts/check-retick-guard.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const MODULE = "lib/server/marketData/universe.ts";
const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
let seq = 0;
async function load(source) {
  const file = path.join(ROOT, "lib/server/marketData", `.check-retick-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}
const { loadTickerMap } = await import(pathToFileURL(path.join(ROOT, "lib/server/secTickerMap.ts")).href);
const live = loadTickerMap();
// The CIKs the rename sweep last saw them under (SEC: BNY 1390777, VMRK 906107).
const LAST_SEEN = new Map([["BK", "0001390777"], ["EQR", "0000906107"]]);
const POOL = ["AAPL", "BK", "BNY", "EQR", "NOCIKX", "VMRK"];

function suite(mod) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const r = mod.retickeredOut(POOL, live, LAST_SEEN);
  ok("the guard is on with SEC's ticker file present", r.guard === "on", r.guard);
  ok("BK and EQR are not sent", !r.keep.includes("BK") && !r.keep.includes("EQR"), JSON.stringify(r.keep));
  ok("...and each names its live ticker (BNY, VMRK)",
    r.dropped.find((d) => d.symbol === "BK")?.listed.includes("BNY") && r.dropped.find((d) => d.symbol === "EQR")?.listed.includes("VMRK"), JSON.stringify(r.dropped));
  ok("AAPL, BNY and VMRK are sent", ["AAPL", "BNY", "VMRK"].every((s) => r.keep.includes(s)), JSON.stringify(r.keep));
  ok("a symbol with no CIK on record (an ETF, a fund) is left alone", r.keep.includes("NOCIKX"));
  const off = mod.retickeredOut(POOL, { present: false, map: new Map() }, LAST_SEEN);
  ok("no ticker map: the guard is off and says so, dropping nothing", off.guard !== "on" && off.keep.length === POOL.length, JSON.stringify(off));
  return fails;
}

console.log("\n1. retickeredOut, on SEC's committed ticker file");
check("SEC's ticker file is present and lists BNY and VMRK, not BK or EQR",
  live.present && live.map.has("BNY") && live.map.has("VMRK") && !live.map.has("BK") && !live.map.has("EQR"));
const base = suite(await load(src));
check("all assertions pass on the real module", base.length === 0, base.join("; "));

console.log("\n2. the universe sends only what the guard keeps");
const jobs = readCodeOnly("lib/server/marketData/jobs.ts");
const wired = (c) =>
  /const r = retickeredOut\(pool, live, lastSeen\);/.test(c) &&
  /return \{ symbols: r\.keep, retickered: r\.dropped\.map\(\(d\) => d\.symbol\), retickerGuard: r\.guard \};/.test(c) &&
  (c.match(/const \{ symbols, retickered, retickerGuard \} = await universe\(\);/g) ?? []).length === 2 &&
  (c.match(/\bretickered,\s*retickerGuard,/g) ?? []).length === 2;
check("universe() returns r.keep, and both jobs record what was dropped", wired(jobs));

console.log("\n3. mutants");
const m1 = src.replace("return { keep: symbols.filter((s) => !out.has(s)), dropped, guard: \"on\" };", "return { keep: symbols, dropped, guard: \"on\" };");
check("mutant applies: the guard keeps every symbol", m1 !== src);
check("mutant caught: a dead ticker (BK, EQR) is sent", (await suite(await load(m1))).length > 0);
const m2 = jobs.replace("return { symbols: r.keep,", "return { symbols: pool,");
check("mutant caught: the universe ignores the guard", m2 !== jobs && !wired(m2));

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
