// WHAT CLOSES THE GRID'S IN-UNIVERSE SEC GAPS — measured, nothing built.
//
// ── THE QUESTION (claude/grid-sec-gaps-measured-2026-09-23.md) ────────────
// #532 found 304 FMP-only (symbol, date) pairs inside our own universe, in
// three buckets that sit on the STORE's side rather than FMP's:
//   1  foreign filers on 6-K        can the store read a results 6-K, how often,
//                                   and at what false-positive rate?
//   2  2.02 on EDGAR, NO record     why was no record ever written?
//   3  2.02 on EDGAR, stale record  why does a record read AFTER the 8-K not
//                                   hold it?
// then projects coverage once each is closed, costs the fix against sec-facts'
// time budget, and — separately, for later — counts US-listed companies over a
// $2B / $5B / $10B floor from SEC data alone.
//
// ── THE SHIPPED CODE, LIFTED, NOT RE-READ ────────────────────────────────
// getMonthCandidates (the grid's candidate builder), resultsPairing /
// periodicReportDates / nextPeriodEndFrom (the report-dates reader),
// reportDatesQueue (the job's queue) and secFieldsHash (readFactSet's gate) are
// all lifted from this ref's sources, so a verdict about "the reader" or "the
// queue" is a verdict about the code that runs.
//
// READ-ONLY. Redis GET / MGET / TTL; GETs against www.sec.gov and
// data.sec.gov. No FMP key exists here and no FMP call is made — the FMP side
// is what production already cached. The write- prefix on the relay task is the
// CREDENTIAL boundary, not a claim that it writes.
//   relay task: write-grid-sec-gaps
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly, grabConst } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; grid SEC gap measurement)";
const TODAY = process.env.TODAY || "2026-09-23";
const WINDOW_DAYS = 60;
const MATCH_TOL = 10;
const SIXK_INDEX_CAP = Number(process.env.SIXK_INDEX_CAP ?? 1500);

const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
const FROM = addDays(TODAY, -(WINDOW_DAYS - 1));
const inWindow = (d) => typeof d === "string" && d >= FROM && d <= TODAY;
const chunk = (xs, n) => { const o = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };
const tally = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
const fmtTally = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(" · ");
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
const ex = (xs, n = 20) => (xs.length ? xs.slice(0, n).join(", ") + (xs.length > n ? ` … (+${xs.length - n})` : "") : "none");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// ── KEYS AND CONSTANTS FROM THE SOURCE ────────────────────────────────────
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const numOf = (src, n) => Number(((fs.readFileSync(src, "utf8").match(new RegExp(`${n} = ([\\d_]+)`)) ?? [])[1] ?? "").replace(/_/g, ""));
const K = {
  REFERENCE: keyOf("lib/server/referenceCache.ts", "REFERENCE_KEY_PREFIX"),
  MANIFEST: keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"),
  FACTS: keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX"),
  DATES: keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX"),
  JOB_RUN: keyOf("lib/server/jobRuns.ts", "JOB_RUN_PREFIX"),
  POOL: keyOf("lib/server/pricePool.ts", "PRICE_POOL_KEY"),
};
const N = {
  JOB_BUDGET_MS: numOf("lib/server/jobBudget.ts", "JOB_BUDGET_MS"),
  REPORT_DATES_RESERVE_MS: numOf("lib/server/jobBudget.ts", "REPORT_DATES_RESERVE_MS"),
  PER_RUN: numOf("app/api/jobs/sec-facts/route.ts", "SEC_REPORT_DATES_PER_RUN"),
  MIN_GAP_MS: numOf("app/api/jobs/sec-facts/route.ts", "MIN_GAP_MS"),
  STORED_EVENT_LIMIT: numOf("lib/server/secReportDatesStore.ts", "STORED_EVENT_LIMIT"),
};
for (const [n, v] of [...Object.entries(K), ...Object.entries(N)]) {
  if (!v) { console.error(`FATAL: ${n} not readable from source`); process.exit(2); }
}

// ── LIFTS ────────────────────────────────────────────────────────────────
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/export (const|function|type)/g, "$1");
const RD = await lift(strip("lib/server/secReportDates.ts") +
  "\nexport { resultsPairing, periodicReportDates, nextPeriodEndFrom, parseAcceptanceEt };", "", "secReportDates");
const Q = await lift(
  grabConst("lib/server/secReportDatesWrite.ts", "STALE_CUT_DAYS") + "\n" +
    grabFunction(readCodeOnly("lib/server/secReportDatesWrite.ts"), "reportDatesQueue").replace(/^export /, "") +
    "\nexport { reportDatesQueue };", "", "reportDatesQueue");
const F = await lift(strip("lib/server/secFields.ts") + "\nexport { secFieldsHash };", "", "secFields");
const H = F.secFieldsHash();
const ec = readCodeOnly("lib/server/earningsCalendar.ts");
const parts = ["getMonthCandidates", "looksNonUsOrDerivative", "candidateDataScore", "num", "str", "monthKey"].map((n) => [n, grabFunction(ec, n)]);
for (const [n, b] of parts) if (!b) { console.error(`FATAL: ${n} not liftable`); process.exit(2); }
const EC = await lift(parts.map(([, b]) => b.replace(/^export /, "")).join("\n") + "\nexport { getMonthCandidates };",
  "const MONTH_CACHE_MS = 0; const candidatesCache = new Map(); const popularRank = (_s) => 0;\n" +
    "let __rows = []; let __names = new Map();\n" +
    "export const __set = (rows, names) => { __rows = rows; __names = names; };\n" +
    "const fetchMonthRows = async (_y, _m) => __rows; const getNameMap = async () => __names;", "getMonthCandidates");

// ── SEC FETCH, paced like the job ─────────────────────────────────────────
let lastAt = 0;
const timing = { submissions: [], index: [], doc: [], facts: [], frames: [] };
const fetchSec = async (url, kind, asText = false) => {
  const wait = Math.max(0, lastAt + N.MIN_GAP_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
      if (res.ok) {
        const body = asText ? await res.text() : await res.json();
        timing[kind]?.push({ ms: Date.now() - t, bytes: Number(res.headers.get("content-length") ?? 0) });
        return body;
      }
      if (res.status !== 429 && res.status < 500) return null;
    } catch { /* retried */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return null;
};
const mgetAll = async (keys, n = 50) => {
  const out = [];
  for (const c of chunk(keys, n)) out.push(...((await redis.mget(...c)) ?? c.map(() => null)));
  return out;
};

console.log(`window ${FROM} .. ${TODAY} · match ±${MATCH_TOL}d · job budget ${N.JOB_BUDGET_MS}ms (report-dates reserve ${N.REPORT_DATES_RESERVE_MS}ms) · ${N.PER_RUN} records/run · gap ${N.MIN_GAP_MS}ms`);

// ════════════════════════════════════════════════════════════════════════════
// INPUTS
// ════════════════════════════════════════════════════════════════════════════
const manifest = await redis.get(K.MANIFEST);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const M = manifest.symbols;
const universe = Object.keys(M).sort();
const withCik = universe.filter((s) => M[s]?.cik);
const recsRaw = await mgetAll(universe.map((s) => `${K.DATES}:${s}`));
const recs = new Map(universe.map((s, i) => [s, recsRaw[i] && Array.isArray(recsRaw[i].events) ? recsRaw[i] : null]));
const setsRaw = await mgetAll(universe.map((s) => `${K.FACTS}:${s}`), 10);
const factState = new Map(), sets = new Map();
universe.forEach((s, i) => {
  const raw = setsRaw[i];
  if (!raw || typeof raw !== "object") factState.set(s, "absent");
  else if (raw.h !== H || !Array.isArray(raw.quarters)) factState.set(s, "gated (fieldsHash mismatch)");
  else { factState.set(s, "readable"); sets.set(s, raw); }
});
console.log(`manifest ${universe.length} (${withCik.length} with CIK) · records ${[...recs.values()].filter(Boolean).length} · fact sets ${fmtTally(tally([...factState.values()]))}`);

// FMP: the grid's pre-admission candidates, rebuilt by the shipped builder.
const months = [...new Set([FROM, TODAY].map((d) => d.slice(0, 7)))];
for (let m = FROM.slice(0, 7); m <= TODAY.slice(0, 7);) {
  if (!months.includes(m)) months.push(m);
  const [y, mo] = m.split("-").map(Number);
  m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}
months.sort();
const names = await redis.get(`${K.REFERENCE}stock-list-names`);
const nameMap = names ? new Map(Object.entries(names)) : null;
const rawBy = new Map(); // symbol -> [dates] (raw FMP rows, all)
const cand = [];
for (const m of months) {
  const rows = await redis.get(`${K.REFERENCE}earnings-calendar:${m}`);
  if (!Array.isArray(rows) || !nameMap) { console.error(`FATAL: FMP month ${m} or names absent from Redis — cannot rebuild candidates`); process.exit(2); }
  for (const r of rows) {
    const s = String(r?.symbol ?? "").toUpperCase(); const d = String(r?.date ?? "").slice(0, 10);
    if (s && d) rawBy.set(s, [...(rawBy.get(s) ?? []), d]);
  }
  EC.__set(rows, nameMap);
  const [y, mo] = m.split("-").map(Number);
  for (const [d, list] of await EC.getMonthCandidates(y, mo)) {
    if (!inWindow(d)) continue;
    for (const c of list) if (M[c.symbol.toUpperCase()]) cand.push({ symbol: c.symbol.toUpperCase(), date: d });
  }
}
console.log(`FMP candidates in universe, window: ${cand.length}`);

// Live submissions for every CIK-bearing manifest symbol.
const subsBy = new Map();
const t0 = Date.now();
for (const s of withCik) {
  const subs = await fetchSec(`https://data.sec.gov/submissions/CIK${String(M[s].cik).padStart(10, "0")}.json`, "submissions");
  if (subs?.filings?.recent) subsBy.set(s, subs);
}
console.log(`submissions ${subsBy.size}/${withCik.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s · median ${median(timing.submissions.map((x) => x.ms))}ms/fetch`);

const filingsOf = (subs) => {
  const r = subs.filings.recent, out = [];
  for (let i = 0; i < (r.accessionNumber?.length ?? 0); i++) {
    const on = RD.parseAcceptanceEt(r.acceptanceDateTime?.[i])?.date ?? r.filingDate?.[i];
    out.push({
      form: r.form?.[i], items: r.items?.[i] ?? "", on, acc: r.accessionNumber[i], reportDate: r.reportDate?.[i] ?? "",
      primaryDocument: r.primaryDocument?.[i] ?? "", primaryDocDescription: r.primaryDocDescription?.[i] ?? "",
      isXBRL: r.isXBRL?.[i] ?? null, size: r.size?.[i] ?? null,
    });
  }
  return out;
};
const filings = new Map([...subsBy].map(([s, subs]) => [s, filingsOf(subs)]));
const isFpi = (s) => { const f = (filings.get(s) ?? []).slice(0, 200).map((x) => x.form); return f.includes("20-F") || f.includes("40-F") || f.includes("6-K"); };
const hasPeriodic = (s) => (filings.get(s) ?? []).slice(0, 200).some((x) => /^10-[QK]$/.test(x.form));
const live202 = new Map([...subsBy].map(([s, subs]) => [s, RD.resultsPairing(subs, new Set()).events.filter((e) => e.basis === "8-K item 2.02").map((e) => e.announcedOn)]));

// ── Pairing (same rule as #532) ───────────────────────────────────────────
const pairUp = (fmp, sec) => {
  const by = (xs) => xs.reduce((m, x) => m.set(x.symbol, [...(m.get(x.symbol) ?? []), x]), new Map());
  const Fm = by(fmp), Sm = by(sec);
  let matched = 0; const fOnly = [], sOnly = [], diffs = [];
  for (const [sym, fl] of Fm) {
    const sl = Sm.get(sym) ?? [];
    const c = [];
    for (const f of fl) for (const e of sl) { const d = diffDays(e.date, f.date); if (Math.abs(d) <= MATCH_TOL) c.push({ f, e, d }); }
    c.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
    const uf = new Set(), us = new Set();
    for (const x of c) { if (uf.has(x.f) || us.has(x.e)) continue; uf.add(x.f); us.add(x.e); matched++; diffs.push(x.d); }
    for (const f of fl) if (!uf.has(f)) fOnly.push(f);
    for (const e of sl) if (!us.has(e)) sOnly.push(e);
    Sm.delete(sym);
  }
  for (const sl of Sm.values()) sOnly.push(...sl);
  return { matched, fOnly, sOnly, diffs };
};
const agree = (diffs) => `same ${diffs.filter((d) => d === 0).length} · ±1 ${diffs.filter((d) => Math.abs(d) === 1).length} · 2-10 ${diffs.filter((d) => Math.abs(d) > 1).length}`;
const storeEvents = [...recs].flatMap(([s, r]) => (r?.events ?? []).filter((e) => inWindow(e.announcedOn)).map((e) => ({ symbol: s, date: e.announcedOn, basis: e.basis })));
const base = pairUp(cand, storeEvents);
console.log(`\n== BASELINE (A3 of #532, reproduced) ==\n  FMP ${cand.length} · SEC ${storeEvents.length} · OVERLAP ${base.matched} · FMP-only ${base.fOnly.length} · SEC-only ${base.sOnly.length} · dates ${agree(base.diffs)}`);

// Bucket each FMP-only pair — same order of tests as #532's fmpOnlyReason.
const bucketOf = (f) => {
  if (!M[f.symbol]?.cik) return "no CIK";
  const fl = filings.get(f.symbol);
  if (!fl) return "submissions unreadable";
  const near202 = (live202.get(f.symbol) ?? []).filter((d) => Math.abs(diffDays(d, f.date)) <= MATCH_TOL);
  if (near202.length) return recs.get(f.symbol) ? "3 stale record" : "2 no record";
  if ((live202.get(f.symbol) ?? []).some((d) => Math.abs(diffDays(d, f.date)) <= 45)) return "2.02 >10d away";
  const sixK = fl.filter((x) => x.form?.startsWith("6-K") && diffDays(x.on, f.date) >= -3 && diffDays(x.on, f.date) <= MATCH_TOL);
  if (isFpi(f.symbol) && (sixK.length || !hasPeriodic(f.symbol))) return "1 FPI / 6-K";
  return "other";
};
const fOnlyB = base.fOnly.map((f) => ({ ...f, bucket: bucketOf(f) }));
console.log(`  FMP-only buckets: ${fmtTally(tally(fOnlyB.map((x) => x.bucket)))}`);

// ════════════════════════════════════════════════════════════════════════════
// BUCKET 1 — FOREIGN FILERS ON 6-K
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== BUCKET 1: FPI / 6-K ==");
const b1 = fOnlyB.filter((x) => x.bucket === "1 FPI / 6-K");
const b1Syms = [...new Set(b1.map((x) => x.symbol))];
// Why the SHIPPED 6-K rule (reportDate ∈ fact-set period ends) finds nothing.
const why = b1Syms.map((s) => {
  const set = sets.get(s);
  const ends = new Set(set ? [...set.quarters, ...(set.years ?? [])].map((p) => p.e) : []);
  const sixKs = (filings.get(s) ?? []).filter((x) => x.form?.startsWith("6-K") && inWindow(x.on));
  const hits = sixKs.filter((x) => ends.has(x.reportDate));
  return { s, fact: factState.get(s), quarters: set?.quarters?.length ?? 0, newestQ: set ? set.quarters.map((p) => p.e).sort().pop() ?? null : null,
    sixK: sixKs.length, reportDateOnPeriodEnd: hits.length, reportDateIsFilingDate: sixKs.filter((x) => x.reportDate === x.on || !x.reportDate).length };
});
console.log(`  ${b1.length} pairs over ${b1Syms.length} filers · fact set: ${fmtTally(tally(why.map((w) => w.fact)))}`);
console.log(`  filers whose fact set has ANY quarter: ${why.filter((w) => w.quarters > 0).length}/${b1Syms.length} · median quarters ${median(why.map((w) => w.quarters))}`);
const allSixK = why.reduce((a, w) => a + w.sixK, 0);
console.log(`  their 6-Ks in window: ${allSixK} · reportDate equal to a stored period end (the shipped rule) ${why.reduce((a, w) => a + w.reportDateOnPeriodEnd, 0)} · reportDate blank or = filing date ${why.reduce((a, w) => a + w.reportDateIsFilingDate, 0)}`);
for (const tol of [1, 3]) {
  const hit = b1.filter((p) => (filings.get(p.symbol) ?? []).some((x) => x.form?.startsWith("6-K") && Math.abs(diffDays(x.on, p.date)) <= tol));
  console.log(`  pairs with ANY 6-K within ±${tol}d of the FMP date: ${hit.length}/${b1.length} (${pct(hit.length, b1.length)})`);
}
const noSixK = b1.filter((p) => !(filings.get(p.symbol) ?? []).some((x) => x.form?.startsWith("6-K") && Math.abs(diffDays(x.on, p.date)) <= 3));
console.log(`    no 6-K within ±3d: ${ex(noSixK.map((p) => {
  const near = (filings.get(p.symbol) ?? []).filter((x) => Math.abs(diffDays(x.on, p.date)) <= 10).map((x) => `${x.form} ${x.on}`);
  return `${p.symbol} ${p.date} [${near.slice(0, 3).join("; ") || "nothing ±10d"}]`;
}), 40)}`);

// Every 6-K the in-universe FPIs filed in the window, with the evidence a rule
// could read: submissions fields (free) and the filing index (one fetch each).
const fpiUniverse = withCik.filter((s) => filings.get(s) && isFpi(s));
const sixKs = fpiUniverse.flatMap((s) => (filings.get(s) ?? []).filter((x) => x.form?.startsWith("6-K") && inWindow(x.on)).map((x) => ({ ...x, symbol: s })));
console.log(`\n  6-K population: ${sixKs.length} 6-Ks in window from ${fpiUniverse.length} in-universe FPI filers (${(sixKs.length / WINDOW_DAYS).toFixed(1)}/day)`);
const nearFmp = (x, tol) => (rawBy.get(x.symbol) ?? []).some((d) => Math.abs(diffDays(x.on, d)) <= tol);
const idxRe = /<tr[^>]*>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>\s*<a href="([^"]+)">([^<]*)<\/a>[\s\S]*?<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;
let idxFetched = 0;
for (const x of sixKs.slice(0, SIXK_INDEX_CAP)) {
  const cikInt = String(Number(M[x.symbol].cik));
  const html = await fetchSec(`https://www.sec.gov/Archives/edgar/data/${cikInt}/${x.acc.replace(/-/g, "")}/${x.acc}-index.htm`, "index", true);
  if (!html) continue;
  idxFetched++;
  x.docs = [...html.matchAll(idxRe)].map((m) => ({ desc: m[2].trim(), file: m[4].trim(), type: m[5].trim() }));
}
console.log(`  filing indexes fetched ${idxFetched}/${sixKs.length} · median ${median(timing.index.map((t) => t.ms))}ms`);
// THE DOCUMENT ITSELF. Run 35838912504 showed exhibit descriptions are almost
// always the generic "EX-99.1" / "EXHIBIT 99.1", so neither the submissions
// fields nor the index can tell a results release from a buyback notice. The
// release says what it is in its first paragraphs, so the probe reads the
// main exhibit (first EX-99*, else the primary document) and keeps the opening
// text. One extra fetch per 6-K.
const DOC_RE = /\b((first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter|(q[1-4]|[1-4]q)\s?'?(20)?2\d|half[- ]year(ly)?|(three|six|nine|twelve)[- ]months ended|interim (results|report|financial)|(quarterly|half[- ]yearly|interim|annual) results|financial results|results (of operations )?for the (quarter|period|first|second|third|fourth|six|three|nine)|earnings release)\b/i;
let docFetched = 0;
for (const x of sixKs.slice(0, SIXK_INDEX_CAP)) {
  const ex99 = (x.docs ?? []).find((d) => /^EX-99/i.test(d.type) && /\.(htm|html|txt)$/i.test(d.file));
  const file = ex99?.file ?? (/\.(htm|html|txt)$/i.test(x.primaryDocument) ? x.primaryDocument : null);
  if (!file) continue;
  const cikInt = String(Number(M[x.symbol].cik));
  const body = await fetchSec(`https://www.sec.gov/Archives/edgar/data/${cikInt}/${x.acc.replace(/-/g, "")}/${file}`, "doc", true);
  if (!body) continue;
  docFetched++;
  x.docText = body.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").slice(0, 20000);
}
console.log(`  main documents fetched ${docFetched}/${sixKs.length} · median ${median(timing.doc.map((t) => t.ms))}ms`);
const RESULTS_RE = /\b(results?|earnings|quarter(ly)?|interim|half[- ]?year(ly)?|semi[- ]?annual|first half|1h|2h|h1|h2|[1-4]q\s?'?\d{2,4}|q[1-4](\s?'?\d{2,4})?|financial (statements|report|information)|management'?s discussion|md&a|press release on .*(results|performance))\b/i;
const NOISE_RE = /\b(annual general meeting|agm|extraordinary general|proxy|voting|notice of meeting|transaction in own shares|share buy[- ]?back|repurchase|director.?s? dealing|pdmr|total voting rights|block listing|form 8\.3|holding\(s\) in company|change of auditor)\b/i;
const text = (x) => [x.primaryDocDescription, x.primaryDocument, ...(x.docs ?? []).flatMap((d) => [d.desc, d.file])].join(" | ");
const RULES = {
  "R0 shipped (reportDate = stored period end)": (x) => { const set = sets.get(x.symbol); return Boolean(set && [...set.quarters, ...(set.years ?? [])].some((p) => p.e === x.reportDate)); },
  "R1 any 6-K": () => true,
  "R2 isXBRL": (x) => x.isXBRL === 1 || x.isXBRL === true,
  "R3 submissions text only (primaryDocDescription + primaryDocument)": (x) => RESULTS_RE.test(`${x.primaryDocDescription} ${x.primaryDocument}`) && !NOISE_RE.test(`${x.primaryDocDescription} ${x.primaryDocument}`),
  "R4 index text (exhibit descriptions + file names)": (x) => RESULTS_RE.test(text(x)) && !NOISE_RE.test(text(x)),
  "R5 R4 or isXBRL": (x) => (RESULTS_RE.test(text(x)) && !NOISE_RE.test(text(x))) || x.isXBRL === 1,
  "R6 main-document text (first 20k chars)": (x) => DOC_RE.test(x.docText ?? ""),
  "R7 R6 on the first 3k chars only": (x) => DOC_RE.test((x.docText ?? "").slice(0, 3000)),
  "R8 R7 or isXBRL": (x) => DOC_RE.test((x.docText ?? "").slice(0, 3000)) || x.isXBRL === 1,
};
for (const [name, rule] of Object.entries(RULES)) {
  const flagged = sixKs.filter(rule);
  const tp3 = flagged.filter((x) => nearFmp(x, 3)), fp10 = flagged.filter((x) => !nearFmp(x, 10));
  const pairsHit1 = b1.filter((p) => flagged.some((x) => x.symbol === p.symbol && Math.abs(diffDays(x.on, p.date)) <= 1));
  const pairsHit3 = b1.filter((p) => flagged.some((x) => x.symbol === p.symbol && Math.abs(diffDays(x.on, p.date)) <= 3));
  console.log(`  ${name}\n    flags ${flagged.length}/${sixKs.length} 6-Ks · within ±3d of an FMP date ${tp3.length} · near NO FMP date (±10d) ${fp10.length} = FP ${pct(fp10.length, flagged.length)}\n    bucket-1 pairs hit: ±1d ${pairsHit1.length}/${b1.length} (${pct(pairsHit1.length, b1.length)}) · ±3d ${pairsHit3.length}/${b1.length} (${pct(pairsHit3.length, b1.length)})`);
}
// What the distinguishing text actually looks like, both sides.
const show = (xs) => xs.slice(0, 12).map((x) => `${x.symbol} ${x.on} "${x.primaryDocDescription}" ${x.primaryDocument} xbrl=${x.isXBRL} [${(x.docs ?? []).filter((d) => /^EX-99/i.test(d.type)).map((d) => `${d.type}:${d.desc || "-"}:${d.file}`).slice(0, 3).join("; ")}]`);
console.log(`  near an FMP date (±1d), sample:\n    ${show(sixKs.filter((x) => nearFmp(x, 1))).join("\n    ")}`);
console.log(`  near NO FMP date (±10d), sample:\n    ${show(sixKs.filter((x) => !nearFmp(x, 10))).join("\n    ")}`);
console.log(`  primaryDocDescription values: ${fmtTally(tally(sixKs.map((x) => x.primaryDocDescription || "(blank)")))}`.slice(0, 1500));
const snip = (x) => { const t = x.docText ?? ""; const m = t.match(DOC_RE); return m ? `…${t.slice(Math.max(0, m.index - 60), m.index + 80)}…` : t.slice(0, 140); };
const r7 = RULES["R7 R6 on the first 3k chars only"];
console.log(`  R7 flagged but near NO FMP date (FP candidates):\n    ${sixKs.filter((x) => r7(x) && !nearFmp(x, 10)).slice(0, 25).map((x) => `${x.symbol} ${x.on}: ${snip(x)}`).join("\n    ")}`);
console.log(`  bucket-1 pairs R7 misses at ±3d:\n    ${b1.filter((p) => !sixKs.some((x) => x.symbol === p.symbol && Math.abs(diffDays(x.on, p.date)) <= 3 && r7(x))).map((p) => {
  const n = sixKs.filter((x) => x.symbol === p.symbol && Math.abs(diffDays(x.on, p.date)) <= 3);
  return `${p.symbol} ${p.date}: ${n.length ? n.slice(0, 2).map((x) => `${x.on} ${(x.docText ?? "(no doc)").slice(0, 110)}`).join(" || ") : "no 6-K ±3d"}`;
}).slice(0, 40).join("\n    ")}`);
const missR4 = b1.filter((p) => !sixKs.some((x) => x.symbol === p.symbol && Math.abs(diffDays(x.on, p.date)) <= 3 && RULES["R4 index text (exhibit descriptions + file names)"](x)));
console.log(`  bucket-1 pairs R4 misses at ±3d (${missR4.length}): ${ex(missR4.map((p) => {
  const n = sixKs.filter((x) => x.symbol === p.symbol && Math.abs(diffDays(x.on, p.date)) <= 3);
  return `${p.symbol} ${p.date} [${n.map((x) => `${x.on} ${(x.docs ?? []).map((d) => d.desc || d.file).slice(0, 2).join("/")}`).join("; ") || "no 6-K ±3d"}]`;
}), 40)}`);

// ════════════════════════════════════════════════════════════════════════════
// BUCKET 2 — 2.02 ON EDGAR, NO RECORD
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== BUCKET 2: NO RECORD ==");
const b2 = fOnlyB.filter((x) => x.bucket === "2 no record");
const b2Syms = [...new Set(b2.map((x) => x.symbol))];
const cut = JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols;
const { queue, tier1, tier2, tier3 } = Q.reportDatesQueue({ entries: M, eventQueued: new Set(), cut, changedThisRun: [], limit: 100000, now: Date.now() });
const pos = new Map(queue.map((s, i) => [s, i]));
const noRec = withCik.filter((s) => !recs.get(s));
console.log(`  manifest symbols with a CIK and no record: ${noRec.length} · never stamped (reportDatesAt null = the job's "backlog"): ${withCik.filter((s) => !M[s].reportDatesAt).length}`);
console.log(`  queue today (uncapped): ${queue.length} · tier1 ${tier1} · tier2 ${tier2} · tier3 ${tier3}`);
const head = queue.slice(0, N.PER_RUN);
console.log(`  of the FIRST ${N.PER_RUN} (one run's slots): ${fmtTally(tally(head.map((s) => `${factState.get(s)}${M[s].reportDatesAt ? " +stamped" : " unstamped"}`)))}`);
const b2Class = (s) => {
  const e = M[s];
  if (e.reportDatesAt) return `stamped ${new Date(e.reportDatesAt).toISOString().slice(0, 10)} but no record`;
  if (factState.get(s) !== "readable") return `never stamped, fact set ${factState.get(s)} — the job skips it without stamping`;
  return "never stamped, fact set readable — backlog not reached";
};
for (const [cls, n] of [...tally(b2Syms.map(b2Class))].sort((a, b) => b[1] - a[1])) {
  const xs = b2Syms.filter((s) => b2Class(s) === cls);
  console.log(`  ${n}  ${cls}\n      e.g. ${ex(xs.map((s) => `${s}(q#${pos.get(s) ?? "-"}, contentHash ${M[s].contentHash ? "set" : "null"}${M[s].needsReverify ? ", needsReverify" : ""})`), 30)}`);
}
const allNoRec = noRec.map(b2Class);
console.log(`  ALL ${noRec.length} no-record symbols: ${fmtTally(tally(allNoRec))}`);
const blockers = head.filter((s) => factState.get(s) !== "readable" && !M[s].reportDatesAt);
console.log(`  queue-head slots burned on symbols the job will skip (no readable fact set, not stamped): ${blockers.length}/${N.PER_RUN} — ${ex(blockers, 30)}`);

// ════════════════════════════════════════════════════════════════════════════
// BUCKET 3 — STALE RECORDS: reader or queue?
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== BUCKET 3: STALE RECORD ==");
const b3 = fOnlyB.filter((x) => x.bucket === "3 stale record");
const periodsOf = (s) => { const set = sets.get(s); return set ? [...set.quarters.map((p) => p.e), ...(set.years ?? []).map((p) => p.e)].filter(Boolean) : []; };
// Period-end sets for the fix variants.
const projected = (s) => {
  const set = sets.get(s); if (!set) return [];
  const c = RD.nextPeriodEndFrom(set.quarters.map((p) => p.e).filter(Boolean), (set.years ?? []).map((p) => p.e).filter(Boolean));
  const out = []; if (!c) return out;
  for (let e = c.end, i = 0; e <= TODAY && i < 8; e = addDays(e, c.stepDays), i++) out.push(e);
  return out;
};
const periodicEnds = (s) => (subsBy.get(s) ? [...RD.periodicReportDates(subsBy.get(s)).keys()] : []);
const VARIANTS = {
  "V0 shipped (fact-set periods)": (s) => periodsOf(s),
  "V1 + 10-Q/10-K reportDates from submissions": (s) => [...periodsOf(s), ...periodicEnds(s)],
  "V2 + cadence-projected period ends": (s) => [...periodsOf(s), ...projected(s)],
  "V3 V1 + V2": (s) => [...periodsOf(s), ...periodicEnds(s), ...projected(s)],
  "V4 submissions only (no fact set needed): 10-Q/10-K reportDates": (s) => periodicEnds(s),
};
const simulate = (s, v) => {
  const subs = subsBy.get(s); if (!subs) return [];
  return RD.resultsPairing(subs, new Set(VARIANTS[v](s))).events.filter((e) => e.periodEnd).slice(0, N.STORED_EVENT_LIMIT);
};
const b3Diag = b3.map((p) => {
  const rec = recs.get(p.symbol);
  const set = sets.get(p.symbol);
  const ev = (live202.get(p.symbol) ?? []).find((d) => Math.abs(diffDays(d, p.date)) <= MATCH_TOL);
  const newestQ = set ? set.quarters.map((q) => q.e).sort().pop() : null;
  // What the shipped pairing does with this 2.02 under today's stored set.
  const all = subsBy.get(p.symbol) ? RD.resultsPairing(subsBy.get(p.symbol), new Set(periodsOf(p.symbol))) : null;
  const raw = all ? (() => {
    // Unfiltered: every 2.02 with the period it matched to, before the collapse.
    const withPeriod = RD.resultsPairing(subsBy.get(p.symbol), new Set(periodsOf(p.symbol))).periods
      .flatMap((pp) => pp.candidates).find((e) => e.announcedOn === ev);
    return withPeriod ? `grouped into ${withPeriod.periodEnd}` : "period null (dropped by filter)";
  })() : "no subs";
  const recAt = rec?.at?.slice(0, 10);
  const inRecNow = simulate(p.symbol, "V0 shipped (fact-set periods)").some((e) => e.announcedOn === ev);
  const cause = !set ? `fact set ${factState.get(p.symbol)}` : inRecNow ? (recAt && recAt < ev ? "QUEUE: record older than the 8-K, not re-read since" : "record written before the set gained the period (now readable)") : `READER: ${raw}`;
  return { ...p, ev, recAt, newestQ, cause, v: Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, simulate(p.symbol, v).some((e) => e.announcedOn === ev)])) };
});
for (const [cls, n] of [...tally(b3Diag.map((d) => d.cause.replace(/grouped into \d{4}-\d{2}-\d{2}/, "grouped into an OLDER period (earliest wins)")))].sort((a, b) => b[1] - a[1])) {
  const xs = b3Diag.filter((d) => d.cause.replace(/grouped into \d{4}-\d{2}-\d{2}/, "grouped into an OLDER period (earliest wins)") === cls);
  console.log(`  ${n}  ${cls}\n      e.g. ${ex(xs.map((d) => `${d.symbol} 2.02 ${d.ev} · read ${d.recAt} · newest stored Q ${d.newestQ} · ${d.cause.replace(/^READER: /, "")}`), 12)}`);
}
console.log(`  record read AFTER the 8-K (so the queue DID select it): ${b3Diag.filter((d) => d.recAt && d.recAt >= d.ev).length}/${b3Diag.length}`);
for (const v of Object.keys(VARIANTS)) console.log(`  ${v}: recovers ${b3Diag.filter((d) => d.v[v]).length}/${b3Diag.length}`);
console.log(`  not recovered by V3: ${ex(b3Diag.filter((d) => !d.v["V3 V1 + V2"]).map((d) => `${d.symbol} 2.02 ${d.ev} (newest Q ${d.newestQ}; ${d.cause})`), 20)}`);
// Bucket 2 under the reader fix: of its 101 symbols' events, how many does the
// FIXED reader produce once the queue reaches them?
console.log(`  bucket 2 once re-read — shipped reader recovers ${b2.filter((p) => simulate(p.symbol, "V0 shipped (fact-set periods)").some((e) => Math.abs(diffDays(e.announcedOn, p.date)) <= MATCH_TOL)).length}/${b2.length} · with V3 ${b2.filter((p) => simulate(p.symbol, "V3 V1 + V2").some((e) => Math.abs(diffDays(e.announcedOn, p.date)) <= MATCH_TOL)).length}/${b2.length}`);

// Does the reader fix disturb records that are right today? Across the whole
// universe, compare in-window events V0 vs V3.
let same = 0, gained = 0, lost = 0, moved = 0;
const lostEx = [];
for (const s of withCik) {
  if (!sets.get(s)) continue;
  const a = new Set(simulate(s, "V0 shipped (fact-set periods)").filter((e) => inWindow(e.announcedOn)).map((e) => e.announcedOn));
  const b = new Set(simulate(s, "V3 V1 + V2").filter((e) => inWindow(e.announcedOn)).map((e) => e.announcedOn));
  const onlyA = [...a].filter((d) => !b.has(d)), onlyB = [...b].filter((d) => !a.has(d));
  if (!onlyA.length && !onlyB.length) same++;
  else if (onlyA.length && onlyB.length) { moved++; lostEx.push(`${s} ${onlyA}->${onlyB}`); }
  else if (onlyB.length) gained++; else { lost++; lostEx.push(`${s} lost ${onlyA}`); }
}
console.log(`  V3 vs V0 across ${withCik.length} filers (in-window events): unchanged ${same} · gained ${gained} · moved ${moved} · lost ${lost}${lostEx.length ? ` — ${ex(lostEx, 15)}` : ""}`);

// ════════════════════════════════════════════════════════════════════════════
// PROJECTION — A3 re-run with each gap closed
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== PROJECTED IN-UNIVERSE COVERAGE vs FMP (A3 definition) ==");
const simEvents = (v, needSet) => withCik.flatMap((s) => (needSet && !sets.get(s) ? (recs.get(s)?.events ?? []).map((e) => ({ symbol: s, date: e.announcedOn })) : simulate(s, v).map((e) => ({ symbol: s, date: e.announcedOn })))
  .filter((e) => inWindow(e.date)));
const sixKEvents = (rule) => {
  const out = [];
  for (const s of fpiUniverse) {
    const flagged = sixKs.filter((x) => x.symbol === s && rule(x)).map((x) => x.on).sort();
    // One event per cluster of flagged 6-Ks, the earliest of it -- the same
    // "original announcement wins" rule the 8-K path applies.
    let last = null;
    for (const d of flagged) { if (!last || diffDays(d, last) > MATCH_TOL) out.push({ symbol: s, date: d }); last = d; }
  }
  return out;
};
const scen = [
  ["S0 today's store", storeEvents],
  ["S1 bucket 2+3 queue closed: every filer with a readable set re-read, shipped reader", simEvents("V0 shipped (fact-set periods)", true)],
  ["S2 S1 + reader fix V3", simEvents("V3 V1 + V2", true)],
  ["S3 S2 + no-fact-set filers read from submissions (V4)", withCik.flatMap((s) => (sets.get(s) ? simulate(s, "V3 V1 + V2") : simulate(s, "V4 submissions only (no fact set needed): 10-Q/10-K reportDates")).map((e) => ({ symbol: s, date: e.announcedOn }))).filter((e) => inWindow(e.date))],
];
const s3 = scen[3][1];
scen.push(["S4 S3 + 6-K rule R4 (index text)", [...s3, ...sixKEvents(RULES["R4 index text (exhibit descriptions + file names)"])]]);
scen.push(["S5 S3 + 6-K rule R3 (submissions text only, no extra fetch)", [...s3, ...sixKEvents(RULES["R3 submissions text only (primaryDocDescription + primaryDocument)"])]]);
for (const r of ["R6 main-document text (first 20k chars)", "R7 R6 on the first 3k chars only", "R8 R7 or isXBRL"]) {
  scen.push([`S6 S3 + 6-K rule ${r}`, [...s3, ...sixKEvents(RULES[r])]]);
}
for (const [name, ev] of scen) {
  const r = pairUp(cand, ev);
  console.log(`  ${name}\n    SEC ${ev.length} · OVERLAP ${r.matched}/${cand.length} (${pct(r.matched, cand.length)}) · FMP-only ${r.fOnly.length} · SEC-only ${r.sOnly.length} · dates ${agree(r.diffs)}`);
  if (/^S[4-6]/.test(name)) {
    const left = r.fOnly.map((f) => ({ ...f, b: bucketOf(f) }));
    console.log(`    FMP-only left by #532 bucket: ${fmtTally(tally(left.map((x) => x.b)))}`);
    console.log(`    e.g. ${ex(left.map((x) => `${x.symbol} ${x.date} [${x.b}]`), 25)}`);
    console.log(`    SEC-only e.g. ${ex(r.sOnly.map((x) => `${x.symbol} ${x.date}`), 25)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// JOB-TIME COST
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== JOB TIME ==");
const run = await redis.get(`${K.JOB_RUN}:sec-facts`);
if (run) {
  const sm = run.summary ?? {};
  const pick = Object.fromEntries(Object.entries(sm).filter(([k]) => /phase|reportDates|attempted|written|failed|elapsed|budget|Ms$|deferred/i.test(k) && k !== "failedSymbols"));
  console.log(`  last sec-facts run ${run.at ? new Date(run.at).toISOString() : "?"} ok=${run.ok}\n  ${JSON.stringify(pick)}`);
} else console.log("  no sec-facts run record");
const subMs = timing.submissions.map((t) => t.ms);
const perRecord = Math.max(median(subMs) ?? 0, N.MIN_GAP_MS);
console.log(`  submissions fetch on this runner: median ${median(subMs)}ms · p90 ${[...subMs].sort((a, b) => a - b)[Math.floor(subMs.length * 0.9)]}ms · paced floor ${N.MIN_GAP_MS}ms`);
console.log(`  6-K filing-index fetch: median ${median(timing.index.map((t) => t.ms))}ms · 6-Ks/day in-universe ${(sixKs.length / WINDOW_DAYS).toFixed(1)}`);

// ════════════════════════════════════════════════════════════════════════════
// MARKET-CAP FLOORS, from SEC data only
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== MARKET-CAP FLOORS (SEC-only proxy) ==");
const tick = await fetchSec("https://www.sec.gov/files/company_tickers_exchange.json", "frames");
if (!tick?.fields) { console.log("  company_tickers_exchange unreadable — floor counts NOT MEASURED"); console.log("\ndone."); process.exit(0); }
const at = (n) => tick.fields.indexOf(n);
const listed = new Map(); // cik -> {tickers, exchange, name}
for (const r of tick.data) {
  const ex_ = r[at("exchange")];
  if (!["Nasdaq", "NYSE", "CBOE"].includes(ex_)) continue;
  const cik = String(r[at("cik")]).padStart(10, "0");
  const e = listed.get(cik) ?? { tickers: [], exchange: ex_, name: r[at("name")] };
  e.tickers.push(String(r[at("ticker")]).toUpperCase()); listed.set(cik, e);
}
console.log(`  US-listed (SEC exchange Nasdaq/NYSE/CBOE): ${listed.size} registrants`);
// EntityPublicFloat: the cover-page aggregate market value held by
// non-affiliates, as of the last day of the filer's prior Q2. A FLOOR on market
// cap (excludes insiders) and up to ~15 months old. Newest frame per CIK wins.
const float = new Map();
for (const fr of ["CY2024Q2I", "CY2024Q3I", "CY2024Q4I", "CY2025Q1I", "CY2025Q2I", "CY2025Q3I", "CY2025Q4I", "CY2026Q1I", "CY2026Q2I"]) {
  const j = await fetchSec(`https://data.sec.gov/api/xbrl/frames/dei/EntityPublicFloat/USD/${fr}.json`, "frames");
  const rows = j?.data ?? [];
  for (const r of rows) { const cik = String(r.cik).padStart(10, "0"); const p = float.get(cik); if (!p || r.end > p.end) float.set(cik, { val: r.val, end: r.end }); }
  console.log(`    frame ${fr}: ${rows.length} rows`);
}
const listedCiks = [...listed.keys()];
const withFloat = listedCiks.filter((c) => float.get(c)?.val > 0);
console.log(`  US-listed with a public-float value: ${withFloat.length}/${listed.size} (${pct(withFloat.length, listed.size)}) · float as-of dates: ${fmtTally(tally(withFloat.map((c) => float.get(c).end.slice(0, 7))))}`.slice(0, 900));
const manCiks = new Set(withCik.map((s) => String(M[s].cik).padStart(10, "0")));
// Calibrate the proxy against the pool's live market caps where both exist.
const poolSyms = universe.filter((s) => M[s]?.cik);
const pool = new Map();
for (const c of chunk(poolSyms, 300)) {
  const raw = await redis.hmget(K.POOL, ...c);
  c.forEach((s, i) => { const r = Array.isArray(raw) ? raw[i] : raw?.[s]; if (r?.marketCap) pool.set(String(M[s].cik).padStart(10, "0"), r.marketCap); });
}
const ratios = [...pool].filter(([c]) => float.get(c)?.val > 0).map(([c, cap]) => float.get(c).val / cap);
console.log(`  calibration vs price-pool market cap (${ratios.length} filers with both): float/cap median ${median(ratios)?.toFixed(2)} · p10 ${[...ratios].sort((a, b) => a - b)[Math.floor(ratios.length * 0.1)]?.toFixed(2)} · p90 ${[...ratios].sort((a, b) => a - b)[Math.floor(ratios.length * 0.9)]?.toFixed(2)}`);
for (const floor of [2e9, 5e9, 10e9]) {
  const over = withFloat.filter((c) => float.get(c).val >= floor);
  const overPool = [...pool].filter(([, cap]) => cap >= floor).length;
  const notIn = over.filter((c) => !manCiks.has(c));
  console.log(`  ≥ $${floor / 1e9}B public float: ${over.length} registrants · already in the manifest ${over.length - notIn.length} · NEW ${notIn.length}   (pool market cap ≥ floor: ${overPool} manifest filers)`);
}
// Seed and steady-state cost for the $2B new set, sampled.
const new2 = withFloat.filter((c) => float.get(c).val >= 2e9 && !manCiks.has(c));
const sample = new2.filter((_, i) => i % Math.max(1, Math.floor(new2.length / 25)) === 0).slice(0, 25);
const factsT = [], perYear = { periodic: [], eightK: [] };
for (const c of sample) {
  const t = Date.now();
  const facts = await fetchSec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${c}.json`, "facts", true);
  if (facts) factsT.push({ ms: Date.now() - t, bytes: facts.length });
  const subs = await fetchSec(`https://data.sec.gov/submissions/CIK${c}.json`, "submissions");
  if (subs?.filings?.recent) {
    const f = filingsOf(subs).filter((x) => x.on >= addDays(TODAY, -365));
    perYear.periodic.push(f.filter((x) => /^(10-[QK]|20-F|40-F)$/.test(x.form)).length);
    perYear.eightK.push(f.filter((x) => /^(8-K|6-K)$/.test(x.form)).length);
  }
}
const fMs = median(factsT.map((x) => x.ms)), fKB = median(factsT.map((x) => x.bytes / 1024));
console.log(`  sampled ${sample.length} new $2B+ filers: companyfacts median ${fMs}ms / ${fKB?.toFixed(0)} KB · periodic filings/yr median ${median(perYear.periodic)} · 8-K+6-K/yr median ${median(perYear.eightK)}`);
for (const floor of [2e9, 5e9, 10e9]) {
  const n = withFloat.filter((c) => float.get(c).val >= floor && !manCiks.has(c)).length;
  const seedS = (n * (Math.max(fMs ?? 0, N.MIN_GAP_MS) + perRecord)) / 1000;
  const factsPerDay = (n * (median(perYear.periodic) ?? 4)) / 365, datesPerDay = (n * (median(perYear.eightK) ?? 8)) / 365;
  console.log(`  $${floor / 1e9}B: +${n} filers · seed ${n} companyfacts + ${n} submissions ≈ ${seedS.toFixed(0)}s of fetch time total · steady state ≈ ${factsPerDay.toFixed(1)} fact re-reads + ${datesPerDay.toFixed(1)} report-date re-reads a day ≈ ${((factsPerDay * Math.max(fMs ?? 0, N.MIN_GAP_MS) + datesPerDay * perRecord) / 1000).toFixed(1)}s/day`);
}
console.log("\ndone.");
