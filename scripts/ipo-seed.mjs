// Build order step 2: seed the 90-day IPO window from the quarterly indexes.
//
// ── ONE CLASSIFICATION PATH, NOT TWO THAT AGREE ────────────────────────────
// This script imports lib/server/ipoExclusions.ts and lib/server/ipoSecSource.ts
// DIRECTLY and calls buildSecIpoTables() -- the same function the page render
// calls. It does not re-implement a single rule.
//
// That is the whole reason buildSecIpoTables is pure and synchronous and takes
// the ticker index as a parameter. If it resolved the map itself it would drag in
// @upstash/redis, the relay's read-only job runs NO `npm ci` by deliberate
// design, and this script would have had to grow its own copy of the filters.
// Seeded rows and daily-accumulated rows would then disagree about what counts as
// an IPO, and BOTH SETS WOULD LOOK PLAUSIBLE -- which is the failure mode this
// project has now hit three times (claude/traps/a-filter-that-matches-nothing-
// looks-correct.md).
//
// Node 24 on the runner strips the types natively, so a .mjs importing a .ts
// needs no build step and no dependencies.
//
// ── THE WINDOW SPANS TWO QUARTERS, AND THAT IS NOT OPTIONAL ────────────────
// 90 days back from mid-September is mid-June, which is QTR2. Seeding from
// QTR3/form.idx alone silently loses the oldest ~two weeks: it fetches cleanly,
// parses cleanly, reports a plausible number, and UNDER-COVERS. Both quarters
// are fetched and deduped by (cik, form, date, accession).
//
//   dispatch relay.yml, task `ipo-seed`
import fs from "node:fs";

import {
  indexByCik,
  isFundEntity,
  IPO_TERMS_MAX_AGE_DAYS,
} from "../lib/server/ipoExclusions.ts";
import { buildSecIpoTables } from "../lib/server/ipoSecSource.ts";
// THE SAME MERGE THE DAILY INGEST USES. The seed must write the shape the ingest
// writes -- two writers producing subtly different rows would both look
// plausible and disagree only where nobody checks.
import { mergeIpoRecords, validateStored, windowStartFor } from "../lib/server/ipoRecordMerge.ts";

const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor sonnybrindle@mystockharbor.com";
const WINDOW_DAYS = Number(process.env.IPO_SEED_WINDOW_DAYS || 90);

// ── WINDOW-END OVERRIDE, for the seasonality comparison ────────────────────
// The measured window is whatever 90 days end today, and "today" in mid-
// September is the quietest stretch of the IPO year: issuers avoid August and
// the autumn window opens after Labor Day. A lower-table count of 8 could be
// August or could be structural, and those need different responses.
//
// So the end date is overridable and the SAME machinery answers both windows --
// a second implementation measuring the comparison would tell us about the
// second implementation.
//
// Passed through the relay's `symbols` input, because relay.yml already forwards
// it and adding a dedicated input would need a merge to main first. A value
// shaped like a date is read as the window end; anything else is ignored.
const END_OVERRIDE = /^\d{4}-\d{2}-\d{2}$/.test(process.env.SYMBOLS ?? "")
  ? process.env.SYMBOLS
  : null;
const TODAY = END_OVERRIDE ? new Date(`${END_OVERRIDE}T00:00:00Z`) : new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY_ISO = iso(TODAY);
const WINDOW_START = iso(new Date(TODAY.getTime() - WINDOW_DAYS * 86400000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { "User-Agent": SEC_UA, accept: "*/*" };

// A declared User-Agent with a contact address is not optional. Without one SEC
// returns 403 with a body reading "Request Rate Threshold Exceeded" WHILE NOT
// BEING A RATE LIMIT -- adding backoff to that is debugging the wrong thing.
if (!SEC_UA.includes("@")) {
  console.error("FATAL: SEC_USER_AGENT carries no contact address. SEC will 403.");
  process.exit(1);
}

async function get(url, timeoutMs = 120000) {
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

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x201c;|&#x201d;/g, '"')
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");

// ── Cover-page terms. The parser Phase 0 gated at 5/5 on correctness. ──────
// Plausibility bounds, phrase anchors, and NULL RATHER THAN A GUESS: a dash in
// the column is honest, "$0.00001" is a par value the old parser read as an
// offer price.
const plausible = (n) => Number.isFinite(n) && n >= 1 && n <= 500;
const RANGE_PHRASES = [
  /(?:initial public offering price|public offering price|offering price)[^.]{0,60}?between\s+\$\s?([\d.]+)\s+and\s+\$\s?([\d.]+)/i,
  /between\s+\$\s?([\d.]+)\s+and\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
  /\$\s?([\d.]+)\s*(?:to|and|–|—|-)\s*\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
];
const FINAL_PHRASES = [
  /initial public offering price (?:is|of|was)\s+\$\s?([\d.]+)/i,
  /public offering price (?:is|of|was)\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
  /offering price of\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
];
const SPAC_UNIT = /\$\s?10\.00\s+per\s+unit|price of\s+\$\s?10\.00/i;
const SPAC_BODY = [/blank check company/i, /business combination/i, /trust account/i];

function parseTerms(text, sic) {
  const cover = text.slice(0, 80000);
  const isSpac = sic === "6770" || SPAC_BODY.filter((re) => re.test(cover)).length >= 2;

  let low = null;
  let high = null;
  for (const re of RANGE_PHRASES) {
    const m = cover.match(re);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      // BOTH ENDS PLAUSIBLE IS NOT ENOUGH. The first seed run produced Aptevo
      // at $11.70-$428.40 -- every value inside the $1-$500 bound, and a deal
      // size of $1.42 BILLION for a microcap follow-on. A real IPO range is
      // tight; underwriters do not market a 36x spread. Anything wider than 3x
      // means the two numbers came from different sentences.
      const RATIO_MAX = 3;
      if (plausible(lo) && plausible(hi) && lo <= hi && hi <= lo * RATIO_MAX) {
        low = lo;
        high = hi;
      }
      break;
    }
  }
  // A SPAC unit is fixed at $10.00 and has no range. The $11.50 nearby is the
  // WARRANT EXERCISE PRICE and was 3 of the first parser's 8 wrong answers.
  if (low === null && isSpac && SPAC_UNIT.test(cover)) { low = 10.0; high = 10.0; }
  if (low === null) {
    for (const re of FINAL_PHRASES) {
      const m = cover.match(re);
      if (m) {
        const n = Number(m[1]);
        if (plausible(n)) { low = n; high = n; }
        break;
      }
    }
  }

  const sharesM =
    cover.match(/([\d,]{5,})\s+shares\s+of\s+(?:our\s+)?(?:common|ordinary)\s+(?:stock|shares)/i) ||
    cover.match(/offering\s+([\d,]{5,})\s+shares/i);
  const shares = sharesM ? Number(sharesM[1].replace(/,/g, "")) : null;

  return {
    priceRangeLow: low,
    priceRangeHigh: high,
    sharesOffered: Number.isFinite(shares) ? shares : null,
    exchange:
      (cover.match(
        /(New York Stock Exchange|NYSE American|Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|NYSE|Nasdaq)/i
      ) ?? [])[1] ?? null,
    proposedSymbol:
      (cover.match(/(?:symbol|ticker)\s*["'"]?\s*:?\s*["'"]?\s*([A-Z]{1,5})\b/) ?? [])[1] ?? null,
  };
}

console.log("=".repeat(78));
console.log(`IPO SEED — ${WINDOW_DAYS}-day window ${WINDOW_START}..${TODAY_ISO}`);
if (END_OVERRIDE) {
  console.log(`WINDOW END OVERRIDDEN to ${END_OVERRIDE} — this is a comparison run,`);
  console.log(`not today's window. The lower table covers the 30 days ending then.`);
}
console.log("=".repeat(78));

// ── Which quarters does the window touch? Computed, never assumed. ─────────
const quarterOf = (isoDate) =>
  `${isoDate.slice(0, 4)}/QTR${Math.ceil(Number(isoDate.slice(5, 7)) / 3)}`;
const quarters = [...new Set([quarterOf(WINDOW_START), quarterOf(TODAY_ISO)])];
console.log(`\nwindow touches ${quarters.length} quarter(s): ${quarters.join(", ")}`);
if (quarters.length === 1) {
  console.log("   NOTE: one quarter only. That is legitimate mid-quarter, but if the");
  console.log("   window start is within ~2 weeks of a quarter boundary, check it.");
}

const KEEP_FORMS = new Set(["8-A12B", "S-1", "S-1/A", "F-1", "F-1/A", "424B4", "424B1", "RW", "AW"]);
// Periodic reports are the free cross-check: a filer that was already filing
// these is a reporting company, so its offering is a follow-on. Collected in a
// SECOND PASS, only for CIKs already seen with an offering form -- a first pass
// over every 10-Q in a quarter would balloon the record set for no gain.
const PERIODIC_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F", "6-K", "10-K/A", "10-Q/A", "20-F/A", "6-K/A"]);

// ── EDGAR-GENERATED NOTICES ARE NOT COMPANY FILINGS ────────────────────────
// Accessions beginning 9999999995- are generated by EDGAR itself: EFFECT
// notices, CORRESP/UPLOAD correspondence, and similar. They are NOT filings by
// the company and must never be read as one.
//
// MEASURED CONSEQUENCE: Wellchange Holdings has no 424B4 on its record at all.
// The 2026-08-28 item this seed recorded as a 424B4 is an EFFECT notice,
// accession 9999999995-26-002778 -- the registration statement going effective,
// with no final prospectus filed. It inflated the lower table's candidate count
// and put a row in the follow-on bucket that was never a prospectus.
//
// Same family as everything else this week, and worth naming as its own shape:
// A FILTER THAT MATCHES THE WRONG THING LOOKS EXACTLY AS CORRECT AS ONE THAT
// MATCHES THE RIGHT THING. The count was plausible, the parse was clean, and the
// row was not what it claimed to be.
const EDGAR_GENERATED_ACCESSION = /^9999999995-/;
const byCik = new Map();
const seen = new Set(); // dedupe key: cik|form|date|accession
let rawRows = 0;
let dupes = 0;
let notices = 0;
const noticeForms = new Map();
const quarterBodies = [];

for (const q of quarters) {
  const url = `https://www.sec.gov/Archives/edgar/full-index/${q}/form.idx`;
  const r = await get(url);
  if (!r.ok) {
    console.error(`FATAL: ${q}/form.idx unreadable (HTTP ${r.status}) ${r.error ?? ""}`);
    process.exit(1);
  }
  let kept = 0;
  for (const line of r.body.split("\n")) {
    const m = line.match(/^(\S[\S\s]{0,11}\S)\s{2,}(.+?)\s{2,}(\d{4,10})\s{2,}(\d{4}-\d{2}-\d{2})\s{2,}(\S+)\s*$/);
    if (!m) continue;
    const [, formRaw, company, cik, date, file] = m;
    const form = formRaw.trim();
    if (date < WINDOW_START || date > TODAY_ISO) continue;
    if (!KEEP_FORMS.has(form)) continue;
    rawRows += 1;
    const accession = file.match(/(\d{10}-\d{2}-\d{6})/)?.[1] ?? file;
    if (EDGAR_GENERATED_ACCESSION.test(accession)) {
      notices += 1;
      noticeForms.set(form, (noticeForms.get(form) ?? 0) + 1);
      continue;
    }
    // A filing can appear in both quarterly indexes around a boundary. Dedupe on
    // the accession, which is the filing's own identity.
    const key = `${cik}|${form}|${date}|${accession}`;
    if (seen.has(key)) { dupes += 1; continue; }
    seen.add(key);
    if (!byCik.has(cik)) byCik.set(cik, { cik, company: company.trim(), sic: null, filings: [], terms: null });
    const rec = byCik.get(cik);
    // accession carried for 424B rows only: the EFFECT-notice question is about
    // whether form.idx and a company's own index.json agree on what was filed.
    rec.filings.push(/^424B/.test(form) ? { form, date, file, acc: accession } : { form, date, file });
    if (company.trim().length > rec.company.length) rec.company = company.trim();
    kept += 1;
  }
  console.log(`   ${q}: ${r.body.length} bytes · ${kept} rows kept in window`);
  quarterBodies.push(r.body);
}

// ── SECOND PASS: periodic reports, only for CIKs already in the record set ──
let periodicRows = 0;
for (const body of quarterBodies) {
  for (const line of body.split("\n")) {
    const m = line.match(/^(\S[\S\s]{0,11}\S)\s{2,}(.+?)\s{2,}(\d{4,10})\s{2,}(\d{4}-\d{2}-\d{2})\s{2,}(\S+)\s*$/);
    if (!m) continue;
    const [, formRaw, , cik, date, file] = m;
    const form = formRaw.trim();
    if (!PERIODIC_FORMS.has(form)) continue;
    if (!byCik.has(cik)) continue; // only filers we already care about
    if (date < WINDOW_START || date > TODAY_ISO) continue;
    const accession = file.match(/(\d{10}-\d{2}-\d{6})/)?.[1] ?? file;
    if (EDGAR_GENERATED_ACCESSION.test(accession)) continue;
    const key = `${cik}|${form}|${date}|${accession}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byCik.get(cik).filings.push({ form, date });
    periodicRows += 1;
  }
}
console.log(`   periodic reports attached to known filers: ${periodicRows}`);
console.log(`\n   rows in window: ${rawRows} · duplicates removed: ${dupes}`);
console.log(`   EDGAR-GENERATED NOTICES EXCLUDED: ${notices}` + (notices ? ` — by form: ${[...noticeForms].map(([f, n]) => `${f}=${n}`).join(", ")}` : ""));
if (notices) {
  console.log(`   >>> Those are accession 9999999995-* : EFFECT notices and the like.`);
  console.log(`   >>> Wellchange's "424B4" was one. It is not a company filing.`);
}
console.log(`   distinct filers: ${byCik.size}`);

// ── The ticker map, for the already-listed join ────────────────────────────
const tickRes = await get("https://www.sec.gov/files/company_tickers_exchange.json");
if (!tickRes.ok) {
  console.error(`FATAL: ticker map unreadable (HTTP ${tickRes.status}). The already-listed filter is load-bearing (172 of 228 in the measured window) and MUST NOT be skipped.`);
  process.exit(1);
}
const tj = JSON.parse(tickRes.body);
const fi = tj.fields ?? [];
const symbolKeyed = new Map();
for (const row of tj.data ?? []) {
  const ticker = row[fi.indexOf("ticker")];
  if (!ticker) continue;
  symbolKeyed.set(String(ticker), {
    cik: String(row[fi.indexOf("cik")]),
    exchange: row[fi.indexOf("exchange")] ?? null,
  });
}
// SAME inversion helper the render uses. The file is symbol-keyed; a direct
// has(cik) type-checks and is always false.
const listedByCik = indexByCik(symbolKeyed);
console.log(`   ticker map: ${symbolKeyed.size} symbols -> ${listedByCik.size} distinct CIKs`);

// ── SIC, for the entity filter. PARSED, never paraphrased. ────────────────
// A summarised read of CIK 1918102's submissions once invented accession numbers
// and asserted an 8-A12B that was a predecessor shell's 10-Q.
const all = [...byCik.values()];
// STRUCTURAL PRE-FILTER ONLY. The first run also skipped already-listed filers
// here, which meant buildSecIpoTables never saw them and its own
// droppedAlreadyListed counter read 0 -- a filter reporting zero because
// something upstream ate its input. The classifier owns every exclusion; this
// only decides whose cover is worth fetching, and an unfetched cover is exactly
// what "no terms" means.
const needsSic = all.filter((r) =>
  r.filings.some((f) => /^(424B[14]|S-1\/A|F-1\/A)$/.test(f.form))
);
console.log(`\n   fetching SIC for ${needsSic.length} filers (submissions.json, parsed)`);
let sicOk = 0;
for (const rec of needsSic) {
  await sleep(140);
  const r = await get(`https://data.sec.gov/submissions/CIK${String(Number(rec.cik)).padStart(10, "0")}.json`);
  if (!r.ok) continue;
  try {
    const j = JSON.parse(r.body);
    rec.sic = j.sic ? String(j.sic) : null;
    if (rec.sic) sicOk += 1;
  } catch { /* left null; the entity filter treats null as "not a fund" */ }
}
console.log(`   SIC resolved for ${sicOk}/${needsSic.length}`);

// ── Cover terms, for the survivors only ───────────────────────────────────
// Two skips, both of which only avoid a wasted fetch: a fund, and an
// already-listed issuer with no 8-A12B (a follow-on). Both are decided by the
// SHARED functions, and both are re-applied by the classifier afterwards -- so
// the funnel still counts them, rather than silently never seeing them.
const needsTerms = needsSic.filter((r) => {
  if (isFundEntity(r.sic, r.company)) return false;
  const listed = listedByCik.has(String(Number(r.cik)));
  const registered = r.filings.some((f) => f.form === "8-A12B");
  return !(listed && !registered);
});
console.log(`\n   fetching cover terms for ${needsTerms.length} of ${needsSic.length} (skipping funds and already-listed-without-8-A12B, both re-checked by the classifier)`);
let termsOk = 0;
for (const rec of needsTerms) {
  const relevant = rec.filings
    .filter((f) => /^(424B[14]|S-1\/A|F-1\/A)$/.test(f.form))
    .sort((a, b) => a.date.localeCompare(b.date));
  const f = relevant.pop();
  if (!f) continue;
  const accession = (f.file.match(/(\d{10}-\d{2}-\d{6})/)?.[1] ?? "").replace(/-/g, "");
  if (!accession) continue;
  await sleep(140);
  const ij = await get(`https://www.sec.gov/Archives/edgar/data/${Number(rec.cik)}/${accession}/index.json`);
  if (!ij.ok) continue;
  let primary = null;
  try {
    const items = JSON.parse(ij.body).directory?.item ?? [];
    primary = items
      .filter((it) => /\.htm$/i.test(it.name) && !/^R\d+\.htm$/i.test(it.name))
      .sort((a, b) => Number(b.size) - Number(a.size))[0]?.name ?? null;
  } catch { /* primary stays null */ }
  if (!primary) continue;
  await sleep(140);
  const doc = await get(`https://www.sec.gov/Archives/edgar/data/${Number(rec.cik)}/${accession}/${primary}`);
  if (!doc.ok) continue;
  rec.terms = parseTerms(strip(doc.body), rec.sic);
  if (rec.terms.priceRangeLow !== null || rec.terms.sharesOffered !== null) termsOk += 1;
}
console.log(`   terms extracted for ${termsOk}/${needsTerms.length}`);

// ══════════════════════════════════════════════════════════════════════════
// THE SHARED CLASSIFIER. Not a copy of it.
// ══════════════════════════════════════════════════════════════════════════
const { upcoming, recent, funnel } = buildSecIpoTables(all, listedByCik, WINDOW_DAYS, TODAY);

console.log(`\n${"═".repeat(78)}\nTHE FUNNEL — buildSecIpoTables(), the same call the render makes\n${"═".repeat(78)}`);
console.log(`   filer records in                    ${String(funnel.records).padStart(5)}`);
console.log(`\n   UPPER  candidates (amendment, no 424B) ${String(funnel.upperCandidates).padStart(4)}`);
console.log(`     − already listed  [class a + c]     ${String(funnel.droppedAlreadyListed).padStart(4)}`);
console.log(`     − ETF / trust     [class b]         ${String(funnel.droppedEntity).padStart(4)}`);
console.log(`     − no terms on the cover             ${String(funnel.droppedNoTerms).padStart(4)}`);
console.log(`     − withdrawn RW/AW after amendment   ${String(funnel.droppedWithdrawn).padStart(4)}`);
console.log(`     − stale > ${IPO_TERMS_MAX_AGE_DAYS}d                       ${String(funnel.droppedStale).padStart(4)}`);
console.log(`   = UPCOMING                            ${String(funnel.upcoming).padStart(4)}`);
console.log(`\n   LOWER  candidates (424B in last 30d)  ${String(funnel.lowerCandidates).padStart(4)}`);
console.log(`     − follow-on: no 8-A12B in window    ${String(funnel.droppedFollowOn).padStart(4)}`);
console.log(`     − no terms on the cover             ${String(funnel.droppedNoTermsLower).padStart(4)}`);
console.log(`   = RECENT                              ${String(funnel.recent).padStart(4)}`);

// ══════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC A — NAME THE FOLLOW-ONS.
//
// 15 of 24 lower candidates being follow-ons is the number to interrogate, not
// the 9 that survived: ~28 US IPOs price monthly, and 24 candidates matches that
// rate almost exactly. If these 15 are seasoned issuers, the test is right. If
// genuine IPOs are in here, the 8-A12B-in-window test is over-filtering and the
// fix is to require the 8-A12B WITHIN ~10 DAYS OF THE 424B instead.
// ══════════════════════════════════════════════════════════════════════════
const recentCut = iso(new Date(TODAY.getTime() - 30 * 86400000));
const lowerCands = all.filter((r) => {
  const f = r.filings.filter((x) => /^424B[14]$/.test(x.form)).sort((a, b) => a.date.localeCompare(b.date)).pop();
  return f && f.date >= recentCut;
});
console.log(`\n${"═".repeat(78)}\nDIAGNOSTIC A — the ${lowerCands.length} lower candidates, and why each was kept or dropped\n${"═".repeat(78)}`);
for (const r of lowerCands) {
  const f424 = r.filings.filter((x) => /^424B[14]$/.test(x.form)).sort((a, b) => a.date.localeCompare(b.date)).pop();
  const a8 = r.filings.filter((x) => x.form === "8-A12B").sort((a, b) => a.date.localeCompare(b.date)).pop();
  const listed = listedByCik.get(String(Number(r.cik)));
  const gap = a8 ? Math.round((new Date(f424.date) - new Date(a8.date)) / 86400000) : null;
  const verdict = a8 ? `KEPT (8-A12B ${a8.date}, ${gap}d before the 424B)` : "DROPPED as follow-on — no 8-A12B in the 90d window";
  console.log(`   ${(listed?.symbol ?? "—").padEnd(6)} ${r.company.slice(0, 38).padEnd(40)} ${f424.form} ${f424.date} · SIC ${r.sic ?? "?"}`);
  console.log(`          ${verdict}`);
  console.log(`          forms: ${r.filings.map((x) => `${x.form}@${x.date}`).join(" ")}`);
  const _b4 = r.filings.filter((x) => /^424B/.test(x.form));
  console.log(`          424B accessions: ${_b4.map((x) => x.acc ?? "(none carried)").join(", ")}`);
}
const droppedList = lowerCands.filter((r) => !r.filings.some((x) => x.form === "8-A12B"));
const earliest8A = lowerCands
  .filter((r) => r.filings.some((x) => x.form === "8-A12B"))
  .map((r) => {
    const f424 = r.filings.filter((x) => /^424B[14]$/.test(x.form)).sort((a, b) => a.date.localeCompare(b.date)).pop();
    const a8 = r.filings.filter((x) => x.form === "8-A12B").sort((a, b) => a.date.localeCompare(b.date)).pop();
    return Math.round((new Date(f424.date) - new Date(a8.date)) / 86400000);
  })
  .sort((a, b) => a - b);
console.log(`\n   dropped as follow-on: ${droppedList.length} of ${lowerCands.length}`);
console.log(`   8-A12B -> 424B gap, days, for those KEPT: [${earliest8A.join(", ")}]`);
console.log(`   >>> If that gap is always small, a +/-10d proximity test costs nothing`);
console.log(`   >>> and removes the 'listed day -29, 8-A12B at day -31' failure mode.`);

// ══════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC B — SPAC vs OPERATING COMPANY in the upper table.
// Not a bug either way; a COPY decision. If the table is mostly blank-check
// shells then "Upcoming IPOs" reads as a SPAC list, and §7's wording should say
// so knowingly rather than by accident.
// ══════════════════════════════════════════════════════════════════════════
const sicOf = new Map(all.map((r) => [String(Number(r.cik)), r.sic]));
const SPAC_NAME_RE = /\b(acquisition|merger)\b/i;
let spacBySic = 0, spacByNameOnly = 0, opco = 0;
console.log(`\n${"═".repeat(78)}\nDIAGNOSTIC B — upper table composition (SIC 6770 is authoritative)\n${"═".repeat(78)}`);
for (const row of upcoming) {
  const sic = sicOf.get(row.cik) ?? null;
  const isSpacSic = sic === "6770";
  const isSpacName = SPAC_NAME_RE.test(row.company);
  if (isSpacSic) spacBySic += 1;
  else if (isSpacName) spacByNameOnly += 1;
  else opco += 1;
  console.log(`   ${isSpacSic ? "[SPAC]" : isSpacName ? "[spac?]" : "[OPCO]"} ${row.company.slice(0, 44).padEnd(46)} SIC ${sic ?? "?"}`);
}
console.log(`\n   SPAC by SIC 6770        ${spacBySic}/${upcoming.length}`);
console.log(`   SPAC by name only       ${spacByNameOnly}/${upcoming.length}  (SIC disagrees — trust the SIC)`);
console.log(`   operating companies     ${opco}/${upcoming.length}`);

console.log(`\n   >>> ENTITY FILTER MATCHED: ${funnel.droppedEntity}`);
if (funnel.droppedEntity === 0) {
  console.log(`   >>> ZERO. Crypto ETF/trust S-1 filings are near-continuous, so this`);
  console.log(`   >>> almost certainly means THE RULE BROKE, not that none were filed.`);
  console.log(`   >>> The previous version (SIC 6726/6221) matched zero and looked fine.`);
}

console.log(`\n── UPPER TABLE (${upcoming.length})`);
for (const r of upcoming) {
  console.log(`   ${(r.symbol ?? "—").padEnd(6)} ${r.company.slice(0, 40).padEnd(42)} terms ${r.date} · ${r.exchange ?? "—"}`);
}
console.log(`\n── LOWER TABLE (${recent.length})`);
for (const r of recent) {
  console.log(`   ${(r.symbol ?? "—").padEnd(6)} ${r.company.slice(0, 40).padEnd(42)} listed ${r.date} · ${r.exchange ?? "—"}`);
}

// ── THE DOCUMENT, BUILT BY THE SHARED MERGE ───────────────────────────────
// Not hand-assembled here. mergeIpoRecords is what the daily ingest calls, so
// seeding and accumulating cannot drift apart in the record shape, the prune
// boundary or the ordering.
const doc = mergeIpoRecords([], all, windowStartFor(TODAY, WINDOW_DAYS), TODAY.getTime());
const valid = validateStored(doc);
console.log(`\n── STORE DOCUMENT (built by the shared merge, not by this script)`);
console.log(`   records after merge+prune: ${doc.records.length} (from ${all.length} parsed)`);
console.log(`   windowStart: ${doc.windowStart} · validates: ${valid.ok ? "yes" : `NO — ${valid.reason}`}`);
console.log(`   bytes: ${JSON.stringify(doc).length}`);
console.log(`   >>> The write itself is TWO Upstash commands (one GET, one SET) and is`);
console.log(`   >>> NOT performed here: relay.yml's Upstash secret is the READ-ONLY`);
console.log(`   >>> token by deliberate choice, and reversing that is the owner's call.`);

fs.mkdirSync("data/sec", { recursive: true });
const payload = {
  ...doc,
  window: [WINDOW_START, TODAY_ISO],
  quarters,
  dedupe: { rowsInWindow: rawRows, duplicatesRemoved: dupes, distinctFilers: byCik.size },
  funnel,
  storeValid: valid,
};
fs.writeFileSync("data/sec/ipo-seed.json", JSON.stringify(payload));
console.log(`\nwrote data/sec/ipo-seed.json (${JSON.stringify(payload).length} bytes)`);
console.log(`\n<<<RAW name=seed-summary.json bytes=0>>>`);
console.log(JSON.stringify({ ...payload, records: undefined, upcoming, recent }, null, 2).slice(0, 200000));
console.log(`<<<ENDRAW name=seed-summary.json>>>`);
console.log(`\nDONE ${new Date().toISOString()}`);
