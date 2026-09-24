// ONE SYMBOL'S REPORT-DATES RECORD, MANIFEST STAMPS AND NEWEST SEC FILINGS.
//
// For a check-in that asks "was MU processed, and has it filed": the stored
// record's `at`, its newest events, `pending`, `next`; the manifest entry's
// reportDatesAt / lastEventFiled; and the filer's newest 8-K/10-K/10-Q from
// EDGAR, so a result filed after the last cron can be seen before the store
// catches up. READ-ONLY: GETs from Upstash, one EDGAR fetch per symbol.
//   relay task: write-symbol-record  (SYMBOLS=MU,TSLA)
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const key = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const DATES_PREFIX = key("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const MANIFEST_KEY = key("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
if (!DATES_PREFIX || !MANIFEST_KEY) { console.error("FATAL: could not read the store keys"); process.exit(2); }
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; record probe)";
const redis = Redis.fromEnv();
const symbols = (process.env.SYMBOLS || "MU").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const manifest = await redis.get(MANIFEST_KEY);

for (const sym of symbols) {
  console.log(`\n${"=".repeat(70)}\n${sym}`);
  const rec = await redis.get(`${DATES_PREFIX}:${sym}`);
  const m = manifest?.symbols?.[sym] ?? null;
  console.log(`  manifest: reportDatesAt=${m?.reportDatesAt ?? "—"} lastEventFiled=${m?.lastEventFiled ?? "—"} cik=${m?.cik ?? "—"}`);
  if (!rec) { console.log("  no report-dates record"); continue; }
  console.log(`  record at=${rec.at ?? "—"}`);
  console.log(`  pending=${JSON.stringify(rec.pending ?? null)}`);
  console.log(`  next=${JSON.stringify(rec.next ?? null)} nextPeriodEnd=${rec.nextPeriodEnd ?? "—"}`);
  for (const e of (rec.events ?? []).slice(0, 4)) {
    console.log(`  event ${e.announcedOn} period ${e.periodEnd ?? "—"} ${e.basis ?? ""} ${e.timing ?? ""} ${e.accession ?? ""}`);
  }
  if (!m?.cik) continue;
  const res = await fetch(`https://data.sec.gov/submissions/CIK${String(m.cik).padStart(10, "0")}.json`,
    { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) { console.log(`  EDGAR HTTP ${res.status}`); continue; }
  const r = (await res.json())?.filings?.recent ?? {};
  let shown = 0;
  for (let i = 0; i < (r.form ?? []).length && shown < 6; i++) {
    if (!/^(8-K|10-K|10-Q)/.test(r.form[i])) continue;
    console.log(`  EDGAR ${r.form[i].padEnd(6)} filed ${r.filingDate[i]} accepted ${r.acceptanceDateTime?.[i] ?? "—"} ` +
      `report ${r.reportDate?.[i] ?? "—"} items ${r.items?.[i] ?? "—"} ${r.accessionNumber[i]}`);
    shown++;
  }
}
console.log("\nNo writes were performed.");
