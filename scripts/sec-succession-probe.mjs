// IS A NEW REGISTRANT THE SUCCESSOR OF AN OLD ONE? (#552 COWORK #28, XOM)
// Reads EDGAR submissions for the given CIK pairs and prints each filer's
// name, former names, and recent filings by form and date, so a succession
// (8-K12B on the successor, 15-12B / 25 on the predecessor) is cited from the
// filings themselves. Read-only, no credential.
//   PAIRS="2115436:34088" node scripts/sec-succession-probe.mjs
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; succession probe)";
const pairs = (process.env.PAIRS || process.argv[2] || "2115436:34088").split(",").map((p) => p.split(":"));
for (const [succ, pred] of pairs) {
  for (const [role, cik] of [["successor", succ], ["predecessor", pred]]) {
    const pad = String(cik).padStart(10, "0");
    const res = await fetch(`https://data.sec.gov/submissions/CIK${pad}.json`, { headers: { "User-Agent": UA } });
    console.log(`\n===== ${role} CIK ${pad}: HTTP ${res.status}`);
    if (!res.ok) continue;
    const j = await res.json();
    console.log(`  name: ${j.name}; tickers: ${(j.tickers ?? []).join(",") || "none"}; exchanges: ${(j.exchanges ?? []).join(",") || "none"}; fiscalYearEnd ${j.fiscalYearEnd}`);
    console.log(`  former names: ${(j.formerNames ?? []).map((f) => `${f.name} (${f.from?.slice(0, 10)}..${f.to?.slice(0, 10)})`).join("; ") || "none"}`);
    const r = j.filings?.recent ?? {};
    const rows = (r.form ?? []).map((form, i) => ({ form, filed: r.filingDate[i], report: r.reportDate[i], accn: r.accessionNumber[i], doc: r.primaryDocDescription?.[i] ?? "" }));
    const interesting = rows.filter((x) => /^(8-K12B|8-K12G3|15-12B|15-12G|25|25-NSE|10-K|10-Q|S-4|424B3|8-K)$/.test(x.form)).slice(0, 25);
    for (const x of interesting) console.log(`  ${x.filed} ${x.form.padEnd(8)} report ${x.report || "—"} ${x.accn} ${x.doc}`.trimEnd());
    await new Promise((res2) => setTimeout(res2, 200));
  }
}
