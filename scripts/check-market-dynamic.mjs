// THE MARKET STATE FROM THE NIGHTLY BARS (#553 COWORK #173, built per #190).
//
// Runtime, on fixtures (lib/server/marketDynamic.ts):
//   1. eligible: a bar on the session itself, a close of at least MIN_PRICE,
//      a dollar volume of at least MIN_DOLLAR_VOLUME
//   2. topTraded by DOLLAR volume; topMovers by |1-day %|; topRanges empty
//   3. dynamicSymbols: the top traded plus the top movers, once each, dashed
//   4. the readers' snapshot: the stored value when fresh; null when absent,
//      malformed, empty or older than MARKET_DYNAMIC_MAX_AGE_DAYS
// Source:
//   5. readMarketState reads the new key first and falls back to the old one;
//      tiingo-eod writes it on a complete night only.
// Every rule has a planted mutant.
//
//   node scripts/check-market-dynamic.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const LIB = "lib/server/marketDynamic.ts";
const STATE = "lib/server/marketState.ts";
const JOBS = "lib/server/marketData/jobs.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function load(src) {
  const f = path.join(ROOT, "lib", "server", `.check-md-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

const ASOF = "2026-10-06";
const two = (prev, close, volume, last = ASOF) => [["2026-10-05", prev, prev, prev, prev, volume], [last, close, close, close, close, volume]];

function rules(M) {
  const fails = [];
  const want = (label, ok, d = "") => { if (!ok) fails.push(`${label}${d ? ` (${d})` : ""}`); };
  const bars = new Map([
    ["BIGCAP", two(100, 101, 2e6)],      // $202M traded, +1%
    ["PENNY", two(2, 2.9, 5e8)],         // under $3: out, however many shares
    ["THIN", two(50, 60, 1e5)],          // $6M traded: out, despite +20%
    ["MOVER", two(10, 13, 3e6)],         // $39M, +30%
    ["STALE", two(10, 20, 9e6, "2026-10-03")], // no bar on the session: out
    ["SHARES", two(5, 5.1, 3e7)],        // most shares ($153M), fewer dollars than BIGCAP
    ["BRK.B", two(400, 404, 1e6)],       // dotted field, $404M
    ["FALLER", two(20, 12, 2.5e6)],      // $30M, -40%: the biggest move is a fall
  ]);
  const v = M.buildMarketDynamic(bars, ASOF, "t");
  const syms = v.dynamicSymbols;
  want("a penny stock, a thin listing and a stale bar are not eligible", !syms.includes("PENNY") && !syms.includes("THIN") && !syms.includes("STALE"), syms.join());
  want("top traded by dollar volume, not shares", v.topTraded.map((r) => r.symbol).join() === "BRK-B,BIGCAP,SHARES,MOVER,FALLER", v.topTraded.map((r) => r.symbol).join());
  want("top movers by |1-day %|: a 40% fall before a 30% rise", v.topMovers[0]?.symbol === "FALLER" && v.topMovers[1]?.symbol === "MOVER" && Math.abs(v.topMovers[1].changePct - 30) < 1e-9);
  want("topRanges stays empty (rangePct null)", v.topTraded.every((r) => r.rangePct === null));
  want("the dynamic symbols once each, dashed", syms.join() === "BIGCAP,BRK-B,FALLER,MOVER,SHARES");
  want("rows keep the snapshot shape (no dollarVolume field)", v.topTraded.every((r) => !("dollarVolume" in r)));
  // The readers' snapshot.
  const now = Date.parse(`${ASOF}T12:00:00Z`);
  const snap = M.snapshotFromDynamic(JSON.parse(JSON.stringify(v)), now);
  want("a fresh value becomes the snapshot", snap && snap.dynamicSymbols.join() === syms.join() && snap.dynamicUniverseSize === syms.length && Array.isArray(snap.topRanges) && snap.topRanges.length === 0);
  want("a stale value is not used", M.snapshotFromDynamic(v, now + (M.MARKET_DYNAMIC_MAX_AGE_DAYS + 1) * 86400000) === null);
  want("absent, malformed or empty is not used", M.snapshotFromDynamic(null, now) === null && M.snapshotFromDynamic({ v: 2 }, now) === null && M.snapshotFromDynamic({ ...v, dynamicSymbols: [] }, now) === null);
  return fails;
}

function sourceRules(state, jobs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const s = stripComments(state, { file: STATE });
  const j = stripComments(jobs, { file: JOBS });
  const newAt = s.indexOf("redis.get(MARKET_DYNAMIC_KEY)");
  const oldAt = s.indexOf("redis.get<StoredState>(REDIS_KEY)");
  want("readMarketState reads the new key first, then the old one", newAt > 0 && oldAt > newAt && /if \(fresh\) return fresh;/.test(s));
  want("tiingo-eod writes it on a complete night only", /const marketDynamic = complete \? await writeMarketDynamic\(r, bars, expected, nowMs\) : null;/.test(j));
  return fails;
}

try {
  const lib = read(LIB), state = read(STATE), jobs = read(JOBS);
  console.log("\n1-4. The rankings and the readers' snapshot");
  const r = rules(await load(lib));
  check("eligibility, dollar volume, movers, dynamic set, snapshot freshness", r.length === 0, r.join("; "));
  console.log("\n5. Source");
  const s = sourceRules(state, jobs);
  check("new key first with fallback; complete night only", s.length === 0, s.join("; "));

  console.log("\n6. Planted mutants");
  const LM = [
    ["ranked by shares", "const byTraded = [...rows].sort((a, b) => b.dollarVolume - a.dollarVolume", "const byTraded = [...rows].sort((a, b) => (b.volume as number) - (a.volume as number)"],
    ["penny stocks admitted", "if (!(close >= MIN_PRICE) || !(prev > 0) || !(volume > 0)) continue;", "if (!(prev > 0) || !(volume > 0)) continue;"],
    ["thin listings admitted", "if (!(dollarVolume >= MIN_DOLLAR_VOLUME)) continue;", ""],
    ["a stale bar admitted", "if (last[0] !== asOf) continue;", ""],
    ["movers ranked by signed change", "Math.abs(b.changePct as number) - Math.abs(a.changePct as number)", "(b.changePct as number) - (a.changePct as number)"],
    ["a stale value used", "nowMs - asOfMs > MARKET_DYNAMIC_MAX_AGE_DAYS * 86_400_000", "false"],
    ["the dotted spelling kept", "symbol: toDashed(String(field).trim().toUpperCase()),", "symbol: String(field).trim().toUpperCase(),"],
  ];
  for (const [label, from, to] of LM) {
    if (!lib.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = rules(await load(lib.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SM = [
    ["the old key read first", "state", "    const fresh = snapshotFromDynamic(await redis.get(MARKET_DYNAMIC_KEY), Date.now());\n    if (fresh) return fresh;\n", ""],
    ["written on a partial night", "jobs", "const marketDynamic = complete ? await writeMarketDynamic(r, bars, expected, nowMs) : null;", "const marketDynamic = await writeMarketDynamic(r, bars, expected, nowMs);"],
  ];
  for (const [label, which, from, to] of SM) {
    const srcs = { state, jobs };
    if (!srcs[which].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const m = { ...srcs, [which]: srcs[which].replace(from, to) };
    const f = sourceRules(m.state, m.jobs);
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
