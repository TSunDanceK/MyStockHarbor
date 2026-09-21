// Run 2. THE FIRST RUN'S S-1/A SAMPLE WAS NOT IPOs, AND THAT INVALIDATED ITS
// HEADLINE NUMBER.
//
// Run 1 (34883412035) took the last five S-1/A filings in the 60-day window and
// reported "price range 0/5". Reading back which companies those were kills the
// number: iPower (IPW, twice), authID, iSpecimen -- all ALREADY LISTED on Nasdaq,
// filing S-1/A to register resale or follow-on shares. An already-public company
// registering a resale has no IPO price range to find, so 0/5 measured the
// sampling frame, not the filings. Reporting it as the cover-page hit rate would
// have answered the brief's decisive question with an artefact.
//
// THE FIX IS THE COHORT, NOT THE REGEX. S-1/A is overwhelmingly used by small
// already-listed issuers; genuine IPOs are a minority of it. So this run defines
// the cohort from the form that actually means "a class is being registered on an
// exchange for the first time" -- 8-A12B -- and only then looks at what those
// companies filed.
//
// 8-A12B IS NOT PURE EITHER. ETFs, notes, SPAC unit/warrant classes and secondary
// class registrations also file it. That is not hidden here: the cohort size,
// the intersection sizes, and every company name are printed so the reader can
// see what the denominator is made of.
//
//   dispatch relay.yml, task `ipo-sec-cohort`
import fs from "node:fs";

const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor sonnybrindle@mystockharbor.com";
const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY_ISO = iso(TODAY);
const MINUS_60 = iso(new Date(TODAY.getTime() - 60 * 86400000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { "User-Agent": SEC_UA, accept: "*/*" };

async function get(url, timeoutMs = 60000) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, status: 0, body: "", ms: Date.now() - started, error: `${err.name}: ${err.message}` };
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
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ");

console.log("=".repeat(78));
console.log("IPO SEC COHORT PROBE (run 2) — 2026-09-14");
console.log(`window ${MINUS_60}..${TODAY_ISO}`);
console.log("=".repeat(78));

const idx = await get("https://www.sec.gov/Archives/edgar/full-index/2026/QTR3/form.idx");
if (!idx.ok) {
  console.error(`FATAL: form.idx unreadable (status ${idx.status}). ${idx.error ?? ""}`);
  process.exit(1);
}
console.log(`form.idx: HTTP ${idx.status} · ${idx.ms}ms · ${idx.body.length} bytes`);

const byCik = new Map();
const counts = {};
for (const line of idx.body.split("\n")) {
  const m = line.match(/^(\S[\S\s]{0,11}\S)\s{2,}(.+?)\s{2,}(\d{4,10})\s{2,}(\d{4}-\d{2}-\d{2})\s{2,}(\S+)\s*$/);
  if (!m) continue;
  const [, formRaw, company, cik, date, file] = m;
  const form = formRaw.trim();
  if (date < MINUS_60 || date > TODAY_ISO) continue;
  counts[form] = (counts[form] ?? 0) + 1;
  if (!["8-A12B", "S-1", "S-1/A", "F-1", "F-1/A", "424B4", "424B1"].includes(form)) continue;
  if (!byCik.has(cik)) byCik.set(cik, { cik, company: company.trim(), filings: [] });
  byCik.get(cik).filings.push({ form, date, file });
}

const cohort = [...byCik.values()].filter((c) => c.filings.some((f) => f.form === "8-A12B"));
console.log(`\n── COHORT`);
console.log(`   8-A12B filers in window (the new-listing signal): ${cohort.length}`);
const withReg = cohort.filter((c) => c.filings.some((f) => /^(S-1|F-1)/.test(f.form)));
const withFinal = cohort.filter((c) => c.filings.some((f) => /^424B[14]$/.test(f.form)));
console.log(`   ...that ALSO filed an S-1/F-1 (any amendment) in window: ${withReg.length}`);
console.log(`   ...that ALSO filed a 424B1/424B4 in window:             ${withFinal.length}`);
console.log(`   NOTE: 8-A12B is also filed by ETFs, notes and SPAC classes — this`);
console.log(`   denominator is "new exchange registrations", not "operating-company IPOs".`);

// Assess the ones that look most like a real IPO: an 8-A12B AND a final
// prospectus. Those are companies that registered a class and priced a deal.
const targets = withFinal.slice(0, 8);
console.log(`\n── ASSESSING ${targets.length} COHORT MEMBERS (8-A12B + final prospectus)`);

const PRICE_RANGE = [
  /between\s+\$\s?([\d.]+)\s+and\s+\$\s?([\d.]+)\s+per\s+share/i,
  /\$\s?([\d.]+)\s*(?:to|and|-|–|—)\s*\$\s?([\d.]+)\s+per\s+share/i,
];
const PRICE_FINAL = [
  /initial public offering price (?:is|of|was)\s+\$\s?([\d.]+)/i,
  /public offering price of\s+\$\s?([\d.]+)\s+per\s+share/i,
  /offering price\s+\$\s?([\d.]+)\s+per\s+share/i,
  /\$\s?([\d.]+)\s+per\s+share/i,
];
const SHARES = [
  /([\d,]{5,})\s+shares\s+of\s+(?:our\s+)?(?:common|ordinary)\s+(?:stock|shares)/i,
  /offering\s+([\d,]{5,})\s+shares/i,
];
// The decisive question. Cover AND underwriting section.
const LISTING_DATE = [
  /expected to (?:begin|commence) trading[^.]{0,200}/i,
  /(?:trading|shares)[^.]{0,60}(?:is|are|will)\s+expected to (?:begin|commence)[^.]{0,200}/i,
  /(?:has been|have been) approved for listing[^.]{0,200}/i,
  /expect(?:s|ed)? (?:our|the) (?:common stock|ordinary shares) to (?:be listed|begin trading)[^.]{0,200}/i,
  /delivery of the shares[^.]{0,100}on or about\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/i,
  /on or about\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/,
];

const firstMatch = (text, patterns, pairs = false) => {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return pairs ? `$${m[1]}–$${m[2]}` : m[1] ?? m[0];
  }
  return null;
};

const rows = [];
for (const c of targets) {
  console.log(`\n   ${c.company} · CIK ${c.cik}`);
  const sorted = [...c.filings].sort((a, b) => a.date.localeCompare(b.date));
  for (const f of sorted) console.log(`     ${f.form.padEnd(8)} ${f.date}`);

  const row = { company: c.company, cik: c.cik, filings: sorted.map((f) => ({ form: f.form, date: f.date })) };

  // LEAD TIME — what the brief's §4 table claims, measured.
  const dateOf = (pred) => sorted.find((f) => pred(f.form))?.date ?? null;
  const reg = dateOf((x) => /^(S-1|F-1)$/.test(x)) ?? dateOf((x) => /^(S-1|F-1)/.test(x));
  const amend = dateOf((x) => /^(S-1\/A|F-1\/A)$/.test(x));
  const eightA = dateOf((x) => x === "8-A12B");
  const final = dateOf((x) => /^424B[14]$/.test(x));
  const days = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) : null);
  row.leadTimes = {
    firstFilingToEightA: days(reg ?? amend, eightA),
    eightAToFinal: days(eightA, final),
    amendToFinal: days(amend, final),
  };
  console.log(`     lead times (days): S-1/F-1→8-A12B ${row.leadTimes.firstFilingToEightA ?? "—"} · 8-A12B→424B ${row.leadTimes.eightAToFinal ?? "—"} · S-1/A→424B ${row.leadTimes.amendToFinal ?? "—"}`);

  // Assess the amendment (price RANGE expected) and the final (actual PRICE).
  for (const kind of ["amend", "final"]) {
    const f = kind === "amend"
      ? sorted.filter((x) => /^(S-1\/A|F-1\/A)$/.test(x.form)).pop()
      : sorted.filter((x) => /^424B[14]$/.test(x.form)).pop();
    if (!f) { console.log(`     ${kind}: none in window`); continue; }
    const accession = f.file.split("/").pop().replace(/\.txt$/, "");
    const noDash = accession.replace(/-/g, "");
    await sleep(150);
    const ij = await get(`https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${noDash}/index.json`);
    if (!ij.ok) { console.log(`     ${kind}: index unreadable`); continue; }
    let primary = null;
    try {
      const items = JSON.parse(ij.body).directory?.item ?? [];
      primary = items
        .filter((it) => /\.htm$/i.test(it.name) && !/^R\d+\.htm$/i.test(it.name))
        .sort((a, b) => Number(b.size) - Number(a.size))[0]?.name ?? null;
    } catch { /* fall through to the null check */ }
    if (!primary) { console.log(`     ${kind}: no primary doc`); continue; }
    await sleep(150);
    const doc = await get(`https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${noDash}/${primary}`);
    if (!doc.ok) { console.log(`     ${kind}: doc unreadable`); continue; }
    const text = strip(doc.body);
    const cover = text.slice(0, 60000);

    const out = {
      form: f.form,
      date: f.date,
      doc: primary,
      bytes: doc.body.length,
      priceRange: firstMatch(cover, PRICE_RANGE, true),
      priceFinal: firstMatch(cover, PRICE_FINAL),
      shares: firstMatch(cover, SHARES),
      exchange: (cover.match(/(New York Stock Exchange|NYSE American|Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|NYSE|Nasdaq)/i) ?? [])[1] ?? null,
      ticker: (cover.match(/(?:symbol|ticker)\s*[""“”'']?\s*:?\s*[""“”'']?\s*([A-Z]{1,5})\b/) ?? [])[1] ?? null,
      listingDate: [],
    };
    for (const re of LISTING_DATE) {
      const m = text.match(re);
      if (m) out.listingDate.push(m[0].trim().slice(0, 240));
    }
    console.log(`     ${kind} (${f.form} ${f.date}, ${primary}):`);
    console.log(`       price range ${out.priceRange ?? "—"} · final price ${out.priceFinal ?? "—"} · shares ${out.shares ?? "—"}`);
    console.log(`       ticker ${out.ticker ?? "—"} · exchange ${out.exchange ?? "—"}`);
    if (out.listingDate.length) {
      console.log(`       LISTING-DATE LANGUAGE (${out.listingDate.length}):`);
      out.listingDate.forEach((h) => console.log(`         "${h}"`));
    } else {
      console.log(`       LISTING-DATE LANGUAGE: NONE`);
    }
    row[kind] = out;
  }
  rows.push(row);
}

// ── Honest aggregate, per document class, within the IPO cohort ───────────
const amends = rows.filter((r) => r.amend);
const finals = rows.filter((r) => r.final);
console.log(`\n── HIT RATE WITHIN THE COHORT (this is the number run 1 got wrong)`);
console.log(`   S-1/A or F-1/A assessed: ${amends.length}`);
if (amends.length) {
  console.log(`     price RANGE on cover   ${amends.filter((r) => r.amend.priceRange).length}/${amends.length}`);
  console.log(`     share count            ${amends.filter((r) => r.amend.shares).length}/${amends.length}`);
  console.log(`     proposed ticker        ${amends.filter((r) => r.amend.ticker).length}/${amends.length}`);
  console.log(`     exchange               ${amends.filter((r) => r.amend.exchange).length}/${amends.length}`);
  console.log(`     ANY listing-date lang. ${amends.filter((r) => r.amend.listingDate.length).length}/${amends.length}`);
}
console.log(`   424B1/424B4 assessed: ${finals.length}`);
if (finals.length) {
  console.log(`     final price            ${finals.filter((r) => r.final.priceFinal).length}/${finals.length}`);
  console.log(`     share count            ${finals.filter((r) => r.final.shares).length}/${finals.length}`);
  console.log(`     ticker                 ${finals.filter((r) => r.final.ticker).length}/${finals.length}`);
  console.log(`     exchange               ${finals.filter((r) => r.final.exchange).length}/${finals.length}`);
  console.log(`     ANY listing-date lang. ${finals.filter((r) => r.final.listingDate.length).length}/${finals.length}`);
}

const lt = rows.map((r) => r.leadTimes.eightAToFinal).filter((v) => v !== null);
if (lt.length) {
  lt.sort((a, b) => a - b);
  console.log(`\n   8-A12B → final prospectus, days: [${lt.join(", ")}] · median ${lt[Math.floor(lt.length / 2)]}`);
}
const lt2 = rows.map((r) => r.leadTimes.amendToFinal).filter((v) => v !== null);
if (lt2.length) {
  lt2.sort((a, b) => a - b);
  console.log(`   S-1/A → final prospectus, days: [${lt2.join(", ")}] · median ${lt2[Math.floor(lt2.length / 2)]}`);
}

fs.mkdirSync("data/sec", { recursive: true });
const payload = {
  window: [MINUS_60, TODAY_ISO],
  formCounts: counts,
  cohort: { eightA: cohort.length, withRegistration: withReg.length, withFinal: withFinal.length },
  assessed: rows,
};
fs.writeFileSync("data/sec/ipo-probe-cohort.json", JSON.stringify(payload, null, 2));
console.log(`\n<<<RAW name=cohort.json bytes=${JSON.stringify(payload).length}>>>`);
console.log(JSON.stringify(payload, null, 2).slice(0, 300000));
console.log(`<<<ENDRAW name=cohort.json>>>`);
console.log(`\nDONE ${new Date().toISOString()}`);
