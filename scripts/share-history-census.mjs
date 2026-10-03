// THE DILUTION CHART BEFORE AND AFTER #552 COWORK #136, ACROSS THE STORE.
//
// Read-only: 1 SMEMBERS on the fact-set index + one MGET per 100 sets. For
// every stored set, runs today's builder (main, kept as text beside this
// script) and this branch's, and reports how many draw, how many get a
// 3-year figure, and the span — split by whether the set has been re-read
// under #715 (sv:2, which carries the long annual history `as`). Then AAPL,
// BKNG and recent listings, before and after. Tickers and counts only.
//   relay task: write-share-history-census
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const man = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (name) => (man.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = pick("SEC_FACTS_PREFIX"), INDEX = pick("SEC_FACTS_INDEX_KEY");
if (!FACTS || !INDEX) { console.error("FATAL: key names not found"); process.exit(2); }

const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const FIELDS = readCodeOnly("lib/server/secFields.ts");
const SHIM = `const valueOf = (p, key) => { const i = SEC_FIELD_KEYS.indexOf(key); const v = p && p.v ? p.v[i] : null; return typeof v === "number" ? v : null; };`;
const load = (src) => lift(`${strip(FIELDS)}\n${SHIM}\n${strip(src)}`);
const Before = await load(fs.readFileSync("scripts/lib/share-history-before.ts.txt", "utf8"));
const After = await load(readCodeOnly("lib/server/secShareHistory.ts"));
const firstPeriodic = JSON.parse(fs.readFileSync("data/sec/first-periodic.json", "utf8")).rows ?? {};

const symbols = (await redis.smembers(INDEX)).map(String).sort();
let commands = 1;
const sets = new Map();
for (let i = 0; i < symbols.length; i += 100) {
  const chunk = symbols.slice(i, i + 100);
  const vals = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  commands++;
  chunk.forEach((s, j) => { if (vals[j]) sets.set(s, vals[j]); });
}

const tally = () => ({ sets: 0, drawn: 0, three: 0, notDrawn: 0, spanYears: [] });
const T = { before: { all: tally(), sv2: tally(), old: tally() }, after: { all: tally(), sv2: tally(), old: tally() } };
const add = (t, h) => {
  t.sets++;
  if (!h) return;
  if (h.withheld) { t.notDrawn++; return; }
  if (h.points.length >= 3) {
    t.drawn++;
    t.spanYears.push((Date.parse(h.points.at(-1).date) - Date.parse(h.points[0].date)) / (365.25 * 864e5));
    if (h.threeYear && h.threeYear.pct !== null) t.three++;
  }
};
const desc = (h) => !h ? "no chart (no series)" : h.withheld ? `Not drawn (${h.withheld.reason})` :
  `${h.points.length} points ${h.points[0].date}..${h.points.at(-1).date}; 3y ${h.threeYear?.pct != null ? h.threeYear.pct.toFixed(1) + "%" : "too short"}${h.yearEnds ? `; ${h.yearEnds.length} fiscal-year points` : ""}${h.refusedYears ? `; ${h.refusedYears.length} refused` : ""}`;
const recent = [];
for (const [sym, set] of sets) {
  const listedFrom = typeof firstPeriodic[sym] === "string" ? firstPeriodic[sym] : null;
  let b = null, a = null;
  try { b = Before.buildShareHistory(set, { listedFrom }); } catch { b = null; }
  try { a = After.buildShareHistory(set, { listedFrom }); } catch { a = null; }
  const group = set.sv === 2 ? "sv2" : "old";
  for (const [which, h] of [["before", b], ["after", a]]) { add(T[which].all, h); add(T[which][group], h); }
  if (listedFrom && listedFrom >= "2024-06-30") recent.push([sym, listedFrom, b, a]);
}
const med = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)].toFixed(1) : "-"; };
const line = (t) => `${t.sets} sets · drawn ${t.drawn} · 3-year figure ${t.three} (${t.sets ? ((100 * t.three) / t.sets).toFixed(1) : 0}%) · "Not drawn" ${t.notDrawn} · median span ${med(t.spanYears)} y`;
console.log(`stored sets read: ${sets.size} of ${symbols.length} indexed · Redis commands: ${commands}`);
for (const g of ["all", "sv2", "old"]) {
  console.log(`\n[${g === "all" ? "ALL SETS" : g === "sv2" ? "RE-READ UNDER #715 (sv:2)" : "NOT YET RE-READ"}]`);
  console.log(`  before: ${line(T.before[g])}`);
  console.log(`  after:  ${line(T.after[g])}`);
}
console.log("\nNAMED");
for (const sym of ["AAPL", "BKNG", "MSFT", "NVDA"]) {
  const set = sets.get(sym);
  if (!set) { console.log(`  ${sym}: not stored`); continue; }
  const listedFrom = typeof firstPeriodic[sym] === "string" ? firstPeriodic[sym] : null;
  console.log(`  ${sym} (sv ${set.sv ?? 1}, as ${set.as?.length ?? 0} years)`);
  console.log(`    before: ${desc(Before.buildShareHistory(set, { listedFrom }))}`);
  console.log(`    after:  ${desc(After.buildShareHistory(set, { listedFrom }))}`);
}
console.log(`\nRECENT LISTINGS (first periodic report on or after 2024-06-30): ${recent.length}`);
for (const [sym, lf, b, a] of recent.slice(0, 6)) console.log(`  ${sym} (from ${lf})\n    before: ${desc(b)}\n    after:  ${desc(a)}`);
