// TWO READ-ONLY MEASUREMENTS FROM THE R2 ARCHIVE (#552 COWORK #86b / #92, and
// the #93/#99 estimate back-test, method M1). No SEC request; no price; no FMP
// data. SEC identifiers, tickers, concept names and error statistics only.
//
// (1) BANK P/S. For every Pickers row with SIC 6000-6299 that shows P/S today
//     (revenue present, not marked incomplete, share count present): which
//     concept fills revenue in the newest annual period the stored set uses,
//     and whether the filer also tags interest income. ASC 606 "revenue from
//     contracts with customers" at a bank is fee income only, so a P/S on it
//     is partial; a filer whose revenue comes from Revenues /
//     RevenuesNetOfInterestExpense / SalesRevenueNet keeps its P/S.
// (2) M1 BACK-TEST. Every filer in the fact-set index with a single-class dei
//     cover-count history: the current count vs the count that was current N
//     months earlier (N = 3, 6, 9, 12, 18, 24). Price cancels (cap error =
//     old count / current count - 1), so no price is read. Multi-class
//     histories (two counts at one date) are skipped. Then: how many Pickers
//     rows refused for a stale or missing count have a filed count within the
//     largest age that passes the bar (within 5% for >= 90%).
//   workflow: sec-archive.yml task "a86b-archive" (probe branch only)
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { r2Client, decodeFacts } from "../lib/secArchive.mjs";

const P = await import("../lib/server/pickersSecFundamentals.ts");
const V = await import("../lib/server/secValuation.ts");
const keyOf = (n) => (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(new RegExp(`export const ${n} = "([^"]+)"`)) ?? [])[1];
const INDEX = keyOf("SEC_FACTS_INDEX_KEY");
const URL_ = process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let cmds = 0, r2reads = 0;
async function redis(cmd) {
  cmds++;
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await res.json(); if (j.error) throw new Error("Upstash error"); return j.result;
}
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const reg = (s) => REG[s] ?? REG[s.replace(".", "-")] ?? REG[s.replace("-", ".")];
const r2 = r2Client();
const factsCache = new Map();
async function facts(cik) {
  const c = String(cik).padStart(10, "0");
  if (factsCache.has(c)) return factsCache.get(c);
  const buf = await r2.get(`facts/${c}.ndjson.br`); r2reads++;
  const out = buf ? decodeFacts(buf).rows : null;
  factsCache.set(c, out);
  return out;
}
// ROW_COLUMNS: taxonomy concept unit start end val accn fy fp form filed frame
const TODAY = new Date().toISOString().slice(0, 10);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

// ── (1) bank P/S ────────────────────────────────────────────────────────────
const universe = ((await redis(["HKEYS", P.PICKERS_SEC_KEY])) ?? []).map((x) => String(x).toUpperCase()); cmds++;
const rows = await P.readSecPickerRows(universe);
const TOTAL = ["Revenues", "RevenuesNetOfInterestExpense", "SalesRevenueNet"];
const ASC606 = ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax"];
const INTEREST = ["InterestIncomeExpenseNet", "InterestAndDividendIncomeOperating", "InterestIncomeExpenseAfterProvisionForLoanLoss", "InterestAndFeeIncomeLoansAndLeases"];
const bank = { total: [], partial: [], fee606NoInterest: [], other: [], noFacts: [] };
const bankLines = [];
for (const s of universe) {
  const sic = reg(s)?.sic;
  if (!sic || sic < "6000" || sic > "6299") continue;
  const row = rows.get(s);
  if (!row || !row.inputs.shares || row.m.revenueIncomplete || row.m.revenue == null) continue;
  const f = await facts(reg(s).cik);
  if (!f) { bank.noFacts.push(s); continue; }
  // The newest annual (12-month) USD period that carries any revenue concept.
  const annual = f.filter((r) => r[0] === "us-gaap" && r[2] === "USD" && r[3] && r[4] && days(r[3], r[4]) > 350 && days(r[3], r[4]) < 380);
  const ends = [...new Set(annual.filter((r) => [...TOTAL, ...ASC606].includes(r[1])).map((r) => r[4]))].sort();
  const end = ends.at(-1);
  if (!end) { bank.other.push(s); bankLines.push(`  ${s} sic ${sic}: no annual revenue concept in the archive`); continue; }
  const at = annual.filter((r) => r[4] === end);
  const has = (c) => at.some((r) => r[1] === c);
  // The extractor's own chain order: 606 Excluding first, then Revenues, ...
  const chain = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"];
  const filledBy = chain.find(has) ?? (has("RevenuesNetOfInterestExpense") ? "RevenuesNetOfInterestExpense" : null);
  const interest = INTEREST.filter(has);
  let cls;
  if (filledBy && TOTAL.includes(filledBy)) cls = "total";
  else if (filledBy && ASC606.includes(filledBy)) cls = interest.length ? "partial" : "fee606NoInterest";
  else cls = "other";
  bank[cls].push(s);
  bankLines.push(`  ${s} sic ${sic} FY to ${end}: filled by ${filledBy}; total concepts tagged: ${TOTAL.filter(has).join("+") || "none"}; interest concepts: ${interest.join("+") || "none"} -> ${cls}`);
}
console.log(`(1) BANK P/S: Pickers SIC 6000-6299 rows showing P/S today, by the concept that fills revenue in the newest annual period`);
for (const l of bankLines) console.log(l);
for (const [k, v] of Object.entries(bank)) console.log(`  ${k}: ${v.length}${v.length ? `: ${v.join(" ")}` : ""}`);

// ── (2) M1 back-test ───────────────────────────────────────────────────────
const indexSyms = ((await redis(["SMEMBERS", INDEX])) ?? []).map(String);
const AGES = [3, 6, 9, 12, 18, 24];
const errs = Object.fromEntries(AGES.map((a) => [a, []]));
let single = 0, multi = 0, none = 0, oldCurrent = 0;
const lastPoint = new Map(); // symbol -> newest single-class point (for cells filled)
for (const s of indexSyms) {
  const r = reg(s);
  if (!r?.cik) { none++; continue; }
  const f = await facts(r.cik);
  const pts = (f ?? []).filter((x) => x[0] === "dei" && x[1] === "EntityCommonStockSharesOutstanding" && x[2] === "shares" && x[4] && x[5] > 0);
  if (!pts.length) { none++; continue; }
  const byEnd = new Map();
  for (const x of pts) { if (!byEnd.has(x[4])) byEnd.set(x[4], new Set()); byEnd.get(x[4]).add(x[5]); }
  if ([...byEnd.values()].some((v) => v.size > 1)) { multi++; continue; }
  single++;
  const series = [...byEnd.entries()].map(([e, v]) => ({ e, v: [...v][0] })).sort((a, b) => a.e.localeCompare(b.e));
  const cur = series.at(-1);
  lastPoint.set(s, cur);
  if (days(cur.e, TODAY) > 460) { oldCurrent++; continue; }
  for (const a of AGES) {
    const target = new Date(Date.parse(cur.e) - a * 30.44 * 86400000).toISOString().slice(0, 10);
    const old = series.filter((p) => p.e <= target).at(-1);
    if (!old) continue;
    errs[a].push(Math.abs(old.v / cur.v - 1));
  }
}
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : null; };
const pct = (x) => (x === null ? "-" : `${(x * 100).toFixed(2)}%`);
console.log(`\n(2) M1 BACK-TEST: market cap from an older filed share count (error = |old count / current count - 1|; price cancels)`);
console.log(`  fact-set index ${indexSyms.length}: single-class histories ${single}; multi-class skipped ${multi}; no dei count in the archive ${none}; current count over 15 months old (excluded) ${oldCurrent}`);
let maxPass = 0;
for (const a of AGES) {
  const e = errs[a];
  const within = e.filter((x) => x <= 0.05).length / (e.length || 1);
  const pass = e.length >= 50 && within >= 0.9;
  if (pass && a > maxPass) maxPass = a;
  console.log(`  count ${a} months older: n ${e.length}; median ${pct(q(e, 0.5))}; p90 ${pct(q(e, 0.9))}; within ±5% ${(within * 100).toFixed(1)}% -> ${pass ? "PASS" : "FAIL"}`);
}
console.log(`  largest age that passes the bar (within 5% for >= 90%): ${maxPass ? `${maxPass} months` : "none"}`);

// Cells M1 would fill on Pickers: rows refused for a stale or missing count
// whose newest single-class filed count is within the passing age of today.
const cand = { stale: [], noCover: [] }, fill = { stale: [], noCover: [] };
for (const s of universe) {
  const row = rows.get(s);
  if (!row) continue;
  const f = V.marketCap({ shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals }, null);
  const why = f && !f.ok ? f.why : null;
  const k = why === "share-count-is-stale" ? "stale" : why === "no-cover-share-count" ? "noCover" : null;
  if (!k) continue;
  cand[k].push(s);
  const lp = lastPoint.get(s);
  if (maxPass && lp && days(lp.e, TODAY) <= maxPass * 30.44) fill[k].push(s);
}
console.log(`  Pickers rows refused for a stale count ${cand.stale.length}; M1 would fill ${fill.stale.length}${fill.stale.length ? `: ${fill.stale.join(" ")}` : ""}`);
console.log(`  Pickers rows refused for no cover count ${cand.noCover.length}; M1 would fill ${fill.noCover.length}${fill.noCover.length ? `: ${fill.noCover.join(" ")}` : ""}`);
console.log(`  P/S, P/B and P/FCF on an M1 cap carry the cap's own error (each divides the cap by an unchanged figure), so they pass or fail with it.`);
console.log(`\nRedis commands ${cmds} (+1 HMGET in readSecPickerRows), read-only · R2 reads ${r2reads} · SEC requests 0`);
