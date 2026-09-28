// AN ISSUER'S 6-Ks IN A DATE WINDOW, GREPPED (#552 COWORK #64: MFG's ADS ratio
// around its 2020 share consolidation). Lists every 6-K filed between FROM and
// TO on all submission pages, fetches each primary document and every .htm/.txt
// exhibit in its index, and prints the sentences matching GREP. SEC text only;
// read-only; no credential. ≤8 req/s.
//   SYMBOLS=MFG FROM=2020-07-01 TO=2020-12-31 node scripts/sixk-grep-probe.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; 6-K grep probe)";
const D = await import("../lib/server/secDescription.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const FROM = process.env.FROM || "2020-07-01", TO = process.env.TO || "2020-12-31";
const GREP = new RegExp(`[^.]{0,300}(?:${process.env.GREP || "ADS ratio|ratio of (?:the )?ADS|American Depositary Share|depositary share|ratio change"})[^.]{0,300}`, "gi");
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return as === "json" ? res.json() : res.text();
}
for (const s of (process.env.SYMBOLS || "MFG").split(/[,\s]+/).filter(Boolean)) {
  const cik = String(REG[s]?.cik ?? "").padStart(10, "0");
  const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const all = [];
  const add = (p) => (p.form ?? []).forEach((f, i) => { if (f === "6-K" && p.filingDate[i] >= FROM && p.filingDate[i] <= TO) all.push({ acc: p.accessionNumber[i], filed: p.filingDate[i], doc: p.primaryDocument[i] }); });
  add(sub.filings?.recent ?? {});
  for (const f of sub.filings?.files ?? []) add(await get(`https://data.sec.gov/submissions/${f.name}`));
  all.sort((a, b) => a.filed.localeCompare(b.filed));
  console.log(`== ${s}: ${all.length} 6-Ks ${FROM}..${TO}`);
  for (const x of all) {
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${x.acc.replace(/-/g, "")}`;
    let docs = [x.doc];
    try {
      const idx = await get(`${base}/index.json`);
      docs = [...new Set([x.doc, ...(idx.directory?.item ?? []).map((it) => it.name).filter((n) => /\.(htm|html|txt)$/i.test(n) && !/index/i.test(n))])];
    } catch { /* primary only */ }
    let hits = 0;
    for (const d of docs.slice(0, 6)) {
      try {
        const flat = D.filingText(await get(`${base}/${d}`, "text")).replace(/\s+/g, " ");
        const title = flat.slice(0, 160);
        for (const m of flat.matchAll(GREP)) {
          if (hits++ >= 8) break;
          console.log(`  ${x.filed} ${x.acc} ${d}: ${m[0].trim()}`);
        }
        if (!hits && d === x.doc) console.log(`  ${x.filed} ${x.acc} (no match) ${title}`);
      } catch (e) { console.log(`  ${x.filed} ${x.acc} ${d} ERROR ${String(e?.message ?? e)}`); }
    }
  }
}
