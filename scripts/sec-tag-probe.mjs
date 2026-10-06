// WHICH TAGS DO THE #187 §3/§4 GAPS ACTUALLY FILE? (#552 COWORK #191). READ-ONLY.
//
// No store access: the read-only relay job has no credentials and no Upstash
// client. companyfacts only, one request per symbol, SEC <= 8/s (paced at 4/s).
// For each symbol it prints, newest first, the concepts whose names match the
// gap being probed, so a fix adds a tag the filer really uses rather than one
// that looked plausible:
//   DEBT  -- debt/borrowing/notes-payable instants (ORCL CAT ARM BUD UL PDD F)
//   NI    -- net-income durations by period length (BKNG; quarters vs years)
//   EPS   -- every EarningsPerShare* concept and unit (HSY BRK.B KKR)
//   SHR   -- share-count concepts dei + us-gaap (F AFRM)
const UA = process.env.PROBE_USER_AGENT ?? "MyStockHarbor/1.0 (+https://www.mystockharbor.com; filing research)";
const GROUPS = {
  DEBT: { syms: ["ORCL", "CAT", "ARM", "BUD", "UL", "PDD", "F"], re: /(Debt|Borrowing|NotesPayable|LoansPayable|CommercialPaper|FinanceLeaseLiabilit)/, instant: true },
  NI: { syms: ["BKNG"], re: /^(NetIncomeLoss|ProfitLoss|NetIncomeLossAvailableToCommonStockholdersBasic|ProfitLossAttributableToOwnersOfParent)$/, instant: false },
  EPS: { syms: ["HSY", "BRK.B", "KKR"], re: /EarningsPerShare|IncomeLossFromContinuingOperationsPerBasicShare/, instant: false },
  SHR: { syms: ["F", "AFRM"], re: /(SharesOutstanding|WeightedAverageNumberOf|PublicFloat|SharesIssued)/, instant: null },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  await sleep(250);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: await res.json() };
}
const days = (f) => (f.start ? Math.round((Date.parse(f.end) - Date.parse(f.start)) / 864e5) : 0);
const tick = await getJson("https://www.sec.gov/files/company_tickers.json");
if (!tick.ok) { console.error(`FATAL: tickers ${tick.status}`); process.exit(2); }
const cikOf = new Map(Object.values(tick.body).map((r) => [String(r.ticker).toUpperCase().replace(/-/g, "."), String(r.cik_str).padStart(10, "0")]));
for (const [group, g] of Object.entries(GROUPS)) {
  for (const sym of g.syms) {
    const cik = cikOf.get(sym) ?? cikOf.get(sym.replace(".", "-"));
    console.log(`\n=== ${group} ${sym} cik=${cik ?? "?"}`);
    if (!cik) continue;
    const r = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    if (!r.ok) { console.log(`  companyfacts ${r.status}`); continue; }
    const rows = [];
    for (const [tax, concepts] of Object.entries(r.body.facts ?? {})) {
      for (const [name, c] of Object.entries(concepts)) {
        if (!g.re.test(name)) continue;
        for (const [unit, facts] of Object.entries(c.units ?? {})) {
          const pick = facts.filter((f) => (g.instant === true ? !f.start : g.instant === false ? !!f.start : true));
          if (!pick.length) continue;
          const newest = pick.reduce((a, b) => (a.end > b.end || (a.end === b.end && a.filed > b.filed) ? a : b));
          const q = pick.filter((f) => days(f) >= 80 && days(f) <= 100);
          const qEnds = [...new Set(q.map((f) => f.end))].sort().slice(-8);
          const fy = [...new Set(pick.filter((f) => days(f) >= 350).map((f) => f.end))].sort().slice(-3);
          rows.push({ tax, name, unit, end: newest.end, val: newest.val, form: newest.form, fp: newest.fp, n: pick.length, qEnds, fy, d: days(newest) });
        }
      }
    }
    rows.sort((a, b) => (a.end < b.end ? 1 : -1));
    for (const x of rows.slice(0, 30)) {
      let line = `  ${x.tax}:${x.name} [${x.unit}] newest ${x.end}${x.d ? ` (${x.d}d)` : ""} ${x.form}/${x.fp} val=${x.val} n=${x.n}`;
      if (group === "NI" || group === "EPS") line += `\n      quarter ends: ${x.qEnds.join(" ") || "none"} | year ends: ${x.fy.join(" ") || "none"}`;
      console.log(line);
    }
    if (rows.length > 30) console.log(`  … ${rows.length - 30} more (older newest-end)`);
  }
}
