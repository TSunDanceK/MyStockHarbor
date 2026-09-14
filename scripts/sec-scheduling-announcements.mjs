// Do companies file earnings-date SCHEDULING announcements as 8-Ks?
//
// THE LAST INPUT TO THE FORWARD-CALENDAR DECISION. Predicting a results date
// from filing cadence was measured and is weak: only 2 of 48 domestic filers
// hold a personal p90 inside +/-2 days. If companies instead ANNOUNCE the date
// ahead of time in a filing, the forward half of the calendar does not need to
// be predicted at all -- it can be read. This measures whether that source
// exists, at what rate, and for which companies.
//
// THE QUESTION IS NOT "DO COMPANIES DO THIS" BUT "DO THE COMPANIES A CALENDAR
// IS SEARCHED FOR DO THIS". A practice universal among micro-caps and absent
// from mega-caps would read as a healthy overall rate and be useless. Hence the
// market-cap segmentation, from the price pool already in the dump.
//
// READ-ONLY: public SEC endpoints and a frozen dump. No Redis, no FMP, no writes.
// Runs on a runner because the agent sandbox is refused data.sec.gov and
// www.sec.gov with 403 CONNECT.
import fs from "node:fs";
import path from "node:path";

const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (contact@mystockharbor.com)";
const HEADERS = { "user-agent": UA, accept: "*/*" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPACING_MS = 150; // ~6.7/sec, inside SEC's published 10/sec

const DAYS_BACK = 30;
const SAMPLE_CAP = Number(process.env.SAMPLE_CAP ?? 90); // filings opened for 2b
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

if (!DUMP) {
  console.error("FATAL: no dump directory. Dispatch the relay with a run_id.");
  process.exit(2);
}
const readJson = (name) => {
  const f = path.join(DUMP, name);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
};

// ── Universe and market caps, from the frozen dump ─────────────────────────
const universeDoc = readJson("universe.json");
const poolDoc = readJson("price-pool.json");
if (!universeDoc) {
  console.error("FATAL: universe.json missing from the dump — there is no universe to scope to.");
  process.exit(1);
}
const universe = [...new Set([
  ...(universeDoc.dumpUniverse ?? []),
  ...(universeDoc.pickersSymbolsKey ?? []),
])].map((s) => String(s).toUpperCase());

const marketCap = new Map();
{
  const raw = poolDoc?.value ?? {};
  for (const [sym, v] of Object.entries(raw)) {
    let e = v;
    if (typeof e === "string") { try { e = JSON.parse(e); } catch { e = null; } }
    const mc = Number(e?.marketCap);
    if (Number.isFinite(mc) && mc > 0) marketCap.set(sym.toUpperCase(), mc);
  }
}

const tickersRaw = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikByTicker = new Map();
const tickerByCik = new Map();
for (const [cik, , ticker] of tickersRaw.data ?? []) {
  if (!ticker) continue;
  const t = String(ticker).toUpperCase();
  cikByTicker.set(t, String(cik));
  if (!tickerByCik.has(String(cik))) tickerByCik.set(String(cik), t);
}
const universeCiks = new Map(); // cik(no pad) -> symbol
for (const sym of universe) {
  const c = cikByTicker.get(sym);
  if (c) universeCiks.set(String(Number(c)), sym);
}

console.log(`[sa] universe symbols        ${universe.length}`);
console.log(`[sa] resolved to a CIK       ${universeCiks.size} (${pct(universeCiks.size, universe.length)})`);
console.log(`[sa] with a market cap       ${[...universeCiks.values()].filter((s) => marketCap.has(s)).length}`);
console.log(`[sa] user-agent              ${JSON.stringify(UA)}`);
console.log("");

// ── Fetch helpers, with failures counted as failures ───────────────────────
let reqs = 0, bytes = 0, ms = 0;
const failures = [];
async function get(url, { json = false } = {}) {
  const t0 = Date.now();
  reqs++;
  try {
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    ms += Date.now() - t0; bytes += text.length;
    await sleep(SPACING_MS);
    if (!res.ok) { failures.push({ url, why: `HTTP ${res.status}` }); return { ok: false, status: res.status, text: "" }; }
    if (json) { try { return { ok: true, status: res.status, body: JSON.parse(text) }; } catch (e) { failures.push({ url, why: `bad JSON: ${e.message}` }); return { ok: false, status: res.status }; } }
    return { ok: true, status: res.status, text };
  } catch (e) {
    ms += Date.now() - t0;
    await sleep(SPACING_MS);
    failures.push({ url, why: `network: ${e.message}` });
    return { ok: false, status: 0, text: "" };
  }
}

const pad2 = (n) => String(n).padStart(2, "0");
const yyyymmdd = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
const quarterOf = (s) => Math.floor((Number(s.slice(4, 6)) - 1) / 3) + 1;
const indexUrl = (s) => `https://www.sec.gov/Archives/edgar/daily-index/${s.slice(0, 4)}/QTR${quarterOf(s)}/master.${s}.idx`;

// ── 1. The daily index, last DAYS_BACK calendar days ───────────────────────
//
// A DAY WITH NO INDEX ANSWERS 403, NOT 404 (the S3 bucket has no ListBucket),
// so weekends and holidays are expected 403s and are counted separately from
// real failures rather than alarming.
const eightKs = []; // { cik, symbol, accession, filed }
let indexDays = 0, indexMissing = 0;
{
  const today = new Date();
  for (let i = 1; i <= DAYS_BACK; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const day = yyyymmdd(d);
    const res = await get(indexUrl(day));
    if (!res.ok) { indexMissing++; continue; }
    indexDays++;
    for (const line of res.text.split("\n")) {
      if (!line.includes("|")) continue;
      const f = line.split("|");
      if (f.length !== 5) continue;
      const cik = f[0].trim();
      if (!/^\d+$/.test(cik)) continue;
      if (f[2].trim() !== "8-K") continue;
      const sym = universeCiks.get(String(Number(cik)));
      if (!sym) continue;
      const file = f[4].trim();
      const accession = (file.split("/").pop() ?? "").replace(/\.txt$/, "");
      eightKs.push({ cik: String(Number(cik)), symbol: sym, accession, filed: f[3].trim().replace(/-/g, "") });
    }
  }
}
// A CIK can file several 8-Ks in the window; dedupe on accession.
const byAccn = new Map();
for (const e of eightKs) if (!byAccn.has(e.accession)) byAccn.set(e.accession, e);
const universe8k = [...byAccn.values()];
const ciksWith8k = [...new Set(universe8k.map((e) => e.cik))];

console.log(`[sa] daily index files read  ${indexDays} of ${DAYS_BACK} (${indexMissing} answered 403 — weekends/holidays, expected)`);
console.log(`[sa] 8-Ks by universe filers ${universe8k.length} across ${ciksWith8k.length} CIKs`);
console.log("");

// ── 2a. Which of those carry item 7.01 or 8.01 ─────────────────────────────
const itemsByAccn = new Map();
for (const cik of ciksWith8k) {
  const res = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { json: true });
  if (!res.ok) continue;
  const r = res.body?.filings?.recent ?? {};
  const n = r.accessionNumber?.length ?? 0;
  for (let i = 0; i < n; i++) {
    itemsByAccn.set(String(r.accessionNumber[i]), {
      items: String(r.items?.[i] ?? ""),
      filingDate: String(r.filingDate?.[i] ?? ""),
      primaryDocument: String(r.primaryDocument?.[i] ?? ""),
    });
  }
}

const withItems = universe8k.map((e) => {
  const withDashes = e.accession.length === 18
    ? `${e.accession.slice(0, 10)}-${e.accession.slice(10, 12)}-${e.accession.slice(12)}`
    : e.accession;
  const meta = itemsByAccn.get(withDashes) ?? itemsByAccn.get(e.accession) ?? null;
  return { ...e, accnDashed: withDashes, items: meta?.items ?? null, filingDate: meta?.filingDate ?? null };
});
const resolved = withItems.filter((e) => e.items !== null);
const candidates = resolved.filter((e) => /\b7\.01\b/.test(e.items) || /\b8\.01\b/.test(e.items));
const distinctCandidateCiks = [...new Set(candidates.map((e) => e.cik))];

console.log(`[sa] 8-Ks matched to submissions items  ${resolved.length} of ${universe8k.length} (${pct(resolved.length, universe8k.length)})`);
console.log(`[sa] carrying 7.01 or 8.01              ${candidates.length} across ${distinctCandidateCiks.length} CIKs`);
console.log("");

// ── 2b. Open a sample and look for scheduling language ─────────────────────
const stripTags = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#\d+;/g, " ")
  .replace(/\s+/g, " ");

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?";
const DATE_RE = new RegExp(`(?:(${MONTHS})\\s+(\\d{1,2})(?:,)?\\s*(\\d{4})?)|(?:(\\d{1,2})\\s+(${MONTHS})\\s*(\\d{4})?)`, "i");
// The two phrasings the brief names, kept separate so the hit rate can say which.
const RESULTS_RE = new RegExp(`(will|plans to|intends to|expects to|is scheduled to|scheduled to)\\s+(report|announce|release|issue)[^.]{0,200}?(results|earnings)[^.]{0,200}?\\b(on|before|after)\\b[^.]{0,80}`, "i");
const CALL_RE = new RegExp(`(conference call|earnings call|webcast)[^.]{0,200}?\\b(on|at)\\b[^.]{0,120}`, "i");

const monthNum = (m) => {
  const k = m.toLowerCase().replace(/\./g, "").slice(0, 3);
  return ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(k) + 1;
};
function extractDate(fragment, filedIso) {
  const m = DATE_RE.exec(fragment);
  if (!m) return null;
  const mon = m[1] ?? m[5];
  const day = m[2] ?? m[4];
  let year = m[3] ?? m[6];
  if (!mon || !day) return null;
  const mn = monthNum(mon);
  if (mn < 1) return null;
  if (!year) {
    // No year given -- the overwhelmingly common case. Take the filing's year,
    // and roll forward if that would put the announcement in the past.
    const fy = Number(filedIso.slice(0, 4));
    const cand = `${fy}-${pad2(mn)}-${pad2(Number(day))}`;
    year = cand >= filedIso ? fy : fy + 1;
  }
  const iso = `${year}-${pad2(mn)}-${pad2(Number(day))}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : null;
}

const sample = candidates.slice(0, SAMPLE_CAP);
const hits = [];
let opened = 0, noExhibit = 0, noLanguage = 0, languageNoDate = 0;

for (const c of sample) {
  const accnPlain = c.accnDashed.replace(/-/g, "");
  const idx = await get(`https://www.sec.gov/Archives/edgar/data/${c.cik}/${accnPlain}/index.json`, { json: true });
  if (!idx.ok) continue;
  opened++;
  const items = idx.body?.directory?.item ?? [];
  // EX-99.* is where a press release lives. The primary 8-K body is the
  // fallback: some filers put the sentence in the 8-K itself.
  const docs = items
    .filter((it) => /\.(htm|html|txt)$/i.test(it.name ?? ""))
    .sort((a, b) => (/^ex-?99/i.test(a.name) ? -1 : 1) - (/^ex-?99/i.test(b.name) ? -1 : 1))
    .slice(0, 2);
  if (!docs.length) { noExhibit++; continue; }

  let found = null;
  for (const d of docs) {
    const doc = await get(`https://www.sec.gov/Archives/edgar/data/${c.cik}/${accnPlain}/${d.name}`);
    if (!doc.ok) continue;
    const text = stripTags(doc.text);
    const rm = RESULTS_RE.exec(text);
    const cm = CALL_RE.exec(text);
    const frag = rm?.[0] ?? cm?.[0] ?? null;
    if (!frag) continue;
    const filedIso = c.filingDate || `${c.filed.slice(0,4)}-${c.filed.slice(4,6)}-${c.filed.slice(6,8)}`;
    const announced = extractDate(frag, filedIso);
    if (!announced) { found = { kind: rm ? "results" : "call", announced: null, frag: frag.slice(0, 160), filedIso }; continue; }
    found = { kind: rm ? "results" : "call", announced, frag: frag.slice(0, 160), filedIso };
    break;
  }
  if (!found) { noLanguage++; continue; }
  if (!found.announced) { languageNoDate++; hits.push({ ...c, ...found }); continue; }
  hits.push({ ...c, ...found });
}

const dated = hits.filter((h) => h.announced);
const leads = dated
  .map((h) => Math.round((Date.parse(`${h.announced}T00:00:00Z`) - Date.parse(`${h.filedIso}T00:00:00Z`)) / 86400000))
  .filter((n) => Number.isFinite(n));
const forward = leads.filter((n) => n >= 0);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m-1]+s[m])/2) : null; };

// ── 2d. Market-cap deciles ─────────────────────────────────────────────────
const capped = [...universeCiks.values()].filter((s) => marketCap.has(s)).sort((a, b) => marketCap.get(b) - marketCap.get(a));
const decileOf = new Map();
capped.forEach((s, i) => decileOf.set(s, Math.min(9, Math.floor((i / capped.length) * 10)) + 1)); // 1 = largest
const filedByDecile = new Array(11).fill(0);
const candByDecile = new Array(11).fill(0);
const hitByDecile = new Array(11).fill(0);
for (const e of universe8k) { const d = decileOf.get(e.symbol); if (d) filedByDecile[d]++; }
for (const e of candidates) { const d = decileOf.get(e.symbol); if (d) candByDecile[d]++; }
for (const h of dated) { const d = decileOf.get(h.symbol); if (d) hitByDecile[d]++; }

// ── Report, printed last ───────────────────────────────────────────────────
console.log(`
================================================================
EARNINGS-DATE SCHEDULING ANNOUNCEMENTS AS 8-Ks — ${new Date().toISOString()}
================================================================

REQUESTS  ${reqs} · ${(bytes / 1048576).toFixed(1)} MB · mean ${reqs ? Math.round(ms / reqs) : 0}ms
FAILURES  ${failures.length}${failures.length ? ` (first: ${failures[0].why} ${failures[0].url.slice(0, 90)})` : ""}
          Counted as failures, not as absence. Weekend/holiday 403s on the daily
          index are separate and expected: ${indexMissing} of ${DAYS_BACK} days.

2a — 8-Ks CARRYING ITEM 7.01 OR 8.01, universe filers, last ${DAYS_BACK} days
  daily index files read           ${indexDays}
  8-Ks by universe filers          ${universe8k.length}  across ${ciksWith8k.length} CIKs
  matched to submissions items     ${resolved.length}  (${pct(resolved.length, universe8k.length)})
  carrying 7.01 or 8.01            ${candidates.length}  across ${distinctCandidateCiks.length} CIKs
  distinct CIKs:                   ${distinctCandidateCiks.map((c) => tickerByCik.get(c) ?? universeCiks.get(c) ?? c).sort().join(" ") || "(none)"}

2b — OF THOSE, HOW MANY ARE A SCHEDULING ANNOUNCEMENT
  sampled                          ${sample.length} of ${candidates.length}
  filing index opened              ${opened}
  no readable document             ${noExhibit}
  no scheduling language           ${noLanguage}
  language but no parseable date   ${languageNoDate}
  HITS with a parseable date       ${dated.length}
  hit rate of sampled              ${pct(dated.length, sample.length)}
  hit rate of opened               ${pct(dated.length, opened || 1)}

2c — LEAD TIME, announced date minus filing date (days)
  dated hits                       ${dated.length}
  forward-looking (>= 0 days)      ${forward.length}
  median lead                      ${forward.length ? median(forward) : "—"}
  min / max                        ${forward.length ? `${Math.min(...forward)} / ${Math.max(...forward)}` : "—"}
  within 2-4 weeks (14-28d)        ${forward.filter((n) => n >= 14 && n <= 28).length} (${pct(forward.filter((n) => n >= 14 && n <= 28).length, forward.length || 1)})
  under 7 days                     ${forward.filter((n) => n < 7).length} (${pct(forward.filter((n) => n < 7).length, forward.length || 1)})
  NEGATIVE leads (date in the past) ${leads.length - forward.length} -- these are
  same-day results releases, not schedule announcements, and are excluded above.

2d — BY MARKET-CAP DECILE (1 = largest), universe symbols with a pool cap: ${capped.length}

| decile | filed any 8-K | carried 7.01/8.01 | dated scheduling hits |
|---|---|---|---|`);
for (let d = 1; d <= 10; d++) {
  console.log(`| ${d} | ${filedByDecile[d]} | ${candByDecile[d]} | ${hitByDecile[d]} |`);
}

console.log(`
THE HITS (up to 30 shown)

| symbol | decile | filed | announced | lead (d) | kind | fragment |
|---|---|---|---|---|---|---|`);
for (const h of dated.slice(0, 30)) {
  const lead = Math.round((Date.parse(`${h.announced}T00:00:00Z`) - Date.parse(`${h.filedIso}T00:00:00Z`)) / 86400000);
  console.log(`| ${h.symbol} | ${decileOf.get(h.symbol) ?? "—"} | ${h.filedIso} | ${h.announced} | ${lead} | ${h.kind} | ${h.frag.replace(/\|/g, "/").slice(0, 90)} |`);
}
if (languageNoDate) {
  console.log(`
  LANGUAGE WITHOUT A PARSEABLE DATE (${languageNoDate}) — phrasing the extractor
  could not resolve. Listed because "no date" here is a limitation of the parser
  as much as of the filing, and the two must not be conflated:`);
  for (const h of hits.filter((x) => !x.announced).slice(0, 8)) {
    console.log(`    ${h.symbol.padEnd(6)} ${h.frag.slice(0, 110)}`);
  }
}
console.log(`
NOT A PRODUCT DECISION. Numbers only.
================================================================
`);
