// WHY NO TWELVE-MONTH EPS? (#552 COWORK #33). Reads only.
// For the 51 quarterly filers B's census found refused `no-twelve-month-eps`,
// read each stored fact set, run the SHIPPED valuationInputs, and classify
// the first guard that fails. Prints the newest eight quarters and three
// years per name (SEC-derived values only; nothing from any other provider).
//   relay task: write-no-ttm-eps-probe (credentialled for the read)
//   Redis cost: 3 MGET (25 keys each), once.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const V = await import("../lib/server/secValuation.ts");
const { valueOf } = await import("../lib/server/secFactCodec.ts");
const { isConsecutive } = await import("../lib/server/secEarningsView.ts");
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const SYMS = (process.argv[2] || "BRK.B,V,XOM,COST,NFLX,PEP,NOW,CRWD,BKNG,C,ONDS,SJM,BKR,AZO,KKR,COF,LEN,AAP,DPZ,LYB,HSY,SATA,RY,WES,VTRS,PS,UHAL,SUN,TD,WTRG,WMG,TECK,SN,QXO,CQP,FERG,PAA,JEF,ATHS,COKE,JHX,FWONK,CRWV,PNFP,MPLX,INIO,ALNY,MFC,MDB,MAIR,TPL").split(",");
const sets = new Map();
for (let i = 0; i < SYMS.length; i += 25) {
  const chunk = SYMS.slice(i, i + 25);
  const got = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => sets.set(s, got[j]));
}
const n = (v) => (v === null || v === undefined ? "-" : Math.abs(v) >= 1e5 ? `${(v / 1e6).toFixed(1)}M` : String(Math.round(v * 1000) / 1000));
function cause(set) {
  const four = set.quarters.slice(0, 4);
  if (four.length < 4) return `fewer than four quarters stored (${four.length})`;
  for (let i = 1; i < 4; i++) if (!isConsecutive(four[i - 1], four[i])) return `gap: ${four[i].e} -> ${four[i - 1].e}`;
  const miss = four.filter((q) => valueOf(q, "epsDiluted") === null);
  const q = miss.find((x) => x.fp !== "Q4" || V.derivedQ4Eps(set, x) === null) ?? miss[0];
  if (!q) return "none";
  if (q.fp !== "Q4") return `${q.fp ?? "unlabelled"} ${q.e} has no EPS`;
  if (set.cur && set.cur !== "USD") return `Q4 not derived: set in ${set.cur}`;
  const year = set.years.find((y) => y.fy === q.fy && y.e === q.e);
  if (!year) return `Q4 ${q.e} fy${q.fy}: no year ending on it (years: ${set.years.slice(0, 2).map((y) => `fy${y.fy} ${y.e}`).join(", ")})`;
  if (valueOf(year, "epsDiluted") === null) return `Q4 ${q.e}: year has no EPS`;
  const parts = ["Q1", "Q2", "Q3"].map((fp) => set.quarters.find((p) => p.fy === q.fy && p.fp === fp));
  if (parts.some((p) => !p)) return `Q4 ${q.e}: Q1-Q3 of fy${q.fy} not all stored (${parts.map((p) => p?.e ?? "none").join(",")})`;
  if (!(isConsecutive(q, parts[2]) && isConsecutive(parts[2], parts[1]) && isConsecutive(parts[1], parts[0]))) return `Q4 ${q.e}: Q1-Q3 not consecutive`;
  if (parts.some((p) => valueOf(p, "epsDiluted") === null)) return `Q4 ${q.e}: a Q1-Q3 has no EPS`;
  const all = [year, ...parts];
  const dil = all.map((p) => valueOf(p, "sharesDiluted")), bas = all.map((p) => valueOf(p, "sharesBasic"));
  if (!dil.every((x) => x !== null) && !(dil.every((x) => x === null) && bas.every((x) => x !== null)))
    return `Q4 ${q.e}: share counts incomplete/mixed (dil ${dil.map(n).join("/")}, basic ${bas.map(n).join("/")})`;
  const k = dil.every((x) => x !== null) ? dil : bas;
  return `Q4 ${q.e}: share basis moved (year ${n(k[0])} vs ${k.slice(1).map(n).join("/")})`;
}
const tally = new Map();
for (const s of SYMS) {
  const set = sets.get(s);
  if (!set || !Array.isArray(set.quarters)) { console.log(`\n== ${s}: NO STORED SET`); tally.set("no stored set", [...(tally.get("no stored set") ?? []), s]); continue; }
  const annualForm = REG[s]?.annualForm ?? REG[s.replace(".", "-")]?.annualForm;
  const inp = V.valuationInputs(set, TODAY, { annualForm });
  const refused = inp.refusals.includes("no-twelve-month-eps");
  const c = refused ? cause(set) : `NOW OK: ${inp.eps.basis} ${n(inp.eps.val)} to ${inp.eps.periodEnd}`;
  const bucket = c.replace(/[\d-]{10}|fy\d+|\d[\d.,/M -]*|\(.*\)/g, "").replace(/\s+/g, " ").trim();
  tally.set(bucket, [...(tally.get(bucket) ?? []), s]);
  console.log(`\n== ${s} | form ${annualForm ?? "?"} cur ${set.cur ?? "USD"} | ${c}`);
  console.log(`   Q: ${set.quarters.slice(0, 8).map((q) => `${q.e} ${q.fp ?? "?"}/fy${q.fy ?? "?"} eps ${n(valueOf(q, "epsDiluted"))} d ${n(valueOf(q, "sharesDiluted"))} b ${n(valueOf(q, "sharesBasic"))}`).join(" | ")}`);
  console.log(`   Y: ${set.years.slice(0, 3).map((y) => `${y.e} fy${y.fy ?? "?"} eps ${n(valueOf(y, "epsDiluted"))} d ${n(valueOf(y, "sharesDiluted"))} b ${n(valueOf(y, "sharesBasic"))}`).join(" | ")}`);
}
console.log("\n== BY CAUSE");
for (const [k, v] of [...tally].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(v.length).padStart(3)}  ${k}: ${v.join(", ")}`);
