// A filer's newest balance-sheet dates through this branch's extraction,
// beside every raw companyfacts row of the named concepts filed for those
// dates. Read-only, no credential.
// SYMBOLS="CVX,TRV|shortTermDebt,longTermDebt|LongTermDebtAndCapitalLeaseObligations,ShortTermBorrowings"
//   relay task: instant-trace
import fs from "node:fs";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";
const UA = "MyStockHarbor/1.0 (+https://www.mystockharbor.com; instant trace)";
const { NEW } = await loadMainAndBranch();
const tick = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const ix = Object.fromEntries(tick.fields.map((f, i) => [f, i]));
const [symArg, fieldArg, conceptArg] = String(process.env.SYMBOLS || "CVX").split("|");
const fields = String(fieldArg || "shortTermDebt,longTermDebt").split(",").filter(Boolean);
const concepts = String(conceptArg || "").split(",").filter(Boolean);
const fmt = (v) => (v == null ? "—" : `${(v / 1e6).toFixed(1)}M`);
for (const sym of symArg.split(",")) {
  const row = tick.data.find((r) => r[ix.ticker] === sym);
  if (!row) { console.log(`${sym}: not in company-tickers`); continue; }
  const facts = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(row[ix.cik]).padStart(10, "0")}.json`, { headers: { "User-Agent": UA } })).json();
  const ex = NEW.extractCompanyFacts(sym, facts);
  console.log(`\n=== ${sym} (notes: ${(ex.notes ?? []).filter((n) => /debt|borrow/i.test(n)).join(" | ") || "none"}) ===`);
  for (const p of ex.instants.slice(0, 3)) {
    console.log(`I ${p.end}: ${fields.map((f) => { const c = p.values[NEW.SEC_FIELD_KEYS.indexOf(f)]; return `${f}=${fmt(c?.val)}${c?.tag ? ` [${c.tag}]` : ""}`; }).join("  ")}`);
    for (const t of concepts) {
      const rows = (facts.facts?.["us-gaap"]?.[t]?.units?.USD ?? []).filter((r) => !r.start && r.end === p.end);
      for (const r of rows.slice(-2)) console.log(`    ${t} ${fmt(r.val)} ${r.form} ${r.accn} filed ${r.filed}`);
    }
  }
}
