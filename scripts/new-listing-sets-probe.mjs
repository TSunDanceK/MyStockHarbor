// WHAT A FIRST-FILER'S STORED SET HOLDS (#552 COWORK #37). Reads only.
// Prints each named symbol's stored fact set: cover, every period (end, start,
// fp/fy, accession, filed) with the income/cash-flow fields that matter to the
// earnings page, and the notes. SEC values only.
//   relay task: write-new-listing-sets   Redis cost: 2 MGETs (fact sets, report dates).
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const syms = (process.env.SYMBOLS || "SPCX,INIO,MAIR,CBRS,BSP,PS,AAPL").split(",").filter(Boolean);
const want = ["revenue", "costOfRevenue", "grossProfit", "operatingIncome", "netIncome", "epsDiluted", "sharesDiluted", "operatingCashFlow", "capex", "freeCashFlow", "stockBasedComp", "interestExpense", "rnd", "sga"];
const got = await redis.mget(...syms.map((s) => `${FACTS}:${s}`));
const DATES = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const dates = await redis.mget(...syms.map((s) => `${DATES}:${s}`));
syms.forEach((s, j) => {
  const set = got[j];
  const rd = dates[j];
  if (rd) console.log(`\n-- ${s} report dates: ${JSON.stringify({ ...rd, events: (rd.events ?? []).slice(0, 4) })}`);
  else console.log(`\n-- ${s} report dates: none`);
  if (set?.yt) console.log(`  YTD ${JSON.stringify(set.yt)}`);
  if (!set) { console.log(`\n== ${s}: no stored set`); return; }
  console.log(`\n== ${s} (${set.entityName}) cik ${set.cik} cur ${set.cur ?? "USD"} | cover ${JSON.stringify(set.cover)}`);
  const row = (p) => {
    const vals = want.map((k) => { const i = SEC_FIELD_KEYS.indexOf(k); return i < 0 || p.v[i] == null ? null : `${k}=${p.v[i]}${p.d[i] && p.d[i] !== "F" ? "(" + p.d[i] + ")" : ""}`; }).filter(Boolean).join(" ");
    return `${p.s ?? "?"}..${p.e} ${p.fp ?? "-"}/fy${p.fy ?? "-"} ${p.a ?? "-"} f${p.f ?? "-"} | ${vals}`;
  };
  for (const p of set.quarters ?? []) console.log(`  Q ${row(p)}`);
  for (const p of set.years ?? []) console.log(`  Y ${row(p)}`);
  if (set.notes?.length) console.log(`  notes: ${set.notes.slice(0, 6).join(" | ")}`);
  const other = SEC_FIELD_KEYS.filter((k) => !want.includes(k));
  const q0 = set.quarters?.[0];
  if (q0) console.log(`  other fields on newest quarter: ${other.map((k) => { const i = SEC_FIELD_KEYS.indexOf(k); return q0.v[i] == null ? null : k; }).filter(Boolean).join(",")}`);
});
console.log(`\nfield keys: ${SEC_FIELD_KEYS.join(",")}`);
console.log("Redis commands: 2");
