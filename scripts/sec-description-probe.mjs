// CAN THE COMPANY'S OWN FILING REPLACE FMP'S DESCRIPTION? Measured, not built.
//
// Brief 2026-09-22 PR 3 step 1. FMP's description is their authored prose,
// and it is the last FMP field on /stock/[symbol]. The candidate replacement is
// the company's own words: 10-K Item 1 "Business", or for a 20-F filer Item 4.B
// "Business Overview". This probe locates that section in the latest annual
// filing for ~30 symbols and reports, per symbol:
//
//   found / not found · the form · character count · and whether the text is a
//   real overview, a table of contents, forward-looking-statements boilerplate,
//   or a cross-reference ("incorporated by reference").
//
// NOTHING RENDERS FROM THIS. The owner reviews the sample first. It writes
// data/sec/description-probe.json (for the artifact) and prints every cleaned
// description in full, and the raw opening of every one a filter rejected, so
// the judgement stays a human one.
//
// STEP 2 (#518): the locator and the owner's six filters live in
// lib/server/secDescription.ts and are lifted here.
//
// Read-only, no credentials. ≤8 requests/s, under SEC's 10/s.
//
//   SYMBOLS="AAPL MU" node scripts/sec-description-probe.mjs   (relay task: sec-description-probe)
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { symbolSpellings } from "../lib/symbolSpellings.mjs";

const UA = process.env.SEC_USER_AGENT ||
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; description probe)";

const DEFAULT = [
  // Named in the brief.
  "AAPL", "MU", "ONDS", "ABVX", "AZN", "RYAAY", "TSM", "BRK.B", "KTOS",
  // Large domestic, mixed industries.
  "NVDA", "XOM", "KO", "TSLA", "GEV", "V",
  // Financials.
  "JPM", "BAC", "GS", "SOFI",
  // Small and mid caps.
  "PLAB", "RKLB", "ASTS", "IONQ", "OKLO", "UPST", "HOOD",
  // Other foreign filers: 20-F, and 40-F (Canadian).
  "ABEV", "ARM", "KGC", "MFC", "SHOP",
];
const SYMBOLS = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const LIST = SYMBOLS.length ? SYMBOLS : DEFAULT;

const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift([
  grabFunction(tickerSrc, "padCik"),
  grabFunction(tickerSrc, "parseTickerFile"),
  "export { parseTickerFile, padCik };",
].join("\n"));
const { map: tickerMap } = tick.parseTickerFile(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const cikFor = (s) => {
  for (const v of symbolSpellings(s)) {
    if (cikMap[v]) return tick.padCik(cikMap[v]);
    if (tickerMap.get(v)?.cik) return tickerMap.get(v).cik;
  }
  return null;
};

let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return { status: res.status };
  return { status: 200, body: as === "json" ? await res.json() : await res.text() };
}

// ── THE SHIPPED LOCATOR AND CLEANER, LIFTED ────────────────────────────────
// Step 2 (#518): the owner's filters live in lib/server/secDescription.ts, the
// module a render path will call. The probe runs THAT code, so the sample the
// owner reads is exactly what would render.
const desc = await lift(readCodeOnly("lib/server/secDescription.ts"));

/** The newest annual filing, reading older submission pages if needed (XOM). */
async function latestAnnual(sub, cik) {
  const ANNUAL = ["10-K", "10-K405", "10-KT", "20-F", "40-F"];
  const pick = (r) => {
    const i = (r.form ?? []).findIndex((f) => ANNUAL.includes(f));
    return i < 0 ? null : { form: r.form[i], accession: r.accessionNumber[i], filedOn: r.filingDate[i], doc: r.primaryDocument[i] };
  };
  const found = pick(sub.filings?.recent ?? {});
  if (found) return found;
  // A heavy filer's recent page can hold ~1,000 filings with no annual among
  // them; the older pages are listed in filings.files.
  for (const f of sub.filings?.files ?? []) {
    const page = await get(`https://data.sec.gov/submissions/${f.name}`);
    if (page.status === 200) { const hit = pick(page.body); if (hit) return hit; }
  }
  return null;
}

const results = [];
for (const symbol of LIST) {
  const cik = cikFor(symbol);
  if (!cik) { results.push({ symbol, found: false, why: "no CIK" }); continue; }
  const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (sub.status !== 200) { results.push({ symbol, cik, found: false, why: `submissions HTTP ${sub.status}` }); continue; }
  const annual = await latestAnnual(sub.body, cik);
  if (!annual) {
    results.push({ symbol, cik, found: false, why: `no annual filing in submissions (${sub.body.name ?? "?"}, ${(sub.body.filings?.recent?.form ?? []).length} recent, ${(sub.body.filings?.files ?? []).length} older pages)` });
    continue;
  }
  const { form, accession, filedOn, doc } = annual;
  const base = { symbol, cik, form, accession, filedOn, document: doc };
  if (form === "40-F") {
    results.push({ ...base, found: false, why: desc.locateSection("", form).why });
    continue;
  }
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${doc}`;
  const page = await get(url, "text");
  if (page.status !== 200) { results.push({ ...base, found: false, why: `document HTTP ${page.status}` }); continue; }
  const text = desc.filingText(page.body);
  const loc = desc.locateSection(text, form);
  // DIAGNOSE=1: every line that looks like an Item heading, with its offset
  // and what follows it — the evidence for a locator miss, not a guess.
  if (process.env.DIAGNOSE) {
    console.log(`\n### ${symbol} ${form} ${url} (${text.length} chars of text)`);
    let at = 0;
    for (const l of text.split("\n")) {
      if (/^\s*(item\s*\d+[a-z]?\b|part\s+i\b|b\.\s*business|business\s*\.?$)/i.test(l) && l.length < 120) {
        console.log(`  @${String(at).padStart(7)}  ${JSON.stringify(l.slice(0, 90))}  →  ${JSON.stringify(text.slice(at + l.length + 1, at + l.length + 90))}`);
      }
      at += l.length + 1;
    }
  }
  if (!loc.found) { results.push({ ...base, url, found: false, why: loc.why }); continue; }
  const cleaned = desc.cleanDescription(loc.body, { companyName: sub.body.name ?? null });
  // THE RAW OPENING TOO, so a rejection can be checked against what it rejected.
  const raw = loc.body.slice(0, 700);
  results.push(cleaned.ok
    ? { ...base, url, found: true, ok: true, chars: cleaned.text.length, description: cleaned.text, raw }
    : { ...base, url, found: true, ok: false, why: cleaned.why, raw });
}

fs.mkdirSync("data/sec", { recursive: true });
fs.writeFileSync("data/sec/description-probe.json", JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), results }, null, 1) + "\n");

console.log("\n===DESCRIPTIONS (what would render)===");
for (const x of results.filter((r) => r.ok)) {
  console.log(`\n--- ${x.symbol} (${x.form}, filed ${x.filedOn}, ${x.chars} chars) ${x.url}\n${x.description}`);
}
console.log("\n===REJECTED (found, then refused by a filter) — raw opening shown===");
for (const x of results.filter((r) => r.found && !r.ok)) {
  console.log(`\n--- ${x.symbol} (${x.form}): ${x.why}\n${x.raw}`);
}

// THE TABLE LAST, so it is in the log's tail where a reader looks first.
console.log(`\n${"symbol".padEnd(7)} ${"form".padEnd(6)} ${"filed".padEnd(10)} ${"renders".padEnd(7)} ${"chars".padStart(5)}  why not`);
for (const x of results) {
  console.log(`${x.symbol.padEnd(7)} ${(x.form ?? "-").padEnd(6)} ${(x.filedOn ?? "-").padEnd(10)} ${String(Boolean(x.ok)).padEnd(7)} ${String(x.chars ?? "-").padStart(5)}  ${x.ok ? "" : x.why}`);
}
console.log(`\nrenders ${results.filter((x) => x.ok).length} of ${results.length} · found-but-rejected ${results.filter((x) => x.found && !x.ok).length} · not found ${results.filter((x) => !x.found).length}`);
