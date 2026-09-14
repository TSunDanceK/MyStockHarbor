// WHICH SYMBOLS THE TWO VENUE SOURCES CLASSIFY DIFFERENTLY, AND WHAT THAT DOES
// TO THE 62.5% FIGURE.
//
// THE FINDING THIS EXISTS TO SETTLE. Two counts of the same universe's listing
// venue do not agree:
//
//     manifest (live, 2026-09-14)   NYSE 476   Nasdaq 216   unknown 4      [696]
//     #448 / listing-split.mjs      NYSE 466*  Nasdaq 230   UNRESOLVED 4   [700]
//                                   * 463 + 3 counted "NYSE (SEC only)"
//
// (An earlier version of this header said #448's universe was 693. That was
// wrong: it added only the NYSE and Nasdaq rows and dropped the UNRESOLVED and
// SEC-only ones. #448's own headline is "The 700 is a third Nasdaq by count".
// The live manifest is therefore SMALLER than the dump, not larger.)
//
// Nasdaq is 14 lower and NYSE 13 higher than the figure the 32.9%-by-count /
// 62.5%-by-dollar-volume licensing case rests on. TOTALS THAT DISAGREE DO NOT
// SAY WHICH ONE IS WRONG -- they do not even say whether the disagreement is
// about classification at all, since the two runs also cover different symbol
// counts. Only a per-symbol diff separates those, so that is what this emits.
//
// THE TWO SOURCES ARE GENUINELY DIFFERENT, WHICH IS THE POINT.
//
//   * listing-split.mjs (#448) resolves venue from Nasdaq's own
//     nasdaqtraded.txt "Listing Exchange" code FIRST -- Q/N/A/P/Z/V -- and only
//     falls back to SEC when that file has no row. Its Nasdaq count is
//     therefore "Listing Exchange == Q".
//   * The manifest stores SEC's `exchange` column VERBATIM, straight out of
//     company_tickers_exchange.json via parseTickerFile -> reconcileExchanges.
//     Nothing normalises it, collapses it, or prefers another source.
//
// So a symbol can be counted Nasdaq by one and NYSE by the other with neither
// file being corrupt. Which is right is a question about the FILES, and the
// only way to answer it is to name the symbols and print both raw values.
//
// WHY IT RUNS ON A RUNNER. The agent sandbox is refused www.nasdaqtrader.com
// and www.sec.gov with 403 CONNECT, and both reference files are the thing
// being compared. Read-only: no credential, no Redis, no write- prefix.
//
// WHAT IT DOES NOT DO. It does not decide which source is correct. It produces
// the per-symbol evidence and quantifies the swing; picking a source of record
// is a decision, and one that has to be made knowing the size of the effect.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { lookupBySpelling } from "./lib/symbol-spellings.mjs";

const DIR = path.resolve(process.argv[2] ?? "step0-dump");
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; listing-venue reconciliation)";
const SESSIONS = Number(process.env.DV_SESSIONS ?? 60);

// ── SELF-TEST ────────────────────────────────────────────────────────────────
// Runs with --selftest: no network, no dump. It exists because the defect this
// guards against is SILENT -- a coverage gap counted as a classification
// difference produces a plausible number, not an error, and the whole report is
// an argument about a number. Driven through the real computeHeadline; a
// reimplementation of the arithmetic could not be evidence about the arithmetic.
if (process.argv.includes("--selftest")) {
  const mk = (symbol, nas, sec, dv) => ({
    symbol,
    dollarVolume: dv,
    nasdaqtraded: { code: null, venue: nas, matchedAs: null },
    sec: { exchange: sec, matchedAs: null },
    agreement: nas == null || sec == null ? "not-comparable" : norm(nas) === norm(sec) ? "agree" : "conflict",
    nasdaqBoundary:
      nas == null || sec == null
        ? "not-comparable"
        : (norm(nas) === "NASDAQ") === (norm(sec) === "NASDAQ")
          ? "agree"
          : "conflict",
  });
  // Three symbols both files cover, plus ONE that only SEC has a row for and
  // which SEC calls Nasdaq. That last row is the defect's exact shape: without
  // the comparable-set restriction it makes nasdaqtraded look like it
  // classified a Nasdaq name as something else.
  const fixture = [
    mk("AAA", "Nasdaq", "Nasdaq", 100),
    mk("BBB", "NYSE", "NYSE", 100),
    mk("CCC", "NYSE", "Nasdaq", 100), // a genuine conflict
    mk("DDD", null, "Nasdaq", 700), // coverage gap, and the heaviest row
  ];
  const cmp = fixture.filter((r) => r.nasdaqBoundary !== "not-comparable");
  const h = computeHeadline(fixture, cmp);
  let failed = 0;
  const check = (name, ok, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed++;
  };
  console.log("listing-venue-diff self-test");
  check("the comparable set excludes the coverage gap", h.comparableRows === 3 && h.excludedFromHeadline === 1);
  check(
    "...and the exclusion is reported BY WEIGHT, not just by count",
    Math.abs(h.excludedDollarVolumeShare - 70) < 1e-9,
    `${h.excludedDollarVolumeShare}% — one of four symbols, but 70% of the dollar volume`
  );
  check(
    "the comparable headline sees ONLY the genuine conflict",
    h.comparableSet.nasdaqtraded.count === 1 && h.comparableSet.sec.count === 2,
    `nasdaqtraded ${h.comparableSet.nasdaqtraded.count}, sec ${h.comparableSet.sec.count}`
  );
  check(
    "...with the comparable set as the denominator for pctCount too",
    Math.abs(h.comparableSet.nasdaqtraded.pctCount - 100 / 3) < 1e-9,
    "rows.length would have given 25%, which is the same defect in the count column"
  );
  check(
    "...and for pctDv",
    Math.abs(h.comparableSet.sec.pctDv - (200 / 300) * 100) < 1e-9,
    `${h.comparableSet.sec.pctDv.toFixed(1)}% of the comparable set's dollar volume`
  );
  // The all-rows line is kept precisely so this divergence is visible.
  check(
    "the all-rows line still counts the missing row as not-Nasdaq",
    h.allRowsSet.nasdaqtraded.count === 1 && h.allRowsSet.sec.count === 3,
    "this is the misleading view, retained and labelled rather than deleted"
  );
  check(
    "...so the two blocks DIVERGE, which is what makes the gap visible",
    Math.abs(h.comparableSet.sec.pctDv - h.allRowsSet.sec.pctDv) > 0.1,
    `${h.comparableSet.sec.pctDv.toFixed(1)}% comparable vs ${h.allRowsSet.sec.pctDv.toFixed(1)}% all-rows`
  );
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

// Same codes, same tape assignment as listing-split.mjs. Duplicated rather than
// imported because this script must reproduce #448's classification EXACTLY as
// #448 made it; sharing a table would let a later edit silently change what the
// "#448 side" of the diff means.
const VENUE = {
  Q: "Nasdaq",
  N: "NYSE",
  A: "NYSE American",
  P: "NYSE Arca",
  Z: "Cboe BZX",
  V: "IEX",
};

const fetchText = async (url, label) => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const text = await res.text();
  // A 200 CARRYING HTML IS NOT DATA. Same strictness that caught stooq.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(`${label}: got HTML, not data — "${text.slice(0, 160).replace(/\s+/g, " ")}"`);
  }
  return text;
};

console.log("LISTING VENUE DIFF — nasdaqtraded.txt (#448) vs SEC exchange column (manifest)");

// ── DUMP PROVENANCE, PRINTED FIRST AND BEFORE ANY FINDING ────────────────────
//
// WHICH DUMP THIS RAN AGAINST IS PART OF THE ANSWER, NOT METADATA. A stale dump
// does not fabricate a classification disagreement -- both reference files are
// fetched LIVE here, so the venue comparison itself is live-vs-live -- but it
// makes two other things stale, and both feed the headline:
//
//   * THE UNIVERSE. An old symbol list is an old denominator. Section 1's
//     counts, and every percentage built on them, describe whatever set the
//     dump froze.
//   * THE DOLLAR-VOLUME WEIGHTS. Section 3 prices the swing from bars in the
//     dump. Old bars price it wrongly, and that is the number the licensing
//     case turns on.
//
// So provenance goes at the TOP, where it is read before the table rather than
// looked up afterwards to explain a surprise.
const provenance = (() => {
  // The run id is authoritative when relay.yml forwards it. It is NOT relied
  // on: the env var is a recent addition, and a diff that silently loses its
  // provenance when dispatched from an older workflow ref would be worse than
  // one that derives it. So the dump's own file times are read either way.
  const runId = process.env.DUMP_RUN_ID || null;
  const artifact = process.env.DUMP_ARTIFACT || null;
  let newest = null;
  let oldest = null;
  try {
    for (const name of fs.readdirSync(DIR)) {
      const st = fs.statSync(path.join(DIR, name));
      if (!st.isFile()) continue;
      const t = st.mtimeMs;
      if (newest === null || t > newest) newest = t;
      if (oldest === null || t < oldest) oldest = t;
    }
  } catch {
    // an unreadable dump dir fails loudly later, at the universe read
  }
  // A declared timestamp inside the payload beats a file mtime, which a zip
  // round trip can flatten. Whichever exists is reported; both if both do.
  let declared = null;
  try {
    const u = JSON.parse(fs.readFileSync(path.join(DIR, "universe.json"), "utf8"));
    declared = u?.generatedAt ?? u?.capturedAt ?? u?._meta?.generatedAt ?? null;
  } catch {
    /* reported as absent below */
  }
  const basis = declared ? Date.parse(declared) : newest;
  const ageDays = Number.isFinite(basis) && basis ? (Date.now() - basis) / 86_400_000 : null;
  return { runId, artifact, declared, newestMtime: newest, oldestMtime: oldest, ageDays };
})();

const iso = (ms) => (Number.isFinite(ms) && ms ? new Date(ms).toISOString() : "unknown");
console.log(`\n  DUMP PROVENANCE`);
console.log(`    directory        ${DIR}`);
console.log(`    run id           ${provenance.runId ?? "NOT FORWARDED (env DUMP_RUN_ID unset) — see file times below"}`);
console.log(`    artifact         ${provenance.artifact ?? "(not forwarded)"}`);
console.log(`    declared time    ${provenance.declared ?? "(none in universe.json)"}`);
console.log(`    file times       ${iso(provenance.oldestMtime)} .. ${iso(provenance.newestMtime)}`);
console.log(
  `    age              ${provenance.ageDays === null ? "UNDETERMINED" : `${provenance.ageDays.toFixed(1)} days`}`
);
const STALE_DAYS = Number(process.env.STALE_DAYS ?? 14);
if (provenance.ageDays === null) {
  console.log(
    `    ⚠ AGE UNDETERMINED. Neither a declared timestamp nor usable file times.\n` +
      `      Treat sections 1 and 3 as describing an unknown vintage of the universe.`
  );
} else if (provenance.ageDays > STALE_DAYS) {
  console.log(
    `    ⚠⚠ THIS DUMP IS OLDER THAN ${STALE_DAYS} DAYS. The venue comparison below is\n` +
      `        still live-vs-live and stands, but the UNIVERSE and the DOLLAR-VOLUME\n` +
      `        WEIGHTS are of that vintage. Do not quote section 3's percentages from\n` +
      `        a stale dump — re-freeze first.`
  );
}

// ── The universe ─────────────────────────────────────────────────────────────
//
// SYMBOLS overrides the frozen dump. The manifest's universe is read live from
// Redis (readDynamicUniverse) and stood at 696 today; the frozen dump is 693.
// Supplying the live list is what closes the membership component of the delta.
// Without it, the diff is still exact -- it is just computed over the frozen
// set, and the membership residual is reported as UNACCOUNTED rather than
// guessed at.
let analysis;
let universeSource;
const supplied = (process.env.SYMBOLS ?? "").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase());
if (supplied.length) {
  analysis = [...new Set(supplied)];
  universeSource = `SYMBOLS env (${analysis.length} symbols) — the live manifest universe`;
} else {
  const p = path.join(DIR, "universe.json");
  if (!fs.existsSync(p)) {
    console.error(`FATAL: no universe.json in ${DIR} and no SYMBOLS given — nothing to classify.`);
    process.exit(2);
  }
  analysis = [...new Set((JSON.parse(fs.readFileSync(p, "utf8"))?.pickersSymbolsKey ?? []).map(String))];
  universeSource = `${DIR}/universe.json pickersSymbolsKey (${analysis.length} symbols) — FROZEN, the #448 denominator`;
}
if (!analysis.length) {
  console.error("FATAL: empty universe. Refusing to report a diff over nothing.");
  process.exit(2);
}
console.log(`universe: ${universeSource}`);

// ── Source 1: nasdaqtraded.txt, exactly as #448 read it ──────────────────────
const venueBySymbol = new Map();
let nasdaqFileOk = false;
try {
  const txt = await fetchText(
    "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt",
    "nasdaqtraded.txt"
  );
  const lines = txt.split("\n").filter((l) => l.includes("|"));
  const header = lines[0].split("|");
  const iSym = header.indexOf("Symbol");
  const iEx = header.indexOf("Listing Exchange");
  if (iSym === -1 || iEx === -1) {
    throw new Error(`columns read by NAME and one is missing (header: ${header.join(",")})`);
  }
  for (const line of lines.slice(1)) {
    if (line.startsWith("File Creation Time")) continue;
    const cols = line.split("|");
    const sym = (cols[iSym] ?? "").trim();
    const code = (cols[iEx] ?? "").trim();
    if (sym && code) venueBySymbol.set(sym, code);
  }
  nasdaqFileOk = venueBySymbol.size > 1000;
  console.log(`nasdaqtraded.txt: ${venueBySymbol.size} rows`);
} catch (e) {
  console.log(`nasdaqtraded.txt UNREACHABLE: ${String(e?.message ?? e)}`);
}

// ── Source 2: SEC's exchange column, through the SHIPPED parser ──────────────
//
// parseTickerFile is LIFTED FROM lib/server/secTickerMap.ts rather than
// reimplemented. A reimplementation of the parser could not be evidence about
// what the parser stores, and "the manifest side of this diff" means precisely
// "whatever that function returns". It reads its columns by name, so a column
// insertion moves this script and the pipeline together or neither.
const secVenue = new Map();
let secFileOk = false;
let parseShape = null;
try {
  const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
  const mod = await lift(
    [grabFunction(tickerSrc, "padCik"), grabFunction(tickerSrc, "parseTickerFile")].join("\n") +
      "\nexport { parseTickerFile };"
  );
  const txt = await fetchText(
    "https://www.sec.gov/files/company_tickers_exchange.json",
    "company_tickers_exchange.json"
  );
  const { map, shape } = mod.parseTickerFile(txt);
  parseShape = shape;
  for (const [t, entry] of map) secVenue.set(t, entry.exchange ?? null);
  secFileOk = secVenue.size > 1000;
  console.log(`company_tickers_exchange.json: ${secVenue.size} tickers, shape "${shape}"`);
  if (shape !== "fields+data") {
    console.log(
      `  ⚠ the LEGACY shape has NO exchange column — every SEC venue below would be null, ` +
        `which is not a finding about venue, it is a finding about the file.`
    );
  }
} catch (e) {
  console.log(`company_tickers_exchange.json UNREACHABLE: ${String(e?.message ?? e)}`);
}

if (!nasdaqFileOk || !secFileOk) {
  console.error(
    "FATAL: a DIFF needs BOTH sides. One reference file is unusable, and reporting " +
      "one side alone is how a single unverifiable file became the disputed number " +
      "in the first place."
  );
  process.exit(2);
}

// ── Dollar volume, so the diff can be priced ─────────────────────────────────
// The disputed figure is 62.5% BY DOLLAR VOLUME, not by count. Fourteen symbols
// could move it by a rounding error or by twenty points depending entirely on
// WHICH fourteen, so every disagreeing symbol is reported with its weight.
const dollarVol = new Map();
{
  const barsPath = path.join(DIR, "history-bars.ndjson.gz");
  if (!fs.existsSync(barsPath)) {
    console.error(`FATAL: no history-bars.ndjson.gz in ${DIR} — the count diff alone cannot price the swing.`);
    process.exit(2);
  }
  const want = new Set(analysis);
  const rl = readline.createInterface({
    input: fs.createReadStream(barsPath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row?._meta || !row?.symbol) continue;
      const sym = String(row.symbol);
      if (!want.has(sym)) continue;
      const daily = (Array.isArray(row?.entry?.daily) ? row.entry.daily : []).slice(-SESSIONS);
      const vals = daily
        .filter((b) => typeof b?.close === "number" && typeof b?.volume === "number" && b.volume > 0)
        .map((b) => b.close * b.volume);
      if (vals.length) dollarVol.set(sym, vals.reduce((a, b) => a + b, 0) / vals.length);
    } catch {
      // a truncated final line is not worth failing the analysis over
    }
  }
}
console.log(`dollar volume: ${dollarVol.size} of ${analysis.length} symbols have ${SESSIONS}-session data`);

// ── The per-symbol table ─────────────────────────────────────────────────────
//
// THE SPELLING PROBLEM, and it is now handled in ONE place. The universe stores
// BRK.B, the reference files use the dashed form, and Nasdaq Trader writes
// suffixed preferreds with a DOLLAR sign (BAC$K). This file previously carried
// its own copy of a dot/dash `alts()` -- the second of three -- and none of them
// knew about "$". See scripts/lib/symbol-spellings.mjs.
const lookup = (m, sym) => lookupBySpelling(m, sym);
// Compared on a normalised key so "NYSE American" and "NYSEAmerican" are not
// reported as a disagreement about venue when they are a disagreement about
// punctuation. The RAW pair is printed either way -- the normalisation decides
// what gets called a finding, never what gets shown.
// A function declaration, not a const arrow: the self-test at the top of this
// file uses it, and must run before any network call or dump read.
function norm(v) {
  return v == null ? null : String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const rows = [];
for (const sym of analysis) {
  const nq = lookup(venueBySymbol, sym);
  const sc = lookup(secVenue, sym);
  const nasdaqSide = nq ? (VENUE[nq.value] ?? `other (${nq.value})`) : null;
  const secSide = sc ? sc.value : null;
  rows.push({
    symbol: sym,
    dollarVolume: dollarVol.get(sym) ?? null,
    nasdaqtraded: { code: nq?.value ?? null, venue: nasdaqSide, matchedAs: nq?.matched ?? null },
    sec: { exchange: secSide, matchedAs: sc?.matched ?? null },
    // Both present and normalised-equal / unequal; either absent is a COVERAGE
    // gap, which is a different fact and is never folded in with a conflict.
    agreement:
      nasdaqSide == null || secSide == null
        ? "not-comparable"
        : norm(nasdaqSide) === norm(secSide)
          ? "agree"
          : "conflict",
    // The decision-relevant boundary is Nasdaq vs everything else -- that is
    // what the 62.5% is a share OF. A Q/N flip matters to it; an
    // Arca-vs-American flip does not.
    nasdaqBoundary:
      nasdaqSide == null || secSide == null
        ? "not-comparable"
        : (norm(nasdaqSide) === "NASDAQ") === (norm(secSide) === "NASDAQ")
          ? "agree"
          : "conflict",
  });
}

const conflicts = rows.filter((r) => r.agreement === "conflict");
const boundaryConflicts = rows.filter((r) => r.nasdaqBoundary === "conflict");
const notComparable = rows.filter((r) => r.agreement === "not-comparable");

const histogram = (pick) => {
  const h = new Map();
  for (const r of rows) {
    const v = pick(r) ?? "(none)";
    h.set(v, (h.get(v) ?? 0) + 1);
  }
  return [...h.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`\n── 1. THE SAME ${analysis.length} SYMBOLS, COUNTED BY EACH SOURCE ──`);
console.log("\n  nasdaqtraded.txt Listing Exchange (the #448 side):");
for (const [v, c] of histogram((r) => r.nasdaqtraded.venue)) console.log(`    ${String(c).padStart(4)}  ${v}`);
console.log("\n  SEC exchange column, verbatim (the manifest side):");
for (const [v, c] of histogram((r) => r.sec.exchange)) console.log(`    ${String(c).padStart(4)}  ${v}`);
console.log(
  "\n  Both columns are over ONE symbol set, so membership is NOT a factor in the\n" +
    "  difference between them. It is classification OR COVERAGE -- a file with no\n" +
    "  row for a symbol contributes nothing to its own column, which looks exactly\n" +
    "  like classifying it as something else. Section 4 says which, per symbol, and\n" +
    "  section 3 reports the headline both ways so the gap cannot hide inside it."
);

console.log(`\n── 2. EVERY SYMBOL THE TWO SOURCES CLASSIFY DIFFERENTLY (${conflicts.length}) ──`);
if (!conflicts.length) {
  console.log("  none — the two files agree on every symbol both cover.");
} else {
  const totalDv = rows.reduce((a, r) => a + (r.dollarVolume ?? 0), 0);
  console.log("\n    SYMBOL     nasdaqtraded        SEC                 $vol share   moves 62.5%?");
  for (const r of conflicts.sort((a, b) => (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0))) {
    const share = totalDv ? ((r.dollarVolume ?? 0) / totalDv) * 100 : 0;
    console.log(
      `    ${r.symbol.padEnd(10)} ${String(`${r.nasdaqtraded.venue} (${r.nasdaqtraded.code})`).padEnd(19)} ` +
        `${String(r.sec.exchange).padEnd(19)} ${share.toFixed(3).padStart(8)}%   ` +
        `${r.nasdaqBoundary === "conflict" ? "YES" : "no"}`
    );
  }
}

// ── 3. What the headline figure becomes under each source ────────────────────
//
// COMPUTED OVER THE COMPARABLE SET, AND THAT IS THE WHOLE POINT.
//
// The Nasdaq test is `norm(venue) === "NASDAQ"`, and norm(null) is null. So a
// symbol one file has NO ROW for is silently counted as NOT Nasdaq on that
// file's side -- and a COVERAGE GAP then prints as a source disagreement. If
// nasdaqtraded.txt lacks rows for symbols SEC calls Nasdaq, the #448 side
// undercounts Nasdaq by absence and this section would report it as
// misclassification. That is a version of exactly the error this script exists
// to stop, committed by the script itself.
//
// So the headline is computed over rows where BOTH sources have an opinion, with
// that set as the denominator for the count percentage too -- rows.length would
// carry the same defect into pctCount.
//
// BOTH NUMBERS ARE KEPT, never one. The all-rows line is printed beside it,
// labelled, so the DIFFERENCE BETWEEN THE TWO LINES is itself visible: if they
// diverge, the coverage gap is material and the reader learns that before
// quoting either. And the exclusion is reported by dollar-volume share as well
// as by count, because "6 symbols excluded, 0.02% of dollar volume" and "6
// symbols excluded, 11% of dollar volume" call for completely different
// responses and the count alone cannot tell them apart.
function computeHeadline(rows, comparable) {
  const totalOf = (set) => set.reduce((a, r) => a + (r.dollarVolume ?? 0), 0);
  const allDv = totalOf(rows);
  const cmpDv = totalOf(comparable);
  const side = (set, setDv, pick) => {
    const isNas = (r) => norm(pick(r)) === "NASDAQ";
    const hit = set.filter(isNas);
    const dv = totalOf(hit);
    return {
      count: hit.length,
      pctCount: set.length ? (hit.length / set.length) * 100 : 0,
      pctDv: setDv ? (dv / setDv) * 100 : 0,
    };
  };
  const excludedDv = allDv - cmpDv;
  return {
    comparableRows: comparable.length,
    allRows: rows.length,
    excludedFromHeadline: rows.length - comparable.length,
    excludedDollarVolumeShare: allDv ? (excludedDv / allDv) * 100 : 0,
    comparableSet: {
      nasdaqtraded: side(comparable, cmpDv, (r) => r.nasdaqtraded.venue),
      sec: side(comparable, cmpDv, (r) => r.sec.exchange),
    },
    allRowsSet: {
      nasdaqtraded: side(rows, allDv, (r) => r.nasdaqtraded.venue),
      sec: side(rows, allDv, (r) => r.sec.exchange),
    },
  };
}


const comparable = rows.filter((r) => r.nasdaqBoundary !== "not-comparable");
const headline = computeHeadline(rows, comparable);

console.log(`\n── 3. WHAT THE HEADLINE FIGURE BECOMES UNDER EACH SOURCE ──`);
{
  const line = (label, v) =>
    `    ${label.padEnd(34)}${String(v.count).padStart(12)}   ${v.pctCount.toFixed(1).padStart(7)}%   ${v.pctDv.toFixed(1).padStart(15)}%`;
  const h = headline;

  console.log(
    `\n  COMPARABLE SET — ${h.comparableRows} symbols both files have a row for. ` +
      `THIS IS THE FIGURE TO QUOTE.`
  );
  console.log(`\n    source                          Nasdaq count   by count   BY DOLLAR VOLUME`);
  console.log(line("nasdaqtraded.txt (#448)", h.comparableSet.nasdaqtraded));
  console.log(line("SEC exchange (manifest)", h.comparableSet.sec));
  {
    const a = h.comparableSet.nasdaqtraded;
    const b = h.comparableSet.sec;
    console.log(
      `\n    swing: ${(b.count - a.count >= 0 ? "+" : "") + (b.count - a.count)} symbols, ` +
        `${(b.pctDv - a.pctDv >= 0 ? "+" : "") + (b.pctDv - a.pctDv).toFixed(1)} points of dollar volume.`
    );
    console.log(
      a.pctDv.toFixed(1) === b.pctDv.toFixed(1)
        ? "    >>> THE HEADLINE FIGURE IS UNCHANGED by the disagreement. The count\n" +
          "        dispute is real but it does not reach the number the case rests on."
        : "    >>> THE HEADLINE FIGURE MOVES. Neither number should be quoted until a\n" +
          "        source of record is chosen, and the choice must be recorded."
    );
  }

  console.log(
    `\n  ALL ROWS — ${h.allRows} symbols, INCLUDING those one file has no row for.\n` +
      `  A missing row counts as not-Nasdaq on that file's side, so this line mixes\n` +
      `  coverage into classification. Shown for comparison, not for quoting.`
  );
  console.log(`\n    source                          Nasdaq count   by count   BY DOLLAR VOLUME`);
  console.log(line("nasdaqtraded.txt (#448)", h.allRowsSet.nasdaqtraded));
  console.log(line("SEC exchange (manifest)", h.allRowsSet.sec));

  console.log(
    `\n  EXCLUDED FROM THE HEADLINE: ${h.excludedFromHeadline} symbol(s), ` +
      `${h.excludedDollarVolumeShare.toFixed(3)}% of dollar volume.`
  );
  const moved = Math.max(
    Math.abs(h.comparableSet.nasdaqtraded.pctDv - h.allRowsSet.nasdaqtraded.pctDv),
    Math.abs(h.comparableSet.sec.pctDv - h.allRowsSet.sec.pctDv)
  );
  console.log(
    h.excludedFromHeadline === 0
      ? "    >>> nothing excluded: both files cover every symbol, so the two blocks\n" +
        "        above are identical by construction."
      : moved >= 0.1
        ? `    >>> MATERIAL. Restricting to the comparable set moves a dollar-volume\n` +
          `        share by ${moved.toFixed(1)} points. The gap is not a rounding detail and the\n` +
          `        two blocks above must not be used interchangeably.`
        : `    >>> immaterial to the headline: the two blocks differ by under 0.1\n` +
          `        points of dollar volume. The excluded symbols are still named in\n` +
          `        section 4 -- immaterial to this figure is not the same as fine.`
  );
}

console.log(`\n── 4. COVERAGE AND MEMBERSHIP — what this diff CANNOT see ──`);
console.log(`  symbols one source has no row for: ${notComparable.length}` +
  (notComparable.length ? ` — ${notComparable.map((r) => r.symbol).slice(0, 40).join(", ")}` : ""));
for (const r of notComparable.slice(0, 40)) {
  console.log(
    `    ${r.symbol.padEnd(10)} nasdaqtraded=${r.nasdaqtraded.venue ?? "ABSENT"}  sec=${r.sec.exchange ?? "ABSENT"}`
  );
}
if (supplied.length) {
  console.log(
    `\n  membership: this ran over the SUPPLIED live universe, so the count delta\n` +
      `  against #448 is decomposed fully — classification above, plus whatever\n` +
      `  symbols differ between this list and the frozen ${analysis.length}-symbol dump.`
  );
} else {
  console.log(
    `\n  membership: UNACCOUNTED. This ran over the FROZEN dump universe, which is\n` +
      `  the #448 denominator. The live manifest universe is larger, and those\n` +
      `  extra symbols are not in this table at all. Re-dispatch with SYMBOLS set\n` +
      `  to the live universe to close that component. Do NOT subtract the totals\n` +
      `  in section 1 from the live manifest histogram and call the remainder a\n` +
      `  classification difference — that is the error this script exists to stop.`
  );
}

const outPath = path.join(DIR, "LISTING-VENUE-DIFF.json");
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      // The report is unusable later without knowing which dump it described.
      dumpProvenance: provenance,
      universeSource,
      universeSize: analysis.length,
      sessionsForDollarVolume: SESSIONS,
      secFileShape: parseShape,
      counts: {
        conflicts: conflicts.length,
        nasdaqBoundaryConflicts: boundaryConflicts.length,
        notComparable: notComparable.length,
        // The JSON is what gets read later, without the console output beside
        // it. A headline restricted to the comparable set is misleading unless
        // the size of what it excluded travels with it -- by weight as well as
        // by count.
        excludedFromHeadline: headline.excludedFromHeadline,
        excludedDollarVolumeShare: headline.excludedDollarVolumeShare,
      },
      headline,
      // EVERY symbol, not just the conflicts. The question "which source said
      // what about X" has to be answerable for any X afterwards, without a
      // second runner round trip.
      symbols: rows,
    },
    null,
    2
  )
);
console.log(`\nwrote ${outPath} — per-symbol, all ${rows.length} rows, both sources, both raw values.`);
