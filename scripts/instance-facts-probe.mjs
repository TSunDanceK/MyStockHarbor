// FACTS IN A FILER'S NEWEST 10-Q/10-K INSTANCE WHOSE CONCEPT MATCHES A PATTERN
// (#552 COWORK #38: where V states its as-converted rates). Prints concept,
// period, dimensions and value. SEC data only; read-only, no credential.
//   PATTERN="Conversion" node scripts/instance-facts-probe.mjs V
import fs from "node:fs";
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; instance facts)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const re = new RegExp(process.env.PATTERN || "Conversion", "i");
const get = async (u) => { await new Promise((r) => setTimeout(r, 150)); return fetch(u, { headers: { "User-Agent": UA } }); };
for (const s of (process.argv[2] || "").split(",").filter(Boolean)) {
  const cik = REG[s].cik;
  const r = (await (await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).json()).filings.recent;
  const i = r.form.findIndex((f) => f === "10-Q" || f === "10-K");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}`;
  const name = (await (await get(`${base}/index.json`)).json()).directory.item.map((x) => x.name).find((n) => /_htm\.xml$/.test(n));
  const xml = await (await get(`${base}/${name}`)).text();
  const ctx = new Map();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const per = (m[2].match(/<(?:[\w-]+:)?(?:instant|endDate)>\s*([\d-]+)/) ?? [])[1];
    const st = (m[2].match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/) ?? [])[1];
    const dims = [...m[2].matchAll(/dimension="([^"]+)"[^>]*>\s*([^<\s]+)/g)].map((d) => `${d[1].replace(/^.*:/, "")}=${d[2].replace(/^.*:/, "")}`).join(",");
    ctx.set(m[1], `${st ? st + ".." : ""}${per} [${dims || "-"}]`);
  }
  console.log(`== ${s} ${r.form[i]} ${r.accessionNumber[i]} filed ${r.filingDate[i]}`);
  let n = 0;
  for (const m of xml.matchAll(/<([\w-]+):(\w+)\b([^>]*)>\s*([^<]{1,60}?)\s*<\/\1:\2>/g)) {
    if (!re.test(m[2])) continue;
    const c = ctx.get((m[3].match(/contextRef="([^"]+)"/) ?? [])[1]);
    if (n++ < Number(process.env.LIMIT || 60)) console.log(`  ${m[1]}:${m[2]} ${c} = ${m[4]}`);
  }
}
