// PHASE 0 of claude/BRIEF-ipo-off-fmp-2026-09-14.md. MEASURE AND STOP.
//
// Three questions, none of which the source probe answered well enough to build on:
//
//   0.1  What is the S-1/A extraction rate on a sample big enough to mean anything,
//        with SPACs SEPARATED from operating companies? The source probe's "price
//        range 1/4" blended an extraction failure with a field that does not exist:
//        a SPAC unit is fixed at $10.00 and has no range to find. Two of those four
//        were SPACs.
//
//   0.2  Can the price parser be made right? It returned a number 8 times out of 8
//        and was right 3 -- three SPAC warrant strikes ($11.50) and two par values
//        ($0.00001, $0.004). THE GATE IS >=90% CORRECT, AND A NULL COUNTS AS CORRECT
//        WHERE THE FIELD IS GENUINELY ABSENT. A parser that always answers has not
//        been tested, so there is a negative control below.
//
//   0.3  Where should the age cap sit? §4.8 requires one and gives no number, because
//        none was measurable from n=8. This prints the histogram and recommends
//        nothing -- the constant is the owner's call once the shape is visible.
//
// NO BUILD. This writes no app file and proposes no code.
//   dispatch relay.yml, task `ipo-phase0`
import fs from "node:fs";

const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor sonnybrindle@mystockharbor.com";
const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY_ISO = iso(TODAY);
const MINUS_120 = iso(new Date(TODAY.getTime() - 120 * 86400000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { "User-Agent": SEC_UA, accept: "*/*" };

async function get(url, timeoutMs = 90000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
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
    .replace(/&#x201c;|&#x201d;|&#8220;|&#8221;/g, '"')
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");

// ── SPAC classification. A SPAC's price range is not missing, it does not exist:
// units are fixed at $10.00. Counting it as an extraction failure is what made the
// source probe's 1/4 meaningless, so this is measured, not assumed, and the
// per-company verdict is printed so the classification can be argued with.
const SPAC_NAME = /\b(acquisition|merger)\s+(corp|corporation|company|co)\b|\bcapital corp\b/i;
const SPAC_BODY = [
  /blank check company/i,
  /business combination/i,
  /trust account/i,
  /units,? each (consisting|comprising)/i,
];
function classify(company, text) {
  const byName = SPAC_NAME.test(company);
  const hits = SPAC_BODY.filter((re) => re.test(text)).length;
  // Two independent signals: the name, and the prospectus's own language. A blank
  // check company says so in the body -- the name alone would misfile an operating
  // company that happens to be called "... Acquisition Corp".
  return { isSpac: hits >= 2 || (byName && hits >= 1), byName, bodyHits: hits };
}

// ══════════════════════════════════════════════════════════════════════════
// THE PARSER UNDER TEST (0.2). Built to the brief's five rules.
// ══════════════════════════════════════════════════════════════════════════
const PLAUSIBLE_LOW = 1;
const PLAUSIBLE_HIGH = 500;
const plausible = (n) => Number.isFinite(n) && n >= PLAUSIBLE_LOW && n <= PLAUSIBLE_HIGH;

// ANCHOR ON THE PHRASE, NOT THE NUMBER. A bare "$X per share" anywhere in a 1.9 MB
// document is not evidence -- that is what produced the par values.
const RANGE_PHRASES = [
  /(?:initial public offering price|public offering price|offering price)[^.]{0,60}?between\s+\$\s?([\d.]+)\s+and\s+\$\s?([\d.]+)/i,
  /between\s+\$\s?([\d.]+)\s+and\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
  /\$\s?([\d.]+)\s*(?:to|and|–|—|-)\s*\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
  /anticipated?[^.]{0,40}(?:price|range)[^.]{0,40}\$\s?([\d.]+)\s*(?:to|and|–|—|-)\s*\$\s?([\d.]+)/i,
];
const FINAL_PHRASES = [
  /initial public offering price (?:is|of|was)\s+\$\s?([\d.]+)/i,
  /public offering price (?:is|of|was)\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
  /offering price of\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
  /at a price of\s+\$\s?([\d.]+)\s+per\s+(?:share|ADS)/i,
];
// SPAC CROSS-CHECK. A unit deal at $10.00 with an $11.50 warrant strike is the
// common shape; $11.50 is not an offer price and was 3 of the source probe's 8.
const WARRANT_STRIKE = /\$\s?11\.50|exercise price of\s+\$\s?([\d.]+)/i;
const SPAC_UNIT = /\$\s?10\.00\s+per\s+unit|price of\s+\$\s?10\.00/i;

function parsePrice(text, isSpac) {
  const cover = text.slice(0, 80000);
  // SPACs first: the unit price is the answer and the warrant strike is the trap.
  if (isSpac) {
    if (SPAC_UNIT.test(cover)) return { value: 10.0, basis: "SPAC unit $10.00" };
    return { value: null, basis: "SPAC, unit price not found — null rather than the warrant strike" };
  }
  for (const re of FINAL_PHRASES) {
    const m = cover.match(re);
    if (m) {
      const n = Number(m[1]);
      if (plausible(n)) return { value: n, basis: `phrase-anchored final: "${m[0].slice(0, 60)}"` };
      return { value: null, basis: `rejected ${n} — outside $${PLAUSIBLE_LOW}–$${PLAUSIBLE_HIGH}` };
    }
  }
  return { value: null, basis: "no anchored offering-price phrase" };
}

function parseRange(text) {
  const cover = text.slice(0, 80000);
  for (const re of RANGE_PHRASES) {
    const m = cover.match(re);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (plausible(lo) && plausible(hi) && lo <= hi) {
        return { low: lo, high: hi, basis: `"${m[0].slice(0, 70)}"` };
      }
      return { low: null, high: null, basis: `rejected ${lo}-${hi} — implausible` };
    }
  }
  return { low: null, high: null, basis: "no anchored range phrase" };
}

console.log("=".repeat(78));
console.log("IPO PHASE 0 — extraction rate, parser gate, age histogram");
console.log(`today ${TODAY_ISO} · window ${MINUS_120}..${TODAY_ISO} (120d, for the age tail)`);
console.log("=".repeat(78));

// ── Build the cohort from BOTH quarters the window spans ───────────────────
const quarters = ["2026/QTR2", "2026/QTR3"];
const byCik = new Map();
for (const q of quarters) {
  const r = await get(`https://www.sec.gov/Archives/edgar/full-index/${q}/form.idx`);
  if (!r.ok) {
    console.error(`FATAL: ${q}/form.idx unreadable (HTTP ${r.status}) ${r.error ?? ""}`);
    process.exit(1);
  }
  console.log(`form.idx ${q}: ${r.body.length} bytes`);
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
  const has = (re) => c.filings.some((f) => re.test(f.form));
  const last = (re) => [...c.filings].reverse().find((f) => re.test(f.form)) ?? null;
  return {
    ...c,
    hasEightA: has(/^8-A12B$/),
    hasFinal: has(/^424B[14]$/),
    hasWithdrawal: has(/^(RW|AW)$/),
    lastAmend: last(/^(S-1\/A|F-1\/A)$/),
    lastFinal: last(/^424B[14]$/),
    withdrawal: last(/^(RW|AW)$/),
  };
});

// ══════════════════════════════════════════════════════════════════════════
// 0.3 AGE HISTOGRAM — the upper table's population, and how it decays
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\n0.3 AGE OF "TERMS SET, NO 424B" — the upper table's real population\n${"═".repeat(78)}`);

const ageDays = (d) => Math.round((TODAY - new Date(d)) / 86400000);
const upperCandidates = all.filter((c) => c.lastAmend && !c.hasFinal);
const withdrawn = upperCandidates.filter((c) => c.hasWithdrawal);
const live = upperCandidates.filter((c) => !c.hasWithdrawal);

console.log(`   companies with an S-1/A or F-1/A and NO 424B in window: ${upperCandidates.length}`);
console.log(`   ...of which carry an RW/AW (explicitly withdrawn):      ${withdrawn.length}`);
console.log(`   ...remaining, i.e. what the upper table would show:     ${live.length}`);

const BUCKETS = [7, 14, 21, 30, 45, 60, 90, 120, 9999];
const hist = new Map(BUCKETS.map((b) => [b, 0]));
for (const c of live) {
  const a = ageDays(c.lastAmend.date);
  const b = BUCKETS.find((x) => a <= x);
  hist.set(b, hist.get(b) + 1);
}
console.log(`\n   age of most recent amendment (no 424B, no RW/AW):`);
let cum = 0;
for (const b of BUCKETS) {
  const n = hist.get(b);
  cum += n;
  const label = b === 9999 ? "  >120d" : `  <=${b}d`;
  const pct = live.length ? Math.round((cum / live.length) * 100) : 0;
  console.log(`   ${label.padEnd(9)} ${String(n).padStart(3)}   cumulative ${String(cum).padStart(3)} (${pct}%)`);
}
console.log(`\n   >>> NO CAP IS RECOMMENDED HERE. The histogram is the finding; the constant`);
console.log(`   >>> is the owner's call. Note what an absent cap costs: every one of the`);
console.log(`   >>> ${live.length} rows above would sit in "Upcoming IPOs" indefinitely.`);

if (withdrawn.length) {
  console.log(`\n   RW/AW sample — these are the ones mechanism 1 catches:`);
  for (const c of withdrawn.slice(0, 8)) {
    console.log(`     ${c.company.slice(0, 44).padEnd(46)} amend ${c.lastAmend.date} · ${c.withdrawal.form} ${c.withdrawal.date}`);
  }
}
console.log(`\n   >>> RW/AW catches ${withdrawn.length} of ${upperCandidates.length}. The rest go stale silently,`);
console.log(`   >>> which is exactly why §4.8 asks for BOTH mechanisms and not just the form.`);

// ══════════════════════════════════════════════════════════════════════════
// 0.1 + 0.2 — assess 20 amendments, SPACs separated, parser under test
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\n0.1 / 0.2 — 20 AMENDMENTS, SPACs SEPARATED, PARSER UNDER TEST\n${"═".repeat(78)}`);

// Sample from the 8-A12B cohort: companies actually heading for an exchange.
const pool = all.filter((c) => c.hasEightA && c.lastAmend);
// Spread across the window rather than taking the tail -- the source probe's
// sample was the last five by index order and came back all-microcap-resale.
const step = Math.max(1, Math.floor(pool.length / 20));
const sample = pool.filter((_, i) => i % step === 0).slice(0, 20);
console.log(`   pool (8-A12B + an amendment): ${pool.length} · sampled every ${step}th → ${sample.length}\n`);

const rows = [];
for (const c of sample) {
  const f = c.lastAmend;
  const accession = f.file.split("/").pop().replace(/\.txt$/, "");
  const noDash = accession.replace(/-/g, "");
  await sleep(150);
  const ij = await get(`https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${noDash}/index.json`);
  if (!ij.ok) { console.log(`   ${c.company.slice(0, 40)}: index unreadable`); continue; }
  let primary = null;
  try {
    const items = JSON.parse(ij.body).directory?.item ?? [];
    primary = items.filter((it) => /\.htm$/i.test(it.name) && !/^R\d+\.htm$/i.test(it.name))
      .sort((a, b) => Number(b.size) - Number(a.size))[0]?.name ?? null;
  } catch { /* handled by the null check */ }
  if (!primary) { console.log(`   ${c.company.slice(0, 40)}: no primary doc`); continue; }
  await sleep(150);
  const doc = await get(`https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${noDash}/${primary}`);
  if (!doc.ok) { console.log(`   ${c.company.slice(0, 40)}: doc unreadable`); continue; }

  const text = strip(doc.body);
  const kind = classify(c.company, text);
  const range = parseRange(text);
  const price = parsePrice(text, kind.isSpac);
  const shares = (text.slice(0, 80000).match(/([\d,]{5,})\s+shares\s+of\s+(?:our\s+)?(?:common|ordinary)\s+(?:stock|shares)/i) ?? [])[1] ?? null;
  const ticker = (text.slice(0, 80000).match(/(?:symbol|ticker)\s*["'"]?\s*:?\s*["'"]?\s*([A-Z]{1,5})\b/) ?? [])[1] ?? null;
  const exchange = (text.slice(0, 80000).match(/(New York Stock Exchange|NYSE American|Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|NYSE|Nasdaq)/i) ?? [])[1] ?? null;

  const row = {
    company: c.company, cik: c.cik, form: f.form, date: f.date, doc: primary,
    isSpac: kind.isSpac, spacSignals: `name=${kind.byName} body=${kind.bodyHits}`,
    range: range.low !== null ? `$${range.low}–$${range.high}` : null, rangeBasis: range.basis,
    price: price.value, priceBasis: price.basis,
    shares, ticker, exchange,
  };
  rows.push(row);
  console.log(`   ${(kind.isSpac ? "[SPAC]" : "[OPCO]")} ${c.company.slice(0, 40).padEnd(42)} ${f.form} ${f.date}`);
  console.log(`     range ${row.range ?? "—"} · price ${row.price ?? "—"} · shares ${shares ?? "—"} · ticker ${ticker ?? "—"} · exch ${exchange ?? "—"}`);
  console.log(`     range basis: ${range.basis.slice(0, 96)}`);
  console.log(`     price basis: ${price.basis.slice(0, 96)}`);
}

const opco = rows.filter((r) => !r.isSpac);
const spac = rows.filter((r) => r.isSpac);
const pc = (n, d) => (d ? `${n}/${d} (${Math.round((n / d) * 100)}%)` : "0/0");

console.log(`\n${"─".repeat(78)}\n0.1 RESULT — the number the source probe could not give`);
console.log(`${"─".repeat(78)}`);
console.log(`   OPERATING COMPANIES (n=${opco.length})`);
console.log(`     price RANGE      ${pc(opco.filter((r) => r.range).length, opco.length)}   <<< THE GATE: >=70%`);
console.log(`     share count      ${pc(opco.filter((r) => r.shares).length, opco.length)}`);
console.log(`     proposed ticker  ${pc(opco.filter((r) => r.ticker).length, opco.length)}`);
console.log(`     exchange         ${pc(opco.filter((r) => r.exchange).length, opco.length)}`);
console.log(`   SPACs (n=${spac.length}) — a unit is fixed at $10.00, so a RANGE DOES NOT EXIST.`);
console.log(`     unit price found ${pc(spac.filter((r) => r.price === 10).length, spac.length)}`);
console.log(`     warrant strike misread as offer price: ${spac.filter((r) => r.price === 11.5).length} (the source probe's failure; target 0)`);

// ── 0.2 negative control ──────────────────────────────────────────────────
console.log(`\n${"─".repeat(78)}\n0.2 NEGATIVE CONTROL — a parser that always answers has not been tested`);
console.log(`${"─".repeat(78)}`);
const CONTROLS = [
  ["par value only", "the par value of $0.00001 per share and 11.50 exercise price of the warrants", null],
  ["warrant strike only", "each warrant entitles the holder to purchase one share at $11.50", null],
  ["genuine final price", "the initial public offering price is $16.00 per share", 16.0],
  ["empty", "this document contains no offering terms whatsoever", null],
];
let controlsPassed = 0;
for (const [label, text, expected] of CONTROLS) {
  const got = parsePrice(text, false).value;
  const ok = got === expected;
  if (ok) controlsPassed++;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label.padEnd(22)} expected ${expected ?? "null"}, got ${got ?? "null"}`);
}
console.log(`   ${controlsPassed}/${CONTROLS.length} controls passed`);

console.log(`\n${"═".repeat(78)}\nGATES\n${"═".repeat(78)}`);
const rangeRate = opco.length ? opco.filter((r) => r.range).length / opco.length : 0;
console.log(`   0.1 operating-company range >=70% : ${rangeRate >= 0.7 ? "PASS" : "FAIL"} (${Math.round(rangeRate * 100)}%)`);
console.log(`       FAIL means the upper table ships WITHOUT a price-range column.`);
console.log(`       That is a real outcome, not a blocker: the 32.4% bucket asks WHO, not HOW MUCH.`);
console.log(`   0.2 negative controls              : ${controlsPassed === CONTROLS.length ? "PASS" : "FAIL"}`);
console.log(`       The >=90% correctness gate needs HAND-CHECKING against the filings above.`);
console.log(`       This run cannot self-certify it -- it would be marking its own homework.`);
console.log(`   0.3 age histogram                  : REPORTED (no gate; the cap is the owner's call)`);

fs.mkdirSync("data/sec", { recursive: true });
const payload = {
  window: [MINUS_120, TODAY_ISO],
  ageHistogram: { upperCandidates: upperCandidates.length, withdrawn: withdrawn.length, live: live.length,
    buckets: Object.fromEntries(BUCKETS.map((b) => [b === 9999 ? ">120" : `<=${b}`, hist.get(b)])) },
  withdrawnSample: withdrawn.slice(0, 20).map((c) => ({ company: c.company, cik: c.cik, amend: c.lastAmend.date, withdrawal: c.withdrawal })),
  assessed: rows,
  negativeControls: { passed: controlsPassed, of: CONTROLS.length },
};
fs.writeFileSync("data/sec/ipo-phase0.json", JSON.stringify(payload, null, 2));
console.log(`\n<<<RAW name=phase0.json bytes=${JSON.stringify(payload).length}>>>`);
console.log(JSON.stringify(payload, null, 2).slice(0, 280000));
console.log(`<<<ENDRAW name=phase0.json>>>`);
console.log(`\nDONE ${new Date().toISOString()}`);
