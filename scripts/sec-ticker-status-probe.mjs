// WHY A UNIVERSE SYMBOL HAS NO REGISTRANT ROW (#552 COWORK #29): EDGAR's
// CURRENT ticker file and each CIK's submissions (name, tickers, exchanges,
// the newest filings incl. 25 / 15-12B / 8-K12B). Read-only, no credential.
//   node scripts/sec-ticker-status-probe.mjs "BK:1390777,EA:712515,EQR:906107,WBS:801337"
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; ticker status)";
const pairs = (process.argv[2] || "").split(",").filter(Boolean).map((p) => p.split(":"));
const tf = await (await fetch("https://www.sec.gov/files/company_tickers_exchange.json", { headers: { "User-Agent": UA } })).json();
const rows = tf.data ?? [];
for (const [sym, cik] of pairs) {
  const byTicker = rows.filter((r) => String(r[2]).toUpperCase() === sym);
  const byCik = rows.filter((r) => String(r[0]) === String(Number(cik)));
  console.log(`\n===== ${sym} (CIK ${cik}): current ticker file by ticker ${JSON.stringify(byTicker)}; by CIK ${JSON.stringify(byCik)}`);
  const res = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": UA } });
  if (!res.ok) { console.log(`  submissions HTTP ${res.status}`); continue; }
  const j = await res.json();
  const r = j.filings?.recent ?? {};
  console.log(`  name ${j.name}; tickers ${(j.tickers ?? []).join(",") || "none"}; exchanges ${(j.exchanges ?? []).join(",") || "none"}; sic ${j.sic} ${j.sicDescription}`);
  const list = (r.form ?? []).map((f, i) => `${r.filingDate[i]} ${f}`).filter((x) => /(10-K|10-Q|25|15-12|15-15|8-K12|S-4|DEFM14A)\b/.test(x)).slice(0, 8);
  console.log(`  recent: ${list.join("; ")}`);
  await new Promise((x) => setTimeout(x, 200));
}
