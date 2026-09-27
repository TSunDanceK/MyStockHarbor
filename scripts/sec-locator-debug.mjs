// WHERE THE LOCATOR LANDS, FOR ONE FILER (#552 COWORK #38). Prints every short
// line whose letters-only key starts with "item" or "business", with its line
// index and offset, then the located body's length and first 600 characters.
// SEC text only; read-only, no credential.
//   node scripts/sec-locator-debug.mjs ABBV
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; locator debug)";
const D = await lift(readCodeOnly("lib/server/secDescription.ts"));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
for (const s of (process.argv[2] || "").split(",").filter(Boolean)) {
  const get = async (u) => { await new Promise((r) => setTimeout(r, 150)); return fetch(u, { headers: { "User-Agent": UA } }); };
  const sub = await (await get(`https://data.sec.gov/submissions/CIK${REG[s].cik}.json`)).json();
  const r = sub.filings.recent; const i = r.form.findIndex((f) => /^10-K/.test(f));
  const text = D.filingText(await (await get(`https://www.sec.gov/Archives/edgar/data/${Number(REG[s].cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`)).text());
  console.log(`== ${s} ${r.form[i]} ${r.accessionNumber[i]} text ${text.length} chars`);
  let at = 0, n = 0;
  for (const [k, t] of text.split("\n").entries()) {
    const key = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key.length <= 90 && /^(item|business|part)/.test(key) && n++ < 60) console.log(`  L${k} @${at}: ${JSON.stringify(t.trim().slice(0, 100))}`);
    at += t.length + 1;
  }
  const loc = D.locateSection(text, r.form[i]);
  console.log(loc.found ? `  BODY ${loc.body.length} chars @${text.indexOf(loc.body)}: ${JSON.stringify(loc.body.slice(0, 600))}` : `  MISS ${loc.why}`);
  const c = D.cleanDescription(loc.found ? loc.body : "", { companyName: sub.name });
  console.log(`  CLEAN ${JSON.stringify(c).slice(0, 700)}`);
}
