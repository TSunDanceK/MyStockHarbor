// TTM EPS, MEASURED BEFORE IT SHIPS (#552 COWORK #8/#9). Reads only.
//
// B's measurement (#553 CODE-B #3) found valuationInputs() falling back to the
// latest FISCAL YEAR's EPS for most filers, because the fiscal Q4 inside every
// trailing window has no filed EPS. This compares, over the price-pool
// universe B measured:
//
//   old   the previous rule, re-stated here: four quarters with filed EPS, else
//         the newest fiscal year (whatever its age)
//   (a)   the shipped valuationInputs(): Q4 derived as FY - (Q1+Q2+Q3) under
//         derivedQ4Eps's guards; annual-only filers (#548) keep the year
//   (b)   TTM net income / diluted weighted shares, over the same four
//         quarters (Q4's shares taken from its fiscal year)
//
// and splits the old fiscal-year fallbacks into annual-only filers (correct)
// vs quarterly filers whose newest quarter is newer than the year (the bug).
//
// THE REFERENCE IS PRODUCTION'S CURRENT EPS FIGURE (the stock-data record the
// picker pages read, as B's script did). It is compared IN AGGREGATE ONLY: no
// per-ticker reference value is printed or stored (owner ruling, #552). The
// pinned rows print SEC-derived values only.
//
//   relay task: write-ttm-eps-measure  (credentialled for the read)
//   Redis cost: 1 HKEYS + 2 MGET per 25 symbols ≈ 70 commands, once.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const V = await import("../lib/server/secValuation.ts");
const { valueOf } = await import("../lib/server/secFactCodec.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const { annualOnlyForm } = await import("../lib/server/annualOnly.ts");
const { isConsecutive } = await import("../lib/server/secEarningsView.ts");

const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!FACTS) { console.error("FATAL: SEC_FACTS_PREFIX not readable"); process.exit(2); }
const PINNED = ["NVDA", "GOOGL", "MSFT", "XOM", "AMZN", "LLY", "AAPL", "TSM"];
const HASH = secFieldsHash();
let commands = 0;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

commands++;
const universe = (await redis.hkeys("msh:price-pool:v1")).map(String).sort();
const sets = new Map();
const ref = new Map();
let stale = 0;
for (let i = 0; i < universe.length; i += 25) {
  const chunk = universe.slice(i, i + 25);
  commands += 2;
  const [f, d] = await Promise.all([
    redis.mget(...chunk.map((s) => `${FACTS}:${s}`)),
    redis.mget(...chunk.map((s) => `msh:stockdata:v1:${s}`)),
  ]);
  chunk.forEach((s, j) => {
    const set = f[j];
    if (set && typeof set === "object" && Array.isArray(set.quarters)) {
      if (set.h === HASH) sets.set(s, set); else stale++;
    }
    const e = num(d[j]?.epsTtm);
    if (e !== null) ref.set(s, e);
  });
}

// ── old: the rule before this PR, re-stated ───────────────────────────────
function oldEps(set) {
  const four = set.quarters.slice(0, 4);
  if (four.length === 4 && four.every((q, i) => i === 0 || isConsecutive(four[i - 1], q))) {
    const v = four.map((q) => valueOf(q, "epsDiluted"));
    if (v.every((x) => x !== null)) return { val: v.reduce((a, b) => a + b, 0), basis: "four-quarters", periodEnd: four[0].e };
  }
  const y = set.years[0];
  const v = y ? valueOf(y, "epsDiluted") : null;
  return v === null ? null : { val: v, basis: "fiscal-year", periodEnd: y.e };
}

// ── (b): TTM net income / diluted weighted shares ─────────────────────────
function methodB(set) {
  const four = set.quarters.slice(0, 4);
  if (four.length < 4 || !four.every((q, i) => i === 0 || isConsecutive(four[i - 1], q))) return null;
  let ni = 0;
  const shares = [];
  for (const q of four) {
    const n = valueOf(q, "netIncome");
    if (n === null) return null;
    ni += n;
    let s = valueOf(q, "sharesDiluted");
    if (s === null && q.fp === "Q4") s = valueOf(set.years.find((y) => y.fy === q.fy && y.e === q.e), "sharesDiluted");
    if (s === null || s <= 0) return null;
    shares.push(s);
  }
  return ni / (shares.reduce((a, b) => a + b, 0) / 4);
}

// Why derivedQ4Eps refused, for the split of the refusals (diagnostic only).
function whyNoQ4(set) {
  const four = set.quarters.slice(0, 4);
  if (four.length < 4) return "fewer than four quarters stored";
  if (!four.every((q, i) => i === 0 || isConsecutive(four[i - 1], q))) return "a gap in the four quarters";
  const q4 = four.find((q) => valueOf(q, "epsDiluted") === null);
  if (!q4) return "none (all filed)";
  if (q4.fp !== "Q4") return `a ${q4.fp} without EPS`;
  if (set.cur && set.cur !== "USD") return "converted from another currency";
  const year = set.years.find((y) => y.fy === q4.fy && y.e === q4.e);
  if (!year) return "no fiscal-year row ending on Q4";
  if (valueOf(year, "epsDiluted") === null || valueOf(year, "sharesDiluted") === null) return "the year has no EPS or diluted shares";
  const parts = ["Q1", "Q2", "Q3"].map((fp) => set.quarters.find((p) => p.fy === q4.fy && p.fp === fp));
  if (parts.some((p) => !p)) return "Q1-Q3 of that year not all stored";
  if (parts.some((p) => valueOf(p, "epsDiluted") === null || valueOf(p, "sharesDiluted") === null)) return "Q1-Q3 missing EPS or shares";
  const ys = valueOf(year, "sharesDiluted");
  if (parts.some((p) => Math.abs(valueOf(p, "sharesDiluted") / ys - 1) > V.Q4_SHARE_BASIS_TOLERANCE)) return "share basis moved (split / class change)";
  return "other";
}

const within = (a, b, tol) => a !== null && b !== null && b !== 0 && Math.abs(a - b) / Math.abs(b) <= tol;
const tally = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

const oldBasis = new Map(), newBasis = new Map(), fySplit = new Map(), refusedWhy = new Map();
const agree = { old: [0, 0, 0], a: [0, 0, 0], b: [0, 0, 0] };
const aVsB = [0, 0, 0, 0, 0, 0];
const pinned = [];
for (const [s, set] of sets) {
  const filer = { annualForm: REG[s]?.annualForm ?? null };
  const annualOnly = annualOnlyForm(filer.annualForm, set, TODAY) !== null;
  const o = oldEps(set);
  const n = V.valuationInputs(set, TODAY, filer).eps;
  const b = annualOnly ? null : methodB(set);
  tally(oldBasis, o?.basis ?? "none");
  tally(newBasis, n ? (n.basis === "four-quarters" ? (n.derivedQ4 ? "four-quarters, Q4 derived" : "four-quarters, all filed") : annualOnly ? "fiscal-year (annual-only)" : "fiscal-year (it is the latest 12 months)") : "refused");
  if (o?.basis === "fiscal-year") {
    const newest = set.quarters[0]?.e ?? null;
    tally(fySplit, annualOnly ? "annual-only filer (correct as is)" : newest && newest > o.periodEnd ? "quarterly filer, year older than its newest quarter (the bug)" : "quarterly filer, the year IS its latest 12 months");
  }
  if (!n) tally(refusedWhy, annualOnly ? "annual-only, no FY EPS" : whyNoQ4(set));
  const r = ref.get(s) ?? null;
  for (const [k, v] of [["old", o?.val ?? null], ["a", n?.val ?? null], ["b", b]]) {
    if (v === null || r === null) continue;
    agree[k][0]++;
    if (within(v, r, 0.05)) agree[k][1]++;
    if (within(v, r, 0.2)) agree[k][2]++;
  }
  if (n?.basis === "four-quarters" && b !== null) {
    aVsB[0]++;
    [0.01, 0.02, 0.05, 0.1, 0.2].forEach((t, i) => { if (within(b, n.val, t)) aVsB[i + 1]++; });
  }
  if (PINNED.includes(s)) pinned.push({ s, o, n, b });
}

console.log(`universe (price pool): ${universe.length}; fact sets read: ${sets.size} (+${stale} on an older field hash, skipped); reference EPS present: ${ref.size}`);
console.log(`\nold basis: ${[...oldBasis].map(([k, v]) => `${k} ${v}`).join("; ")}`);
console.log(`old fiscal-year fallbacks, split (COWORK #9):`);
for (const [k, v] of fySplit) console.log(`  ${k}: ${v}`);
console.log(`\nnew basis: ${[...newBasis].map(([k, v]) => `${k} ${v}`).join("; ")}`);
console.log(`refused under the new rule, why:`);
for (const [k, v] of [...refusedWhy].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`\nagreement with production's current EPS figure (aggregate only):`);
for (const [k, label] of [["old", "old rule"], ["a", "(a) derived Q4 (shipped)"], ["b", "(b) NI / diluted shares"]]) {
  const [n, p5, p20] = agree[k];
  console.log(`  ${label}: n=${n}  ±5% ${pct(p5, n)}  ±20% ${pct(p20, n)}`);
}
console.log(`\n(a) vs (b) where both exist (n=${aVsB[0]}): within 1% ${pct(aVsB[1], aVsB[0])}; 2% ${pct(aVsB[2], aVsB[0])}; 5% ${pct(aVsB[3], aVsB[0])}; 10% ${pct(aVsB[4], aVsB[0])}; 20% ${pct(aVsB[5], aVsB[0])}`);
console.log(`\npinned (SEC values only): symbol | old | new (a) | (b)`);
const f = (e) => (e ? `${e.val.toFixed(2)} ${e.basis}${e.derivedQ4 ? ` (Q4 ${e.derivedQ4} derived)` : ""} to ${e.periodEnd}` : "refused");
for (const p of pinned.sort((x, y) => x.s.localeCompare(y.s))) {
  console.log(`  ${p.s} | ${f(p.o)} | ${f(p.n)} | ${p.b === null ? "—" : p.b.toFixed(2)}`);
}
const missing = PINNED.filter((s) => !sets.has(s));
if (missing.length) console.log(`  not in the read: ${missing.join(" ")}`);
console.log(`\nRedis commands used by this read: ${commands}`);
