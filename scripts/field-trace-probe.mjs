// One field's cells through main's extraction, beside every raw companyfacts
// row of the named concepts for the same frames. Read-only, no credential.
// SYMBOLS="SCHW,MET|netIncome|NetIncomeLoss,ProfitLoss|cover,qrows" (the relay passes SYMBOLS only)
import fs from "node:fs";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";
const UA = "MyStockHarbor/1.0 (+https://www.mystockharbor.com; field trace)";
const { NEW, OLD } = await loadMainAndBranch();
const M = OLD ?? NEW;
const tick = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const ix = Object.fromEntries(tick.fields.map((f, i) => [f, i]));
const near = (a, b) => a && b && Math.abs(Date.parse(a) - Date.parse(b)) <= 10 * 864e5;
// The relay passes SYMBOLS only, so it carries everything: "SCHW,MET|netIncome|NetIncomeLoss,ProfitLoss|cover,qrows"
const [symArg, fieldArg, conceptArg, flagArg] = String(process.env.SYMBOLS || "SCHW").split("|");
const flags = new Set(String(flagArg || "").split(","));
const field = fieldArg || "netIncome";
const concepts = String(conceptArg || "NetIncomeLoss").split(",").filter(Boolean);
const years = 6;
const fmt = (v) => (v == null ? "—" : Math.abs(v) >= 1e5 ? `${(v / 1e6).toFixed(1)}M` : String(v));
for (const sym of symArg.split(",")) {
  const row = tick.data.find((r) => r[ix.ticker] === sym);
  if (!row) { console.log(`${sym}: not in company-tickers`); continue; }
  const facts = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(row[ix.cik]).padStart(10, "0")}.json`, { headers: { "User-Agent": UA } })).json();
  const ex = M.extractCompanyFacts(sym, facts);
  const fi = M.SEC_FIELD_KEYS.indexOf(field);
  console.log(`\n=== ${sym} ${field} (notes: ${(ex.notes ?? []).filter((n) => n.toLowerCase().includes(field.toLowerCase().slice(0, 6))).join(" | ") || "none"}) ===`);
  if (flags.has("cover")) {
    console.log(`cover: ${JSON.stringify(ex.coverShares ?? ex.cover ?? null)}`);
    const dei = Object.entries(facts.facts?.dei?.EntityCommonStockSharesOutstanding?.units ?? {}).flatMap(([u, rs]) => rs.map((r) => ({ ...r, u })));
    for (const r of dei.sort((a, b) => String(b.end).localeCompare(String(a.end))).slice(0, 8)) console.log(`    dei cover [${r.u}] ${r.val} end ${r.end} ${r.form} ${r.accn} filed ${r.filed}`);
    console.log(`    dei cover rows total: ${dei.length}`);
  }
  for (const [label, list] of [["Y", ex.years.slice(0, years)], ["Q", ex.quarters.slice(0, years * 2)]]) {
    for (const p of list) {
      const c = fi >= 0 ? p.values[fi] : null;
      console.log(`${label} ${p.fp ?? ""}${p.fy ?? ""} ${p.start}..${p.end}: site ${fmt(c?.val)} [${c?.tag ?? "-"}${c?.derived ? ` ${c.derived}` : ""}${c?.covers ? ` covers ${c.covers.join("..")}` : ""}]`);
      if (label === "Q" && !flags.has("qrows")) continue;
      for (const k of concepts) {
        const ns = facts.facts?.["us-gaap"]?.[k] ? "us-gaap" : facts.facts?.dei?.[k] ? "dei" : "ifrs-full";
        const units = facts.facts?.[ns]?.[k]?.units ?? {};
        for (const [u, rows] of Object.entries(units)) {
          for (const r of rows.filter((r) => (r.start ? near(r.start, p.start) && near(r.end, p.end) : near(r.end, p.end)))) {
            console.log(`    ${k} [${u}] ${fmt(r.val)} ${r.form} ${r.accn} fp=${r.fp}${r.fy} filed ${r.filed}${r.frame ? ` frame ${r.frame}` : ""}`);
          }
        }
      }
    }
  }
}
