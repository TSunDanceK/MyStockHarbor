// DERIVED Q4s THAT DON'T MATCH THEIR YEAR (#552 COWORK #196). READ-ONLY.
// Q4 is derived as FY − 9M. Where the year's line and the quarters' line cover
// different scopes (OXY: FY contract revenue narrower than its quarters), the
// difference under-reads Q4. Flag: a DIFFERENCED Q4 below 40% of the mean of
// the same fiscal year's other three quarters (and, for contrast, any above
// 250%). Revenue first; net income, operating income and operating cash flow
// counted alongside.
// Store: SCAN + MGET (fact sets). Anything else is refused. No SEC requests.
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
const { SEC_FIELD_INDEX } = await import("../lib/server/secFields.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!FACTS) { console.error("FATAL: the facts prefix moved"); process.exit(2); }
const CUT = new Set(JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols);
const redis = Redis.fromEnv();
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");
const FIELDS = ["revenue", "netIncome", "operatingIncome", "operatingCashFlow"];
const low = Object.fromEntries(FIELDS.map((f) => [f, []])), high = Object.fromEntries(FIELDS.map((f) => [f, []]));
let sets = 0, q4s = 0;
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => {
    const set = raw[j];
    if (!set?.quarters?.length) return;
    sets++;
    const sym = k.slice(FACTS.length + 1);
    const byFy = new Map();
    for (const p of set.quarters) { if (p.fy == null || !p.fp) continue; const m = byFy.get(p.fy) ?? {}; m[p.fp] = p; byFy.set(p.fy, m); }
    for (const [fy, m] of byFy) {
      const q4 = m.Q4; if (!q4 || !m.Q1 || !m.Q2 || !m.Q3) continue;
      for (const f of FIELDS) {
        const idx = SEC_FIELD_INDEX[f];
        if (idx == null || (q4.d ?? "")[idx] !== "D") continue;
        const v = q4.v?.[idx], o = [m.Q1, m.Q2, m.Q3].map((p) => p.v?.[idx]);
        if (typeof v !== "number" || o.some((x) => typeof x !== "number")) continue;
        if (f === "revenue") q4s++;
        const mean = (o[0] + o[1] + o[2]) / 3;
        if (!(mean > 0)) continue; // ratios only mean something on a positive base
        const r = v / mean;
        const row = `${sym}${CUT.has(sym) ? "*" : ""} FY${fy} Q4 ${(v / 1e6).toFixed(0)}M vs ${(mean / 1e6).toFixed(0)}M mean (${(r * 100).toFixed(0)}%)`;
        if (r < 0.4) low[f].push({ sym, fy, row });
        else if (r > 2.5) high[f].push({ sym, fy, row });
      }
    }
  });
}
console.log(`fact sets with quarters: ${sets} · differenced revenue Q4s with three sibling quarters: ${q4s} · (* = in the top-200 cut)`);
for (const f of FIELDS) {
  const L = low[f], H = high[f];
  const newest = (arr) => { const m = new Map(); for (const x of arr) if (!m.has(x.sym) || m.get(x.sym).fy < x.fy) m.set(x.sym, x); return [...m.values()]; };
  console.log(`\n${f.toUpperCase()}: Q4 < 40% of the other three: ${L.length} periods in ${new Set(L.map((x) => x.sym)).size} filers · > 250%: ${H.length} periods in ${new Set(H.map((x) => x.sym)).size} filers`);
  if (f === "revenue") {
    console.log("  under 40% (newest per filer):"); newest(L).sort((a, b) => (a.sym < b.sym ? -1 : 1)).forEach((x) => console.log("    " + x.row));
    console.log("  over 250% (newest per filer):"); newest(H).sort((a, b) => (a.sym < b.sym ? -1 : 1)).forEach((x) => console.log("    " + x.row));
  }
}
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
