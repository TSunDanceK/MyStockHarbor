// ANNUAL VALUES OF NAMED TAGS, per unit, from a filer's companyfacts (#552
// COWORK #57: JD's non-operating line). SEC values only; reads only.
//   relay task: sec-tag-values   SYMBOLS="JD"  TAGS="A,B"
import fs from "node:fs";
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; tag values probe)";
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const syms = (process.env.SYMBOLS || "JD").split(/[\s,]+/).filter(Boolean);
const tags = (process.env.TAGS || "NonoperatingIncomeExpense,OtherNonoperatingIncomeExpense,IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest,OperatingIncomeLoss").split(",");
for (const s of syms) {
  const cik = String(cikMap[s] ?? "").padStart(10, "0");
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA } });
  if (!r.ok) { console.log(`${s}: HTTP ${r.status}`); continue; }
  const facts = (await r.json()).facts ?? {};
  for (const t of tags) for (const ns of Object.keys(facts)) {
    const u = facts[ns]?.[t]?.units; if (!u) continue;
    for (const [unit, list] of Object.entries(u)) {
      const annual = list.filter((x) => x.start && (Date.parse(x.end) - Date.parse(x.start)) / 864e5 > 350 && x.end >= "2018-01-01");
      const byEnd = new Map(); for (const x of annual) byEnd.set(x.end, x); // last filed wins
      console.log(`${s} ${ns}:${t} [${unit}] ${[...byEnd.values()].sort((a, b) => a.end < b.end ? -1 : 1).map((x) => `${x.end.slice(0, 4)}=${(x.val / 1e6).toFixed(1)}M`).join(" ")}`);
    }
  }
}
