// DO THE QUARTERS ADD UP TO THE YEAR? (audit r5, item 3). Reads only.
//
// Every stored set in the Pickers universe, as the earnings page renders it.
// For each fiscal year row whose span the stored quarters cover, the quarter
// rows inside it are collected and:
//   SUM   revenue / net income: Q1+Q2+Q3+Q4 against the year, flagged when
//         off by more than 0.5% of the year (both sides present);
//   SHORT fewer than four quarter rows inside a covered year.
// Each flag carries the quarters' derivation codes (F filed, D differenced,
// C computed, W withheld), so a derived Q4 is visible as such.
//   relay task: write-quarter-sum-sweep  (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const F = await lift(fs.readFileSync("lib/server/secFields.ts", "utf8"));
const KEYS = F.SEC_FIELD_KEYS;
const redis = Redis.fromEnv();
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SYMBOLS_KEY = keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!SYMBOLS_KEY || !FACTS || !KEYS?.length) { console.error("FATAL: key names not readable"); process.exit(2); }

const u = ((await redis.get(SYMBOLS_KEY)) ?? []).map((s) => String(s).toUpperCase());
const sets = new Map();
for (let i = 0; i < u.length; i += 25) {
  const chunk = u.slice(i, i + 25);
  const vals = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => { if (vals[j]) sets.set(s, vals[j]); });
}
const day = (d) => Date.parse(d) / 864e5;
const FIELDS = ["revenue", "netIncome"];
const sumFlags = [], shortFlags = [];
let yearsChecked = 0;
for (const [sym, set] of sets) {
  const qs = (set.quarters ?? []).filter((q) => q.s && q.e);
  const ys = (set.years ?? []).filter((y) => y.s && y.e);
  if (!qs.length) continue;
  const oldestQ = qs.reduce((m, q) => (q.s < m ? q.s : m), qs[0].s);
  for (const y of ys) {
    if (day(y.s) < day(oldestQ) - 5) continue; // the quarter window does not reach this year
    const inside = qs.filter((q) => day(q.e) > day(y.s) && day(q.e) <= day(y.e) + 5 && day(q.s) >= day(y.s) - 5).sort((a, b) => a.e.localeCompare(b.e));
    yearsChecked++;
    const label = `FY ${y.s}..${y.e}`;
    if (inside.length < 4) { shortFlags.push(`${sym}\t${label}\t${inside.length} quarter row(s): ${inside.map((q) => `${q.s}..${q.e}`).join(", ") || "none"}`); }
    if (inside.length !== 4) continue;
    for (const f of FIELDS) {
      const i = KEYS.indexOf(f);
      const yv = y.v[i];
      const qv = inside.map((q) => q.v[i]);
      if (yv == null || qv.some((v) => v == null)) continue;
      const sum = qv.reduce((a, b) => a + b, 0);
      const off = Math.abs(sum - yv) / Math.max(Math.abs(yv), 1);
      if (off > 0.005) {
        const codes = inside.map((q) => q.d?.[i] ?? "?").join("");
        sumFlags.push(`${sym}\t${f}\t${label}\tyear ${(yv / 1e6).toFixed(1)}M\tquarters ${qv.map((v) => (v / 1e6).toFixed(1)).join(" + ")} = ${(sum / 1e6).toFixed(1)}M\toff ${(off * 100).toFixed(2)}%\tcodes ${codes}`);
      }
    }
  }
}
console.log(`Pickers universe: ${u.length}; stored sets read: ${sets.size}; fiscal years covered by quarter rows: ${yearsChecked}`);
console.log(`\nSUM: quarters vs year off by more than 0.5% (revenue, net income): ${sumFlags.length} cell(s), ${new Set(sumFlags.map((l) => l.split("\t")[0])).size} filer(s)`);
console.log("symbol\tfield\tyear\tyear value\tquarters\toff\tcodes (Q1..Q4: F filed, D differenced, C computed, W withheld)");
for (const l of sumFlags.sort()) console.log(l);
console.log(`\nSHORT: covered fiscal years with fewer than four quarter rows: ${shortFlags.length}, ${new Set(shortFlags.map((l) => l.split("\t")[0])).size} filer(s)`);
for (const l of shortFlags.sort()) console.log(l);
