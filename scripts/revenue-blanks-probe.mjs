// Revenue series through main's extraction, with each blank period's filed
// bank halves and totals beside it. Read-only, no credential. SYMBOLS=BPOP,MCHB
import fs from "node:fs";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";
const UA = "MyStockHarbor/1.0 (+https://www.mystockharbor.com; revenue blanks probe)";
const { NEW, OLD } = await loadMainAndBranch();
const M = OLD ?? NEW;
const tick = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const ix = Object.fromEntries(tick.fields.map((f, i) => [f, i]));
const near = (a, b) => a && b && Math.abs(Date.parse(a) - Date.parse(b)) <= 10 * 864e5;
for (const sym of String(process.env.SYMBOLS || process.argv[2] || "BPOP,MCHB").split(",")) {
  const row = tick.data.find((r) => r[ix.ticker] === sym);
  if (!row) { console.log(`${sym}: not in company-tickers`); continue; }
  const facts = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(row[ix.cik]).padStart(10, "0")}.json`, { headers: { "User-Agent": UA } })).json();
  const ex = M.extractCompanyFacts(sym, facts);
  const ri = M.SEC_FIELD_KEYS.indexOf("revenue");
  const filed = (c, p) => {
    const rows = (facts.facts?.["us-gaap"]?.[c]?.units?.USD ?? []).filter((r) => near(r.start, p.start) && near(r.end, p.end));
    const r = rows.sort((a, b) => String(b.filed).localeCompare(String(a.filed)))[0];
    return r ? `${(r.val / 1e6).toFixed(1)} (${r.form} ${r.accn})` : "—";
  };
  console.log(`\n=== ${sym} (${(ex.notes ?? []).filter((n) => /revenue|bank/i.test(n)).join(" | ") || "no revenue notes"}) ===`);
  for (const [label, list] of [["years", ex.years], ["quarters", ex.quarters]]) {
    const filledIdx = list.map((p, i) => (p.values[ri]?.val != null ? i : -1)).filter((i) => i >= 0);
    const lo = Math.min(...filledIdx), hi = Math.max(...filledIdx);
    for (const [i, p] of list.entries()) {
      const r = p.values[ri];
      const tag = r?.val != null ? `${(r.val / 1e6).toFixed(1)} ${r.tag ?? ""}${r.derived ? ` (${r.derived})` : ""}` : `BLANK${i > lo && i < hi ? " (interior)" : ""}`;
      console.log(`${label} ${p.fp ?? ""}${p.fy ?? ""} ${p.start}..${p.end}: ${tag}`);
      if (r?.val == null) for (const c of ["InterestIncomeExpenseNet", "NoninterestIncome", "Revenues", "RevenuesNetOfInterestExpense", "InterestAndDividendIncomeOperating"]) console.log(`    ${c}: ${filed(c, p)}`);
    }
  }
}
