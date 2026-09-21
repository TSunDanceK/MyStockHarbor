// §4.10 — the three exclusion classes, measured before any of them is built.
//
// Owner decisions this implements (2026-09-14):
//   AGE CAP = 45 days, keyed off the UPPER BOUND of observed lead time (14d), not
//   the median. The retention figure in the Phase 0 histogram is contaminated, so
//   this re-reads it on the cleaned population -- that is the whole reason this
//   probe exists rather than the constant just being written down.
//
// THE THREE CLASSES, and they are not one filter:
//   (a) already listed on a major exchange, filing a resale  -- ticker map, PROVEN
//       (removes 172 of 228; load-bearing, not hygiene)
//   (b) ETF / commodity trust                                 -- to build
//   (c) UPLISTING FROM OTC                                    -- Eloxx/ELOX
//
// (c) IS CHECKED FIRST AND MAY COST NOTHING. If company_tickers_exchange.json
// carries OTC issuers, then (a) already catches uplistings and (c) needs no code
// at all. That is the single cheapest check available and it gates a whole class,
// so it runs before anything is designed.
//
// ── THE SIC RULE THAT MUST NOT BE GOT WRONG ────────────────────────────────
// EXCLUDE 6726 (investment offices) and 6221 (commodity contracts).
// NEVER EXCLUDE 6770 (blank checks).
//
// 6770 is SPACs, and A SPAC IPO IS A REAL IPO -- it is a large share of the
// market by count, and in this probe's own samples SPACs were 8 of 20 amendments.
// Excluding 6770 would gut the page. This is written here, in the code that does
// the excluding, because a future reader tidying "6726, 6221" into "all the
// finance SIC codes" would silently delete half the listings.
//
//   dispatch relay.yml, task `ipo-exclusions`
import fs from "node:fs";

const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor sonnybrindle@mystockharbor.com";
const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY_ISO = iso(TODAY);
const MINUS_120 = iso(new Date(TODAY.getTime() - 120 * 86400000));
const AGE_CAP_DAYS = 45; // owner decision, 2026-09-14
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { "User-Agent": SEC_UA, accept: "*/*" };

async function get(url, timeoutMs = 90000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, body: "", error: `${err.name}: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

console.log("=".repeat(78));
console.log("§4.10 EXCLUSION CLASSES — measured before built");
console.log(`age cap under test: ${AGE_CAP_DAYS}d (owner decision) · window ${MINUS_120}..${TODAY_ISO}`);
console.log("=".repeat(78));

// ══════════════════════════════════════════════════════════════════════════
// CLASS (c) FIRST — does the ticker map carry OTC issuers?
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\n(c) UPLISTING — does company_tickers_exchange.json carry OTC?\n${"═".repeat(78)}`);

const tick = await get("https://www.sec.gov/files/company_tickers_exchange.json");
if (!tick.ok) {
  console.error(`FATAL: ticker map unreadable (HTTP ${tick.status}). Every class depends on it.`);
  process.exit(1);
}
const tickJson = JSON.parse(tick.body);
const fields = tickJson.fields ?? [];
const iCik = fields.indexOf("cik");
const iTicker = fields.indexOf("ticker");
const iExch = fields.indexOf("exchange");
console.log(`   fields: ${fields.join(", ")}  ·  rows: ${(tickJson.data ?? []).length}`);

const byCikMap = new Map();
const exchangeCounts = new Map();
for (const row of tickJson.data ?? []) {
  const cik = String(row[iCik]);
  const exch = row[iExch] ?? null;
  byCikMap.set(cik, { ticker: row[iTicker] ?? null, exchange: exch });
  const key = exch === null ? "(null)" : String(exch);
  exchangeCounts.set(key, (exchangeCounts.get(key) ?? 0) + 1);
}
console.log(`\n   DISTINCT exchange VALUES — this is the answer to (c):`);
for (const [k, v] of [...exchangeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`     ${k.padEnd(14)} ${v}`);
}

// The named instance from the verification doc. Eloxx Pharmaceuticals, CIK 1035354,
// quoted on OTC Pink as ELOX, uplisting to Nasdaq.
const ELOXX_CIK = "1035354";
const eloxx = byCikMap.get(ELOXX_CIK) ?? null;
console.log(`\n   Eloxx (CIK ${ELOXX_CIK}, ELOX — the known uplisting):`);
console.log(`     ${eloxx ? `PRESENT — ticker ${eloxx.ticker}, exchange ${eloxx.exchange ?? "(null)"}` : "ABSENT from the map"}`);

const otcLabels = [...exchangeCounts.keys()].filter((k) => /otc|pink|grey|gray|expert/i.test(k));
const mapHasOtc = otcLabels.length > 0 || Boolean(eloxx);
console.log(`\n   >>> OTC-shaped exchange labels present: ${otcLabels.length ? otcLabels.join(", ") : "NONE"}`);
console.log(`   >>> VERDICT ON CLASS (c): ${mapHasOtc
  ? "the map DOES carry the uplisting case — class (a) already covers it, (c) needs NO code"
  : "the map does NOT carry OTC issuers — class (c) needs its own signal"}`);
if (!mapHasOtc) {
  console.log(`   >>> Fallback signal, from the verification doc: the cover says "an ASSUMED`);
  console.log(`   >>> public offering price" (struck off an existing market) rather than`);
  console.log(`   >>> "anticipated", and names the OTC tier. Measured per company below.`);
}

// ══════════════════════════════════════════════════════════════════════════
// Rebuild the live population, then classify it
// ══════════════════════════════════════════════════════════════════════════
const byCik = new Map();
for (const q of ["2026/QTR2", "2026/QTR3"]) {
  const r = await get(`https://www.sec.gov/Archives/edgar/full-index/${q}/form.idx`);
  if (!r.ok) { console.error(`FATAL: ${q}/form.idx HTTP ${r.status}`); process.exit(1); }
  for (const line of r.body.split("\n")) {
    const m = line.match(/^(\S[\S\s]{0,11}\S)\s{2,}(.+?)\s{2,}(\d{4,10})\s{2,}(\d{4}-\d{2}-\d{2})\s{2,}(\S+)\s*$/);
    if (!m) continue;
    const [, formRaw, company, cik, date, file] = m;
    const form = formRaw.trim();
    if (date < MINUS_120 || date > TODAY_ISO) continue;
    if (!["8-A12B", "S-1", "S-1/A", "F-1", "F-1/A", "424B4", "424B1", "RW", "AW"].includes(form)) continue;
    if (!byCik.has(cik)) byCik.set(cik, { cik, company: company.trim(), filings: [] });
    const c = byCik.get(cik);
    c.filings.push({ form, date, file });
    if (company.trim().length > c.company.length) c.company = company.trim();
  }
}

const all = [...byCik.values()].map((c) => {
  c.filings.sort((a, b) => a.date.localeCompare(b.date));
  const last = (re) => [...c.filings].reverse().find((f) => re.test(f.form)) ?? null;
  return {
    ...c,
    hasFinal: c.filings.some((f) => /^424B[14]$/.test(f.form)),
    lastAmend: last(/^(S-1\/A|F-1\/A)$/),
    withdrawal: last(/^(RW|AW)$/),
  };
});

const raw = all.filter((c) => c.lastAmend && !c.hasFinal);
// JOIN ON CIK, NEVER ON NAME. `ITG, Inc./DE/` (CIK 2110117) is a new registrant and
// is NOT Investment Technology Group (CIK 920424) -- a name join would merge them.
const listedHit = (c) => byCikMap.get(String(Number(c.cik))) ?? null;
const classA = raw.filter((c) => listedHit(c));
const afterA = raw.filter((c) => !listedHit(c));
// A withdrawal only withdraws what came before it.
const withdrawnAfter = afterA.filter((c) => c.withdrawal && c.withdrawal.date >= c.lastAmend.date);
const live = afterA.filter((c) => !(c.withdrawal && c.withdrawal.date >= c.lastAmend.date));

console.log(`\n${"═".repeat(78)}\nPOPULATION BEFORE (b)\n${"═".repeat(78)}`);
console.log(`   amendment, no 424B                    ${String(raw.length).padStart(4)}`);
console.log(`   − (a) already listed [ticker map]     ${String(classA.length).padStart(4)}`);
console.log(`   − withdrawn after the amendment       ${String(withdrawnAfter.length).padStart(4)}`);
console.log(`   = carried into (b) classification     ${String(live.length).padStart(4)}`);

// ══════════════════════════════════════════════════════════════════════════
// CLASS (b) — ETFs and trusts, by SIC. PARSED, never summarised.
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\n(b) ETF / TRUST — by SIC, parsed from submissions.json\n${"═".repeat(78)}`);
console.log(`   EXCLUDE 6726 (investment offices) and 6221 (commodity contracts).`);
console.log(`   NEVER EXCLUDE 6770 (blank checks) — a SPAC IPO is a real IPO.\n`);

const EXCLUDE_SIC = new Set(["6726", "6221"]);
const NEVER_EXCLUDE_SIC = new Set(["6770"]);
// Name patterns are a CROSS-CHECK, not the rule -- an operating company called
// "... Trust" would be misfiled by a name test alone.
const NAME_FUND = /\b(ETF|Trust|Fund|Index|Shares)\b/i;

const rows = [];
for (const c of live) {
  await sleep(140); // SEC fair access: <= 10 req/s, nowhere near it
  // PARSE THIS FILE, NEVER PARAPHRASE IT. A summarised read of CIK 1918102's
  // submissions invented accession numbers and asserted an 8-A12B that was a
  // predecessor shell's 10-Q (verification doc §5).
  const r = await get(`https://data.sec.gov/submissions/CIK${String(Number(c.cik)).padStart(10, "0")}.json`);
  let sic = null, sicDesc = null, exchanges = [], tickers = [];
  if (r.ok) {
    try {
      const j = JSON.parse(r.body);
      sic = j.sic ?? null;
      sicDesc = j.sicDescription ?? null;
      exchanges = j.exchanges ?? [];
      tickers = j.tickers ?? [];
    } catch { /* left null; reported as unknown rather than guessed */ }
  }
  const nameFund = NAME_FUND.test(c.company);
  const sicExcluded = sic !== null && EXCLUDE_SIC.has(String(sic));
  const isSpac = sic !== null && NEVER_EXCLUDE_SIC.has(String(sic));
  rows.push({
    cik: c.cik, company: c.company, amend: c.lastAmend.date,
    ageDays: Math.round((TODAY - new Date(c.lastAmend.date)) / 86400000),
    sic, sicDesc, exchanges, tickers, nameFund, sicExcluded, isSpac,
  });
}

const excludedB = rows.filter((r) => r.sicExcluded);
const spacs = rows.filter((r) => r.isSpac);
const nameOnly = rows.filter((r) => r.nameFund && !r.sicExcluded);
const finalLive = rows.filter((r) => !r.sicExcluded);

console.log(`   (b) EXCLUDED by SIC 6726/6221: ${excludedB.length}`);
for (const r of excludedB) console.log(`     ${r.company.slice(0, 46).padEnd(48)} SIC ${r.sic} ${r.sicDesc ?? ""}`);
console.log(`\n   SIC 6770 (SPACs) KEPT: ${spacs.length}  <<< these are real IPOs, never excluded`);
console.log(`   name looks fund-like but SIC does NOT exclude: ${nameOnly.length}`);
for (const r of nameOnly.slice(0, 10)) console.log(`     ${r.company.slice(0, 46).padEnd(48)} SIC ${r.sic ?? "?"} ${r.sicDesc ?? ""}`);
console.log(`   >>> a name-only rule would have wrongly excluded those ${nameOnly.length}.`);

const sicCounts = new Map();
for (const r of rows) {
  const k = `${r.sic ?? "unknown"} ${r.sicDesc ?? ""}`.trim();
  sicCounts.set(k, (sicCounts.get(k) ?? 0) + 1);
}
console.log(`\n   SIC distribution across the ${rows.length} carried in:`);
for (const [k, v] of [...sicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`     ${String(v).padStart(3)}  ${k}`);
}

// Class (c) residual: anyone whose submissions record shows an OTC-ish exchange
// or an existing ticker while not being in the ticker map.
const uplistSuspects = finalLive.filter(
  (r) => r.tickers.length > 0 || r.exchanges.some((e) => /otc|pink|grey|gray/i.test(String(e)))
);
console.log(`\n   (c) residual uplisting suspects (a ticker/exchange on the submissions record`);
console.log(`       but absent from the ticker map): ${uplistSuspects.length}`);
for (const r of uplistSuspects.slice(0, 10)) {
  console.log(`     ${r.company.slice(0, 40).padEnd(42)} tickers=${JSON.stringify(r.tickers)} exch=${JSON.stringify(r.exchanges)}`);
}

// ══════════════════════════════════════════════════════════════════════════
// THE HISTOGRAM, RE-READ ON THE CLEANED POPULATION (owner decision 1)
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\nHISTOGRAM RE-READ AFTER §4.10 — the number the cap is set against\n${"═".repeat(78)}`);
const BUCKETS = [7, 14, 21, 30, 45, 60, 90, 120, 9999];
const hist = new Map(BUCKETS.map((b) => [b, 0]));
for (const r of finalLive) hist.set(BUCKETS.find((x) => r.ageDays <= x), hist.get(BUCKETS.find((x) => r.ageDays <= x)) + 1);
let cum = 0;
console.log(`   clean population: ${finalLive.length} (was 53 contaminated)\n`);
for (const b of BUCKETS) {
  const n = hist.get(b);
  cum += n;
  const pct = finalLive.length ? Math.round((cum / finalLive.length) * 100) : 0;
  const mark = b === AGE_CAP_DAYS ? "   <<< AGE CAP = 45d" : "";
  console.log(`   ${(b === 9999 ? "  >120d" : `  <=${b}d`).padEnd(9)} ${String(n).padStart(3)}   cumulative ${String(cum).padStart(3)} (${pct}%)${mark}`);
}
const retained = finalLive.filter((r) => r.ageDays <= AGE_CAP_DAYS).length;
console.log(`\n   >>> AT THE 45-DAY CAP: ${retained} of ${finalLive.length} rows retained (${finalLive.length ? Math.round((retained / finalLive.length) * 100) : 0}%)`);
console.log(`   >>> The cap is keyed off the UPPER BOUND of observed lead time (14d), not the`);
console.log(`   >>> median (7d) — 45d is >3x the longest amendment→pricing gap measured.`);
console.log(`   >>> STILL RIGHT-CENSORED at the 120d window edge: ">120d = 0" is an artefact`);
console.log(`   >>> of where this looked, not a fact about the world.`);

fs.mkdirSync("data/sec", { recursive: true });
const payload = {
  ageCapDays: AGE_CAP_DAYS,
  tickerMap: { rows: (tickJson.data ?? []).length, exchanges: Object.fromEntries(exchangeCounts), otcLabels, eloxx, mapHasOtc },
  funnel: { raw: raw.length, classA: classA.length, withdrawnAfter: withdrawnAfter.length,
    intoB: live.length, excludedB: excludedB.length, clean: finalLive.length, retainedAtCap: retained },
  spacsKept: spacs.length,
  nameOnlyFalsePositives: nameOnly.map((r) => ({ company: r.company, sic: r.sic, sicDesc: r.sicDesc })),
  excludedByB: excludedB.map((r) => ({ company: r.company, cik: r.cik, sic: r.sic, sicDesc: r.sicDesc })),
  uplistSuspects: uplistSuspects.map((r) => ({ company: r.company, cik: r.cik, tickers: r.tickers, exchanges: r.exchanges })),
  histogram: Object.fromEntries(BUCKETS.map((b) => [b === 9999 ? ">120" : `<=${b}`, hist.get(b)])),
  rows,
};
fs.writeFileSync("data/sec/ipo-exclusions.json", JSON.stringify(payload, null, 2));
console.log(`\n<<<RAW name=exclusions.json bytes=${JSON.stringify(payload).length}>>>`);
console.log(JSON.stringify(payload, null, 2).slice(0, 260000));
console.log(`<<<ENDRAW name=exclusions.json>>>`);
console.log(`\nDONE ${new Date().toISOString()}`);
