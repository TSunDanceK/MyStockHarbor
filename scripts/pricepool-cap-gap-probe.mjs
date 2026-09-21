// WHICH SOURCE SHOULD HOLD NVDA'S MARKET CAP, AND WHAT IS ACTUALLY THERE?
//
// MEASUREMENT ONLY. No fix is proposed and none should be inferred from this
// file: the point is to replace "source: none" -- which is all
// due-strip-universe.mjs can say -- with the three facts it cannot distinguish.
//
// ── WHAT "source: none" CANNOT TELL APART ─────────────────────────────────
// due-strip-universe reports a symbol as uncapped when capOf() returns null for
// every source. That single verdict covers four entirely different states:
//
//   ABSENT     the symbol has no entry in that source at all
//   NULL       an entry exists and its cap field is null/0/absent
//   SHAPE      an entry exists and carries a cap under a key capOf() does not
//              read, or as a type it rejects
//   SPELLING   the entry is there under another spelling of the ticker
//
// The first is an ingest gap, the second is an upstream gap, and the last two
// are parsing gaps in OUR code -- different owners. So each is reported
// separately, per source, per symbol.
//
// ── AND A NULL CAP IS NOT SELF-EXPLANATORY EITHER ─────────────────────────
// Run 35631103914 found NVDA present in the pool with a live price and P/E and
// a null marketCap -- and a null volume, open, dayHigh and dayLow beside it.
// "These four symbols failed" and "the pool populates none of these fields and
// the 696 caps come from elsewhere" produce the same NVDA row. So the whole
// source is tabulated field by field, capped rows against uncapped ones, and
// capped rows are printed in full as CONTROLS.
//
// ── EVERY KEY, NOT A CHOSEN SUBSET ────────────────────────────────────────
// The same rule the multi-class probe needed: "nothing carries a cap here"
// concluded from a projection that dropped the field carrying it is how this
// gets answered wrongly. Entry keys are printed verbatim for the focus symbols.
//
// ── THE SAMPLE IS INDEPENDENT OF THE THING BEING MEASURED ─────────────────
// A sample drawn by market cap would be drawn using the field under
// investigation, and symbols missing it would be invisible to the sample. So
// the large-cap list below is written by NAME -- companies whose size is not in
// question -- and separately the FULL universe is swept for unpriced symbols so
// the answer does not depend on the list being right.
//
//   relay task: pricepool-cap-gap   (read-only, uncredentialled, needs a dump)
import fs from "node:fs";
import path from "node:path";
import { emitPayload } from "./lib/relay-capture.mjs";
import { symbolSpellings } from "./lib/symbol-spellings.mjs";

const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
if (!DUMP) {
  console.error("FATAL: no dump directory. Dispatch the relay with a run_id carrying a step 0 dump.");
  process.exit(2);
}

// The four sources and their order, LIFTED FROM the consumer rather than
// retyped, so this probe cannot measure a different set from the one that
// refuses. If that file's list changes and this one does not, the mismatch is
// the bug this guard reports.
const CONSUMER = fs.readFileSync(path.join(process.cwd(), "scripts/due-strip-universe.mjs"), "utf8");
const capSourcesLine = /const CAP_SOURCES = \[([^\]]*)\]/.exec(CONSUMER);
if (!capSourcesLine) {
  console.error("FATAL: could not read CAP_SOURCES from due-strip-universe.mjs — it was renamed or restructured.");
  process.exit(1);
}
const CAP_SOURCES = [...capSourcesLine[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

// capOf, ALSO lifted, for the same reason: a probe with its own copy would
// report a shape mismatch that exists only between the probe and the consumer.
const capOfSrc = /const capOf = \(e\) => \{[\s\S]*?\n\};/.exec(CONSUMER);
if (!capOfSrc) {
  console.error("FATAL: could not read capOf from due-strip-universe.mjs.");
  process.exit(1);
}
const capOf = eval(`(${capOfSrc[0].replace(/^const capOf = /, "").replace(/;$/, "")})`);

// Every key that has ever looked like a cap, so a SHAPE mismatch is findable
// rather than merely suspected. Deliberately wider than capOf's three.
const CAP_LIKE = /^(market_?cap|mkt_?cap|marketCapitalization|capitalization|mc)$/i;

const readJson = (n) => {
  const f = path.join(DUMP, n);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
};

/** Symbol -> entry, from either a {SYM: entry} map or an array of {symbol,...}. */
function entriesOf(doc) {
  const v = doc?.value ?? doc;
  if (Array.isArray(v)) {
    const out = [];
    for (const e of v) { const sym = e?.symbol ?? e?.ticker; if (sym) out.push([String(sym).toUpperCase(), e]); }
    return out;
  }
  if (v && typeof v === "object") return Object.entries(v).map(([k, e]) => [String(k).toUpperCase(), e]);
  return [];
}

const parsed = (x) => {
  if (typeof x === "string") { try { return JSON.parse(x); } catch { return null; } }
  return x;
};

// ── load ──────────────────────────────────────────────────────────────────
const universeDoc = readJson("universe.json");
if (!universeDoc) { console.error("FATAL: universe.json missing from the dump."); process.exit(1); }
const universe = [...new Set((universeDoc.pickersSymbolsKey ?? []).map((s) => String(s).toUpperCase()))];

const sources = new Map();
for (const file of CAP_SOURCES) {
  const doc = readJson(file);
  sources.set(file, { present: doc != null, entries: new Map(entriesOf(doc)) });
}

/** The three-way verdict for one symbol in one source. */
function inspect(file, symbol) {
  const src = sources.get(file);
  if (!src?.present) return { state: "source-missing" };
  if (!src.entries.has(symbol)) {
    // ABSENT AND MIS-SPELLED ARE DIFFERENT OWNERS, and "a symbol-mapping
    // mismatch" is one of the three hypotheses this probe exists to separate.
    // The CONSUMER does not widen spellings -- it uppercases and nothing more
    // -- so a hit here is a finding about our code, not about the source, and
    // it is reported under its own state rather than folded into ABSENT.
    for (const alt of symbolSpellings(symbol)) {
      if (alt !== symbol && src.entries.has(alt)) {
        const altRaw = src.entries.get(alt);
        return { state: "SPELLED-DIFFERENTLY", matched: alt, cap: capOf(altRaw) };
      }
    }
    return { state: "ABSENT" };
  }
  const raw = src.entries.get(symbol);
  const obj = parsed(raw);
  if (obj == null || typeof obj !== "object") {
    return { state: "UNPARSEABLE", rawType: typeof raw };
  }
  const keys = Object.keys(obj);
  const cap = capOf(raw);
  if (cap != null) return { state: "HAS-CAP", cap, keys };
  // Present, no cap capOf accepts. Is there something cap-SHAPED it missed?
  const capLike = keys.filter((k) => CAP_LIKE.test(k));
  const capLikeValues = Object.fromEntries(capLike.map((k) => [k, obj[k]]));
  const readKeys = ["marketCap", "mktCap", "marketCapitalization"];
  const readValues = Object.fromEntries(readKeys.filter((k) => k in obj).map((k) => [k, obj[k]]));
  // THE WHOLE ENTRY, ABBREVIATED. "The pool never fetched this symbol" and
  // "the pool fetched it and the vendor returned a null cap" are different
  // owners and look identical from the cap field alone. A row whose price,
  // volume and name are populated beside a null cap says the fetch WORKED.
  const entry = Object.fromEntries(keys.map((k) => {
    const v = obj[k];
    if (v == null || typeof v === "number" || typeof v === "boolean") return [k, v];
    const t = String(v);
    return [k, t.length > 40 ? `${t.slice(0, 40)}…` : t];
  }));
  return {
    state: capLike.length && Object.values(capLikeValues).some((v) => Number.isFinite(Number(v)) && Number(v) > 0)
      ? "SHAPE-MISMATCH"
      : "NULL-CAP",
    keys,
    capLikeValues,
    readValues,
    entry,
  };
}

// Written by NAME, independent of the field under investigation.
const LARGE_CAPS = [
  "NVDA", "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "AVGO", "TSLA", "BRK-B",
  "LLY", "JPM", "V", "XOM", "UNH", "MA", "COST", "HD", "PG", "JNJ",
  "WMT", "NFLX", "ABBV", "BAC", "CRM", "ORCL", "CVX", "KO", "AMD", "PEP",
  "TMO", "LIN", "ADBE", "MRK", "ACN", "MCD", "CSCO", "ABT", "PM", "INTU",
  "TXN", "QCOM", "IBM", "GE", "CAT", "VZ", "DIS", "NOW", "AMGN", "INTC",
];

// MEMBERSHIP TOLERATES SPELLING, AND THE FIRST RUN DID NOT. This list writes
// Berkshire as BRK-B and the universe writes it BRK.B, so run 35631103914
// counted it "not in universe" and dropped it from the sample — while the full
// sweep, which reads the universe's own spellings, found it uncapped anyway.
// The sample was wrong about one of the four symbols it exists to find, and the
// sweep is the only reason that was visible. Both are kept for that reason.
const universeSpellingOf = (sym) => symbolSpellings(sym).find((a) => universe.includes(a)) ?? null;

const focus = [];
for (const sym of LARGE_CAPS) {
  const canon = universeSpellingOf(sym);
  const perSource = {};
  for (const file of CAP_SOURCES) perSource[file] = inspect(file, canon ?? sym);
  const anyCap = Object.values(perSource).some((v) => v.state === "HAS-CAP");
  focus.push({ symbol: sym, universeSpelling: canon, inUniverse: Boolean(canon), anyCap, perSource });
}

// THE FULL SWEEP, so the answer does not depend on the hand-written list.
const unpriced = [];
for (const sym of universe) {
  const states = {};
  let anyCap = false;
  for (const file of CAP_SOURCES) {
    const v = inspect(file, sym);
    states[file] = v.state;
    if (v.state === "HAS-CAP") anyCap = true;
    // A cap found only under another spelling is NOT counted as priced: the
    // consumer would not find it either. It is recorded so the reason shows.
    if (v.state === "SPELLED-DIFFERENTLY" && v.cap != null) states[file] = `SPELLED-DIFFERENTLY(${v.matched}, cap present)`;
  }
  if (!anyCap) unpriced.push({ symbol: sym, states, entry: inspect(CAP_SOURCES[0], sym).entry ?? null });
}

// Per-source coverage, with the denominator beside it.
const coverage = {};
const otherStateExamples = {};
for (const file of CAP_SOURCES) {
  const src = sources.get(file);
  // EVERY STATE GETS ITS OWN COUNTER, and the else-branch is a counter of its
  // own rather than a bucket. The first draft folded "source-missing" into
  // nullCap, which reported a source ABSENT FROM THE DUMP as one that answered
  // for every symbol and carried no cap — the failure-vs-absence confusion this
  // build has been correcting, reintroduced in the measurement of it. The
  // totals are asserted to add up so a future state cannot vanish.
  let has = 0, absent = 0, nul = 0, shape = 0, spelled = 0, sourceMissing = 0, other = 0;
  for (const sym of universe) {
    const v = inspect(file, sym);
    if (v.state === "HAS-CAP") has++;
    else if (v.state === "ABSENT") absent++;
    else if (v.state === "SPELLED-DIFFERENTLY") spelled++;
    else if (v.state === "SHAPE-MISMATCH") shape++;
    else if (v.state === "NULL-CAP") nul++;
    else if (v.state === "source-missing") sourceMissing++;
    else {
      other++;
      // AN "OTHER" COUNTER WITH NO EXAMPLE IS A NUMBER NOBODY CAN ACT ON. Run
      // 35631103914 printed OTHER=1 against three sources and nothing said what
      // it was, which is the same shape of unactionable verdict this probe
      // exists to replace.
      (otherStateExamples[file] ??= []).push({ symbol: sym, ...v });
    }
  }
  const tally = has + absent + spelled + shape + nul + sourceMissing + other;
  if (tally !== universe.length) {
    console.error(`FATAL: ${file} counters sum to ${tally}, universe is ${universe.length} — a state is being dropped.`);
    process.exit(1);
  }
  coverage[file] = {
    sourcePresent: src.present,
    entriesInSource: src.entries.size,
    universeWithCap: has,
    universeAbsent: absent,
    universeNullCap: nul,
    universeShapeMismatch: shape,
    universeSpelledDifferently: spelled,
    universeSourceMissing: sourceMissing,
    universeOtherState: other,
    universeSize: universe.length,
  };
}

// ── THE WHOLE SOURCE, NOT JUST THE UNIVERSE'S SLICE ───────────────────────
// The pool carries 841 entries against a 700-symbol universe, and the universe
// slice cannot say whether a null cap is rare everywhere or common outside it.
// A rate measured only where the consumer looks is a rate that moves when the
// consumer's list moves.
//
// AND THE CO-NULLITY IS THE ACTUAL EVIDENCE. NVDA's row carries a live price
// and a live P/E beside a null marketCap — AND a null volume, open, dayHigh and
// dayLow. Whether that set of nulls is peculiar to the uncapped rows or is the
// ordinary shape of every row in the pool is the difference between "these four
// symbols failed" and "the pool never populates these fields and 696 caps come
// from somewhere else". Nothing printed so far distinguishes them, so both
// populations are tabulated field by field.
const POOL = CAP_SOURCES[0];
const poolSrc = sources.get(POOL);
const nullnessCapped = {}, nullnessUncapped = {};
let poolCapped = 0, poolUncapped = 0;
const poolUncappedSymbols = [];
const bump = (tbl, k) => { tbl[k] = (tbl[k] ?? 0) + 1; };
for (const [sym, raw] of poolSrc.entries) {
  const obj = parsed(raw);
  if (obj == null || typeof obj !== "object") continue;
  const capped = capOf(raw) != null;
  if (capped) poolCapped++; else { poolUncapped++; poolUncappedSymbols.push(sym); }
  const tbl = capped ? nullnessCapped : nullnessUncapped;
  for (const k of Object.keys(obj)) if (obj[k] == null) bump(tbl, k);
}

// CONTROLS: capped rows printed in full beside the uncapped ones. Without them
// "NVDA's volume is null" is an observation with nothing to compare it to.
const controls = [];
for (const sym of ["AAPL", "MSFT", "AMZN"]) {
  const canon = universeSpellingOf(sym) ?? sym;
  const v = inspect(POOL, canon);
  if (v.state === "HAS-CAP") controls.push({ symbol: canon, cap: v.cap, entry: parsed(poolSrc.entries.get(canon)) });
}

// ── THE SHAPE OF EACH FILE, BEFORE ANY CONCLUSION IS DRAWN FROM IT ────────
//
// Run 35631353569 reported 5 entries each for screener-fundamentals.json
// (650 KB), fundamentals.json (176 KB) and stockdata.json (680 KB). A 650 KB
// file with five entries in it is not a file with five entries in it -- it is
// a reader that has not understood the file.
//
// THAT IS NOT A PROBE BUG ALONE. entriesOf() here is a copy of the one in
// due-strip-universe.mjs, and that script's committed conclusion -- "adding the
// other three sources contributed ZERO new caps", the finding that closed the
// question -- was reached through the SAME reader. If the reader is wrong, so
// is the conclusion, and nobody would have been able to tell from the counters.
//
// So the structure is printed BEFORE any verdict rests on it: top-level type,
// the first keys, and one level down. No interpretation, just what is there.
console.log("\n=== FILE STRUCTURE — printed before any conclusion rests on it ===");
for (const file of CAP_SOURCES) {
  const doc = readJson(file);
  if (doc == null) { console.log(`  ${file}: absent or unparseable`); continue; }
  const describe = (v, depth = 0) => {
    const pad = "    ".repeat(depth + 1);
    if (Array.isArray(v)) {
      console.log(`${pad}Array(${v.length})`);
      if (v.length) {
        const f = v[0];
        console.log(`${pad}  [0] typeof ${typeof f}${f && typeof f === "object" ? ` keys=[${Object.keys(f).slice(0, 15).join(",")}]` : ` = ${String(f).slice(0, 120)}`}`);
      }
      return;
    }
    if (v && typeof v === "object") {
      const k = Object.keys(v);
      console.log(`${pad}Object with ${k.length} keys: [${k.slice(0, 15).join(",")}]${k.length > 15 ? ` … +${k.length - 15}` : ""}`);
      if (depth < 2) {
        for (const key of k.slice(0, 3)) {
          console.log(`${pad}  .${key} →`);
          describe(v[key], depth + 2);
        }
      }
      return;
    }
    const t = String(v);
    console.log(`${pad}${typeof v}, ${t.length} chars: ${t.slice(0, 200)}${t.length > 200 ? " …" : ""}`);
  };
  console.log(`  ${file}:`);
  describe(doc);
  // AND WHAT THE READER MADE OF IT, side by side with the above, so a
  // disagreement between the file and the reader is visible in one place.
  const got = entriesOf(doc);
  console.log(`    entriesOf() read ${got.length} entr${got.length === 1 ? "y" : "ies"}: [${got.slice(0, 10).map(([k]) => k).join(",")}]`);
}

// ── report ────────────────────────────────────────────────────────────────
console.log("\n=== PRICE-POOL CAP GAP ===");
console.log(`universe: ${universe.length} symbols · sources read from due-strip-universe.mjs: ${CAP_SOURCES.join(", ")}\n`);

console.log("PER-SOURCE COVERAGE OF THE UNIVERSE (denominator beside every counter)");
for (const [file, c] of Object.entries(coverage)) {
  if (!c.sourcePresent) {
    console.log(`  ${file.padEnd(28)} NOT IN THIS DUMP — it answered for nothing, which is not the same as answering "no cap"`);
    continue;
  }
  console.log(
    `  ${file.padEnd(28)} entries=${String(c.entriesInSource).padStart(5)} · ` +
    `withCap=${String(c.universeWithCap).padStart(4)}/${c.universeSize} · ` +
    `absent=${String(c.universeAbsent).padStart(4)} · nullCap=${String(c.universeNullCap).padStart(4)} · ` +
    `shapeMismatch=${c.universeShapeMismatch} · spelledDifferently=${c.universeSpelledDifferently}` +
    (c.universeOtherState ? ` · OTHER=${c.universeOtherState}` : "")
  );
  for (const ex of otherStateExamples[file] ?? []) {
    console.log(`      OTHER: ${ex.symbol} → ${ex.state}${ex.rawType ? ` (raw typeof ${ex.rawType})` : ""}`);
  }
}

console.log(`\n${POOL} AS A WHOLE, not just the universe's slice`);
console.log(`  ${poolSrc.entries.size} entries · ${poolCapped} with a cap · ${poolUncapped} without`);
console.log(`  uncapped: ${poolUncappedSymbols.join(" ") || "(none)"}`);
console.log("\n  NULL FIELDS, capped rows vs uncapped rows (count of rows where the field is null)");
const fields = [...new Set([...Object.keys(nullnessCapped), ...Object.keys(nullnessUncapped)])].sort();
for (const f of fields) {
  console.log(`    ${f.padEnd(14)} capped ${String(nullnessCapped[f] ?? 0).padStart(4)}/${poolCapped}   ·   uncapped ${String(nullnessUncapped[f] ?? 0).padStart(3)}/${poolUncapped}`);
}

console.log("\n  CONTROLS — rows that DO carry a cap, printed in full");
for (const c of controls) console.log(`    ${c.symbol.padEnd(6)} cap=${c.cap} · ${JSON.stringify(c.entry)}`);

console.log(`\nUNIVERSE SYMBOLS WITH NO CAP IN ANY SOURCE: ${unpriced.length}`);
for (const u of unpriced) {
  console.log(`  ${u.symbol.padEnd(8)} ${CAP_SOURCES.map((f) => `${f.split(".")[0]}=${u.states[f]}`).join(" · ")}`);
  if (u.entry) console.log(`      pool entry: ${JSON.stringify(u.entry)}`);
}

console.log("\nLARGE-CAP SAMPLE (written by name, so the sample does not depend on the missing field)");
const sampleMissing = focus.filter((f) => f.inUniverse && !f.anyCap);
const renamed = focus.filter((f) => f.universeSpelling && f.universeSpelling !== f.symbol);
console.log(`  in universe: ${focus.filter((f) => f.inUniverse).length}/${focus.length} · of those, WITHOUT a cap: ${sampleMissing.length}`);
if (renamed.length) console.log(`  matched only via a spelling widening: ${renamed.map((f) => `${f.symbol}→${f.universeSpelling}`).join(", ")}`);
const notInUniverse = focus.filter((f) => !f.inUniverse).map((f) => f.symbol);
if (notInUniverse.length) console.log(`  not in the universe under any spelling: ${notInUniverse.join(", ")}`);
for (const f of sampleMissing) {
  console.log(`  ${f.symbol}${f.universeSpelling !== f.symbol ? ` (as ${f.universeSpelling})` : ""}:`);
  for (const file of CAP_SOURCES) {
    const v = f.perSource[file];
    console.log(`     ${file.padEnd(28)} ${v.state}` +
      (v.matched ? ` · matched=${v.matched} · capThere=${v.cap ?? "null"}` : "") +
      (v.readValues && Object.keys(v.readValues).length ? ` · read=${JSON.stringify(v.readValues)}` : "") +
      (v.capLikeValues && Object.keys(v.capLikeValues).length ? ` · capLike=${JSON.stringify(v.capLikeValues)}` : ""));
    if (v.entry) console.log(`        entry: ${JSON.stringify(v.entry)}`);
  }
}

emitPayload("pricepool-cap-gap", JSON.stringify({
  at: new Date().toISOString(), capSources: CAP_SOURCES,
  universeSize: universe.length, coverage, otherStateExamples, unpriced, focus,
  pool: { name: POOL, entries: poolSrc.entries.size, capped: poolCapped, uncapped: poolUncapped, poolUncappedSymbols, nullnessCapped, nullnessUncapped },
  controls,
}, null, 2));
