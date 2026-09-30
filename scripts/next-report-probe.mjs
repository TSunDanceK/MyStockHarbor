// READS ONLY (Redis + SEC submissions): why the next-report box says what it
// says for named symbols (#552 COWORK #78 items 1–3). Per symbol:
//   STORED  manifest entry, the report-dates record (events count, newest
//           events' dates, nextPeriodEnd, fye, the pool size), the fact set's
//           newest quarter/year ends, and the outlook's reason;
//   FRESH   buildReportDatesRecord from submissions as the cron reads it
//           (recent only), then with the older pages merged, then (successor)
//           with the predecessor's filings merged — the outlook reason for each.
// SEC values only (dates, accession-free counts); no FMP data. One throttled
// runner, ≤4 SEC requests/s.
//   relay task: write-next-report-probe, symbols "KO,JPM,XOM,WDFC,AAPL"
import "./lib/register-ts-app.mjs";
import fs from "node:fs";

const { readReportDatesChecked } = await import("../lib/server/secReportDatesStore.ts");
const { buildReportDatesRecord } = await import("../lib/server/secReportDatesWrite.ts");
const { lagHabit } = await import("../lib/server/expectedToReport.ts");
const { outlookFrom } = await import("../lib/server/symbolOutlook.ts");
const { readFactSet } = await import("../lib/server/secFactStore.ts");
const { readManifest } = await import("../lib/server/secManifest.ts");

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; next-report probe)";
let secRequests = 0, last = 0;
async function sec(url) {
  const wait = 250 - (Date.now() - last); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); secRequests++;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 429 || res.status === 403) { console.log(`stopped: SEC ${res.status}`); process.exit(3); }
  if (!res.ok) throw new Error(`SEC ${res.status}`);
  return res.json();
}
const SUCC = JSON.parse(fs.readFileSync("data/sec/successor-ciks.json", "utf8")).successors;
const pad = (c) => String(c).padStart(10, "0");
const COLS = ["accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "form", "items", "primaryDocument", "primaryDocDescription", "fileNumber", "filmNumber", "size", "isXBRL", "isInlineXBRL", "act", "core_type"];
function mergeRecent(base, extra) {
  const r = base.filings.recent, x = extra;
  const out = { ...base, filings: { ...base.filings, recent: {} } };
  for (const k of Object.keys(r)) out.filings.recent[k] = [...(r[k] ?? []), ...(x[k] ?? Array((x.accessionNumber ?? []).length).fill(null))];
  return out;
}
const span = (subs) => { const d = subs.filings.recent.filingDate ?? []; return d.length ? `${d.at(-1)}..${d[0]} (${d.length} filings)` : "-"; };
const count8k = (subs) => (subs.filings.recent.form ?? []).filter((f, i) => /^(8-K|6-K)$/.test(f) && /2\.02/.test(subs.filings.recent.items?.[i] ?? "")).length;
const summary = (rec, today) => {
  const h = lagHabit(rec), o = outlookFrom(rec.symbol, rec, today);
  const ev = rec.events.slice(0, 3).map((e) => `${e.announcedOn}→${e.periodEnd}`).join(" ");
  return `events ${rec.events.length} [${ev}] · nextPeriodEnd ${rec.nextPeriodEnd ?? "-"} · fye ${rec.fye ?? "-"} · pool ${h.fromPeriods}${h.pooled ? " (Q4-split)" : ""} · scored ${h.scored ? h.scored.predictions : "no"} · outlook ${o.kind}${o.reason ? `/${o.reason}` : ""}`;
};

const today = new Date().toISOString().slice(0, 10);
const now = new Date().toISOString();
const manifest = await readManifest();
const syms = String(process.env.SYMBOLS ?? "").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase()).slice(0, 10);
let redisCmds = 1;
for (const sym of syms) {
  console.log(`\n== ${sym}`);
  const m = manifest?.symbols?.[sym] ?? {};
  const iso = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16) : "-");
  console.log(`manifest: cik ${m.cik ?? "-"} · reportDatesAt ${iso(m.reportDatesAt)} · lastEventFiled ${m.lastEventFiled ?? "-"} · needsReverify ${Boolean(m.needsReverify)}`);
  const read = await readReportDatesChecked(sym); redisCmds++;
  const set = await readFactSet(sym); redisCmds++;
  if (set) {
    const nq = [...set.quarters].sort((a, b) => (a.e < b.e ? 1 : -1))[0], ny = [...set.years].sort((a, b) => (a.e < b.e ? 1 : -1))[0];
    console.log(`fact set: quarters ${set.quarters.length} (newest ${nq?.e ?? "-"} filed ${nq?.f ?? "-"}) · years ${set.years.length} (newest ${ny?.e ?? "-"})`);
  } else console.log("fact set: none");
  if (!read.ok) { console.log("STORED: read failed"); continue; }
  console.log(`STORED: ${read.rec ? `at ${read.rec.at.slice(0, 16)} · ${summary(read.rec, today)}` : "no record"}`);
  if (!set || !m.cik) continue;
  try {
    const subs = await sec(`https://data.sec.gov/submissions/CIK${pad(m.cik)}.json`);
    console.log(`submissions recent: ${span(subs)} · results 8-K/6-K ${count8k(subs)} · older pages ${(subs.filings.files ?? []).length}`);
    const fresh = buildReportDatesRecord(sym, m.cik, set, subs, today, now);
    console.log(`FRESH (recent only, as the cron): ${summary(fresh, today)}`);
    let merged = subs;
    for (const f of (subs.filings.files ?? []).slice(0, 3)) merged = mergeRecent(merged, await sec(`https://data.sec.gov/submissions/${f.name}`));
    if (merged !== subs) {
      console.log(`  + older pages: ${span(merged)} · results 8-K/6-K ${count8k(merged)}`);
      console.log(`FRESH (+ older pages): ${summary(buildReportDatesRecord(sym, m.cik, set, merged, today, now), today)}`);
    }
    const s = SUCC.find((x) => pad(x.cik) === pad(m.cik));
    if (s) {
      const pred = await sec(`https://data.sec.gov/submissions/CIK${pad(s.predecessorCik)}.json`);
      const both = mergeRecent(merged, pred.filings.recent);
      console.log(`  + predecessor ${pad(s.predecessorCik)}: ${span(pred)} · results 8-K ${count8k(pred)}`);
      console.log(`FRESH (+ predecessor): ${summary(buildReportDatesRecord(sym, m.cik, set, both, today, now), today)}`);
    }
  } catch (e) { console.log(`fresh build failed: ${String(e?.message ?? e).slice(0, 80)}`); }
}
console.log(`\nSEC requests ${secRequests} · Redis commands ${redisCmds} (reads only)`);
