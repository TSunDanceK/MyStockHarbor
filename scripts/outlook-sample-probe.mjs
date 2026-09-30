// READ-ONLY MEASUREMENT (#552 COWORK #80/#82): does the latest results
// release (8-K Item 2.02, Exhibit 99.1) carry a management outlook we could
// quote? A 100-filer SAMPLE. Nothing stored; counts in the log, plus 20 rows
// of symbol + heading + classification (NO QUOTED TEXT: the log is public).
//
// THE SAMPLE: the 100 largest US 10-K filers in the stored universe BY LATEST
// FILED ANNUAL REVENUE (SEC). Not by market cap: a cap needs a price, and
// computing caps from prices is out of bounds (#552 rules). Revenue values are
// read for ranking only and never printed. One CIK per company.
//
// SEC: one runner, 250 ms between requests (4/s, so the filing job's own
// ≤5/s cannot push the pair past SEC's 10/s), stops on 429/403. About 3
// requests a filer: submissions, the filing index, the exhibit.
//   relay task: write-outlook-sample
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
const src = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (n) => (src.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const PREFIX = pick("SEC_FACTS_PREFIX"), INDEX = pick("SEC_FACTS_INDEX_KEY");
const redis = Redis.fromEnv();
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const REV = SEC_FIELD_KEYS.indexOf("revenue");
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; outlook sample)";

// ── The sample ─────────────────────────────────────────────────────────────
const symbols = (await redis.smembers(INDEX)).map(String).sort();
let cmds = 1;
const cand = [];
for (let i = 0; i < symbols.length; i += 50) {
  const chunk = symbols.slice(i, i + 50);
  const got = await redis.mget(...chunk.map((s) => `${PREFIX}:${s}`)); cmds++;
  chunk.forEach((s, j) => {
    const set = got[j]; const r = REG[s];
    if (!set?.years?.length || !r || r.annualForm !== "10-K" || r.entityType !== "operating") return;
    const y = [...set.years].sort((a, b) => (a.e < b.e ? 1 : -1))[0];
    const rev = y.v?.[REV];
    if (typeof rev === "number" && rev > 0) cand.push({ sym: s, cik: String(r.cik).padStart(10, "0"), sic: r.sic ?? "", rev });
  });
}
const seen = new Set();
const sample = cand.sort((a, b) => b.rev - a.rev).filter((c) => (seen.has(c.cik) ? false : (seen.add(c.cik), true))).slice(0, 100);

// ── SEC, paced ─────────────────────────────────────────────────────────────
let secReq = 0, last = 0;
async function sec(url, kind = "json") {
  const wait = 250 - (Date.now() - last); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); secReq++;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 429 || res.status === 403) { console.log(`stopped: SEC ${res.status} after ${secReq} requests`); process.exit(3); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return kind === "json" ? res.json() : res.text();
}

// ── Classification ─────────────────────────────────────────────────────────
const HEADING = /\b((?:(?:full[- ]year|fiscal(?: year)?|fy)\s*(?:20\d\d)?\s*|20\d\d\s+|(?:first|second|third|fourth)[- ]quarter\s+(?:20\d\d\s+)?|q[1-4]\s+|business\s+|financial\s+|company\s+|updated\s+|annual\s+)?(?:outlook|guidance))\b/i;
const VERB = /\b(expects?|expected|anticipates?|projects?|forecasts?|reaffirm(?:s|ed|ing)?|rais(?:es|ed|ing)|lower(?:s|ed|ing)?|updat(?:es|ed|ing)|narrow(?:s|ed|ing)?|guid(?:es|ed|ance)|outlook|now sees|targets?)\b/i;
const FIG = /(\$\s?\d|\d(?:\.\d+)?\s?%|\d(?:\.\d+)?\s?(?:billion|million|percent))/i;
const RANGE = /(\$?\d[\d.,]*\s?(?:%|billion|million)?\s?(?:to|-|–|—|and)\s?\$?\d[\d.,]*)|\bbetween\b/i;
const METRIC = {
  revenue: /\b(revenue|revenues|net sales|sales|total sales)\b/i,
  eps: /\b(earnings per (?:diluted )?share|eps|per diluted share|per share)\b/i,
  margin: /\b(margin|margins)\b/i,
};
const htmlToText = (h) => h
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<\/(p|div|tr|li|h\d|br|table)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#[0-9]+;/g, " ").replace(/[ \t]+/g, " ");
const sentencesOf = (t) => t.replace(/\n+/g, " \n ").split(/(?<=[.!?])\s+(?=[A-Z(])|\n/).map((s) => s.trim()).filter((s) => s.length > 0);

function classify(html) {
  const text = htmlToText(html);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // A HEADING: a short line (≤ 8 words) naming an outlook or guidance.
  const hIdx = lines.findIndex((l) => l.split(/\s+/).length <= 8 && HEADING.test(l) && !/forward[- ]looking/i.test(l));
  const heading = hIdx >= 0 ? lines[hIdx].match(HEADING)[1].replace(/\s+/g, " ").trim() : null;
  // THE SECTION: from the heading to the next short heading-like line (≤ 6 words, no period), max 40 lines.
  let section = [];
  if (hIdx >= 0) {
    for (let i = hIdx + 1; i < Math.min(lines.length, hIdx + 40); i++) {
      const l = lines[i];
      if (i > hIdx + 1 && l.split(/\s+/).length <= 6 && !/[.:]$/.test(l) && !FIG.test(l) && /^[A-Z]/.test(l)) break;
      section.push(l);
    }
  }
  // GUIDANCE SENTENCES: in the section when there is one, else anywhere (the no-heading case).
  const pool = sentencesOf((section.length ? section : lines).join("\n"));
  const isFwd = (s) => VERB.test(s) && !/forward[- ]looking statements?/i.test(s) && !/\b(was|were)\b.*\b(compared|versus|vs\.?)\b/i.test(s);
  const guidance = pool.filter((s) => isFwd(s) && (section.length || /\b(for (?:the )?(?:full[- ]year|fiscal|fourth|third|second|first|next)|20\d\d\b|quarter)\b/i.test(s)));
  const numeric = guidance.filter((s) => FIG.test(s) && s.split(/\s+/).length <= 80);
  // TABLE-ONLY: a heading whose section is a table (many short numeric cells) and no numeric sentence.
  const cells = section.filter((l) => l.split(/\s+/).length <= 4 && /\d/.test(l)).length;
  const tableOnly = Boolean(heading) && numeric.length === 0 && cells >= 3;
  const any = Boolean(heading) || guidance.length > 0;
  const covers = Object.fromEntries(Object.entries(METRIC).map(([k, re]) => [k, numeric.some((s) => re.test(s))]));
  const shape = numeric.length ? (numeric.some((s) => RANGE.test(s)) ? "range" : "point") : guidance.length ? "qualitative" : "none";
  // QUOTABLE: the numeric outlook fits in 1–3 complete sentences, ≤ 60 words in all.
  const words = numeric.slice(0, 3).reduce((n, s) => n + s.split(/\s+/).length, 0);
  const quotable = numeric.length >= 1 && numeric.length <= 3 && words <= 60;
  return { any, heading, covers, shape, tableOnly, quotable, nNumeric: numeric.length, words, sectionLines: section.length };
}

// ── Run ────────────────────────────────────────────────────────────────────
const sector = (sic) => {
  const n = Number(sic);
  if (!n) return "unknown";
  if (n >= 6000 && n < 6800) return "financials";
  if (n >= 4900 && n < 5000) return "utilities";
  if (n >= 4800 && n < 4900) return "communications";
  if (n >= 2830 && n < 2840 || n >= 3840 && n < 3860 || n >= 8000 && n < 8100) return "healthcare";
  if (n >= 3570 && n < 3580 || n >= 3670 && n < 3680 || n >= 7370 && n < 7380 || n >= 3660 && n < 3670) return "technology";
  if (n >= 1300 && n < 1400 || n >= 2900 && n < 3000) return "energy";
  if (n >= 5000 && n < 6000) return "retail & wholesale";
  if (n >= 2000 && n < 4000) return "industrials & manufacturing";
  return "other";
};
const rows = [];
let noRelease = 0, noExhibit = 0, failed = 0;
for (const c of sample) {
  try {
    const subs = await sec(`https://data.sec.gov/submissions/CIK${c.cik}.json`);
    const r = subs.filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f, k) => f === "8-K" && /2\.02/.test(r.items?.[k] ?? ""));
    if (i < 0) { noRelease++; rows.push({ ...c, status: "no 2.02 in recent" }); continue; }
    const accn = r.accessionNumber[i], filed = r.filingDate[i];
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${accn.replace(/-/g, "")}`;
    const idx = await sec(`${base}/index.json`);
    const items = (idx.directory?.item ?? []).map((x) => ({ name: String(x.name ?? ""), size: Number(x.size) || 0 }));
    const names = items.map((x) => x.name);
    const primary = String(r.primaryDocument?.[i] ?? "");
    // BY NAME FIRST (ex99.1 and its spellings), THEN the largest other .htm in
    // the filing: many filers name the release after the period
    // ("q2fy27pr.htm"), not the exhibit number. The 8-K itself, XBRL viewer
    // pages (R1.htm…) and the index are never it.
    const htm = items.filter((x) => /\.html?$/i.test(x.name) && x.name !== primary && !/^R\d+\.htm$|index|FilingSummary/i.test(x.name));
    const ex = names.find((n) => /ex-?99[-_.]?0?1\b|ex991|ex-99\.1|exhibit991|ex99-1|ex99_1/i.test(n) && /\.html?$/i.test(n))
      ?? names.find((n) => /ex-?99/i.test(n) && /\.html?$/i.test(n))
      ?? htm.sort((a, b) => b.size - a.size)[0]?.name;
    if (!ex) { noExhibit++; rows.push({ ...c, filed, status: "no EX-99 document" }); continue; }
    const html = await sec(`${base}/${ex}`, "text");
    rows.push({ ...c, filed, status: "read", ...classify(html) });
  } catch (e) {
    failed++; rows.push({ ...c, status: `failed ${String(e?.message ?? e).slice(0, 30)}` });
  }
}

// ── Counts only ────────────────────────────────────────────────────────────
const read = rows.filter((r) => r.status === "read");
const pct = (n, d = read.length) => `${n} (${d ? Math.round((100 * n) / d) : 0}%)`;
const cnt = (f, xs = read) => xs.filter(f).length;
console.log(`\nSAMPLE ${sample.length} US 10-K filers (largest by latest filed annual revenue) · releases read ${read.length} · no results 8-K in recent ${noRelease} · no EX-99 found ${noExhibit} · failed ${failed}`);
console.log(`any outlook passage ${pct(cnt((r) => r.any))} · heading found ${pct(cnt((r) => r.heading))}`);
console.log(`numeric outlook: revenue ${pct(cnt((r) => r.covers.revenue))} · EPS ${pct(cnt((r) => r.covers.eps))} · margin ${pct(cnt((r) => r.covers.margin))}`);
console.log(`shape: range ${pct(cnt((r) => r.shape === "range"))} · point ${pct(cnt((r) => r.shape === "point"))} · qualitative only ${pct(cnt((r) => r.shape === "qualitative"))} · none ${pct(cnt((r) => r.shape === "none"))}`);
console.log(`quotable in 1–3 sentences, ≤60 words ${pct(cnt((r) => r.quotable))} · table-only ${pct(cnt((r) => r.tableOnly))}`);
console.log("\nby sector (read · any · numeric revenue · quotable · table-only):");
const bySec = {};
for (const r of read) (bySec[sector(r.sic)] ??= []).push(r);
for (const [s, xs] of Object.entries(bySec).sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${s}: ${xs.length} · ${cnt((r) => r.any, xs)} · ${cnt((r) => r.covers.revenue, xs)} · ${cnt((r) => r.quotable, xs)} · ${cnt((r) => r.tableOnly, xs)}`);
console.log("\n20 ROWS FOR A HAND CHECK (symbol · filed · heading found · shape · numeric sentences/words · quotable · table-only) — no text:");
const step = Math.max(1, Math.floor(read.length / 20));
for (const r of read.filter((_, i) => i % step === 0).slice(0, 20))
  console.log(`  ${r.sym.padEnd(6)} ${r.filed} · ${r.heading ?? "(no heading)"} · ${r.shape} · ${r.nNumeric}/${r.words}w · quotable ${r.quotable ? "yes" : "no"} · table-only ${r.tableOnly ? "yes" : "no"}`);
const skipped = rows.filter((r) => r.status !== "read");
if (skipped.length) console.log(`\nnot read: ${skipped.map((r) => `${r.sym} (${r.status})`).join(", ")}`);
console.log(`\nSEC requests ${secReq} · Redis commands ${cmds} (reads only)`);
