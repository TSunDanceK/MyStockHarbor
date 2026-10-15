// EARNINGS-PAGE DATA AUDIT (#552 COWORK #239). Reads only.
//   relay task: write-earnings-audit-239
//
// PART A, over every stored fact set (MGET in 50s):
//   1  quarterly EPS computed (net income / weighted diluted shares) where the
//      filer's own filed EPS disagrees with that ratio by more than 10% on a
//      period that has both -- the share count is not the EPS basis (Up-C, two
//      class); plus sets whose quarterly EPS is blank while net income is not.
//   2  Q4 rows: EPS blank while revenue and net income are present.
//   3  quarter gaps: two consecutive stored quarter ends more than 120 days apart.
//   4  quarterly revenue blank on all newest 8 quarters while a year has revenue.
// PART B, for SYMBOLS (default CVNA,COST,JPM,BAC,WFC): live companyfacts rows
// for EPS, net income, shares and the revenue concepts, newest 3 years.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; earnings audit)";
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const fields = await lift(readCodeOnly("lib/server/secFields.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type)/g, "$1") + "\nexport { SEC_FIELD_KEYS, secFieldsHash };", "", "secFields");
const K = fields.SEC_FIELD_KEYS, H = fields.secFieldsHash();
const ix = (k) => K.indexOf(k);
const I = { eps: ix("epsDiluted"), ni: ix("netIncome"), sh: ix("sharesDiluted"), rev: ix("revenue"), nci: ix("netIncomeToNoncontrollingInterest") };
const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
const symbols = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
console.log(`${symbols.length} manifest symbols · fields ${K.length} · idx ${JSON.stringify(I)}\n`);

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const val = (p, i) => (p.v[i] ?? null);
const code = (p, i) => p.d[i] ?? "-";
const out = { basis: [], epsBlank: [], q4: { rows: 0, epsBlank: 0, epsFilled: 0, syms: new Set() }, gaps: [], revGap: [], read: 0, gated: 0 };
let cmds = 1;

for (let i = 0; i < symbols.length; i += 50) {
  const batch = symbols.slice(i, i + 50);
  const sets = await redis.mget(...batch.map((s) => `${PREFIX}:${s}`)); cmds++;
  sets.forEach((set, j) => {
    const sym = batch[j];
    if (!set || set.h !== H || !Array.isArray(set.quarters)) { out.gated++; return; }
    out.read++;
    const qs = [...set.quarters].sort((a, b) => a.e.localeCompare(b.e)).slice(-8);
    const ys = [...set.years].sort((a, b) => a.e.localeCompare(b.e));
    // (1) basis: filed EPS vs net income / diluted shares, on periods with all three
    const ratios = [];
    for (const p of [...qs, ...ys.slice(-4)]) {
      const e = val(p, I.eps), n = val(p, I.ni), s = val(p, I.sh);
      if (code(p, I.eps) === "F" && e && n && s) ratios.push({ e: p.e, r: n / (e * s) });
    }
    const computedQ = qs.filter((p) => code(p, I.eps) === "C").length;
    const off = ratios.filter((x) => Math.abs(x.r - 1) > 0.1);
    if (computedQ && off.length) {
      const nci = qs.map((p) => val(p, I.nci)).filter((x) => x).length;
      out.basis.push(`${sym} computedQ=${computedQ}/${qs.length} filedQ=${qs.filter((p) => code(p, I.eps) === "F").length} off=${off.length}/${ratios.length} r=${off.slice(-2).map((x) => `${x.e}:${x.r.toFixed(2)}`).join(",")} nciQ=${nci} cover=${set.cover?.derived ?? "none"}`);
    }
    const blank = qs.filter((p) => val(p, I.eps) === null && val(p, I.ni) !== null && p.fp !== "Q4").length;
    if (blank >= 2) out.epsBlank.push(`${sym}:${blank}`);
    // (2) Q4
    for (const p of qs) {
      if (p.fp !== "Q4") continue;
      if (val(p, I.ni) === null || val(p, I.rev) === null) continue;
      out.q4.rows++;
      if (val(p, I.eps) === null) { out.q4.epsBlank++; out.q4.syms.add(sym); } else out.q4.epsFilled++;
    }
    // (3) gaps
    for (let k = 1; k < qs.length; k++) {
      const g = days(qs[k - 1].e, qs[k].e);
      if (g > 120) { out.gaps.push(`${sym} ${qs[k - 1].e}->${qs[k].e} (${Math.round(g)}d, next fp ${qs[k].fp})`); break; }
    }
    // (4) revenue
    const qRev = qs.filter((p) => val(p, I.rev) !== null).length;
    const yRev = ys.slice(-4).filter((p) => val(p, I.rev) !== null).length;
    if (qs.length >= 4 && qRev === 0 && yRev > 0) out.revGap.push(sym);
  });
}

console.log(`read ${out.read} · gated/absent ${out.gated}\n`);
console.log(`== (1) EPS BASIS MISMATCH with computed quarterly EPS: ${out.basis.length}`);
out.basis.forEach((l) => console.log("BASIS " + l));
console.log(`\n== (1b) quarterly EPS blank on >=2 non-Q4 quarters while net income present: ${out.epsBlank.length}`);
console.log("EPSBLANK " + out.epsBlank.join(" "));
console.log(`\n== (2) Q4 rows with revenue+NI: ${out.q4.rows} · EPS blank ${out.q4.epsBlank} · EPS filled ${out.q4.epsFilled} · symbols with a blank Q4 EPS ${out.q4.syms.size}`);
console.log(`\n== (3) quarter gaps >120d: ${out.gaps.length}`);
out.gaps.forEach((l) => console.log("GAP " + l));
console.log(`\n== (4) quarterly revenue blank (all newest 8) while annual present: ${out.revGap.length}`);
console.log("REVGAP " + out.revGap.join(" "));

// ── PART B ──
const NAMED = (process.env.SYMBOLS || "CVNA,COST,JPM,BAC,WFC").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
const CONCEPTS = ["EarningsPerShareDiluted", "EarningsPerShareBasic", "NetIncomeLoss", "ProfitLoss", "NetIncomeLossAttributableToNoncontrollingInterest",
  "WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic",
  "Revenues", "RevenuesNetOfInterestExpense", "RevenueFromContractWithCustomerExcludingAssessedTax", "InterestAndDividendIncomeOperating",
  "InterestIncomeExpenseNet", "NoninterestIncome", "InterestIncomeExpenseAfterProvisionForLoanLoss"];
let lastAt = 0;
const getJson = async (url) => {
  const wait = Math.max(0, lastAt + 150 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  return res.ok ? res.json() : null;
};
for (const sym of NAMED) {
  const cik = manifest.symbols[sym]?.cik;
  console.log(`\n######## ${sym} cik ${cik ?? "none"}`);
  if (!cik) continue;
  const set = await redis.get(`${PREFIX}:${sym}`); cmds++;
  if (set?.quarters) {
    for (const p of [...set.quarters].sort((a, b) => a.e.localeCompare(b.e)).slice(-9)) {
      console.log(`STORED ${p.s}..${p.e} ${p.fp}${p.fy} rev=${val(p, I.rev)}${code(p, I.rev)} ni=${val(p, I.ni)}${code(p, I.ni)} sh=${val(p, I.sh)}${code(p, I.sh)} eps=${val(p, I.eps)}${code(p, I.eps)} nci=${val(p, I.nci)}`);
    }
    console.log(`STORED cover ${JSON.stringify(set.cover)}`);
  }
  const f = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
  if (!f) { console.log("companyfacts: fetch failed"); continue; }
  const since = `${new Date().getUTCFullYear() - 3}-01-01`;
  for (const c of CONCEPTS) {
    const units = f.facts?.["us-gaap"]?.[c]?.units;
    if (!units) { console.log(`${c}: absent`); continue; }
    for (const [u, rows] of Object.entries(units)) {
      const seen = new Set();
      const recent = rows.filter((r) => r.end >= since && r.start).filter((r) => {
        const k = `${r.start}|${r.end}`; if (seen.has(k)) return false; seen.add(k); return true;
      }).sort((a, b) => a.end.localeCompare(b.end));
      const q = recent.filter((r) => days(r.start, r.end) < 120);
      const y = recent.filter((r) => days(r.start, r.end) > 340);
      console.log(`${c} [${u}] 3M: ${q.map((r) => `${r.end}=${r.val}(${r.form})`).join(" ") || "none"}`);
      console.log(`${c} [${u}] FY: ${y.map((r) => `${r.end}=${r.val}`).join(" ") || "none"}`);
      const odd = recent.filter((r) => days(r.start, r.end) >= 120 && days(r.start, r.end) <= 340 && days(r.start, r.end) < 125);
      if (odd.length) console.log(`${c} [${u}] 120-125d: ${odd.map((r) => `${r.start}..${r.end}=${r.val}`).join(" ")}`);
    }
  }
  // Every frame length present for revenue-ish concepts (COST's 16-week Q4).
  if (sym === "COST") {
    const rows = f.facts?.["us-gaap"]?.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.USD ?? [];
    const spans = [...new Set(rows.filter((r) => r.end >= since && r.start).map((r) => `${r.start}..${r.end}=${Math.round(days(r.start, r.end))}d`))];
    console.log(`COST revenue frames: ${spans.join(" ")}`);
  }
}
console.log(`\nRedis commands: ${cmds}`);
