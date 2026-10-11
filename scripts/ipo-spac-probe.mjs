// What does a SPAC cover actually say about how big the deal is?
//
// ── WHY THIS IS A SEPARATE MEASUREMENT ─────────────────────────────────────
// The share-count fix (relay 35583959865) replaced two unanchored patterns
// with five anchored ones and took correctness from 29% to ~100%. The cost
// landed where it is most visible: THE PAGE IS SPAC-DOMINATED and the one
// unit-shaped anchor, `unitHeader`, matched 1 of 94 covers. So Deal Size is
// blank on almost every row the page shows today -- a real regression in what
// a reader sees, not an edge case.
//
// The temptation is to write what a SPAC cover "usually" says from general
// knowledge. That is exactly how the ETF exclusion got SIC 6726/6221 -- codes
// that were entirely reasonable and matched ZERO rows in 120 days
// (claude/traps/a-filter-that-matches-nothing-looks-correct.md). So this reads
// the filings first and prints what is in them.
//
// ── WHAT IT PRINTS, AND WHY EACH PIECE ────────────────────────────────────
// For every SPAC cover in the window:
//
//   COVER HEAD    the first ~700 stripped characters. A SPAC cover states the
//                 deal in its masthead, and that is the one place every filer
//                 uses. Reading it is the point of the exercise.
//   $ AMOUNTS     every `$<6+ digits>` with context. For a SPAC the aggregate
//                 offering amount IS the deal size, stated directly.
//   UNIT COUNTS   every `<n> Units` with context.
//   TRUST         "trust account" sentences, which restate the amount and are
//                 a corroborating source rather than the primary one.
//   SHIPPED       what parseCoverTerms returns today, so the gap is a number.
//
// NO CANDIDATE PATTERNS IN THIS FILE. Adding them here would invite reading the
// output for confirmation of a guess already made. The anchors get written
// after the sentences have been read, and measured by re-running with them in
// lib/server/ipoCoverTerms.ts.
//
//   dispatch relay.yml, task `ipo-spac`
//   inputs: symbols = "<from>[..<to>]" as yyyymmdd, blank = the last 30 days
import fs from "node:fs";

import { ingestIpoWindow } from "../lib/server/ipoIngest.ts";
import { parseCoverTerms, stripHtml, TERMS_BEARING_FORM } from "../lib/server/ipoCoverTerms.ts";
import { windowStartFor } from "../lib/server/ipoRecordMerge.ts";
import { addDays, latestProcessableDate } from "../lib/server/secDailyIndex.ts";

const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor sonnybrindle@mystockharbor.com";
if (!SEC_UA.includes("@")) {
  console.error("FATAL: SEC_USER_AGENT carries no contact address. SEC will 403.");
  process.exit(1);
}

const NOW = new Date();
const LATEST = latestProcessableDate(NOW);
const RANGE = (process.env.SYMBOLS ?? "").trim();
const m = RANGE.match(/^(\d{8})(?:\.\.(\d{8}))?$/);
const FROM = m ? m[1] : addDays(LATEST, -29);
const TO = m?.[2] ?? LATEST;
const MAX_COVERS = Number(process.env.IPO_SPAC_MAX || 14);

console.log("=".repeat(78));
console.log("SPAC COVER PROBE — what do these filings actually say about deal size?");
console.log(`   walking ${FROM}..${TO}`);
console.log("=".repeat(78));

const windowStart = windowStartFor(NOW);
const ingest = await ingestIpoWindow({
  ua: SEC_UA,
  windowStart,
  from: FROM,
  to: TO,
  maxDays: 45,
  now: NOW,
});
console.log(`\n   ${ingest.filersTouched} filers touched, ${ingest.coversFetched} covers fetched`);

let lastAt = 0;
const get = async (url) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate", accept: "*/*" },
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, body: `${err.name}: ${err.message}` };
  }
};

// SIC 6770 is authoritative. The name test is a SECOND, looser net, printed
// separately so the two never get averaged into one number -- a filer caught
// only by its name is a filer whose submissions read may have failed, and that
// is a different fact from being a blank-check company.
const SPAC_NAME = /\b(acquisition|merger)\b/i;

const DOLLARS = /\$\s?([\d,]{6,})(?!\s*(?:per|\/))/g;
const UNITS = /([\d,]{5,})\s+(Units|units)/g;
const TRUST = /trust account[^.]{0,200}\./gi;

const ctx = (text, idx, before = 110, after = 110) =>
  text.slice(Math.max(0, idx - before), Math.min(text.length, idx + after)).replace(/\s+/g, " ");

const rows = [];
let examined = 0;

for (const record of ingest.records) {
  if (rows.length >= MAX_COVERS) break;
  const terms = record.filings
    .filter((f) => TERMS_BEARING_FORM.test(f.form))
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
  if (!terms) continue;

  const bySic = record.sic === "6770";
  const byName = SPAC_NAME.test(record.company);
  if (!bySic && !byName) continue;

  const padded = String(Number(record.cik)).padStart(10, "0");
  const subs = await get(`https://data.sec.gov/submissions/CIK${padded}.json`);
  if (!subs.ok) continue;
  let accession = null;
  try {
    const j = JSON.parse(subs.body);
    const r = j.filings?.recent ?? {};
    for (let i = 0; i < (r.form ?? []).length; i++) {
      if (r.form[i] === terms.form && r.filingDate[i] === terms.date) {
        accession = r.accessionNumber[i];
        break;
      }
    }
  } catch { /* leave null */ }
  if (!accession) continue;

  const bare = accession.replace(/-/g, "");
  const dir = `https://www.sec.gov/Archives/edgar/data/${Number(record.cik)}/${bare}`;
  const index = await get(`${dir}/index.json`);
  if (!index.ok) continue;
  let primary = null;
  try {
    primary =
      (JSON.parse(index.body).directory?.item ?? [])
        .filter((it) => /\.htm$/i.test(it.name) && !/^R\d+\.htm$/i.test(it.name))
        .sort((a, b) => Number(b.size) - Number(a.size))[0]?.name ?? null;
  } catch { /* leave null */ }
  if (!primary) continue;

  const doc = await get(`${dir}/${primary}`);
  if (!doc.ok) continue;
  examined += 1;

  const cover = stripHtml(doc.body).slice(0, 80000);
  const shipped = parseCoverTerms(cover, record.sic);

  const dollars = [];
  DOLLARS.lastIndex = 0;
  let hit;
  while ((hit = DOLLARS.exec(cover)) !== null && dollars.length < 6) {
    dollars.push({ value: Number(hit[1].replace(/,/g, "")), context: ctx(cover, hit.index) });
  }
  const units = [];
  UNITS.lastIndex = 0;
  while ((hit = UNITS.exec(cover)) !== null && units.length < 6) {
    units.push({ value: Number(hit[1].replace(/,/g, "")), context: ctx(cover, hit.index) });
  }
  const trust = (cover.match(TRUST) ?? []).slice(0, 2).map((t) => t.replace(/\s+/g, " ").slice(0, 200));

  rows.push({
    cik: record.cik,
    company: record.company,
    sic: record.sic,
    bySic,
    byName,
    form: terms.form,
    date: terms.date,
    shippedShares: shipped.sharesOffered,
    shippedLow: shipped.priceRangeLow,
    shippedHigh: shipped.priceRangeHigh,
    head: cover.slice(0, 700),
    dollars,
    units,
    trust,
  });
}

fs.mkdirSync("data/sec", { recursive: true });
fs.writeFileSync("data/sec/ipo-spac-probe.json", JSON.stringify({ probedAt: NOW.toISOString(), rows }));

// ── THE EVIDENCE ──────────────────────────────────────────────────────────
for (const r of rows) {
  console.log("\n" + "─".repeat(78));
  console.log(`${r.company.slice(0, 48)}  ·  ${r.form} ${r.date}  ·  SIC ${r.sic ?? "?"}  ·  ${r.bySic ? "SIC-6770" : "name-only"}`);
  console.log(`   SHIPPED shares ${r.shippedShares === null ? "null" : r.shippedShares.toLocaleString()}   price ${r.shippedLow ?? "—"}-${r.shippedHigh ?? "—"}`);
  console.log(`   COVER HEAD: ${r.head.slice(0, 420)}`);
  for (const d of r.dollars) console.log(`      $${String(d.value).padStart(12)}  …${d.context.slice(0, 130)}…`);
  for (const u of r.units) console.log(`      ${String(u.value).padStart(12)} U …${u.context.slice(0, 130)}…`);
  for (const t of r.trust) console.log(`      TRUST: ${t.slice(0, 150)}`);
}

// ── THE AGGREGATE ─────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(78)}\nAGGREGATE\n${"═".repeat(78)}`);
console.log(`   SPAC covers examined                         ${examined}`);
console.log(`   identified by SIC 6770                       ${rows.filter((r) => r.bySic).length}`);
console.log(`   by NAME only (SIC disagrees or is null)      ${rows.filter((r) => !r.bySic && r.byName).length}`);
console.log(`   shipped parser returned a share/unit count   ${rows.filter((r) => r.shippedShares !== null).length}/${rows.length}   <<< THE GAP`);
console.log(`   shipped parser returned a price              ${rows.filter((r) => r.shippedLow !== null).length}/${rows.length}`);
console.log(`   covers carrying at least one $>=6-digit sum  ${rows.filter((r) => r.dollars.length).length}/${rows.length}`);
console.log(`   covers carrying at least one "<n> Units"     ${rows.filter((r) => r.units.length).length}/${rows.length}`);
console.log(`   covers mentioning a trust account            ${rows.filter((r) => r.trust.length).length}/${rows.length}`);
console.log(`\n   >>> Read the COVER HEAD lines above before writing any pattern.`);
console.log(`   >>> The masthead is the one place every SPAC filer states the deal.`);
console.log(`\nDONE ${new Date().toISOString()}`);
