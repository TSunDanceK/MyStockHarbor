// THE DEPOSITARY'S F-6 FILINGS FOR AN ISSUER (#552 COWORK #63, MFG). An F-6 is
// filed under the depositary-share registrant's CIK, not the issuer's, so it is
// found through EDGAR full-text search. Prints each hit's form, accession, date
// and every sentence stating what one ADS represents. SEC text only; read-only.
//   QUERY="Mizuho Financial Group" node scripts/f6-search-probe.mjs
import "./lib/register-ts-here.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; f6 search probe)";
const D = await import("../lib/server/secDescription.ts");
const q = process.env.QUERY || process.env.SYMBOLS || "Mizuho Financial Group";
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return as === "json" ? res.json() : res.text();
}
const hits = [];
for (const forms of ["F-6", "F-6 POS", "F-6EF", "424B3"]) {
  try {
    const r = await get(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&forms=${encodeURIComponent(forms)}`);
    for (const h of r.hits?.hits ?? []) hits.push({ form: h._source?.form ?? h._source?.root_forms?.[0], filed: h._source?.file_date, id: h._id, ciks: h._source?.ciks, names: h._source?.display_names });
  } catch (e) { console.log(`search ${forms}: ERROR ${String(e?.message ?? e)}`); }
}
hits.sort((a, b) => String(b.filed).localeCompare(String(a.filed)));
console.log(`"${q}": ${hits.length} hits`);
for (const h of hits.slice(0, 12)) console.log(`  ${h.form} ${h.filed} ${h.id} ${JSON.stringify(h.names)}`);
for (const h of hits.slice(0, 5)) {
  const [acc, doc] = String(h.id).split(":");
  const cik = Number(h.ciks?.[0]);
  try {
    const flat = D.filingText(await get(`https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${doc}`, "text")).replace(/\s+/g, " ");
    console.log(`\n-- ${h.form} ${h.filed} ${acc}`);
    let n = 0;
    for (const m of flat.matchAll(/[^.]{0,250}(?:represent|ratio|each American Depositary Share)[^.]{0,250}/gi)) {
      if (n++ >= 8) break;
      console.log(`  f6: ${m[0].trim()}`);
    }
  } catch (e) { console.log(`\n-- ${h.id} ERROR ${String(e?.message ?? e)}`); }
}
