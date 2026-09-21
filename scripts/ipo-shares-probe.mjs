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

fs.mkdirSync("data/sec", { recursive: true });
const payload = { probedAt: NOW.toISOString(), walked: [FROM, TO], rows };
fs.writeFileSync("data/sec/ipo-shares-probe.json", JSON.stringify(payload));

// ── THE RAW BLOCK GOES FIRST, AND THAT IS NOT A STYLE CHOICE ──────────────
// The sandbox reads these runs through the Actions log API, which returns the
// TAIL. A 200 KB JSON dump printed last pushes the report off the end and the
// run has to be repeated to read its own findings -- which is what happened on
// run 35582966306. Evidence and verdict come after it.
console.log(`<<<RAW name=ipo-shares-probe.json bytes=${JSON.stringify(payload).length}>>>`);
console.log(JSON.stringify(payload));
console.log(`<<<ENDRAW name=ipo-shares-probe.json>>>`);

// ── THE EVIDENCE ──────────────────────────────────────────────────────────
// Only the covers where the shipped rule and the anchored candidates DISAGREE,
// plus three where they agree. A dump of every filer is unreadable, and the
// agreeing cases are the negative control: a candidate that "fixes" the
// disagreements by matching nothing would look identical here without them.
const disagree = rows.filter((r) =>
  Object.values(r.candidateHits).some((v) => v !== null && v !== r.shippedShares)
);
const agree = rows.filter((r) => !disagree.includes(r)).slice(0, 3);

const dump = (r, heading) => {
  const deal = r.impliedDealSize === null ? "—" : `$${(r.impliedDealSize / 1e6).toFixed(1)}M`;
  console.log("─".repeat(78));
  console.log(`${heading} ${r.company.slice(0, 44)}  ·  ${r.form} ${r.date}  ·  SIC ${r.sic ?? "?"}`);
  console.log(`   SHIPPED ${r.shippedShares === null ? "null" : r.shippedShares.toLocaleString()} via ${r.shippedWhich}   price ${r.priceLow ?? "—"}-${r.priceHigh ?? "—"}  deal ${deal}`);
  for (const [name, v] of Object.entries(r.candidateHits)) {
    console.log(`   cand ${name.padEnd(20)} ${v === null ? "—" : v.toLocaleString()}`);
  }
  for (const o of r.occurrences.slice(0, 6)) {
    console.log(`      ${String(o.value).padStart(12)} ${o.noun.padEnd(6)} ${o.saysOutstanding ? "[OUTSTANDING]" : "             "} …${o.context.slice(0, 150)}…`);
  }
};

console.log(`\n${"═".repeat(78)}\nDISAGREEMENTS (${disagree.length}) — where the anchored rules differ from the shipped one\n${"═".repeat(78)}`);
for (const r of disagree) dump(r, "[DIFF]");
console.log(`\n${"═".repeat(78)}\nCONTROLS (${agree.length}) — covers where they agree; a candidate that matched\nnothing would look like a fix without these\n${"═".repeat(78)}`);
for (const r of agree) dump(r, "[SAME]");

// ── THE AGGREGATE, WHICH IS WHAT DECIDES THE RULE ─────────────────────────
console.log(`\n${"═".repeat(78)}\nAGGREGATE\n${"═".repeat(78)}`);
const withShipped = rows.filter((r) => r.shippedShares !== null);
const shippedOnOutstanding = rows.filter((r) =>
  r.occurrences.some((o) => o.value === r.shippedShares && o.saysOutstanding)
);
console.log(`   covers examined                                     ${rows.length}`);
console.log(`   shipped rule returned a number                      ${withShipped.length}`);
console.log(`   ...and its sentence says "outstanding"              ${shippedOnOutstanding.length}   <<< THE FINDING`);
console.log(`   >>> A count taken from the post-offering share total is not an`);
console.log(`   >>> offering size, and it is multiplied by the price midpoint to`);
console.log(`   >>> produce the dealSize the page renders.`);
console.log(`   shipped branch A (shares of common stock)           ${rows.filter((r) => r.shippedWhich.startsWith("A")).length}`);
console.log(`   shipped branch B (offering N shares)                ${rows.filter((r) => r.shippedWhich.startsWith("B")).length}`);
console.log(`   shipped matched nothing                             ${rows.filter((r) => r.shippedWhich === "none").length}`);
for (const name of Object.keys(CANDIDATES).filter((n) => CANDIDATES[n])) {
  const hits = rows.filter((r) => r.candidateHits[name] !== null);
  const onOutstanding = hits.filter((r) =>
    r.occurrences.some((o) => o.value === r.candidateHits[name] && o.saysOutstanding)
  );
  console.log(
    `   cand ${name.padEnd(20)} matched ${String(hits.length).padStart(3)}/${rows.length}` +
      `   on an "outstanding" sentence: ${onOutstanding.length}`
  );
}
// COVERAGE IS ONLY HALF THE QUESTION. A rule that matches 40% and is right is
// better than one that matches 100% and is sometimes the wrong sentence --
// hasTerms() treats a null share count as "no terms" only when the price is
// ALSO null, so a miss costs a column, not a row.
const anyCandidate = rows.filter((r) => Object.values(r.candidateHits).some((v) => v !== null));
console.log(`   at least one anchored candidate matched             ${anyCandidate.length}/${rows.length}`);
console.log(`\nDONE ${new Date().toISOString()}`);
