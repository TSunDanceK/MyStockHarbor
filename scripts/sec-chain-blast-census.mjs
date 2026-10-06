// BLAST RADIUS OF THE #187 §3/§4 CHAIN EDITS, BEFORE BUILDING (#552 COWORK #191).
// READ-ONLY: companyfacts only, no store, SEC paced at 4/s. Universe: the 200 cut
// (data/due-strip.json). Approximates the extractor's selector -- the concept
// covering the filer's NEWEST period, chain rank breaking ties -- on raw rows.
//   REV  filers whose newest revenue period resolves to RevenueFromContract…
//        while Revenues for the SAME (start,end) is > 5% larger. Excise-tax
//        filers are flagged, since their Revenues can be gross of excise.
//   NI   filers where NetIncomeLossAvailableToCommonStockholdersBasic, added
//        LAST, would become the preferred concept (newer end than NetIncomeLoss
//        and ProfitLoss), and how many periods it would fill vs differ.
//   DEBT filers with no short/long debt at the newest balance instant under
//        today's chain, that NotesPayableCurrent / LongTermNotesPayable fill.
import fs from "node:fs";
const UA = process.env.PROBE_USER_AGENT ?? "MyStockHarbor/1.0 (+https://www.mystockharbor.com; filing research)";
const CUT = JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  await sleep(250);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: await res.json() };
}
const days = (f) => (f.start ? (Date.parse(f.end) - Date.parse(f.start)) / 864e5 : 0);
const tick = await getJson("https://www.sec.gov/files/company_tickers.json");
if (!tick.ok) { console.error(`FATAL: tickers ${tick.status}`); process.exit(2); }
const cikOf = new Map(Object.values(tick.body).map((r) => [String(r.ticker).toUpperCase().replace(/-/g, "."), String(r.cik_str).padStart(10, "0")]));
const REV_CHAIN = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"];
const SHORT = ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"];
const LONG = ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"];
const usd = (g, name) => (g?.[name]?.units?.USD ?? []).filter((f) => f.val != null);
const dur = (rows) => rows.filter((f) => f.start && days(f) >= 80);
const newestEnd = (rows) => rows.reduce((m, f) => (f.end > m ? f.end : m), "");
const out = { rev: [], ni: [], debt: [], noCik: [], err: [] };
let n = 0;
for (const sym of CUT) {
  const cik = cikOf.get(sym) ?? cikOf.get(sym.replace(".", "-"));
  if (!cik) { out.noCik.push(sym); continue; }
  const r = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!r.ok) { out.err.push(`${sym}:${r.status}`); continue; }
  n++;
  const g = r.body.facts?.["us-gaap"];
  if (!g) continue; // IFRS filer: none of these chains apply
  // REV
  const revRows = REV_CHAIN.map((t, rank) => dur(usd(g, t)).map((f) => ({ ...f, t, rank }))).flat();
  const ne = newestEnd(revRows);
  if (ne) {
    const atNe = revRows.filter((f) => f.end === ne).sort((a, b) => a.rank - b.rank);
    const best = atNe[0];
    if (best.t === REV_CHAIN[0]) {
      const same = atNe.find((f) => f.t === "Revenues" && f.start === best.start);
      if (same && same.val > best.val * 1.05) {
        const excise = Object.keys(g).some((k) => /Excise/.test(k));
        out.rev.push(`${sym} ${ne} RFC=${best.val} Revenues=${same.val} x${(same.val / best.val).toFixed(2)}${excise ? " EXCISE-TAGGED" : ""}`);
      }
    }
  }
  // NI
  const niOld = [...dur(usd(g, "NetIncomeLoss")), ...dur(usd(g, "ProfitLoss"))];
  const niNew = dur(usd(g, "NetIncomeLossAvailableToCommonStockholdersBasic"));
  if (niNew.length && newestEnd(niNew) > newestEnd(niOld)) {
    const key = (f) => `${f.start}|${f.end}`;
    const old = new Map(dur(usd(g, "NetIncomeLoss")).map((f) => [key(f), f.val]));
    let fill = 0, differ = 0, equal = 0;
    for (const f of niNew) { const o = old.get(key(f)); if (o == null) fill++; else if (Math.abs(o - f.val) > Math.abs(o) * 0.001) differ++; else equal++; }
    out.ni.push(`${sym} NI newest ${newestEnd(niOld) || "none"} → avail newest ${newestEnd(niNew)} · rows fill ${fill} equal ${equal} DIFFER ${differ}`);
  }
  // DEBT
  const inst = (t) => usd(g, t).filter((f) => !f.start);
  const all = Object.values(g).flatMap((c) => (c.units?.USD ?? []).filter((f) => !f.start && f.form !== "DEF 14A"));
  const bsEnd = newestEnd(all.filter((f) => f.form && /^(10-K|10-Q|20-F|40-F|6-K)/.test(f.form)));
  const has = (chain) => chain.some((t) => inst(t).some((f) => f.end === bsEnd));
  if (bsEnd && !has(SHORT) && !has(LONG)) {
    const npc = inst("NotesPayableCurrent").find((f) => f.end === bsEnd);
    const ltnp = inst("LongTermNotesPayable").find((f) => f.end === bsEnd);
    out.debt.push(`${sym} ${bsEnd}: ${npc || ltnp ? `FILLED short=${npc?.val ?? "-"} long=${ltnp?.val ?? "-"}` : "still none"}`);
  }
}
console.log(`read ${n}/${CUT.length} · no cik: ${out.noCik.join(" ") || "-"} · errors: ${out.err.join(" ") || "-"}`);
console.log(`\nREV rule would flip ${out.rev.length}:`); out.rev.forEach((l) => console.log("  " + l));
console.log(`\nNI avail-to-common would become preferred for ${out.ni.length}:`); out.ni.forEach((l) => console.log("  " + l));
console.log(`\nDEBT none at newest instant under today's chain: ${out.debt.length}`); out.debt.forEach((l) => console.log("  " + l));
