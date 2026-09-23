// PICKER P/S CENSUS (#535 COWORK #12 item 2). Read-only.
//
// The pickers rank on FMP figures (msh:stockdata:v1:<SYM>: TTM revenue,
// operating income, net income, FMP's psRatio) and the price pool's market
// cap. Which rows would the shared predicate (secFields
// .revenueLineIncompleteValues: operating income above revenue; pre-tax is not
// in the FMP row) refuse, and do UDR / SOFI / MET trip it on FMP's figures?
// Also listed: rows whose TTM net income exceeds revenue (a >100% net margin),
// the other half of the symptom the page guard was built for.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

const src = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fnSrc = src.slice(src.indexOf("export function revenueLineIncompleteValues"));
const body = fnSrc.slice(0, fnSrc.indexOf("\n}\n") + 3);
const incomplete = body.includes("revenueLineIncompleteValues")
  ? (rev, op, pre) => { if (rev == null || rev <= 0) return false; if (op != null) return op > rev; return pre != null && pre > rev; }
  : null;
if (!incomplete) { console.error("FATAL: predicate not found"); process.exit(2); }

const keys = [];
let cursor = "0";
do { const [n, b] = await redis.scan(cursor, { match: "msh:stockdata:v1:*", count: 1000 }); keys.push(...b); cursor = String(n); } while (cursor !== "0");
const rows = new Map();
for (let i = 0; i < keys.length; i += 100) {
  const b = keys.slice(i, i + 100);
  const vals = await redis.mget(...b);
  b.forEach((k, j) => { if (vals[j]) rows.set(k.slice("msh:stockdata:v1:".length), vals[j]); });
}
const pool = (await redis.hgetall("msh:price-pool:v1")) ?? {};
const capOf = (s) => { const r = pool[s]; const o = typeof r === "string" ? JSON.parse(r) : r; return o?.marketCap ?? null; };
const fmt = (x) => (x == null ? "—" : `${(x / 1e6).toFixed(1)}M`);
const ps = (s, r) => { const cap = capOf(s); return cap != null && r.revenue > 0 ? cap / r.revenue : r.psRatio ?? null; };

console.log(`stockdata rows ${rows.size}; with revenue ${[...rows.values()].filter((r) => r.revenue != null).length}; with operating income ${[...rows.values()].filter((r) => r.operatingIncome != null).length}`);
const refused = [...rows].filter(([, r]) => incomplete(r.revenue, r.operatingIncome, null));
console.log(`\nREFUSED by the shared predicate (operating income > revenue): ${refused.length}`);
for (const [s, r] of refused.sort()) console.log(`  ${s.padEnd(7)} rev ${fmt(r.revenue)} op ${fmt(r.operatingIncome)} net ${fmt(r.netIncome)} · P/S shown ${ps(s, r)?.toFixed(2) ?? "—"}`);
const netOver = [...rows].filter(([, r]) => r.revenue > 0 && r.netIncome != null && r.netIncome > r.revenue && !incomplete(r.revenue, r.operatingIncome, null));
console.log(`\nnet income > revenue but NOT refused (operating below revenue or absent): ${netOver.length}`);
for (const [s, r] of netOver.sort()) console.log(`  ${s.padEnd(7)} rev ${fmt(r.revenue)} op ${fmt(r.operatingIncome)} net ${fmt(r.netIncome)} · P/S shown ${ps(s, r)?.toFixed(2) ?? "—"}`);
console.log("\nNAMED");
for (const s of ["UDR", "SOFI", "MET", "COF", "AMT", "CCI", "CFG", "KEY", "HIG", "SBAC", "ESS", "EXR", "NTNX", "AFRM", "AAPL"]) {
  const r = rows.get(s);
  console.log(`  ${s.padEnd(5)} ${r ? `rev ${fmt(r.revenue)} op ${fmt(r.operatingIncome)} net ${fmt(r.netIncome)} · refused ${incomplete(r.revenue, r.operatingIncome, null)} · P/S shown ${ps(s, r)?.toFixed(2) ?? "—"} (FMP psRatio ${r.psRatio?.toFixed?.(2) ?? "—"})` : "no row"}`);
}
