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
      // GREP=regex: every sentence matching it, capped at 15 (#552 COWORK #63, MFG 12.D).
      if (process.env.GREP) {
        let n = 0;
        for (const m of flat.matchAll(new RegExp(`[^.]{0,250}(?:${process.env.GREP})[^.]{0,250}`, "gi"))) {
          if (n++ >= 15) break;
          console.log(`  grep: ${m[0].trim()}`);
        }
      }
    }
    // Every F-6 family filing on the recent list, newest first.
    const f6 = (r.form ?? []).map((f, i) => (/^F-6/.test(f) ? `${f} ${r.accessionNumber[i]} ${r.filingDate[i]}` : null)).filter(Boolean);
    console.log(`  F-6 family on the recent list: ${f6.length ? f6.join(" | ") : "none"}`);
    // OLDER=1: the F-6 family on the older submission pages too, and the newest
    // one's text through GREP (#552 COWORK #63: MFG's ratio after the 2020 consolidation).
    if (process.env.OLDER) {
      const sub = await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
      const all = [];
      const add = (p) => (p.form ?? []).forEach((f, i) => { if (/^F-6/.test(f)) all.push({ f, acc: p.accessionNumber[i], filed: p.filingDate[i], doc: p.primaryDocument[i] }); });
      add(sub.filings?.recent ?? {});
      for (const f of sub.filings?.files ?? []) add(await get(`https://data.sec.gov/submissions/${f.name}`));
      all.sort((a, b) => b.filed.localeCompare(a.filed));
      console.log(`  F-6 family, all pages: ${all.map((x) => `${x.f} ${x.acc} ${x.filed}`).join(" | ") || "none"}`);
      for (const x of all.slice(0, 3)) {
        const flat = D.filingText(await get(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${x.acc.replace(/-/g, "")}/${x.doc}`, "text")).replace(/\s+/g, " ");
        console.log(`  -- ${x.f} ${x.acc} ${x.filed}`);
        let n = 0;
        for (const m of flat.matchAll(/[^.]{0,250}(?:represent|each American Depositary Share|ADSs? (?:to|for))[^.]{0,250}/gi)) {
          if (n++ >= 6) break;
          console.log(`  f6: ${m[0].trim()}`);
        }
      }
    }
  } catch (e) { console.log(`\n== ${s} ERROR ${String(e?.message ?? e).slice(0, 80)}`); }
}
