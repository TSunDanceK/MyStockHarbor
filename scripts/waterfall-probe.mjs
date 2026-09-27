// THE INCOME WATERFALL FROM A STORED SET, SEC VALUES ONLY (#552 COWORK #60:
// GOOGL's summed S&M + G&A after #620; JD's non-operating line after #638).
// For the newest year and quarter: revenue, cost of revenue, R&D, SG&A (and
// whether it is the S&M + G&A sum), operating income, and what is left when
// the lines are taken from revenue. Plus the non-operating line per year.
//   relay task: write-waterfall   SYMBOLS=GOOGL,JD   Redis: 1 MGET.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";
const F = await import("../lib/server/secFields.ts");
const redis = Redis.fromEnv();
const FACTS = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
const syms = (process.env.SYMBOLS || "GOOGL,JD").split(/[\s,]+/).filter(Boolean).slice(0, 5);
const sets = await redis.mget(...syms.map((s) => `${FACTS}:${s}`));
const I = F.SEC_FIELD_INDEX;
const v = (p, k) => (p?.v?.[I[k]] ?? null);
const m = (x) => (x == null ? "-" : `${(x / 1e6).toFixed(0)}M`);
syms.forEach((s, n) => {
  const set = sets[n];
  if (!set) { console.log(`${s}: no stored set`); return; }
  for (const [label, list] of [["FY", set.years], ["Q", set.quarters]]) {
    const p = [...(list ?? [])].sort((a, b) => (a.e < b.e ? 1 : -1))[0];
    if (!p) continue;
    const rev = v(p, "revenue"), cogs = v(p, "costOfRevenue"), rd = v(p, "researchAndDevelopment"), sga = v(p, "sellingGeneralAndAdministrative"), oth = v(p, "otherOperatingExpense"), op = v(p, "operatingIncome");
    const summed = (set.sg ?? []).includes(`${p.s ?? ""}|${p.e}`);
    const left = [rev, cogs, rd, sga, op].every((x) => x != null) ? rev - cogs - rd - sga - (oth ?? 0) - op : null;
    console.log(`${s} ${label} ${p.s}..${p.e}: revenue ${m(rev)} · cost ${m(cogs)} · R&D ${m(rd)} · SG&A ${m(sga)}${summed ? " (S&M + G&A, summed)" : ""} · other opex ${m(oth)} · operating income ${m(op)} · left over ${left == null ? "-" : m(left)}${left != null && rev ? ` (${((left / rev) * 100).toFixed(2)}% of revenue)` : ""}`);
  }
  const ys = [...(set.years ?? [])].sort((a, b) => (a.e < b.e ? -1 : 1));
  console.log(`${s} non-operating by FY: ${ys.map((y) => `${y.e.slice(0, 4)} ${m(v(y, "nonOperatingIncomeExpense"))} (pre ${m(v(y, "preTaxIncome"))}, op ${m(v(y, "operatingIncome"))})`).join(" · ")}${set.cur && set.cur !== "USD" ? ` [USD, from ${set.cur}]` : ""}`);
});
console.log("Redis commands: 1");
