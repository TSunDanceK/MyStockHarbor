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
// data/sec/description-probe.json (for the artifact) and prints every excerpt
// in full, because the judgement "is this a usable overview" is a human one and
// a classifier's label is only a hint.
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

// ── HTML TO TEXT, KEEPING PARAGRAPH BREAKS ───────────────────────────────
// iXBRL filings carry a hidden <ix:header> full of tagged facts and many
// display:none blocks; both are removed before anything is read, or the
// "text" begins with a thousand lines of XBRL context.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", bull: "•", reg: "®", trade: "™", copy: "©" };
function toText(html) {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<([a-z]+)[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

// ── WHERE THE SECTION STARTS ─────────────────────────────────────────────
// The heading appears at least twice: once in the table of contents and once
// at the section itself. A TOC hit is followed within a few hundred
// characters by the NEXT item's heading; the real one is followed by prose.
const HEADINGS = {
  "10-K": { start: /item\s*1\s*[.:\-–—]?\s*business\b/gi, next: /item\s*1a\b/i },
  "10-K405": { start: /item\s*1\s*[.:\-–—]?\s*business\b/gi, next: /item\s*1a\b|item\s*2\b/i },
  "10-KT": { start: /item\s*1\s*[.:\-–—]?\s*business\b/gi, next: /item\s*1a\b/i },
  "20-F": { start: /\bb\s*[.:\-–—]?\s*business\s+overview\b/gi, next: /\bc\s*[.:\-–—]?\s*organi[sz]ational\s+structure\b/i },
};

function locate(text, form) {
  const h = HEADINGS[form];
  if (!h) return { found: false, why: `no section heading defined for ${form}` };
  const hits = [...text.matchAll(h.start)];
  if (!hits.length) return { found: false, why: "heading not found" };
  for (const m of hits) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 600);
    if (h.next.test(after)) continue; // a table-of-contents entry
    const body = text.slice(m.index + m[0].length, m.index + m[0].length + 6000).trim();
    return { found: true, hitsSkipped: hits.indexOf(m), body };
  }
  return { found: false, why: `heading found ${hits.length}x, every hit looked like a table of contents` };
}

/** The opening paragraph(s): up to ~1,200 characters, whole paragraphs only. */
function opening(body) {
  const paras = body.split(/\n\n|\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const out = [];
  let n = 0;
  for (const p of paras) {
    // Sub-headings ("General", "Overview", "Company Background") are skipped,
    // not counted as the overview.
    if (p.length < 60 && !/[.!?]$/.test(p)) continue;
    out.push(p);
    n += p.length;
    if (n >= 700 || out.length >= 3) break;
  }
  return out.join("\n\n");
}

function classify(text) {
  if (!text) return "empty";
  const head = text.slice(0, 600);
  if (/incorporated\s+(herein\s+)?by\s+reference/i.test(head)) return "cross-reference";
  if (/forward[-\s]looking\s+statements?/i.test(head)) return "forward-looking-boilerplate";
  if ((head.match(/\bitem\s*\d/gi) ?? []).length >= 3 || /\.{5,}\s*\d+/.test(head)) return "table-of-contents";
  return "overview";
}

const results = [];
for (const symbol of LIST) {
  const cik = cikFor(symbol);
  if (!cik) { results.push({ symbol, found: false, why: "no CIK" }); continue; }
  const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (sub.status !== 200) { results.push({ symbol, cik, found: false, why: `submissions HTTP ${sub.status}` }); continue; }
  const r = sub.body.filings?.recent ?? {};
  const forms = r.form ?? [];
  const i = forms.findIndex((f) => ["10-K", "10-K405", "10-KT", "20-F", "40-F"].includes(f));
  if (i < 0) { results.push({ symbol, cik, found: false, why: "no annual filing in recent submissions" }); continue; }
  const form = forms[i];
  const accession = r.accessionNumber[i];
  const filedOn = r.filingDate[i];
  const doc = r.primaryDocument[i];
  const base = { symbol, cik, form, accession, filedOn, document: doc };
  if (form === "40-F") {
    // A 40-F's business description is in the Annual Information Form, filed
    // as an EXHIBIT, not in the primary document. Reported as such rather
    // than searched for in the wrong file.
    results.push({ ...base, found: false, why: "40-F: the business description is in the AIF exhibit, not the primary document" });
    continue;
  }
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${doc}`;
  const page = await get(url, "text");
  if (page.status !== 200) { results.push({ ...base, found: false, why: `document HTTP ${page.status}` }); continue; }
  const text = toText(page.body);
  const loc = locate(text, form);
  if (!loc.found) { results.push({ ...base, url, found: false, why: loc.why }); continue; }
  const excerpt = opening(loc.body);
  results.push({ ...base, url, found: true, chars: excerpt.length, class: classify(excerpt), tocHitsSkipped: loc.hitsSkipped, excerpt });
}

fs.mkdirSync("data/sec", { recursive: true });
fs.writeFileSync("data/sec/description-probe.json", JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), results }, null, 1) + "\n");

console.log(`\n${"symbol".padEnd(7)} ${"form".padEnd(6)} ${"filed".padEnd(10)} ${"found".padEnd(5)} ${"chars".padStart(5)}  class / why`);
for (const x of results) {
  console.log(`${x.symbol.padEnd(7)} ${(x.form ?? "-").padEnd(6)} ${(x.filedOn ?? "-").padEnd(10)} ${String(x.found).padEnd(5)} ${String(x.chars ?? "-").padStart(5)}  ${x.found ? x.class : x.why}`);
}
const by = (k) => results.filter((x) => x.found && x.class === k).length;
console.log(`\nfound ${results.filter((x) => x.found).length} of ${results.length} · overview ${by("overview")} · toc ${by("table-of-contents")} · boilerplate ${by("forward-looking-boilerplate")} · cross-ref ${by("cross-reference")}`);
console.log("\n===EXCERPTS===");
for (const x of results.filter((r) => r.found)) {
  console.log(`\n--- ${x.symbol} (${x.form}, filed ${x.filedOn}, ${x.chars} chars, ${x.class}) ${x.url}\n${x.excerpt}`);
}
