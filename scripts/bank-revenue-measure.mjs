// READ-ONLY MEASUREMENT (#552 COWORK #78 item 4): how many filers a BANK
// REVENUE CHAIN would recover, and through which concepts. Nothing is built.
//
// Population A — what readers see: every stored Layer 2 set whose NEWEST year
//   has no revenue (the "Not captured from this filing" cell), from Redis.
// Population B — the whole archive universe: filers whose newest 10-K/20-F
//   year carries none of today's revenue concepts, from the R2 archive.
// For each, the archive is asked (presence only, never a value) whether the
// newest annual period carries:
//   R  us-gaap:RevenuesNetOfInterestExpense                  (JPM's own line)
//   N  us-gaap:InterestIncomeExpenseNet + us-gaap:NoninterestIncome (both)
//   I  us-gaap:InterestAndDividendIncomeOperating (gross interest income; NOT
//      revenue on its own — counted to show what a wrong chain would grab)
// SEC identifiers and tickers only; no values; no FMP data. Reads: R2 GETs,
// Upstash SMEMBERS/MGET. No SEC request.
//   workflow: sec-archive.yml task "bank-revenue" (probe branch only)
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { r2Client, decodeFacts } from "../lib/secArchive.mjs";

const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
const keyOf = (n) => (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(new RegExp(`export const ${n} = "([^"]+)"`)) ?? [])[1];
const PREFIX = keyOf("SEC_FACTS_PREFIX"), INDEX = keyOf("SEC_FACTS_INDEX_KEY"), MANIFEST = keyOf("SEC_MANIFEST_KEY");
const URL_ = process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let cmds = 0;
async function redis(cmd) {
  cmds++;
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await res.json(); if (j.error) throw new Error("Upstash error"); return j.result;
}
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const REV = SEC_FIELD_KEYS.indexOf("revenue");
const TODAY_CHAIN = new Set(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods"]);
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const EXTRA = JSON.parse(fs.readFileSync("data/sec/archive-extra-ciks.json", "utf8")).rows;
const symsOf = new Map();
for (const [s, r] of [...Object.entries(REG).map(([s, r]) => [s, r.cik]), ...Object.entries(EXTRA)]) {
  const c = String(r).padStart(10, "0"); if (!symsOf.has(c)) symsOf.set(c, []); symsOf.get(c).push(s);
}
const sicOf = (cik) => { for (const s of symsOf.get(cik) ?? []) if (REG[s]?.sic) return REG[s].sic; return null; };
const band = (sic) => !sic ? "no SIC" : sic >= "6000" && sic <= "6199" ? "banks & credit (60-61)" : sic >= "6200" && sic <= "6299" ? "brokers (62)" : sic >= "6300" && sic <= "6499" ? "insurance (63-64)" : sic >= "6500" && sic <= "6799" ? "real estate & trusts (65-67)" : "non-financial";

// ── Population A: stored sets with no revenue in their newest year ─────────
const symbols = ((await redis(["SMEMBERS", INDEX])) ?? []).map(String).sort();
const manifest = parse(await redis(["GET", MANIFEST])) ?? { symbols: {} };
const noRevStored = [], noRevQuarter = [];
for (let i = 0; i < symbols.length; i += 25) {
  const chunk = symbols.slice(i, i + 25);
  const got = await redis(["MGET", ...chunk.map((s) => `${PREFIX}:${s}`)]);
  chunk.forEach((s, j) => {
    const set = got?.[j] ? parse(got[j]) : null;
    if (!set?.years?.length) return;
    const newest = [...set.years].sort((a, b) => (a.e < b.e ? 1 : -1))[0];
    const cik = String(manifest.symbols?.[s]?.cik ?? set.cik ?? "").padStart(10, "0");
    if (newest.v?.[REV] == null) noRevStored.push({ sym: s, cik });
    const nq = [...(set.quarters ?? [])].sort((a, b) => (a.e < b.e ? 1 : -1))[0];
    if (nq && nq.v?.[REV] == null && newest.v?.[REV] != null) noRevQuarter.push({ sym: s, cik, end: nq.e, start: nq.s });
  });
}

// ── The archive, per CIK: newest annual end, and which concepts it carries there ──
const r2 = r2Client();
const idx = JSON.parse((await r2.get("index.json")).toString("utf8"));
const classify = async (cik) => {
  const buf = await r2.get(`facts/${cik}.ndjson.br`);
  if (!buf) return null;
  const { rows } = decodeFacts(buf);
  const annual = rows.filter((r) => /^(10-K|20-F|40-F)/.test(String(r[9])) && r[7] != null && String(r[8]) === "FY" && r[3]);
  const newest = annual.reduce((m, r) => (r[4] > m ? r[4] : m), "");
  if (!newest) return { newest: null, today: false, R: false, N: false, I: false };
  const at = new Set(annual.filter((r) => r[4] === newest && r[0] === "us-gaap" || r[4] === newest && r[0] === "ifrs-full").map((r) => r[1]));
  return {
    newest,
    today: [...at].some((c) => TODAY_CHAIN.has(c)),
    R: at.has("RevenuesNetOfInterestExpense"),
    N: at.has("InterestIncomeExpenseNet") && at.has("NoninterestIncome"),
    I: at.has("InterestAndDividendIncomeOperating"),
  };
};
// THE NEWEST QUARTER: the same concepts, on a ~3-month duration ending at `end`.
const classifyQuarter = async (cik, end) => {
  const buf = await r2.get(`facts/${cik}.ndjson.br`);
  if (!buf) return null;
  const { rows } = decodeFacts(buf);
  const q = rows.filter((r) => r[4] === end && r[3] && (Date.parse(r[4]) - Date.parse(r[3])) / 86_400_000 < 100);
  const at = new Set(q.map((r) => r[1]));
  return { newest: end, today: [...at].some((c) => TODAY_CHAIN.has(c)), R: at.has("RevenuesNetOfInterestExpense"),
    N: at.has("InterestIncomeExpenseNet") && at.has("NoninterestIncome"), I: at.has("InterestAndDividendIncomeOperating"),
    todayYtdOnly: rows.some((r) => r[4] === end && TODAY_CHAIN.has(r[1])) && ![...at].some((c) => TODAY_CHAIN.has(c)) };
};
const tallyOf = () => ({ n: 0, R: 0, N: 0, RorN: 0, neither: 0, Ionly: 0, noArchive: 0, symbols: { R: [], NonlyN: [], neither: [] } });
const add = (t, sym, c) => {
  t.n++;
  if (!c) { t.noArchive++; return; }
  if (c.R) t.R++; if (c.N) t.N++;
  if (c.R || c.N) t.RorN++; else { t.neither++; if (c.I) t.Ionly++; }
  if (c.R) t.symbols.R.push(sym); else if (c.N) t.symbols.NonlyN.push(sym); else t.symbols.neither.push(sym);
};

console.log(`\nA. STORED SETS WITH NO REVENUE IN THEIR NEWEST YEAR: ${noRevStored.length} of ${symbols.length}`);
const byBandA = {};
for (const { sym, cik } of noRevStored) {
  const c = idx.entries[cik] ? await classify(cik) : null;
  add(byBandA[band(sicOf(cik))] ??= tallyOf(), sym, c);
}
for (const [b, t] of Object.entries(byBandA).sort((x, y) => y[1].n - x[1].n)) {
  console.log(`  ${b}: ${t.n} · RevenuesNetOfInterestExpense ${t.R} · NII+noninterest ${t.N} · either ${t.RorN} · neither ${t.neither} (gross interest income only ${t.Ionly}) · not archived ${t.noArchive}`);
  console.log(`     R: ${t.symbols.R.join(" ") || "-"}`);
  console.log(`     NII+NI only: ${t.symbols.NonlyN.join(" ") || "-"}`);
  console.log(`     neither: ${t.symbols.neither.join(" ") || "-"}`);
}

console.log(`\nA2. STORED SETS WHOSE NEWEST QUARTER HAS NO REVENUE (their newest year has it): ${noRevQuarter.length}`);
const byBandQ = {};
let ytdOnly = [];
for (const { sym, cik, end } of noRevQuarter) {
  const c = idx.entries[cik] ? await classifyQuarter(cik, end) : null;
  if (c?.todayYtdOnly) ytdOnly.push(sym);
  add(byBandQ[band(sicOf(cik))] ??= tallyOf(), sym, c);
}
for (const [b, t] of Object.entries(byBandQ).sort((x, y) => y[1].n - x[1].n)) {
  console.log(`  ${b}: ${t.n} · RevenuesNetOfInterestExpense ${t.R} · NII+noninterest ${t.N} · either ${t.RorN} · neither ${t.neither} · not archived ${t.noArchive}`);
  console.log(`     R: ${t.symbols.R.join(" ") || "-"}`);
  console.log(`     NII+NI only: ${t.symbols.NonlyN.join(" ") || "-"}`);
  console.log(`     neither: ${t.symbols.neither.join(" ") || "-"}`);
}
console.log(`  of which today's revenue concepts exist only as year-to-date at that end (a derivation gap, not a tag gap): ${ytdOnly.length} ${ytdOnly.join(" ")}`);
if (process.env.SKIP_UNIVERSE === "yes") { console.log(`\nRedis commands ${cmds} (reads only) · SEC requests 0 · R2 reads only`); process.exit(0); }

console.log(`\nB. ARCHIVE UNIVERSE: filers whose newest annual year has none of today's revenue concepts`);
const byBandB = {};
let scanned = 0;
for (const cik of Object.keys(idx.entries)) {
  if (!idx.entries[cik].factsSha) continue;
  const c = await classify(cik); scanned++;
  if (!c?.newest || c.today) continue;
  add(byBandB[band(sicOf(cik))] ??= tallyOf(), (symsOf.get(cik) ?? ["?"])[0], c);
}
console.log(`  scanned ${scanned} filers with companyfacts`);
for (const [b, t] of Object.entries(byBandB).sort((x, y) => y[1].n - x[1].n))
  console.log(`  ${b}: ${t.n} · RevenuesNetOfInterestExpense ${t.R} · NII+noninterest ${t.N} · either ${t.RorN} · neither ${t.neither} (gross interest income only ${t.Ionly})`);
console.log(`\nRedis commands ${cmds} (reads only) · SEC requests 0 · R2 reads only`);
