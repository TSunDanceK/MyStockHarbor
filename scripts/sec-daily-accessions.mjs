// NEW ACCESSIONS PER DAY ACROSS THE REGISTRANT UNIVERSE (#552 COWORK #65): the
// EDGAR daily form index for the last DAYS business days, counted by form for
// registrant CIKs. Financial-data forms (10-K/10-Q/20-F/40-F and amendments)
// are what change companyfacts; all forms change submissions. Read-only.
//   DAYS=30 node scripts/sec-daily-accessions.mjs   (relay: sec-daily-accessions)
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; daily accessions)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const CIKS = new Set(Object.values(REG).map((r) => String(Number(r.cik))));
const DAYS = Number(process.env.DAYS || 30);
const FIN = /^(10-K|10-Q|20-F|40-F|10-KT)(\/A)?$/;
let lastAt = 0;
async function get(url) {
  const wait = Math.max(0, lastAt + 150 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  return res.ok ? res.text() : null;
}
const days = [];
for (let d = new Date(); days.length < DAYS; d = new Date(d.getTime() - 86400000)) {
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const t = await get(`https://www.sec.gov/Archives/edgar/daily-index/${d.getUTCFullYear()}/QTR${q}/form.${ymd}.idx`);
  if (!t) continue;
  let all = 0, fin = 0;
  const ciksAll = new Set(), ciksFin = new Set(), byForm = {};
  for (const l of t.split("\n")) {
    const m = /^(\S+(?: \S+)?)\s{2,}.+?\s{2,}(\d{1,10})\s{2,}\d{4}-?\d{2}-?\d{2}\s+(\S+)/.exec(l);
    if (!m || !CIKS.has(String(Number(m[2])))) continue;
    all++; ciksAll.add(m[2]); byForm[m[1]] = (byForm[m[1]] ?? 0) + 1;
    if (FIN.test(m[1])) { fin++; ciksFin.add(m[2]); }
  }
  days.push({ ymd, all, ciksAll: ciksAll.size, fin, ciksFin: ciksFin.size });
  const top = Object.entries(byForm).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => `${f}:${n}`).join(" ");
  console.log(`D ${ymd} filings ${all} ciks ${ciksAll.size} | financial ${fin} ciks ${ciksFin.size} | ${top}`);
}
const avg = (k) => (days.reduce((a, d) => a + d[k], 0) / Math.max(1, days.length)).toFixed(1);
const max = (k) => Math.max(...days.map((d) => d[k]));
console.log(`\n${days.length} business days, universe ${CIKS.size} ciks: per day filings avg ${avg("all")} (max ${max("all")}), filer-days avg ${avg("ciksAll")}; financial avg ${avg("fin")} (max ${max("fin")}), filers avg ${avg("ciksFin")} (max ${max("ciksFin")})`);
