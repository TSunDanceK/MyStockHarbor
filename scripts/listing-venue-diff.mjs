// WHICH SYMBOLS THE TWO VENUE SOURCES CLASSIFY DIFFERENTLY, AND WHAT THAT DOES
// TO THE 62.5% FIGURE.
//
// THE FINDING THIS EXISTS TO SETTLE. Two counts of the same universe's listing
// venue do not agree:
//
//     manifest (live, 2026-09-14)   NYSE 476   Nasdaq 216   (unknown) 4   [696]
//     #448 / listing-split.mjs      NYSE 463   Nasdaq 230                 [693]
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

const DIR = path.resolve(process.argv[2] ?? "step0-dump");
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; listing-venue reconciliation)";
const SESSIONS = Number(process.env.DV_SESSIONS ?? 60);

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
console.log(`dump: ${DIR}`);

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
// THE DOT/DASH PROBLEM, third convention in this repo. The universe stores
// BRK.B; both reference files use the dashed form. Both sides try both
// spellings, so a spelling miss cannot masquerade as a venue disagreement.
const alts = (sym) => [sym, sym.replace(/\./g, "-"), sym.replace(/-/g, ".")];
const lookup = (m, sym) => {
  for (const a of alts(sym)) if (m.has(a)) return { value: m.get(a), matched: a };
  return null;
};
// Compared on a normalised key so "NYSE American" and "NYSEAmerican" are not
// reported as a disagreement about venue when they are a disagreement about
// punctuation. The RAW pair is printed either way -- the normalisation decides
// what gets called a finding, never what gets shown.
const norm = (v) => (v == null ? null : String(v).toUpperCase().replace(/[^A-Z0-9]/g, ""));

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
  "\n  Both columns are over ONE symbol set, so any difference between them is\n" +
    "  classification and nothing else. Membership is isolated in section 3."
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

console.log(`\n── 3. WHAT THE HEADLINE FIGURE BECOMES UNDER EACH SOURCE ──`);
{
  const totalDv = rows.reduce((a, r) => a + (r.dollarVolume ?? 0), 0);
  const side = (pick) => {
    const isNas = (r) => norm(pick(r)) === "NASDAQ";
    const count = rows.filter(isNas).length;
    const dv = rows.filter(isNas).reduce((a, r) => a + (r.dollarVolume ?? 0), 0);
    return { count, pctCount: (count / rows.length) * 100, pctDv: totalDv ? (dv / totalDv) * 100 : 0 };
  };
  const a = side((r) => r.nasdaqtraded.venue);
  const b = side((r) => r.sec.exchange);
  console.log(`\n    source                          Nasdaq count   by count   BY DOLLAR VOLUME`);
  console.log(
    `    nasdaqtraded.txt (#448)         ${String(a.count).padStart(12)}   ${a.pctCount.toFixed(1).padStart(7)}%   ${a.pctDv.toFixed(1).padStart(15)}%`
  );
  console.log(
    `    SEC exchange (manifest)         ${String(b.count).padStart(12)}   ${b.pctCount.toFixed(1).padStart(7)}%   ${b.pctDv.toFixed(1).padStart(15)}%`
  );
  console.log(
    `\n    swing: ${(b.count - a.count >= 0 ? "+" : "") + (b.count - a.count)} symbols, ` +
      `${((b.pctDv - a.pctDv) >= 0 ? "+" : "") + (b.pctDv - a.pctDv).toFixed(1)} points of dollar volume.`
  );
  console.log(
    a.pctDv.toFixed(1) === b.pctDv.toFixed(1)
      ? "    >>> THE HEADLINE FIGURE IS UNCHANGED by the disagreement. The count\n" +
        "        dispute is real but it does not reach the number the case rests on."
      : "    >>> THE HEADLINE FIGURE MOVES. Neither number should be quoted until a\n" +
        "        source of record is chosen, and the choice must be recorded."
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
      universeSource,
      universeSize: analysis.length,
      sessionsForDollarVolume: SESSIONS,
      secFileShape: parseShape,
      counts: {
        conflicts: conflicts.length,
        nasdaqBoundaryConflicts: boundaryConflicts.length,
        notComparable: notComparable.length,
      },
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
