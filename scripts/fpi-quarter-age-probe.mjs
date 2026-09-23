// #535 COWORK #19 §2: for every 20-F/40-F filer with a stored set, how old its
// newest structured quarter is, and the spacing of its stored quarters — so a
// 6-month rule's effect (and any half-yearly filer that would flip between
// layouts through the year) is measured, not assumed. Read-only.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
const reg = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const today = new Date().toISOString().slice(0, 10);
const syms = Object.entries(reg).filter(([, r]) => /^(20-F|40-F)/.test(r.annualForm ?? "")).map(([s]) => s);
const months = (a, b) => (Date.parse(b) - Date.parse(a)) / (30.44 * 86400000);
const rows = [];
for (let i = 0; i < syms.length; i += 25) {
  const chunk = syms.slice(i, i + 25);
  const sets = await redis.mget(...chunk.map((s) => `msh:sec:facts:v1:${s}`));
  chunk.forEach((s, k) => {
    const set = sets[k];
    if (!set) return rows.push({ s, form: reg[s].annualForm, set: false });
    const q = [...(set.quarters ?? [])].map((p) => p.e).sort().reverse();
    const gaps = q.slice(0, 6).map((e, j) => (j ? Math.round(months(e, q[j - 1])) : null)).filter((g) => g !== null);
    rows.push({ s, form: reg[s].annualForm, set: true, n: q.length, newest: q[0] ?? null, age: q[0] ? months(q[0], today) : null, gaps, years: (set.years ?? []).length, fy0: set.years?.[0]?.e ?? null });
  });
}
const withSet = rows.filter((r) => r.set);
const bucket = (r) => (r.age === null ? "none" : r.age <= 6 ? "<=6m" : r.age <= 18 ? "6-18m" : ">18m");
const count = {};
for (const r of withSet) count[bucket(r)] = (count[bucket(r)] ?? 0) + 1;
console.log(`20-F/40-F registrants ${syms.length}; with a stored set ${withSet.length}; today ${today}`);
console.log(`newest stored quarter age: ${JSON.stringify(count)}`);
console.log(`annual-only under 18m rule: ${withSet.filter((r) => r.years && (r.age === null || r.age > 18)).length}; under 6m rule: ${withSet.filter((r) => r.years && (r.age === null || r.age > 6)).length}`);
console.log("\nwithin 6 months (stay quarterly), with quarter spacing in months:");
for (const r of withSet.filter((r) => bucket(r) === "<=6m")) console.log(`  ${r.s} ${r.form} newest ${r.newest} (${r.age.toFixed(1)}m) n=${r.n} gaps ${r.gaps.join(",")}`);
console.log("\n6-18 months (flip to annual under the new rule):");
for (const r of withSet.filter((r) => bucket(r) === "6-18m")) console.log(`  ${r.s} ${r.form} newest ${r.newest} (${r.age.toFixed(1)}m) n=${r.n} gaps ${r.gaps.join(",")}`);
const halfYearly = withSet.filter((r) => r.gaps.length >= 2 && r.gaps.slice(0, 3).every((g) => g >= 5 && g <= 7));
console.log(`\nhalf-yearly cadence (first gaps ~6m): ${halfYearly.length}: ${halfYearly.map((r) => `${r.s}(${r.age.toFixed(1)}m)`).join(" ")}`);
