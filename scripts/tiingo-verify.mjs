// Tiingo, verified on the live token before anything is built on it
// (Relay B, #553 COWORK #49; claude/tiingo-contract-and-limits-2026-09-23.md §8).
//
// ── ACTIONS LOGS ARE PUBLIC, SO THIS PRINTS NO TIINGO DATA ──────────────────
// Status codes, counts, byte sizes, timings, dates covered, header and field
// NAMES, and our own tickers. Never a price, a bar, a volume, a name Tiingo
// returned, or a response body (an error body is summarised by status only).
// Tiingo data in a public log would be distribution (contract §5.3, §5.4.2).
// The key is read from the environment and never printed; GitHub masks it too.
//
// STORES NOTHING, MAKES NO REDIS COMMANDS. It runs in relay.yml's `tiingo`
// job, which holds TIINGO_API_KEY and nothing else. The universe comes in
// through SYMBOLS (from the write-universe-tickers task), because this job
// cannot read Redis.
//
// REQUEST BUDGET, stated up front: 1 bulk + 1 per-ticker history (field
// names) + 2 limit probes + 1 per universe ticker (metadata) + 2 per search
// sample (50 samples). About 1,150 for a ~1,000-ticker universe, against
// 300,000/day and 20,000/hour. supported_tickers.zip is a public file.
//
//   relay task: tiingo-verify   (SYMBOLS=comma list; SEARCH_N optional)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { toDashed } from "../lib/symbolSpellings.mjs";

const KEY = process.env.TIINGO_API_KEY ?? "";
if (!KEY) {
  console.error("FATAL: TIINGO_API_KEY is not set in this job. Refusing (nothing was requested).");
  process.exit(2);
}
const API = "https://api.tiingo.com";
const HEADERS = { Authorization: `Token ${KEY}`, "Content-Type": "application/json" };
let requests = 0;
const now = () => performance.now();

/** One Tiingo request. Returns status, headers, timing and the body for LOCAL use only. */
async function get(pathAndQuery, { text = false } = {}) {
  requests++;
  const t0 = now();
  try {
    const res = await fetch(`${API}${pathAndQuery}`, { headers: HEADERS });
    const body = text ? await res.text() : await res.text().then((t) => { try { return JSON.parse(t); } catch { return null; } });
    return { status: res.status, headers: res.headers, ms: Math.round(now() - t0), body };
  } catch (err) {
    return { status: 0, headers: new Headers(), ms: Math.round(now() - t0), body: null, error: String(err?.name ?? "fetch-error") };
  }
}

/** Header NAMES that look like limits, with their values (counts, not data). */
function limitHeaders(h) {
  const out = [];
  for (const [k, v] of h.entries()) if (/rate|limit|quota|remaining|usage|reset|retry/i.test(k)) out.push(`${k}=${v}`);
  return out.length ? out.join("; ") : "(none)";
}

/** Split one CSV line (quoted fields allowed). Used for headers and local counting only. */
function csvFields(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const tiingoSpelling = toDashed;
const universe = [...new Set((process.env.SYMBOLS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const REG = read("data/sec/registrants.json").rows ?? {};
const NAMES = read("data/company-names.json").rows ?? {};

console.log(`universe from SYMBOLS: ${universe.length} tickers${universe.length ? "" : " (none given: sections 3, 4 and 6 are skipped)"}`);

// CAPPED RE-RUN (MODE=rerun, #553 COWORK #55 §1), after the plan upgrade:
// bulk status, latest EOD date on 3 tickers, limit headers, search hit rate on
// 20 names, one AAPL full-history call, one IEX batch quote. HARD CAP 60 requests; the first 429
// stops every further request. Same print rules: statuses, counts, dates,
// byte sizes and names of fields/headers only.
if (process.env.MODE === "rerun") {
  const CAP = 60;
  let stopped = null;
  const headerNames = new Set();
  const capped = async (p, opts) => {
    if (stopped) return { status: -1, headers: new Headers(), ms: 0, body: null };
    if (requests >= CAP) { stopped = `request cap ${CAP} reached`; return { status: -1, headers: new Headers(), ms: 0, body: null }; }
    const r = await get(p, opts);
    for (const k of r.headers.keys()) headerNames.add(k);
    if (r.status === 429) stopped = `HTTP 429 on request ${requests}`;
    return r;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log("\n=== R1. bulk endpoint ===");
  const bulk = await capped("/tiingo/daily/prices?format=csv", { text: true });
  if (bulk.status === 200 && typeof bulk.body === "string") {
    const lines = bulk.body.split(/\r?\n/).filter(Boolean);
    const h = csvFields(lines[0] ?? "");
    const iD = h.findIndex((f) => /^date$/i.test(f));
    const dates = new Map();
    for (const l of lines.slice(1)) { const d = iD >= 0 ? String(csvFields(l)[iD]).slice(0, 10) : "?"; dates.set(d, (dates.get(d) ?? 0) + 1); }
    console.log(`HTTP 200 in ${bulk.ms} ms; ${Buffer.byteLength(bulk.body)} bytes; ${lines.length - 1} rows; field names: ${h.join(", ")}; latest date: ${[...dates.keys()].sort().pop()}`);
  } else {
    const hint = typeof bulk.body === "string" && /power/i.test(bulk.body) ? " (body mentions a Power plan; body not printed)" : " (body not printed)";
    console.log(`HTTP ${bulk.status} in ${bulk.ms} ms${hint}`);
  }
  console.log(`limit-like headers on the bulk call: ${limitHeaders(bulk.headers)}`);

  console.log("\n=== R2. freshness: latest EOD date, 3 tickers (JSON) ===");
  for (const t of ["AAPL", "MSFT", "BRK-B"]) {
    const r = await capped(`/tiingo/daily/${t}/prices?startDate=2026-09-15`);
    const rows = Array.isArray(r.body) ? r.body : [];
    const last = rows.length ? String(rows[rows.length - 1]?.date ?? "").slice(0, 10) : "";
    const shape = Array.isArray(r.body) ? `array of ${rows.length}` : r.body === null ? "unparsed" : typeof r.body;
    console.log(`${t}: HTTP ${r.status} in ${r.ms} ms; body ${shape}; row field names: ${rows[0] ? Object.keys(rows[0]).join(", ") : "(none)"}; latest date: ${last || "(none)"}`);
  }
  console.log(`run at ${new Date().toISOString()}`);

  console.log("\n=== R3. provisioned-limit headers ===");
  const test = await capped("/api/test");
  console.log(`/api/test: HTTP ${test.status}; limit-like headers: ${limitHeaders(test.headers)}`);

  console.log("\n=== R4. search, 20 names (hit rate only) ===");
  const cleanName = (n) => String(n).replace(/\s+-\s+.*$/, "").replace(/\b(Common Stock|Ordinary Shares|American Depositary Shares?|Class [A-Z]|Inc\.?|Corporation|Corp\.?|Ltd\.?|plc|N\.V\.|S\.A\.)\b/gi, " ").replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  const withName = universe.filter((s) => NAMES[s]);
  const step = Math.max(1, Math.floor(withName.length / 20));
  const sample = withName.filter((_, i) => i % step === 0).slice(0, 20);
  const st = new Map();
  let first = 0, top5 = 0, asked = 0;
  for (const s of sample) {
    const r = await capped(`/tiingo/utilities/search?query=${encodeURIComponent(cleanName(NAMES[s]))}`);
    if (r.status === -1) break;
    asked++;
    st.set(r.status, (st.get(r.status) ?? 0) + 1);
    const got = Array.isArray(r.body) ? r.body.map((x) => String(x?.ticker ?? "").toUpperCase()) : [];
    const want = tiingoSpelling(s);
    if (got[0] === want) first++;
    if (got.slice(0, 5).includes(want)) top5++;
    await sleep(500);
  }
  console.log(`name queries: ${asked}/${sample.length}; statuses: ${[...st.entries()].map(([k, n]) => `${k}: ${n}`).join("; ") || "(none)"}; our ticker first: ${first}/${asked}; in top 5: ${top5}/${asked}`);

  console.log("\n=== R5. AAPL full history (csv) ===");
  const full = await capped("/tiingo/daily/AAPL/prices?startDate=1970-01-01&format=csv", { text: true });
  if (full.status === 200 && typeof full.body === "string") {
    const lines = full.body.split(/\r?\n/).filter(Boolean);
    const h = csvFields(lines[0] ?? "");
    const iD = h.findIndex((f) => /^date$/i.test(f));
    const firstDate = iD >= 0 ? String(csvFields(lines[1] ?? "")[iD] ?? "").slice(0, 10) : "(no date column)";
    const lastDate = iD >= 0 ? String(csvFields(lines[lines.length - 1] ?? "")[iD] ?? "").slice(0, 10) : "(no date column)";
    console.log(`HTTP 200 in ${full.ms} ms; ${Buffer.byteLength(full.body)} bytes; ${lines.length - 1} rows; first date ${firstDate}; last date ${lastDate}; field names: ${h.join(", ")}`);
  } else {
    console.log(`HTTP ${full.status} in ${full.ms} ms (body not printed)`);
  }

  console.log("\n=== R6. IEX batch quotes (the hourly job's call), one request for every SYMBOLS ticker ===");
  const iexList = universe.map(tiingoSpelling);
  const iex = await capped(`/iex/?tickers=${encodeURIComponent(iexList.join(","))}`);
  if (iex.status === 200 && Array.isArray(iex.body)) {
    const got = new Set(iex.body.map((x) => String(x?.ticker ?? "").toUpperCase()));
    const stamps = iex.body.map((x) => String(x?.timestamp ?? "")).filter(Boolean).sort();
    console.log(`HTTP 200 in ${iex.ms} ms; asked ${iexList.length}, rows ${iex.body.length}, matched ${iexList.filter((t) => got.has(t)).length}; field names: ${iex.body[0] ? Object.keys(iex.body[0]).join(", ") : "(none)"}; newest timestamp: ${stamps.pop() ?? "(none)"}`);
  } else {
    console.log(`HTTP ${iex.status} in ${iex.ms} ms (body not printed)`);
  }
  console.log(`limit-like headers on the IEX call: ${limitHeaders(iex.headers)}`);

  console.log(`\nall response header names seen: ${[...headerNames].sort().join(", ")}`);
  console.log(`stopped early: ${stopped ?? "no"}`);
  console.log(`Tiingo requests used: ${requests} (cap ${CAP}); Redis commands: 0; stored: nothing`);
  process.exit(0);
}

// FOLLOW-UP MODE (MODE=followup): the questions the first run left open --
// what the search failures were, whether per-ticker price calls hold up across
// many symbols, and the latest EOD date. About 60 requests, spaced out.
if (process.env.MODE === "followup") {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tally = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const fmtTally = (m) => [...m.entries()].map(([k, n]) => `${k}: ${n}`).join("; ");
  console.log("\n=== follow-up A: search statuses (10 samples x 2 queries, 1 s apart) ===");
  const sample = universe.filter((s) => NAMES[s]).filter((_, i) => i % 80 === 0).slice(0, 10);
  const st = new Map();
  let first429 = null;
  for (const s of sample) {
    for (const q of [tiingoSpelling(s), String(NAMES[s]).split(/\s+-\s+|,| Inc| Corp/)[0]]) {
      const r = await get(`/tiingo/utilities/search?query=${encodeURIComponent(q)}`);
      tally(st, r.status);
      if (r.status === 429 && !first429) first429 = [...r.headers.keys()].join(", ");
      await sleep(1000);
    }
  }
  console.log(`statuses: ${fmtTally(st)}${first429 ? `; header names on the first 429: ${first429}` : ""}`);
  console.log("\n=== follow-up B: per-ticker price calls, 30 universe tickers (statuses and latest date only) ===");
  const pst = new Map(), latest = new Map();
  const pick = universe.filter((_, i) => i % 28 === 0).slice(0, 30);
  for (const s of pick) {
    const r = await get(`/tiingo/daily/${encodeURIComponent(tiingoSpelling(s))}/prices?format=csv&startDate=2026-09-15`, { text: true });
    tally(pst, r.status);
    if (r.status === 200 && typeof r.body === "string") {
      const rows = r.body.split(/\r?\n/).filter(Boolean);
      const d = String(csvFields(rows[rows.length - 1] ?? "")[0] ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) tally(latest, d);
    }
    await sleep(200);
  }
  console.log(`statuses: ${fmtTally(pst)}; latest bar date (date: tickers): ${fmtTally(latest)}; run at ${new Date().toISOString()}`);
  console.log(`\nTiingo requests used: ${requests}; Redis commands: 0; stored: nothing`);
  process.exit(0);
}

// ── 2. PROVISIONED LIMITS (first, so the headers are from a clean window) ──
console.log("\n=== 2. provisioned limits ===");
const test = await get("/api/test");
console.log(`/api/test: HTTP ${test.status} in ${test.ms} ms; limit-like headers: ${limitHeaders(test.headers)}`);
for (const p of ["/account/usage", "/api/account/usage"]) {
  const r = await get(p);
  const fields = r.body && typeof r.body === "object" ? Object.keys(Array.isArray(r.body) ? r.body[0] ?? {} : r.body) : [];
  console.log(`${p}: HTTP ${r.status}; field names: ${fields.length ? fields.join(", ") : "(none)"}; limit-like headers: ${limitHeaders(r.headers)}`);
}

// ── 1 + 5. BULK ENDPOINT AND FRESHNESS ─────────────────────────────────────
console.log("\n=== 1. bulk endpoint, and 5. freshness ===");
const bulk = await get("/tiingo/daily/prices?format=csv", { text: true });
let bulkHeader = [];
let bulkTickers = new Set();
if (bulk.status === 200 && typeof bulk.body === "string") {
  const lines = bulk.body.split(/\r?\n/).filter(Boolean);
  bulkHeader = csvFields(lines[0] ?? "");
  const iDate = bulkHeader.findIndex((f) => /^date$/i.test(f));
  const iTicker = bulkHeader.findIndex((f) => /^ticker$/i.test(f));
  const dates = new Map();
  for (const l of lines.slice(1)) {
    const f = csvFields(l);
    const d = iDate >= 0 ? String(f[iDate]).slice(0, 10) : "?";
    dates.set(d, (dates.get(d) ?? 0) + 1);
    if (iTicker >= 0) bulkTickers.add(String(f[iTicker]).toUpperCase());
  }
  const byDate = [...dates.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`HTTP 200 in ${bulk.ms} ms; ${Buffer.byteLength(bulk.body)} bytes; ${lines.length - 1} rows; ${bulkTickers.size} distinct tickers`);
  console.log(`field names: ${bulkHeader.join(", ")}`);
  console.log(`dates covered (date: rows), top 5: ${byDate.slice(0, 5).map(([d, n]) => `${d}: ${n}`).join("; ")}`);
  console.log(`latest date in the bulk file: ${[...dates.keys()].sort().pop()} (run at ${new Date().toISOString()})`);
} else {
  console.log(`HTTP ${bulk.status} in ${bulk.ms} ms${bulk.error ? ` (${bulk.error})` : ""}; body not printed. The bulk call did NOT return a market file on this token.`);
}
console.log(`limit-like headers on the bulk call: ${limitHeaders(bulk.headers)}`);

// ── 7. ADJUSTED / UNADJUSTED FIELD NAMES, from one per-ticker history call ──
console.log("\n=== 7. adjusted and unadjusted columns ===");
const hist = await get("/tiingo/daily/AAPL/prices?format=csv&startDate=2026-09-01", { text: true });
const histHeader = hist.status === 200 && typeof hist.body === "string" ? csvFields(hist.body.split(/\r?\n/)[0] ?? "") : [];
console.log(`/tiingo/daily/AAPL/prices (csv): HTTP ${hist.status} in ${hist.ms} ms; field names: ${histHeader.join(", ") || "(none)"}`);
for (const [label, header] of [["per-ticker", histHeader], ["bulk", bulkHeader]]) {
  const has = (n) => header.some((f) => f.toLowerCase() === n.toLowerCase());
  const want = ["close", "adjClose", "open", "adjOpen", "high", "adjHigh", "low", "adjLow", "volume", "adjVolume", "divCash", "splitFactor"];
  if (header.length) console.log(`${label}: present ${want.filter(has).join(", ") || "none"}; missing ${want.filter((n) => !has(n)).join(", ") || "none"}`);
}

// ── 3 + 4. SYMBOL COVERAGE AND METADATA ─────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tiingo-"));
let supported = new Map();
console.log("\n=== 3. symbol coverage ===");
try {
  const t0 = now();
  const res = await fetch("https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip");
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(tmp, "st.zip"), buf);
  const csv = execFileSync("unzip", ["-p", path.join(tmp, "st.zip")], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const h = csvFields(lines[0]);
  const idx = (n) => h.findIndex((f) => f.toLowerCase() === n.toLowerCase());
  const [iT, iEx, iType, iEnd] = [idx("ticker"), idx("exchange"), idx("assetType"), idx("endDate")];
  for (const l of lines.slice(1)) {
    const f = csvFields(l);
    const t = String(f[iT] ?? "").toUpperCase();
    if (!t) continue;
    const row = { ex: f[iEx] ?? "", type: f[iType] ?? "", end: f[iEnd] ?? "" };
    const prev = supported.get(t);
    if (!prev || row.end > prev.end) supported.set(t, row);
  }
  console.log(`supported_tickers.zip: HTTP ${res.status}; ${buf.length} bytes zipped; ${lines.length - 1} rows; ${supported.size} distinct tickers; fields: ${h.join(", ")} (${Math.round(now() - t0)} ms)`);
} catch (err) {
  console.log(`supported_tickers.zip could not be read (${String(err?.name ?? err)}); coverage below uses the metadata endpoint only.`);
}

function classOf(sym) {
  const reg = REG[sym] ?? REG[toDashed(sym)] ?? null;
  if (/[.-]P[A-Z]?$|\.PR|-P-|\bPR[A-Z]?$/.test(sym) || /^[A-Z]+p[A-Z]*$/.test(sym)) return "preferred";
  if (/\.(U|UN|W|WS|WT|R|RT)$|-(U|UN|W|WS|WT|R|RT)$/.test(sym) || (/^[A-Z]{5}$/.test(sym) && /[UWR]$/.test(sym))) return "unit/warrant/right";
  if (/[.-][A-Z]$/.test(sym)) return "multi-class";
  if (/^(20-F|40-F)/.test(reg?.annualForm ?? "")) return "ADR/foreign filer";
  if (!reg) return "no SEC registrant row (often a recent listing)";
  return "other";
}

if (universe.length) {
  const today = new Date().toISOString().slice(0, 10);
  const staleCut = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  const inList = universe.filter((s) => supported.has(tiingoSpelling(s)));
  const activeInList = inList.filter((s) => (supported.get(tiingoSpelling(s)).end ?? "") >= staleCut);
  console.log(`in supported_tickers (after . -> -): ${inList.length}/${universe.length}; of those with an endDate within 10 days of ${today}: ${activeInList.length}`);
  if (bulkTickers.size) {
    const inBulk = universe.filter((s) => bulkTickers.has(tiingoSpelling(s)));
    console.log(`in the bulk file: ${inBulk.length}/${universe.length}`);
  }

  console.log("\n=== 4. metadata (/tiingo/daily/<t>), and coverage by the endpoint ===");
  let ok = 0, withName = 0, withEx = 0, statuses = new Map(), misses = [];
  const metaMs = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < universe.length; i += CONCURRENCY) {
    const chunk = universe.slice(i, i + CONCURRENCY);
    const rs = await Promise.all(chunk.map((s) => get(`/tiingo/daily/${encodeURIComponent(tiingoSpelling(s))}`)));
    rs.forEach((r, j) => {
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      metaMs.push(r.ms);
      if (r.status === 200 && r.body && typeof r.body === "object" && !Array.isArray(r.body)) {
        ok++;
        if (typeof r.body.name === "string" && r.body.name.trim()) withName++;
        if (typeof r.body.exchangeCode === "string" && r.body.exchangeCode.trim()) withEx++;
      } else {
        misses.push(chunk[j]);
      }
    });
    if (rs.some((r) => r.status === 429)) { console.log("HTTP 429 seen: stopping the metadata pass early."); break; }
  }
  metaMs.sort((a, b) => a - b);
  console.log(`statuses: ${[...statuses.entries()].map(([s, n]) => `${s}: ${n}`).join("; ")}; median ${metaMs[Math.floor(metaMs.length / 2)] ?? "?"} ms`);
  console.log(`200 with metadata: ${ok}/${universe.length}; usable name: ${withName}; exchangeCode: ${withEx}`);
  const symdir = misses.filter((s) => NAMES[s]).length;
  console.log(`would need the Nasdaq symdir fallback for a name: ${universe.length - withName} (of the ${misses.length} misses, ${symdir} have a symdir name already committed)`);
  const byClass = new Map();
  for (const s of misses) byClass.set(classOf(s), [...(byClass.get(classOf(s)) ?? []), s]);
  console.log(`misses: ${misses.length}`);
  for (const [c, list] of [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${c} (${list.length}): ${list.join(", ")}`);

  // ── 6. SEARCH ─────────────────────────────────────────────────────────────
  console.log("\n=== 6. search (/tiingo/utilities/search) ===");
  const N = Math.max(1, Number(process.env.SEARCH_N ?? 50));
  const step = Math.max(1, Math.floor(universe.length / N));
  const sample = universe.filter((_, i) => i % step === 0).filter((s) => NAMES[s]).slice(0, N);
  const cleanName = (n) => String(n).replace(/\s+-\s+.*$/, "").replace(/\b(Common Stock|Ordinary Shares|American Depositary Shares?|Class [A-Z]|Inc\.?|Corporation|Corp\.?|Ltd\.?|plc|N\.V\.|S\.A\.)\b/gi, " ").replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  let prefix1 = 0, prefix5 = 0, name1 = 0, name5 = 0, errs = 0;
  for (const s of sample) {
    const want = tiingoSpelling(s);
    const tickersOf = (r) => (Array.isArray(r.body) ? r.body.map((x) => String(x?.ticker ?? "").toUpperCase()) : []);
    const a = await get(`/tiingo/utilities/search?query=${encodeURIComponent(want)}`);
    const b = await get(`/tiingo/utilities/search?query=${encodeURIComponent(cleanName(NAMES[s]))}`);
    if (a.status !== 200 || b.status !== 200) errs++;
    const ta = tickersOf(a), tb = tickersOf(b);
    if (ta[0] === want) prefix1++;
    if (ta.slice(0, 5).includes(want)) prefix5++;
    if (tb[0] === want) name1++;
    if (tb.slice(0, 5).includes(want)) name5++;
  }
  console.log(`sample: ${sample.length} universe tickers with a committed symdir name (every ${step}th); non-200 pairs: ${errs}`);
  console.log(`ticker query -> our ticker first: ${prefix1}/${sample.length}; in top 5: ${prefix5}/${sample.length}`);
  console.log(`name query   -> our ticker first: ${name1}/${sample.length}; in top 5: ${name5}/${sample.length}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nTiingo requests used: ${requests} (of 300,000/day, 20,000/hour); Redis commands: 0; stored: nothing`);
