// SPLIT SG&A ACROSS THE UNIVERSE (#552 COWORK #40 step 1). Reads only.
//
// The us-gaap sellingGeneralAndAdministrative chain is
// [SellingGeneralAndAdministrativeExpense, GeneralAndAdministrativeExpense],
// so a filer that files Sales & marketing and G&A as two lines, with no
// combined tag, shows G&A alone as "SG&A", and the waterfall's reconcile guard
// then hides the bars (GOOGL Q2 FY2026: an 8.41B gap).
//
// Part A: GOOGL's own companyfacts, the tags and values for its newest
// quarters, so the 6.46B's tag is read rather than inferred.
// Part B: one SEC frames request per tag for one calendar quarter (CY2026Q2
// by default), intersected with data/sec/registrants.json's CIKs. Counts only.
//   relay task: sga-split-coverage   (read-only, uncredentialled)
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; sga coverage)";
const FRAME = process.env.FRAME || "CY2026Q2";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const universe = new Set(Object.values(REG).map((r) => Number(r.cik)).filter(Boolean));

let lastAt = 0;
const get = async (url) => {
  const wait = Math.max(0, lastAt + 150 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  return fetch(url, { headers: { "User-Agent": UA } });
};

// ── A: GOOGL ──────────────────────────────────────────────────────────────
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const TAGS_A = [
  "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "CostOfRevenue",
  "ResearchAndDevelopmentExpense", "SellingGeneralAndAdministrativeExpense",
  "GeneralAndAdministrativeExpense", "SellingAndMarketingExpense", "MarketingExpense",
  "SellingExpense", "AdvertisingExpense", "OperatingIncomeLoss", "CostsAndExpenses",
];
for (const sym of ["GOOGL"]) {
  const cik = String(cikMap[sym] ?? "").padStart(10, "0");
  const res = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!res.ok) { console.log(`${sym}: companyfacts HTTP ${res.status}`); continue; }
  const g = (await res.json()).facts?.["us-gaap"] ?? {};
  console.log(`${sym} (CIK ${cik}) — three-month rows, newest 2 per tag`);
  for (const t of TAGS_A) {
    const rows = (g[t]?.units?.USD ?? []).filter((r) => r.start && r.end &&
      (Date.parse(r.end) - Date.parse(r.start)) / 86_400_000 < 100);
    const byEnd = [...new Map(rows.map((r) => [r.end, r])).values()].sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 2);
    console.log(`  ${t.padEnd(56)} ${byEnd.length ? byEnd.map((r) => `${r.end}=${(r.val / 1e9).toFixed(2)}B`).join("  ") : "not filed"}`);
  }
}

// ── B: the universe, one frame per tag ────────────────────────────────────
async function frame(tag) {
  const res = await get(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${FRAME}.json`);
  if (res.status === 404) return new Set();
  if (!res.ok) throw new Error(`${tag}: HTTP ${res.status}`);
  const j = await res.json();
  return new Set((j.data ?? []).map((d) => Number(d.cik)).filter((c) => universe.has(c)));
}
const SELL = ["SellingAndMarketingExpense", "MarketingExpense", "SellingExpense"];
const TAGS_B = ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense", ...SELL, "OperatingIncomeLoss"];
const has = {};
console.log(`\nframe ${FRAME}, universe ${universe.size} CIKs`);
for (const t of TAGS_B) { has[t] = await frame(t); console.log(`  ${t.padEnd(56)} ${has[t].size}`); }
const sellAny = new Set(SELL.flatMap((t) => [...has[t]]));
const combined = has.SellingGeneralAndAdministrativeExpense;
const ga = has.GeneralAndAdministrativeExpense;
const split = [...ga].filter((c) => sellAny.has(c) && !combined.has(c));
const both = [...ga].filter((c) => sellAny.has(c) && combined.has(c));
const gaOnly = [...ga].filter((c) => !sellAny.has(c) && !combined.has(c));
console.log(`\nG&A + a selling/marketing tag, NO combined SG&A (would be summed): ${split.length}`);
for (const t of SELL) console.log(`    of which ${t}: ${split.filter((c) => has[t].has(c)).length}`);
console.log(`G&A + selling tag AND the combined tag too (must NOT be summed): ${both.length}`);
console.log(`G&A alone, no selling tag, no combined (unchanged): ${gaOnly.length}`);
console.log(`split filers that also file OperatingIncomeLoss (reconcile can run): ${split.filter((c) => has.OperatingIncomeLoss.has(c)).length}`);
