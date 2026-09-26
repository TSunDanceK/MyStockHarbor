// NON-OPERATING: A TOTAL AHEAD OF ITS COMPONENT, BEFORE AND AFTER (#552 COWORK #58).
//
// The shipped extractor (rankPerPeriod on nonOperatingIncomeExpense) against
// the same source with the flag dropped (the newest-period preference, as
// shipped by #613), over every registrant whose companyfacts carries BOTH
// NonoperatingIncomeExpense and OtherNonoperatingIncomeExpense -- the only
// filers the flag can move. For each: how many period cells change, and how
// many periods reconcile (pre-tax = operating + non-operating, within 0.5%)
// under each rule. Tickers and counts only; no figure is printed.
// Read-only, uncredentialled. ALL registrants by default (~2,600 fetches).
//   relay task: nonop-rank-census   (SYMBOLS=... to narrow)
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; non-operating rank census)";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const fields = fs.readFileSync("lib/server/secFields.ts", "utf8");
const rest = [strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secExtract.ts")].join("\n");
const FLAG = 'unit: "USD", rankPerPeriod: true },';
if (!fields.includes(FLAG)) { console.error("FATAL: the shipped flag is not where the census expects it"); process.exit(2); }
const after = await lift(`${fields}\n${rest}`);
const before = await lift(`${fields.replace(FLAG, 'unit: "USD" },')}\n${rest}`);

const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const ONLY = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const byCik = new Map();
for (const [s, r] of Object.entries(REG)) {
  if (!r.cik || (ONLY.length && !ONLY.includes(s))) continue;
  const c = String(r.cik).padStart(10, "0");
  if (!byCik.has(c)) byCik.set(c, s);
}
let lastAt = 0;
const get = async (url) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, lastAt + 125 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    let res;
    try { res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } }); } catch { res = { ok: false, status: 0 }; }
    if (![0, 429, 503].includes(res.status)) return res;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return { ok: false, status: 503 };
};

const I = after.SEC_FIELD_INDEX;
const val = (p, k) => p.values[I[k]]?.val ?? null;
const reconciles = (p) => {
  const pre = val(p, "preTaxIncome"), op = val(p, "operatingIncome"), non = val(p, "nonOperatingIncomeExpense");
  if (pre == null || op == null || non == null) return null;
  return Math.abs(pre - op - non) <= 0.005 * Math.max(Math.abs(pre), 1);
};
const periods = (out) => [...out.years, ...out.quarters];

let scanned = 0, failed = 0, candidates = 0, moved = 0, cellsMoved = 0;
const tot = { before: { ok: 0, bad: 0 }, after: { ok: 0, bad: 0 } };
const movedSyms = [], worse = [];
for (const [cik, sym] of byCik) {
  const res = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  scanned++;
  if (!res.ok) { if (res.status !== 404) failed++; continue; }
  let facts;
  try { facts = await res.json(); } catch { failed++; continue; }
  const g = facts.facts?.["us-gaap"] ?? {};
  if (!g.NonoperatingIncomeExpense || !g.OtherNonoperatingIncomeExpense) continue;
  candidates++;
  let a, b;
  try { a = after.extractCompanyFacts(sym, facts); b = before.extractCompanyFacts(sym, facts); } catch { failed++; continue; }
  const bByEnd = new Map(periods(b).map((p) => [`${p.start}|${p.end}`, p]));
  let n = 0, okA = 0, badA = 0, okB = 0, badB = 0;
  for (const p of periods(a)) {
    const q = bByEnd.get(`${p.start}|${p.end}`);
    if (q && val(p, "nonOperatingIncomeExpense") !== val(q, "nonOperatingIncomeExpense")) {
      n++;
      // DETAIL=1 (with SYMBOLS): each changed period, SEC values and tags only.
      if (process.env.DETAIL) {
        const c = (x) => x.values[I.nonOperatingIncomeExpense];
        const m = (v) => (v == null ? "-" : (v / 1e6).toFixed(1) + "M");
        console.log(`  ${sym} ${p.start}..${p.end}: pre ${m(val(p, "preTaxIncome"))} op ${m(val(p, "operatingIncome"))} | before ${c(q)?.tag} ${m(c(q)?.val)} (${reconciles(q)}) | after ${c(p)?.tag} ${m(c(p)?.val)} (${reconciles(p)})`);
      }
    }
    const ra = reconciles(p); if (ra === true) okA++; else if (ra === false) badA++;
    if (q) { const rb = reconciles(q); if (rb === true) okB++; else if (rb === false) badB++; }
  }
  tot.after.ok += okA; tot.after.bad += badA; tot.before.ok += okB; tot.before.bad += badB;
  if (n) { moved++; cellsMoved += n; movedSyms.push(`${sym}(${n})`); if (okA < okB) worse.push(sym); }
  if (scanned % 250 === 0) console.log(`  … ${scanned}/${byCik.size} fetched, ${candidates} file both tags`);
}
console.log(`\nregistrants ${byCik.size} (one per CIK) · fetched ${scanned} · failed ${failed}`);
console.log(`file BOTH NonoperatingIncomeExpense and OtherNonoperatingIncomeExpense: ${candidates}`);
console.log(`filers whose non-operating cells change: ${moved} (${cellsMoved} period cells)`);
console.log(`periods that reconcile (pre-tax = operating + non-op, 0.5%) over those ${candidates} filers:`);
console.log(`  before (newest-period preference): ${tot.before.ok} reconcile, ${tot.before.bad} do not`);
console.log(`  after  (rank per period):          ${tot.after.ok} reconcile, ${tot.after.bad} do not`);
console.log(`filers that reconcile FEWER periods after: ${worse.length}${worse.length ? `: ${worse.join(" ")}` : ""}`);
console.log(`changed: ${movedSyms.join(" ")}`);
