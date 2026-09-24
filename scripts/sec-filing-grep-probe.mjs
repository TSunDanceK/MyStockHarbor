// QUOTE A PASSAGE FROM A FILER'S LATEST FILING OF A FORM (#552 COWORK #31):
// e.g. Visa's "Conversion Rate Into Class A Common Stock" table in its latest
// 10-Q, so a class weight is cited from the filing's own numbers. Prints
// ~1,800 characters of text after each match (max 3). Read-only, no credential.
//   node scripts/sec-filing-grep-probe.mjs "V|10-Q|Conversion Rate Into Class A"
import fs from "node:fs";
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; filing grep)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA } }); await new Promise((x) => setTimeout(x, 130)); return r; };
for (const spec of (process.argv[2] || "").split(";").filter(Boolean)) {
  const [sym, form, needle] = spec.split("|");
  const cik = String(REG[sym]?.cik ?? "").padStart(10, "0");
  const subs = await (await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).json();
  const r = subs.filings?.recent ?? {};
  const i = (r.form ?? []).findIndex((f) => f === form);
  if (i < 0) { console.log(`== ${sym}: no ${form}`); continue; }
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`;
  const text = (await (await get(url)).text()).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;|&#8203;/g, " ").replace(/&#8212;/g, "—").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  console.log(`\n== ${sym} | ${form} ${r.filingDate[i]} ${r.accessionNumber[i]} | reportDate ${r.reportDate[i]}`);
  let from = 0, n = 0;
  while (n < 3) {
    const at = text.toLowerCase().indexOf(needle.toLowerCase(), from);
    if (at < 0) break;
    console.log(`   >> ${text.slice(Math.max(0, at - 200), at + 1800)}`);
    from = at + needle.length; n++;
  }
}
