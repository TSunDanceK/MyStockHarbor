// "RATE, NOT RUNNING TOTAL" DIVIDEND FILERS (#552 COWORK #206 item 2). READ-ONLY.
// BKNG files its dividend per share as the quarter's RATE in every frame, so
// FY − 9M and 6M − 3M difference to $0 (CODE-A #225). Over every stored set,
// on today's share basis (splitAdjusted, as every reader sees it):
//   1. the year's FILED dividend against the same fiscal year's FILED Q1:
//      ≈ 4× a running-total filer, ≈ 1× a rate filer, ≈ 2× likely semi-annual;
//   2. for the rate filers, how many stored quarters are differenced (and
//      would change), and how many read ≤ 0;
//   3. the top-200 cut among them;
//   4. CROSS-BASIS differencing: a differenced dividend or EPS quarter in a
//      fiscal year whose quarters straddle a proven split (some moved by
//      splitAdjusted, some not), as BKNG's Q3 2025.
// Store: SCAN + MGET only. Anything else is refused. No SEC requests.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["scan", "mget"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  } else if (!url.startsWith("data:")) throw new Error("read guard: only the store may be reached");
  return realFetch(input, init);
};
const { cell } = await import("../lib/server/secFactCodec.ts");
const { splitAdjusted } = await import("../lib/server/secSplitAdjust.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!FACTS) { console.error("FATAL: the facts prefix moved"); process.exit(2); }
const CUT = new Set(JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols);
const redis = Redis.fromEnv();
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");

const DPS = "dividendsDeclaredPerShare";
const f2 = (v) => (typeof v === "number" ? v.toFixed(4) : "—");
const bucket = { rate: [], semi: [], running: [], other: [] };
const crossBasis = [];
let sets = 0, withDps = 0;
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => {
    const filed = raw[j];
    if (!filed?.quarters?.length || !filed?.years?.length) return;
    sets++;
    const sym = k.slice(FACTS.length + 1);
    const set = splitAdjusted(filed);
    const moved = new Set(set.spa?.adjusted ?? []);
    // ── 1. the newest year with a filed dividend AND its filed Q1 ──
    const years = [...set.years].sort((a, b) => (a.e < b.e ? 1 : -1));
    let verdict = null;
    for (const y of years) {
      const fy = cell(y, DPS);
      if (fy.derived !== "as-filed" || !(fy.val > 0) || y.fy == null) continue;
      const q1 = set.quarters.find((p) => p.fy === y.fy && p.fp === "Q1");
      const c1 = q1 ? cell(q1, DPS) : null;
      if (!c1 || c1.derived !== "as-filed" || !(c1.val > 0)) continue;
      const r = fy.val / c1.val;
      const kind = r >= 0.8 && r <= 1.25 ? "rate" : r >= 1.7 && r <= 2.4 ? "semi" : r >= 3.2 && r <= 5 ? "running" : "other";
      const qs = set.quarters.filter((p) => cell(p, DPS).val != null);
      const diffd = qs.filter((p) => cell(p, DPS).derived === "differenced");
      const nonPos = diffd.filter((p) => !(cell(p, DPS).val > 0));
      verdict = { sym, cut: CUT.has(sym), fy: y.fy, ratio: r, fyVal: fy.val, q1: c1.val, quarters: qs.length, differenced: diffd.length, nonPositive: nonPos.length };
      bucket[kind].push(verdict);
      break;
    }
    if (verdict) withDps++;
    // ── 4. cross-basis differencing ──
    if (moved.size) {
      const byFy = new Map();
      for (const p of set.quarters) { if (p.fy == null) continue; const l = byFy.get(p.fy) ?? []; l.push(p); byFy.set(p.fy, l); }
      for (const [fy, qs] of byFy) {
        const states = new Set(qs.map((p) => moved.has(p.e)));
        if (states.size < 2) continue; // the year sits wholly on one basis
        for (const p of qs) {
          for (const key of [DPS, "epsDiluted"]) {
            const c = cell(p, key);
            if (c.derived !== "differenced" || c.val == null) continue;
            const prior = qs.filter((x) => x.e < p.e).sort((a, b) => (a.e < b.e ? 1 : -1))[0];
            if (!prior || moved.has(prior.e) === moved.has(p.e)) continue;
            crossBasis.push(`${sym}${CUT.has(sym) ? "*" : ""} FY${fy} ${p.fp} ${key}: ${f2(c.val)} (quarter ${moved.has(p.e) ? "moved" : "as filed"}, the quarter before it ${moved.has(prior.e) ? "moved" : "as filed"})`);
          }
        }
      }
    }
  });
}
console.log(`stored sets with quarters and years: ${sets} · with a filed annual dividend and filed Q1 in the same year: ${withDps}`);
console.log(`ratio of the year's filed dividend to its filed Q1: rate (0.8–1.25×) ${bucket.rate.length} · semi-annual-like (1.7–2.4×) ${bucket.semi.length} · running total (3.2–5×) ${bucket.running.length} · other ${bucket.other.length}`);
const show = (list) => list.sort((a, b) => (a.sym < b.sym ? -1 : 1)).forEach((v) =>
  console.log(`  ${v.sym}${v.cut ? "*" : ""} FY${v.fy}: year ${f2(v.fyVal)} / Q1 ${f2(v.q1)} = ${v.ratio.toFixed(2)}× · quarters with a dividend ${v.quarters}, differenced ${v.differenced}, of which ≤ 0: ${v.nonPositive}`));
console.log(`\nRATE FILERS (${bucket.rate.length}; * = top-200 cut, ${bucket.rate.filter((v) => v.cut).length} of them):`);
show(bucket.rate);
console.log(`  quarters that would change (differenced dividend cells on rate filers): ${bucket.rate.reduce((s, v) => s + v.differenced, 0)}, of which ≤ 0 today: ${bucket.rate.reduce((s, v) => s + v.nonPositive, 0)}`);
console.log(`\nSEMI-ANNUAL-LIKE (${bucket.semi.length}), for contrast:`);
show(bucket.semi);
console.log(`\nOTHER RATIOS (${bucket.other.length}):`);
show(bucket.other);
console.log(`\nCROSS-BASIS DIFFERENCED QUARTERS (${crossBasis.length}):`);
crossBasis.forEach((x) => console.log("  " + x));
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
