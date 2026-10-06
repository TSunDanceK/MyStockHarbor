// READ-ONLY (#552 COWORK #181). Three questions, one run:
//
//   1. WHY DO THE BANKS' REPORT-DATE RECORDS HOLD 3 PERIODS? secReportDates
//      reads only `filings.recent` (the newest ~1,000 filings). A filer that
//      issues hundreds of 424B2 notes a quarter fills that window in months.
//      Measured: each filer's recent window (span, results filings in it), the
//      older pages under `filings.files`, and the results filings those pages
//      hold over the last four years.
//   2. INTC Q2 FY2026 DILUTED EPS: every EarningsPerShareDiluted,
//      NetIncomeLoss and diluted-share fact for 2025-26, with its start, end,
//      form and frame, so a six-month YTD figure read as the quarter shows up.
//   3. THE TOP-150 CUT for data/due-strip.json (COWORK #181): the analysis
//      universe ranked by cover-page shares (Pickers SEC hash) × Tiingo close.
//
// SEC: ≤ 5 requests a second, sequential. Store: 1 GET + 2 HMGETs + 5 GETs.
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; read-only census)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let secRequests = 0;
async function sec(url) {
  await sleep(220);
  secRequests++;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
const RESULTS_ITEM = /(^|,)\s*2\.02\b/;
const tally = (cols, from = "0000") => {
  const n = cols.accessionNumber?.length ?? 0;
  let results8k = 0, periodic = 0, oldest = null, newest = null;
  for (let i = 0; i < n; i++) {
    const d = cols.filingDate?.[i];
    if (!d) continue;
    if (!oldest || d < oldest) oldest = d;
    if (!newest || d > newest) newest = d;
    if (d < from) continue;
    const f = cols.form?.[i];
    if ((f === "8-K" || f === "8-K/A") && RESULTS_ITEM.test(cols.items?.[i] ?? "")) results8k++;
    if (f === "10-Q" || f === "10-K") periodic++;
  }
  return { n, results8k, periodic, oldest, newest };
};

// ── 1. THE BANKS ──────────────────────────────────────────────────────────
console.log("1. REPORT-DATE HISTORY: filings.recent vs the older pages (8-K Item 2.02 and 10-Q/10-K since 2022-10-01)");
const FROM = "2022-10-01";
for (const sym of ["JPM", "BAC", "GS", "WFC", "MS", "AAPL"]) {
  const cik = REG[sym]?.cik;
  if (!cik) { console.log(`   ${sym}: no CIK`); continue; }
  const rec = await redis.get(`msh:sec:report-dates:v1:${sym}`).catch(() => null);
  const subs = await sec(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = tally(subs.filings.recent, FROM);
  const pages = subs.filings.files ?? [];
  console.log(`   ${sym.padEnd(5)} stored events ${Array.isArray(rec?.events) ? rec.events.length : "n/a"} · recent: ${r.n} filings, ${r.oldest} → ${r.newest}, ${r.results8k} results 8-Ks, ${r.periodic} 10-Q/K · older pages: ${pages.length}`);
  let olderResults = 0, olderPeriodic = 0, fetched = 0;
  for (const p of pages) {
    if (p.filingTo && p.filingTo < FROM) continue;
    if (fetched >= 12) { console.log(`      (stopped after 12 pages; ${pages.length - fetched} more)`); break; }
    const page = await sec(`https://data.sec.gov/submissions/${p.name}`);
    fetched++;
    const t = tally(page, FROM);
    olderResults += t.results8k; olderPeriodic += t.periodic;
    console.log(`      ${p.name.padEnd(36)} ${p.filingFrom} → ${p.filingTo} · ${String(p.filingCount).padStart(5)} filings · ${t.results8k} results 8-Ks, ${t.periodic} 10-Q/K`);
  }
  console.log(`      → since ${FROM}: ${r.results8k + olderResults} results 8-Ks (${olderResults} only in older pages), ${r.periodic + olderPeriodic} 10-Q/K · pages read ${fetched}`);
}

// ── 2. INTC ───────────────────────────────────────────────────────────────
console.log("\n2. INTC: the diluted EPS, net income and diluted shares facts for 2025–26");
const intc = REG.INTC.cik;
for (const [tax, concept] of [["us-gaap", "EarningsPerShareDiluted"], ["us-gaap", "NetIncomeLoss"], ["us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"], ["us-gaap", "NetIncomeLossAttributableToParent"]]) {
  let doc;
  try { doc = await sec(`https://data.sec.gov/api/xbrl/companyconcept/CIK${intc}/${tax}/${concept}.json`); }
  catch (e) { console.log(`   ${concept}: ${e.message}`); continue; }
  for (const [unit, facts] of Object.entries(doc.units ?? {})) {
    const rows = facts.filter((f) => f.end >= "2025-01-01").sort((a, b) => (a.end + (a.start ?? "")).localeCompare(b.end + (b.start ?? "")));
    console.log(`   ${concept} [${unit}] (${rows.length})`);
    for (const f of rows) {
      const days = f.start ? Math.round((Date.parse(f.end) - Date.parse(f.start)) / 864e5) + 1 : null;
      console.log(`      ${(f.start ?? "—").padEnd(10)} → ${f.end} (${days ?? "inst"}d) ${String(f.val).padStart(16)}  ${f.form} ${f.fy}${f.fp} filed ${f.filed}${f.frame ? ` frame ${f.frame}` : ""}`);
    }
  }
}
{
  const raw = await redis.get("msh:sec:facts:v1:INTC");
  const s = JSON.stringify(raw ?? null);
  console.log(`   stored INTC fact set: ${raw ? `${s.length} chars` : "absent"}`);
  for (const k of ["EarningsPerShareDiluted", "epsDiluted", "eps"]) {
    let i = s.indexOf(k), shown = 0;
    while (i >= 0 && shown < 3) { console.log(`      …${s.slice(i, i + 360)}…`); shown++; i = s.indexOf(k, i + k.length); }
    if (shown) break;
  }
}

// ── 3. THE TOP-150 CUT ────────────────────────────────────────────────────
console.log("\n3. THE TOP-150 CUT (cover-page shares × Tiingo close)");
const universe = await redis.get("msh:pickers:v10:symbols");
const fields = [...new Set((universe ?? []).map((s) => s.replace(/\./g, "-")))];
const secRaw = await redis.hmget("msh:pickers:sec-fundamentals:v1", ...fields);
const eod = await redis.hmget("msh:tiingo:eod-last:v1", ...fields);
const pick = (raw, f, i) => { let v = Array.isArray(raw) ? raw[i] : raw?.[f]; if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } } return v; };
const caps = [];
fields.forEach((f, i) => {
  const shares = Number(pick(secRaw, f, i)?.inputs?.shares?.val), close = Number(pick(eod, f, i)?.c);
  if (shares > 0 && close > 0) caps.push([f, shares * close]);
});
caps.sort((a, b) => b[1] - a[1]);
const old = JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols;
const dot = new Map(old.map((s) => [s.replace(/\./g, "-"), s]));
const top = caps.slice(0, 150).map(([f]) => dot.get(f) ?? f);
console.log(`   universe ${universe?.length ?? 0} · ranked ${caps.length} · the 150th cap ${(caps[149]?.[1] / 1e9).toFixed(1)}B`);
console.log(`   leaving the frozen 50: ${old.filter((s) => !top.includes(s)).join(" ") || "none"}`);
console.log(`CUT150_JSON ${JSON.stringify(top)}`);
console.log(`\nSEC requests ${secRequests}.`);
