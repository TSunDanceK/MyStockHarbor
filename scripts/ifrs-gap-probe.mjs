// #535 COWORK #19 §3: the annual-only filers' newest year — which of revenue,
// net income, diluted EPS, operating income and operating cash flow resolve;
// for each gap, which concepts the filer actually publishes for that year
// (mapped or not, and in which unit); and which filers are a year or more
// stale, with the cause (feed lag / stored set behind the feed / dropped at
// conversion). Read-only: Redis GETs and public companyfacts.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadCards } from "./lib/render-cards.mjs";
import { lift } from "./lib/earnings-plan.mjs";
const redis = Redis.fromEnv();
const M = await loadCards();
const A = await lift(fs.readFileSync("lib/server/annualOnly.ts", "utf8").replace(/^import type[^;]+;$/gm, ""));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; ifrs gap probe)";
const today = new Date().toISOString().slice(0, 10);
const KEYS = ["revenue", "netIncome", "epsDiluted", "operatingIncome", "operatingCashFlow"];
const idx = Object.fromEntries(KEYS.map((k) => [k, M.SEC_FIELDS.findIndex((f) => f.key === k)]));
const field = Object.fromEntries(KEYS.map((k) => [k, M.SEC_FIELDS[idx[k]]]));
const LIKE = {
  revenue: /Revenue|Sales|Turnover|IncomeFromContractsWithCustomers/i,
  netIncome: /^ProfitLoss|NetIncomeLoss/,
  epsDiluted: /EarningsLossPerShare|EarningsPerShare/,
  operatingIncome: /ProfitLossFromOperatingActivities|OperatingIncomeLoss|OperatingProfit/,
  operatingCashFlow: /CashFlowsFromUsedInOperatingActivities|NetCashProvidedByUsedInOperatingActivities/,
};
const mapped = (k) => new Set([...(field[k].chain ?? []), ...(field[k].ifrsChain ?? [])]);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

const syms = Object.entries(REG).filter(([, r]) => /^(20-F|40-F)/.test(r.annualForm ?? "")).map(([s]) => s);
const filers = [];
for (let i = 0; i < syms.length; i += 25) {
  const chunk = syms.slice(i, i + 25);
  const sets = await redis.mget(...chunk.map((s) => `msh:sec:facts:v1:${s}`));
  chunk.forEach((s, k) => {
    const set = sets[k];
    if (!set || !set.years?.length) return;
    const form = A.annualOnlyForm(REG[s].annualForm, set, today);
    if (form) filers.push({ s, form, set, cik: REG[s].cik });
  });
}
console.log(`annual-only filers with a stored set: ${filers.length}`);
const have = Object.fromEntries(KEYS.map((k) => [k, 0]));
for (const f of filers) for (const k of KEYS) if (f.set.years[0].v[idx[k]] != null) have[k]++;
console.log("newest stored year, % with each field: " + KEYS.map((k) => `${k} ${have[k]}/${filers.length} (${Math.round((100 * have[k]) / filers.length)}%)`).join(", "));
const cur = {};
for (const f of filers) cur[f.set.cur ?? "USD"] = (cur[f.set.cur ?? "USD"] ?? 0) + 1;
console.log(`reporting currencies: ${JSON.stringify(cur)}`);

const gapConcepts = Object.fromEntries(KEYS.map((k) => [k, new Map()]));
const gapNothing = Object.fromEntries(KEYS.map((k) => [k, []]));
const gapExtractHas = Object.fromEntries(KEYS.map((k) => [k, []]));
const stale = [];
const detail = [];
for (const f of filers) {
  const y0 = f.set.years[0];
  const missing = KEYS.filter((k) => y0.v[idx[k]] == null);
  const isStale = days(y0.e, today) > 365 + 120;
  if (!missing.length && !isStale) continue;
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(f.cik).padStart(10, "0")}.json`, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
    if (!res.ok) { detail.push(`${f.s}: companyfacts HTTP ${res.status}`); continue; }
    facts = await res.json();
  } catch (e) { detail.push(`${f.s}: fetch ${e.message}`); continue; }
  await new Promise((r) => setTimeout(r, 150));
  // Annual-duration facts, by end date, across namespaces
  const annual = []; // {ns, tag, unit, end, form, filed}
  for (const [ns, tags] of Object.entries(facts.facts ?? {})) {
    if (ns === "dei") continue;
    for (const [tag, node] of Object.entries(tags)) for (const [unit, list] of Object.entries(node.units ?? {})) for (const r of list) {
      if (!r.start || !r.end) continue;
      const span = days(r.start, r.end);
      if (span < 340 || span > 380) continue;
      annual.push({ ns, tag, unit, end: r.end, form: r.form, filed: r.filed });
    }
  }
  const feedNewest = annual.filter((a) => /^(20-F|40-F)/.test(a.form ?? "")).map((a) => a.end).sort().pop() ?? null;
  let ex = null;
  try { ex = M.extractCompanyFacts(f.s, facts); } catch { /* reported below */ }
  const exYear = ex?.years?.find((p) => p.end === y0.e) ?? null;
  for (const k of missing) {
    const pub = annual.filter((a) => a.end === y0.e && LIKE[k].test(a.tag));
    const tagset = new Map();
    for (const a of pub) tagset.set(`${a.ns}:${a.tag}`, `${a.unit}${mapped(k).has(a.tag) ? " (mapped)" : ""}`);
    if (!tagset.size) gapNothing[k].push(f.s);
    for (const [t, u] of tagset) { const key = `${t} [${u.includes("mapped") ? "mapped" : "UNMAPPED"}]`; gapConcepts[k].set(key, [...(gapConcepts[k].get(key) ?? []), `${f.s}(${u.replace(" (mapped)", "")})`]); }
    if (exYear?.values?.[idx[k]]?.val != null) gapExtractHas[k].push(f.s);
  }
  if (isStale) {
    const exNewest = ex?.years?.map((p) => p.end).sort().pop() ?? null;
    let cause;
    if (!feedNewest || feedNewest <= y0.e) cause = "feed lag (companyfacts has no newer annual period)";
    else if (exNewest && exNewest > y0.e) cause = `stored set behind the feed (extraction now yields ${exNewest}; set written ${new Date(f.set.at).toISOString().slice(0, 10)})`;
    else cause = `newer annual facts exist (${feedNewest}) but extraction does not yield the year (currency ${f.set.cur ?? "USD"} / other)`;
    stale.push(`${f.s} ${f.form} cur ${f.set.cur ?? "USD"}: stored FY end ${y0.e}; feed newest ${feedNewest}; ${cause}`);
  }
}
console.log(`\nSTALE by a year or more (newest stored FY ended over 16 months ago): ${stale.length}`);
for (const l of stale) console.log("  " + l);
for (const k of KEYS) {
  console.log(`\n${k}: missing on ${filers.length - have[k]}; the live extractor DOES yield it for ${gapExtractHas[k].length} (${gapExtractHas[k].join(" ")}); nothing like it published for the year: ${gapNothing[k].length} (${gapNothing[k].join(" ")})`);
  for (const [t, who] of [...gapConcepts[k]].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) console.log(`  ${who.length}  ${t}  ${who.slice(0, 14).join(" ")}`);
}
if (detail.length) console.log("\n" + detail.join("\n"));
for (const s of ["SAP", "SONY"]) {
  const f = filers.find((x) => x.s === s);
  if (f) console.log(`\n${s}: cur ${f.set.cur}; years ${f.set.years.map((y) => y.e).join(",")}; newest year values ${KEYS.map((k) => `${k}=${f.set.years[0].v[idx[k]]}`).join(" ")}; fx ${JSON.stringify(f.set.fx ?? null).slice(0, 160)}`);
}
