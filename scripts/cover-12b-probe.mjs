// THE 12(b) TABLE AND COVER COUNT OF THE NEWEST ANNUAL FILING (#552 COWORK #61
// CCZ, #63 MFG). SEC text only; read-only, no credential, no Redis. ≤8 req/s.
//   SYMBOLS="CMCSA MFG" node scripts/cover-12b-probe.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; 12b probe)";
const D = await import("../lib/server/secDescription.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const syms = (process.env.SYMBOLS || "CMCSA").split(/[,\s]+/).filter(Boolean);
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return as === "json" ? res.json() : res.text();
}
for (const s of syms) {
  try {
    const cik = String(REG[s]?.cik ?? "");
    if (!cik) { console.log(`\n== ${s}: no CIK in registrants`); continue; }
    const r = (await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).filings?.recent ?? {};
    const forms = (process.env.FORMS || "10-K,20-F,40-F,F-6,F-6EF,F-6 POS").split(",");
    for (const f of forms) {
      const i = (r.form ?? []).indexOf(f);
      if (i < 0) continue;
      const text = D.filingText(await get(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`, "text"));
      const flat = text.replace(/\s+/g, " ");
      console.log(`\n== ${s} ${f} ${r.accessionNumber[i]} filed ${r.filingDate[i]}`);
      const at = flat.search(/registered,?\s+(or\s+to\s+be\s+registered,?\s+)?pursuant\s+to\s+Section\s+12\s*\(\s*b\s*\)/i);
      console.log(`  12(b): ${at < 0 ? "not found" : flat.slice(at, at + 1800)}`);
      let shown = 0;
      for (const m of flat.matchAll(/[^.]{0,200}\b(outstanding|American depositary share[s]? represent|represents?\s+(one|two|[\d.\/]+))[^.]{0,200}/gi)) {
        if (shown < 8 && /depositary|outstanding/i.test(m[0]) && shown++ >= 0) console.log(`  line: ${m[0].trim().slice(0, 400)}`);
      }
    }
  } catch (e) { console.log(`\n== ${s} ERROR ${String(e?.message ?? e).slice(0, 80)}`); }
}
