// THE COVER'S PER-CLASS SHARE COUNTS, BY MEMBER, FROM THE NEWEST 10-Q/10-K
// INSTANCE (audit r4, item 4): the member names a share-classes entry must use,
// and the counts it will combine. Read-only, SEC only, no credential.
//   SYMBOLS="HEI:46619,FOXA:1754301,FIG:1579878"   relay task: sec-cover-members
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; cover members probe)";
const get = async (u) => { await new Promise((x) => setTimeout(x, 150)); const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r; };
for (const pair of String(process.env.SYMBOLS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const [sym, cikRaw] = pair.split(":");
  const cik = String(Number(cikRaw));
  try {
    const sub = await (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json();
    const r = sub.filings.recent;
    const i = r.form.findIndex((f) => f === "10-Q" || f === "10-K");
    const accn = r.accessionNumber[i];
    const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}`;
    const idx = await (await get(`${base}/index.json`)).json();
    const names = idx.directory.item.map((x) => x.name);
    const inst = names.find((n) => /_htm\.xml$/i.test(n)) ?? names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre)\.xml$/i.test(n));
    const xml = await (await get(`${base}/${inst}`)).text();
    const ctx = new Map();
    for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
      const mem = m[2].match(/dimension="[\w-]+:StatementClassOfStockAxis"[^>]*>\s*([\w-]+:)?(\w+)\s*</);
      const inst2 = m[2].match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1];
      ctx.set(m[1], { member: mem ? mem[2] : "(no class axis)", date: inst2 });
    }
    console.log(`== ${sym} ${r.form[i]} ${accn} filed ${r.filingDate[i]} period ${r.reportDate[i]} (${inst})`);
    for (const m of xml.matchAll(/<dei:EntityCommonStockSharesOutstanding\b[^>]*contextRef="([^"]+)"[^>]*>([^<]+)</g)) {
      const c = ctx.get(m[1]);
      console.log(`  ${c?.member ?? "?"} | ${c?.date ?? "?"} | ${Number(m[2]).toLocaleString("en-US")}`);
    }
    const tsym = xml.matchAll(/<dei:TradingSymbol\b[^>]*contextRef="([^"]+)"[^>]*>([^<]+)</g);
    for (const m of tsym) console.log(`  trading symbol ${m[2].trim()} on ${ctx.get(m[1])?.member ?? "?"}`);
  } catch (e) { console.log(`== ${sym}: ${e.message}`); }
}
