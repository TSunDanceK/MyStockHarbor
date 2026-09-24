// The SEC-listing delisting signal (Relay B, #553 COWORK #20).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE FOUR COME BACK. BK, EQR, EA and WBS sat in the Pickers universe for
//      weeks because every eviction signal was FMP's. The SEC pass must name
//      them from the real committed ticker file.
//   2. A LIVE COMPANY IS EVICTED. BRK.B against SEC's "BRK-B" (spelling), a
//      recent IPO absent from the committed seed (only the live map counts), a
//      truncated map that still passes validation (the mass-absence refusal).
//   3. A STALE MAP ACTS.
//   4. A PRESET IS EVICTED instead of shouted about (the one gate).
//   5. THE WIRING: the pass nested back under the FMP screener branch (so it
//      dies with FMP on 14 Oct), or it detects and never evicts.
//
// Runs the real modules, then every assertion again on mutants; each must be
// caught.
//
//   node scripts/check-sec-delisting.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LISTING = "lib/server/secListing.ts";
const EVICTION = "lib/server/symbolEviction.ts";
const ROUTE = "app/api/jobs/warm-screener-fundamentals/route.ts";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-secdl-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// The real committed SEC file as the "live" map: it omits the four, as the
// relay census measured the live map to (2026-09-24).
const T = await import("../lib/server/secTickerMap.ts");
const file = T.loadTickerMap();
if (!file.present) throw new Error(`committed ticker file not loadable: ${file.error}`);
const live = { map: file.map, source: "redis", stale: false };

const FOUR = ["BK", "EQR", "EA", "WBS"];
const ALIVE = ["AAPL", "BRK.B", "BRK-B", "BNY", "VMRK", "MSFT", "GOOGL"];

async function suite(L, E, route) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  const v = L.secUnlistedSymbols([...ALIVE, ...FOUR, " bk "], live);
  ok("the pass runs on a fresh live map", v.skipped === null, JSON.stringify(v));
  ok("exactly the four are named", JSON.stringify([...v.unlisted].sort()) === JSON.stringify([...FOUR].sort()), JSON.stringify(v.unlisted));
  ok("BRK.B is found under SEC's BRK-B", !v.unlisted.includes("BRK.B"));

  ok("the committed seed never acts (a new IPO is absent from it while alive)",
    L.secUnlistedSymbols(FOUR, { ...live, source: "committed-file" }).skipped === "map-not-live");
  ok("no map, no action", L.secUnlistedSymbols(FOUR, { ...live, source: "none" }).skipped === "map-not-live");
  ok("a stale live map does not act", L.secUnlistedSymbols(FOUR, { ...live, stale: true }).skipped === "map-stale");
  ok("an empty map does not act", L.secUnlistedSymbols(FOUR, { ...live, map: new Map() }).skipped === "map-empty");

  // A map that lost a slice of its tickers: 30 of a 700-name universe absent.
  const universe = [...file.map.keys()].slice(0, 700);
  const truncated = new Map([...file.map].filter(([t]) => !universe.slice(0, 30).includes(t)));
  const mass = L.secUnlistedSymbols(universe, { ...live, map: truncated });
  ok("a mass absence is the map's fault: refused, nothing named", mass.skipped === "map-suspect" && mass.unlisted.length === 0, JSON.stringify({ skipped: mass.skipped, n: mass.unlisted.length }));
  const few = new Map([...file.map].filter(([t]) => !universe.slice(0, 8).includes(t)));
  ok("a handful absent from a 700 universe still acts", L.secUnlistedSymbols(universe, { ...live, map: few }).unlisted.length === 8);

  ok("an unlisted non-preset is evicted", E.secListingEvictionAction("BK", true) === "evict");
  ok("an unlisted preset is a hand edit, never an eviction", E.secListingEvictionAction("AAPL", true) === "hand-edit");
  ok("a listed symbol is kept", E.secListingEvictionAction("BK", false) === "keep");

  // Wiring: outside the screener branch, and it evicts.
  const passAt = route.indexOf("secUnlistedSymbols(universe, await resolveTickerMap())");
  const branchEnd = route.indexOf("if (sweep.skipped) {");
  ok("the route runs the SEC pass", passAt > 0);
  ok("the SEC pass sits AFTER the FMP branch closes (it must survive FMP's end)", passAt > branchEnd && branchEnd > 0);
  ok("it asks the one preset gate", /secListingEvictionAction\(symbol, true\)/.test(route));
  ok("it evicts and deregisters what it names",
    /const evicted = await evictSymbol\(symbol\);[\s\S]{0,120}sweep\.evictedBySecListing\+\+/.test(route) && /await deregisterSymbols\(secEvicted\)/.test(route));
  ok("the run record carries the names and the skip reason", /secUnlisted: sweep\.secUnlisted\.join/.test(route) && /secSweepSkipped: sweep\.secSkipped/.test(route));
  return fails;
}

const listingSrc = read(LISTING);
const evictionSrc = read(EVICTION);
const routeCode = readCodeOnly(ROUTE);

const base = await suite(await loadSibling(LISTING, listingSrc), await loadSibling(EVICTION, evictionSrc), routeCode);
if (base.length) {
  console.error("FAIL check-sec-delisting:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return src.replace(from, () => to);
};
const MUTANTS = [
  ["the committed seed accepted", () => [mut("source", listingSrc, `if (live.source !== "redis")`, `if (live.source === "none")`), evictionSrc, routeCode]],
  ["a stale map accepted", () => [mut("stale", listingSrc, `if (live.stale) return { skipped: "map-stale", unlisted: [] };`, ""), evictionSrc, routeCode]],
  ["the mass-absence refusal removed", () => [mut("cap", listingSrc, `if (unlisted.length > cap)`, `if (false)`), evictionSrc, routeCode]],
  ["exact-spelling lookup (BRK.B misses BRK-B)", () => [mut("spell", listingSrc, `!lookupBySpelling(live.map, s)`, `!live.map.has(s)`), evictionSrc, routeCode]],
  ["the preset gate bypassed", () => [listingSrc, mut("gate", evictionSrc, `return actionFor(unlisted, symbol, presets);`, `return unlisted ? "evict" : "keep";`), routeCode]],
  ["the pass nested under the FMP branch", () => {
    const CALL = "secUnlistedSymbols(universe, await resolveTickerMap())";
    const moved = mut("nest", routeCode, CALL, "null").replace("if (sweep.skipped) {", () => `${CALL};\n  if (sweep.skipped) {`);
    return [listingSrc, evictionSrc, moved];
  }],
  ["detects but never evicts", () => [listingSrc, evictionSrc, mut("evict", routeCode, `if (action === "evict") {\n        const evicted = await evictSymbol(symbol);\n        sweep.evicted.push(symbol);\n        sweep.evictedBySecListing++;`, `if (action === "evict") {\n        sweep.evictedBySecListing++;`)]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [l, e, r] = make();
  const fails = await suite(await loadSibling(LISTING, l), await loadSibling(EVICTION, e), r);
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-sec-delisting: the four named, ${ALIVE.length} live names kept; ${MUTANTS.length} mutants caught`);
