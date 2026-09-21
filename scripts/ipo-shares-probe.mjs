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

// ── CANDIDATES, WRITTEN FROM THE SENTENCES RUN 35583603426 PRINTED ────────
// The first set (offeringVerb / ipoOf / unitsOffered) matched 7, 1 and 1 of 94
// -- far too narrow to replace anything. These are the shapes the covers
// actually use, each traceable to a filing in that run's output:
//
//   LiPower F-1/A     "Shares Offered by the Issuer We are offering 5,000,000 shares"
//   Lannister F-1/A   "$15,000,000 Units 3,000,000 Units Each ..."  (the cover header)
//   Advance JV 424B4  "We have determined the offering price of the 2,500,000 shares"
const CANDIDATES = {
  // "We are offering 10,000,000 shares" / "we are offering 5,000,000 ADSs"
  offeringVerb:
    /\b(?:we|the\s+company|the\s+issuer)\s+(?:are|is)\s+offering\s+(?:an\s+aggregate\s+of\s+)?([\d,]{5,})\s+(?:shares|ADSs|American\s+Depositary\s+Shares|units|Units)/i,
  // The OFFERING summary table: "Shares Offered by the Issuer  5,000,000"
  offeringTable:
    /(?:shares|ADSs|units)\s+offered\s+(?:by\s+(?:the\s+)?(?:issuer|us|the\s+company)|hereby)[^.]{0,90}?([\d,]{5,})/i,
  // "This is the initial public offering of 5,000,000 shares"
  ipoOf:
    /(?:initial\s+public\s+offering|this\s+offering)\s+of\s+(?:an\s+aggregate\s+of\s+)?([\d,]{5,})\s+(?:shares|ADSs|units|Units)/i,
  // "the offering price of the 2,500,000 shares"
  offeringPriceOf: /offering\s+price\s+of\s+the\s+([\d,]{5,})\s+(?:shares|ADSs|units|Units)/i,
  // The SPAC cover header: "$15,000,000 Units 3,000,000 Units"
  unitHeader: /\$[\d,]{6,}\s+Units\s+([\d,]{5,})\s+Units/i,
};

// ── THE DISQUALIFIERS, ALSO FROM THE FILINGS ──────────────────────────────
// A count is not an offering size when its sentence is about something else,
// and the run above showed THREE distinct somethings, only one of which was
// the "outstanding" case this probe set out to find:
//
//   CYABRA   "by the selling shareholders ... of up to 21,645,176 shares"
//   Aura     "We are registering the offer and sale from time to time of up to
//             143,277,908 shares"        (a RESALE, not an offering)
//   Aptevo   "resale from time to time by certain selling stockholders ... up to
//             6,444,858 shares"          + a $428.40 price -> a $2.76 BILLION
//                                          deal size for a microcap
//   many     "... shares of common stock outstanding after this offering"
//   many     "issuable upon exercise of ... warrants"
const DISQUALIFY = /outstanding|resale|selling\s+(?:share|stock)holder|issuable\s+upon|from\s+time\s+to\s+time|registering/i;

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
      // The WHOLE sentence around the number, both directions -- "resale" and
      // "selling stockholders" sit BEFORE the count, "outstanding" after it,
      // so a trailing-only window sees half the disqualifiers.
      disqualified: DISQUALIFY.test(cover.slice(Math.max(0, hit.index - 180), hit.index + 160)),
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
// SELECTED ON THE DEFECT, NOT ON DISAGREEMENT. The first version of this
// printed covers where a candidate anchor differed from the shipped rule --
// which is precisely the wrong set, because the 12 covers whose shipped answer
// came from an "outstanding" sentence are mostly ones where NO candidate
// matched at all, so they were filtered out. The report showed everything
// except the thing being investigated.
const shippedOnOutstandingRows = rows.filter((r) =>
  r.shippedShares !== null &&
  r.occurrences.some((o) => o.value === r.shippedShares && o.saysOutstanding)
);
// The other half of the problem: 56 of 94 got no number at all. A rule that
// only refuses bad matches leaves those where they are, so the sentences that
// DO carry an offering size need reading too.
const shippedNull = rows.filter((r) => r.shippedShares === null).slice(0, 6);
// Controls: shipped returned a number and its sentence does NOT say
// outstanding. Without these, a fix that refuses everything looks like a fix.
const shippedLooksRight = rows.filter(
  (r) => r.shippedShares !== null && !shippedOnOutstandingRows.includes(r)
).slice(0, 4);

const dump = (r, heading) => {
  const deal = r.impliedDealSize === null ? "—" : `$${(r.impliedDealSize / 1e6).toFixed(1)}M`;
  console.log("─".repeat(78));
  console.log(`${heading} ${r.company.slice(0, 44)}  ·  ${r.form} ${r.date}  ·  SIC ${r.sic ?? "?"}`);
  console.log(`   SHIPPED ${r.shippedShares === null ? "null" : r.shippedShares.toLocaleString()} via ${r.shippedWhich}   price ${r.priceLow ?? "—"}-${r.priceHigh ?? "—"}  deal ${deal}`);
  const cands = Object.entries(r.candidateHits).filter(([, v]) => v !== null);
  if (cands.length) console.log(`   candidates: ${cands.map(([n, v]) => `${n}=${v.toLocaleString()}`).join("  ")}`);
  for (const o of r.occurrences.slice(0, 5)) {
    const mark = o.value === r.shippedShares ? "<<SHIPPED" : "         ";
    console.log(`      ${String(o.value).padStart(12)} ${o.noun.padEnd(6)} ${o.saysOutstanding ? "[OUTST]" : "       "} ${mark} …${o.context.slice(0, 145)}…`);
  }
};

console.log(`\n${"═".repeat(78)}\nWRONG (${shippedOnOutstandingRows.length}) — shipped answer came from an "outstanding" sentence\n${"═".repeat(78)}`);
for (const r of shippedOnOutstandingRows) dump(r, "[BAD]");
console.log(`\n${"═".repeat(78)}\nMISSED (${shippedNull.length} of ${rows.filter((r) => r.shippedShares === null).length}) — no share count at all; what IS on these covers?\n${"═".repeat(78)}`);
for (const r of shippedNull) dump(r, "[NONE]");
console.log(`\n${"═".repeat(78)}\nCONTROLS (${shippedLooksRight.length}) — shipped returned a number that is NOT from an\noutstanding sentence. A fix that refuses everything must break these.\n${"═".repeat(78)}`);
for (const r of shippedLooksRight) dump(r, "[OK]");

// ── THE AGGREGATE, WHICH IS WHAT DECIDES THE RULE ─────────────────────────
console.log(`\n${"═".repeat(78)}\nAGGREGATE\n${"═".repeat(78)}`);
const withShipped = rows.filter((r) => r.shippedShares !== null);
const shippedOnOutstanding = shippedOnOutstandingRows;
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
  const bad = hits.filter((r) =>
    r.occurrences.some((o) => o.value === r.candidateHits[name] && o.disqualified)
  );
  console.log(
    `   cand ${name.padEnd(20)} matched ${String(hits.length).padStart(3)}/${rows.length}` +
      `   of which DISQUALIFIED context: ${bad.length}`
  );
}
// COVERAGE IS ONLY HALF THE QUESTION. A rule that matches 40% and is right is
// better than one that matches 100% and is sometimes the wrong sentence --
// hasTerms() treats a null share count as "no terms" only when the price is
// ALSO null, so a miss costs a column, not a row.
const anyCandidate = rows.filter((r) => Object.values(r.candidateHits).some((v) => v !== null));
console.log(`   at least one anchored candidate matched             ${anyCandidate.length}/${rows.length}`);
const shippedDisqualified = rows.filter(
  (r) => r.shippedShares !== null && r.occurrences.some((o) => o.value === r.shippedShares && o.disqualified)
);
console.log(`   shipped answer sat in DISQUALIFIED context          ${shippedDisqualified.length}/${rows.filter((r) => r.shippedShares !== null).length}`);
console.log(`   >>> wider than the "outstanding" count above: it adds resale and`);
console.log(`   >>> selling-shareholder registrations, which are not offerings at all.`);

// ── A SECOND DEFECT, MEASURED BECAUSE IT WAS IN FRONT OF US ───────────────
// Aptevo's 424B4 parsed a price of $428.40 -- inside the $1-$500 plausibility
// bound, and a SINGLE price, so the 3x range-ratio guard never applies to it.
// Combined with a resale share count it produced a $2.76 BILLION deal size.
// Not the share count's fault and not this probe's brief; counted so the
// decision to fix it or not is made against a number.
const highPrice = rows.filter((r) => r.priceLow !== null && r.priceLow > 100);
console.log(`\n   covers whose parsed price is above $100/share       ${highPrice.length}`);
for (const r of highPrice) {
  console.log(`      ${r.company.slice(0, 40).padEnd(42)} $${r.priceLow}${r.priceHigh !== r.priceLow ? `-$${r.priceHigh}` : " (single price — the 3x ratio guard does not apply)"}`);
}
console.log(`\nDONE ${new Date().toISOString()}`);
