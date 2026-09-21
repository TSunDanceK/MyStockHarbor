// What sentence is the share count actually coming from?
//
// ── WHY A PROBE AND NOT A PATCH ────────────────────────────────────────────
// Phase 0 gated the PRICE parser at 5/5 against real covers. THE SHARE COUNT
// WAS NEVER MEASURED AT ALL, and the first live ingest run showed two rows that
// cannot be right:
//
//   ADARx Pharmaceuticals   88,250,216 shares   (reads like shares OUTSTANDING)
//   Alopexx, Inc.              195,425 shares x $10-12 = a $2.1M NYSE American IPO
//
// `sharesOffered` feeds `dealSize`, which the page renders, so a wrong number
// here is a wrong figure on a live page -- and a plausible one, which is the
// whole shape of claude/traps/a-filter-that-matches-nothing-looks-correct.md.
//
// SO THIS PRINTS EVIDENCE, NOT A VERDICT. For each cover it dumps EVERY
// "<number> shares/Units/ADSs" occurrence with the words around it, then shows
// what the shipped regex picked and what each candidate would pick. The rule is
// chosen by reading the sentences, the way the price parser's was. A probe that
// asserted my guess would be measuring the guess.
//
// ── WHAT WE ALREADY SUSPECT, STATED SO THE OUTPUT CAN REFUTE IT ────────────
// The shipped pattern is `([\d,]{5,})\s+shares\s+of\s+(?:our\s+)?(?:common|
// ordinary)\s+(?:stock|shares)` with NO anchor on the offering itself, taking
// the FIRST match in 80,000 characters. A prospectus cover says "shares of our
// common stock" in several places, and at least one of them is the
// post-offering share count. If that is what is happening, the hits will
// cluster on the word "outstanding" and the fix is an anchor, not a bound.
//
//   dispatch relay.yml, task `ipo-shares`
//   inputs: symbols = "<from>[..<to>]" as yyyymmdd, blank = the last 14 days
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
const FROM = m ? m[1] : addDays(LATEST, -13);
const TO = m?.[2] ?? LATEST;

console.log("=".repeat(78));
console.log("IPO SHARE-COUNT PROBE — which sentence is the number coming from?");
console.log(`   walking ${FROM}..${TO}`);
console.log("=".repeat(78));

// ── Find the filers, the same way the ingest does ─────────────────────────
// Reusing ingestIpoWindow means the cohort is exactly the one the page would
// build from, rather than a hand-picked sample that could flatter either rule.
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

// ── Re-fetch the covers, keeping the TEXT this time ───────────────────────
// ingestIpoWindow parses and discards; this needs the surrounding sentences.
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

// EVERY "<number> shares|Units|ADSs" ON THE COVER, with its context. Not just
// the one the regex takes -- the question is which of several the rule SHOULD
// be taking, and that cannot be answered from the winner alone.
const ALL_COUNTS = /([\d,]{5,})\s+(shares|Units|units|ADSs|American Depositary Shares)/g;

// The shipped rule, lifted verbatim so the report is about the code that runs.
const SHIPPED_A = /([\d,]{5,})\s+shares\s+of\s+(?:our\s+)?(?:common|ordinary)\s+(?:stock|shares)/i;
const SHIPPED_B = /offering\s+([\d,]{5,})\s+shares/i;

// ── CANDIDATES. Each anchors on the OFFERING rather than on the phrase
// "shares of common stock", which a cover uses for several different facts.
const CANDIDATES = {
  // "We are offering 10,000,000 shares ..." / "we are offering 5,000,000 ADSs"
  offeringVerb:
    /\b(?:we|the\s+company|the\s+issuer)\s+(?:are|is)\s+offering\s+(?:an\s+aggregate\s+of\s+)?([\d,]{5,})\s+(?:shares|ADSs|units|Units)/i,
  // "This is the initial public offering of 5,000,000 shares ..."
  ipoOf:
    /initial\s+public\s+offering\s+of\s+(?:an\s+aggregate\s+of\s+)?([\d,]{5,})\s+(?:shares|ADSs|units|Units)/i,
  // "offering 20,000,000 Units" — the SPAC shape
  unitsOffered: /offering\s+(?:of\s+)?(?:an\s+aggregate\s+of\s+)?([\d,]{5,})\s+(?:units|Units)/i,
  // The shipped pattern, but refusing a hit whose sentence says "outstanding".
  sharesOfNotOutstanding: null, // computed below; needs lookahead over context
};

const ctx = (text, idx, before = 130, after = 90) =>
  text.slice(Math.max(0, idx - before), Math.min(text.length, idx + after)).replace(/\s+/g, " ");

const rows = [];
let fetched = 0;

for (const record of ingest.records) {
  const terms = record.filings
    .filter((f) => TERMS_BEARING_FORM.test(f.form))
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
  if (!terms) continue;

  // The accession is not on the merged record, so re-derive the directory from
  // submissions the same way the ingest did.
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
  fetched += 1;

  const cover = stripHtml(doc.body).slice(0, 80000);
  const shipped = parseCoverTerms(cover, record.sic);

  const occurrences = [];
  ALL_COUNTS.lastIndex = 0;
  let hit;
  while ((hit = ALL_COUNTS.exec(cover)) !== null && occurrences.length < 10) {
    occurrences.push({
      value: Number(hit[1].replace(/,/g, "")),
      noun: hit[2],
      at: hit.index,
      // "outstanding" anywhere in the trailing clause is the tell we are
      // looking for; recorded per occurrence rather than judged here.
      saysOutstanding: /outstanding/i.test(cover.slice(hit.index, hit.index + 160)),
      context: ctx(cover, hit.index),
    });
  }

  const candidateHits = {};
  for (const [name, re] of Object.entries(CANDIDATES)) {
    if (!re) continue;
    const mm = cover.match(re);
    candidateHits[name] = mm ? Number(mm[1].replace(/,/g, "")) : null;
  }

  const shippedWhich = SHIPPED_A.test(cover) ? "A (shares of common stock)" : SHIPPED_B.test(cover) ? "B (offering N shares)" : "none";

  rows.push({
    cik: record.cik,
    company: record.company,
    form: terms.form,
    date: terms.date,
    sic: record.sic,
    shippedShares: shipped.sharesOffered,
    shippedWhich,
    priceLow: shipped.priceRangeLow,
    priceHigh: shipped.priceRangeHigh,
    impliedDealSize:
      shipped.sharesOffered !== null && shipped.priceRangeLow !== null && shipped.priceRangeHigh !== null
        ? shipped.sharesOffered * ((shipped.priceRangeLow + shipped.priceRangeHigh) / 2)
        : null,
    candidateHits,
    occurrences,
  });
}

console.log(`\n   covers re-fetched with text: ${fetched}\n`);

// ── THE EVIDENCE, one filer at a time ─────────────────────────────────────
for (const r of rows) {
  const deal = r.impliedDealSize === null ? "—" : `$${(r.impliedDealSize / 1e6).toFixed(1)}M`;
  console.log("─".repeat(78));
  console.log(`${r.company.slice(0, 50)}  ·  CIK ${r.cik}  ·  ${r.form} ${r.date}  ·  SIC ${r.sic ?? "?"}`);
  console.log(`   SHIPPED: ${r.shippedShares === null ? "null" : r.shippedShares.toLocaleString()} via ${r.shippedWhich}`);
  console.log(`   price ${r.priceLow ?? "—"}-${r.priceHigh ?? "—"}  ->  implied deal size ${deal}`);
  for (const [name, v] of Object.entries(r.candidateHits)) {
    console.log(`   candidate ${name.padEnd(22)} ${v === null ? "—" : v.toLocaleString()}`);
  }
  console.log(`   occurrences on the cover (${r.occurrences.length}):`);
  for (const o of r.occurrences) {
    console.log(`      ${String(o.value).padStart(12)} ${o.noun.padEnd(6)} ${o.saysOutstanding ? "[OUTSTANDING]" : "             "} …${o.context}…`);
  }
}

// ── THE AGGREGATE, which is what decides the rule ─────────────────────────
console.log(`\n${"═".repeat(78)}\nAGGREGATE\n${"═".repeat(78)}`);
const withShipped = rows.filter((r) => r.shippedShares !== null);
const shippedOnOutstanding = rows.filter((r) =>
  r.occurrences.some((o) => o.value === r.shippedShares && o.saysOutstanding)
);
console.log(`   covers examined                       ${rows.length}`);
console.log(`   shipped rule returned a number        ${withShipped.length}`);
console.log(`   ...and that number's sentence says "outstanding"   ${shippedOnOutstanding.length}`);
console.log(`   >>> THAT SECOND NUMBER IS THE FINDING. A count taken from the`);
console.log(`   >>> post-offering share total is not an offering size, and it is`);
console.log(`   >>> multiplied by the price midpoint to produce dealSize.`);
for (const name of Object.keys(CANDIDATES).filter((n) => CANDIDATES[n])) {
  const hits = rows.filter((r) => r.candidateHits[name] !== null);
  const agreeWithShipped = hits.filter((r) => r.candidateHits[name] === r.shippedShares);
  console.log(
    `   candidate ${name.padEnd(22)} matched ${String(hits.length).padStart(3)}/${rows.length}` +
      `   agrees with shipped on ${agreeWithShipped.length}`
  );
}

fs.mkdirSync("data/sec", { recursive: true });
fs.writeFileSync("data/sec/ipo-shares-probe.json", JSON.stringify({ probedAt: NOW.toISOString(), walked: [FROM, TO], rows }));
console.log(`\n<<<RAW name=ipo-shares-probe.json bytes=0>>>`);
console.log(JSON.stringify({ probedAt: NOW.toISOString(), walked: [FROM, TO], rows }, null, 2).slice(0, 400000));
console.log(`<<<ENDRAW name=ipo-shares-probe.json>>>`);
console.log(`\nDONE ${new Date().toISOString()}`);
