// WHICH SOURCE SHOULD HOLD NVDA'S MARKET CAP, AND WHAT IS ACTUALLY THERE?
//
// MEASUREMENT ONLY. No fix is proposed and none should be inferred from this
// file: the point is to replace "source: none" -- which is all
// due-strip-universe.mjs can say -- with the three facts it cannot distinguish.
//
// ── WHAT "source: none" CANNOT TELL APART ─────────────────────────────────
// due-strip-universe reports a symbol as uncapped when capOf() returns null for
// every source. That single verdict covers three entirely different states:
//
//   ABSENT     the symbol has no entry in that source at all
//   NULL       an entry exists and its cap field is null/0/absent
//   SHAPE      an entry exists and carries a cap under a key capOf() does not
//              read, or as a type it rejects
//
// The first is an ingest gap, the second is an upstream gap, the third is a
// parsing gap in OUR code -- three different owners. So each is reported
// separately, per source, per symbol.
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

const focus = [];
for (const sym of LARGE_CAPS) {
  const perSource = {};
  for (const file of CAP_SOURCES) perSource[file] = inspect(file, sym);
  const anyCap = Object.values(perSource).some((v) => v.state === "HAS-CAP");
  focus.push({ symbol: sym, inUniverse: universe.includes(sym), anyCap, perSource });
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
  if (!anyCap) unpriced.push({ symbol: sym, states });
}

// Per-source coverage, with the denominator beside it.
const coverage = {};
for (const file of CAP_SOURCES) {
  const src = sources.get(file);
  // EVERY STATE GETS ITS OWN COUNTER, and the else-branch is a counter of its
  // own rather than a bucket. The first draft folded "source-missing" into
  // nullCap, which reported a source ABSENT FROM THE DUMP as one that answered
  // for every symbol and carried no cap -- the failure-vs-absence confusion
  // this build has been correcting elsewhere, reintroduced in the measurement
  // of it. The totals are asserted to add up so a future state cannot vanish.
  let has = 0, absent = 0, nul = 0, shape = 0, spelled = 0, sourceMissing = 0, other = 0;
  for (const sym of universe) {
    const v = inspect(file, sym);
    if (v.state === "HAS-CAP") has++;
    else if (v.state === "ABSENT") absent++;
    else if (v.state === "SPELLED-DIFFERENTLY") spelled++;
    else if (v.state === "SHAPE-MISMATCH") shape++;
    else if (v.state === "NULL-CAP") nul++;
    else if (v.state === "source-missing") sourceMissing++;
    else other++;
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
}

console.log(`\nUNIVERSE SYMBOLS WITH NO CAP IN ANY SOURCE: ${unpriced.length}`);
for (const u of unpriced) {
  console.log(`  ${u.symbol.padEnd(8)} ${CAP_SOURCES.map((f) => `${f.split(".")[0]}=${u.states[f]}`).join(" · ")}`);
}

console.log("\nLARGE-CAP SAMPLE (written by name, so the sample does not depend on the missing field)");
const sampleMissing = focus.filter((f) => f.inUniverse && !f.anyCap);
console.log(`  in universe: ${focus.filter((f) => f.inUniverse).length}/${focus.length} · of those, WITHOUT a cap: ${sampleMissing.length}`);
for (const f of sampleMissing) {
  console.log(`  ${f.symbol}:`);
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
  universeSize: universe.length, coverage, unpriced, focus,
}, null, 2));
