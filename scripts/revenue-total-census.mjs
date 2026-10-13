// THE FILED TOTAL OVER THE ASC 606 LINE, MEASURED (#552 COWORK #217 step 1).
//
// The shipped extractor already prefers `Revenues` over
// `RevenueFromContractWithCustomerExcludingAssessedTax` (#552 COWORK #192
// ruling A), but only where the filer tags NO excise concept and the total is
// more than REVENUE_TOTAL_OVER_CONTRACT (5%) above the contract line. MELI and
// CEG tag excise; PAYX and LUNR sit under 5%. This runs the SHIPPED extractor
// twice on one payload per filer:
//   SHIPPED    as it ships
//   CANDIDATE  the same code with the excise exclusion removed and the factor
//              at 1 (any larger total), nothing else changed
// and prints every filer whose revenue moves, with the newest period's figures
// and gross margin (filed GrossProfit, else revenue - cost of revenue) both ways,
// and whether the filer's own GrossProfit + CostOfRevenue adds up to the old or
// the new revenue (the basis check). SEC only, read-only, no credential.
// ≤8 requests/s.
//   SYMBOLS="MELI,CEG,LUNR,PAYX" node scripts/revenue-total-census.mjs
//   SHARD=1/3 node scripts/revenue-total-census.mjs   (every registrant)
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; revenue total census)";
const [K, N] = (process.env.SHARD || "1/1").split("/").map(Number);
const BUDGET_MS = Number(process.env.BUDGET_MS || 27 * 60 * 1000);
const started = Date.now();
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const parts = (extract) => [
  readCodeOnly("lib/server/secFields.ts"),
  extract,
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
  "export { extractCompanyFacts, SEC_FIELD_INDEX, filerTagsExcise };",
].join("\n");
const EXTRACT = strip("lib/server/secExtract.ts");
const swap = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor matched ${n} times, needs 1: ${from}`);
  return src.replace(from, to);
};
const CAND = swap(
  swap(EXTRACT, "if (!filerTagsExcise(facts)) {", "if (true) {"),
  "fb.val > rev.val * REVENUE_TOTAL_OVER_CONTRACT && !floorHolds",
  "fb.val > rev.val * 1 && !floorHolds",
).replace("fb.val > rev.val * REVENUE_TOTAL_OVER_CONTRACT)", "fb.val > rev.val * 1)");
if (CAND.includes("rev.val * REVENUE_TOTAL_OVER_CONTRACT")) throw new Error("factor anchor left in place");
const S = await lift(parts(EXTRACT));
const C = await lift(parts(CAND));
const I = S.SEC_FIELD_INDEX;

const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const CAND877 = new Set(JSON.parse(fs.readFileSync("data/content-candidates.json", "utf8")).symbols.map((x) => x.symbol));
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const mine = only.length ? only : Object.keys(REG).sort().filter((s) => REG[s]?.cik).filter((_, i) => i % N === K - 1);
const seenCik = new Set();
let lastAt = 0;
async function get(url) {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
const v = (p, k) => p?.values?.[I[k]]?.val ?? null;
const t = (p, k) => p?.values?.[I[k]]?.tag ?? null;
const pct = (a, b) => (a != null && b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const m = (x) => (x == null ? "—" : `${(x / 1e6).toFixed(1)}M`);
const gross = (p) => v(p, "grossProfit") ?? (v(p, "revenue") != null && v(p, "costOfRevenue") != null ? v(p, "revenue") - v(p, "costOfRevenue") : null);
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.002);
const tally = { filers: 0, same: 0, changed: 0, changedIn877: 0, ERROR: 0 };
const byWhy = { excise: 0, under5pct: 0, other: 0 };
for (const s of mine) {
  if (Date.now() - started > BUDGET_MS) break;
  const cik = String(REG[s].cik);
  if (seenCik.has(cik) && !only.length) continue;
  seenCik.add(cik);
  try {
    const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`);
    tally.filers++;
    const a = S.extractCompanyFacts(s, facts), b = C.extractCompanyFacts(s, facts);
    const diffs = [];
    for (const [bucket, A, B] of [["q", a.quarters, b.quarters], ["y", a.years, b.years]]) {
      const ends = new Set([...A.map((p) => p.end), ...B.map((p) => p.end)]);
      for (const e of ends) {
        const pa = A.find((p) => p.end === e), pb = B.find((p) => p.end === e);
        if (v(pa, "revenue") !== v(pb, "revenue")) diffs.push({ bucket, e, pa, pb });
      }
    }
    if (process.env.DETAIL) {
      // EVERY revenue-like concept the filer tags, for its newest year and newest quarter-length duration.
      const g = facts.facts?.["us-gaap"] ?? {};
      const rows = [];
      for (const [k, c] of Object.entries(g)) {
        if (!/Revenue|Sales|Grant/i.test(k) || /Cost|Deferred|Receivable|Expense|Tax|Unearned|Percentage|Remaining/i.test(k)) continue;
        for (const r of c.units?.USD ?? []) if (r.start && r.form && /^10-[KQ]/.test(r.form)) rows.push({ k, ...r, days: (Date.parse(r.end) - Date.parse(r.start)) / 864e5 });
      }
      const pick = (lo, hi) => { const rs = rows.filter((r) => r.days >= lo && r.days <= hi); const e = rs.map((r) => r.end).sort().at(-1); return rs.filter((r) => r.end === e); };
      for (const [label, rs] of [["year", pick(350, 380)], ["quarter", pick(80, 100)]]) {
        const seen = new Map();
        for (const r of rs) if (!seen.has(r.k) || r.filed > seen.get(r.k).filed) seen.set(r.k, r);
        console.log(`  ${s} ${label} ${rs[0]?.start ?? "?"}..${rs[0]?.end ?? "?"}: ${[...seen.values()].map((r) => `${r.k}=${m(r.val)}`).join("; ") || "none"}`);
      }
      for (const [lbl, list] of [["q", a.quarters.slice(-3)], ["y", a.years.slice(-2)]]) for (const p of list) console.log(`  ${s} stored ${lbl}:${p.start}..${p.end} revenue ${m(v(p, "revenue"))} [${t(p, "revenue")}]`);
    }
    if (!diffs.length) { tally.same++; if (only.length) console.log(`SAME ${s} revenue ${m(v(a.quarters.at(-1) ?? a.years.at(-1), "revenue"))} [${t(a.quarters.at(-1) ?? a.years.at(-1), "revenue")}]`); continue; }
    tally.changed++;
    if (CAND877.has(s)) tally.changedIn877++;
    const excise = S.filerTagsExcise(facts);
    const newest = diffs.filter((d) => d.bucket === "q").sort((x, y) => x.e.localeCompare(y.e)).at(-1) ?? diffs.sort((x, y) => x.e.localeCompare(y.e)).at(-1);
    const ra = v(newest.pa, "revenue"), rb = v(newest.pb, "revenue");
    const ratio = ra && rb ? rb / ra : null;
    const why = excise ? "excise" : ratio != null && ratio <= 1.05 ? "under5pct" : "other";
    byWhy[why]++;
    const gp = v(newest.pb, "grossProfit"), cogs = v(newest.pb, "costOfRevenue");
    const basis = gp != null && cogs != null ? (near(gp + cogs, rb) ? "GP+COGS=new" : near(gp + cogs, ra) ? "GP+COGS=old" : "GP+COGS=neither") : "no GP+COGS pair";
    const lost = diffs.filter((d) => v(d.pb, "revenue") == null).length, gained = diffs.filter((d) => v(d.pa, "revenue") == null).length;
    console.log(`CHANGED ${s}${CAND877.has(s) ? " [877]" : ""} why=${why} excise=${excise} periods=${diffs.length} (gained ${gained}, now unreported ${lost}) | newest ${newest.bucket}:${newest.e} ${m(ra)} [${t(newest.pa, "revenue")}] -> ${m(rb)} [${t(newest.pb, "revenue")}] x${ratio?.toFixed(3) ?? "—"} | gross margin ${pct(gross(newest.pa), ra)} -> ${pct(gross(newest.pb), rb)} | ${basis}`);
  } catch (e) { tally.ERROR++; console.log(`ERROR ${s} ${String(e?.message ?? e).slice(0, 80)}`); }
}
console.log(`\nshard ${K}/${N}: ${mine.length} symbols | ${JSON.stringify(tally)} | changed by reason ${JSON.stringify(byWhy)} | ${Math.round((Date.now() - started) / 1000)}s`);
