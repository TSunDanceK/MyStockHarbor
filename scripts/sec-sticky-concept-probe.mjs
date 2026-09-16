// WHAT ONE-CONCEPT-PER-FILER COSTS, PER CELL — measured, not argued.
//
// ── THE QUESTION THIS OWES AN ANSWER TO ───────────────────────────────────
// The ruling fixes ONE concept per filer for a marked field and refuses every
// other, so a period the chosen concept does not cover reads "Not reported"
// instead of taking the other one. That is a deliberate loss of cells, and a
// ruling is owed the size of it: how many rendered cells CHANGE value, and how
// many become "Not reported", across the analysis universe.
//
// ── ONE CODE PATH, RUN TWICE, ONE PAYLOAD ─────────────────────────────────
// BEFORE is not a remembered number and not a second implementation: the
// shipped extractor runs against the payload with `oneConceptPerFiler` turned
// OFF for the field — which is exactly the default policy the rest of the
// fields use — and then again with it as it ships. Any difference is the flag
// and nothing else. Sibling of sec-capex-blast-probe, which does the same for a
// chain edit; the only difference is which switch is flipped between the runs.
//
// NOT A CHAIN COMPARISON. The chain is identical in both runs. Pointing
// sec-capex-blast at this question would measure the wrong edit entirely.
//
// Reports, per symbol:
//   NOT-REPORTED  a cell had a value and now has none      — the cost
//   CHANGED       a cell's value moved to a different one  — the correction
//   GAINED        a cell had none and now has one          — the refund
//   same          identical before and after               — the control
//
// ── GAINED IS NOT IMPOSSIBLE, AND THE FIRST VERSION OF THIS PROBE SAID IT WAS
// It printed ">> A RESTRICTION CANNOT ADD A READING" and told the reader not to
// quote the run. That reasoning was wrong, and the live run tripped it: MELI
// q:2023-12-31 went NONE -> 180,000,000.
//
// Restricting the candidate set does only remove READINGS — but a reading is
// not a cell. Every quarter but Q1 is DIFFERENCED, and the differencing refuses
// to subtract across a concept change. Fixing one concept for the whole column
// removes those changes, so a quarter the same-concept guard had refused now
// has two operands of one concept and resolves. The cell is gained by the
// refusal no longer firing, not by a candidate appearing.
//
// Corroborated independently: sec-capex-concepts listed the quarters the
// same-concept rule nulls as ANET 3, MELI 1 (2023-12-31), TT 1, MAR 1 — and
// MELI 2023-12-31 is exactly the cell that comes back.
//
// So a gain is REPORTED AND EXPLAINED rather than treated as a fault. What
// would be a fault is a gain on an INSTANT field, which is never differenced
// and so has no refusal to refund; that is flagged separately below.
//
// Read-only: no credential, no store, no writes. Needs the network.
//
//   SYMBOLS="CRM,GE,SCHW" node scripts/sec-sticky-concept-probe.mjs
//   (no SYMBOLS: the frozen dump's analysis universe, capped by LIMIT)
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; sticky concept cost)";
const FIELD = process.env.FIELD || "capex";
const LIMIT = Number(process.env.LIMIT || 120);

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { SEC_FIELDS, extractCompanyFacts, encodeFactSet, valueOf, rowsForField } = sec;

const field = SEC_FIELDS.find((f) => f.key === FIELD);
if (!field) { console.error(`FATAL: no field "${FIELD}"`); process.exit(2); }
if (!field.oneConceptPerFiler) {
  // A PROBE AIMED AT A FIELD THAT DOES NOT USE THE RULE would run the same
  // policy twice and report "nothing changed" — a clean bill of health for a
  // measurement that never happened.
  console.error(`FATAL: ${FIELD} is not marked oneConceptPerFiler, so both runs would use the same policy`);
  process.exit(2);
}
console.log(`${FIELD}: chain [${field.chain.join(", ")}] — identical in both runs; the FLAG is the switch`);

const DIR = process.env.DUMP_DIR || "";
const fromDump = () => {
  if (!DIR) return [];
  try {
    const u = JSON.parse(fs.readFileSync(path.join(DIR, "universe.json"), "utf8"));
    return (u?.pickersSymbolsKey ?? []).map(String);
  } catch { return []; }
};
const SYMBOLS = (process.env.SYMBOLS || "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const targets = (SYMBOLS.length ? SYMBOLS : fromDump()).slice(0, LIMIT);
if (!targets.length) {
  console.error("FATAL: no symbols — pass SYMBOLS or run with a dump that has universe.json");
  process.exit(2);
}
console.log(`${targets.length} SYMBOLS (source: ${SYMBOLS.length ? "SYMBOLS input" : "frozen dump universe"})\n`);

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

/** Every STORED period's value for the field, keyed so the two runs line up. */
const readField = (set) => {
  const out = new Map();
  for (const [b, periods] of [["q", set.quarters], ["y", set.years], ["i", set.instants]]) {
    for (const p of periods ?? []) out.set(`${b}:${p.e}`, valueOf(p, FIELD));
  }
  return out;
};

const tally = { notReported: [], changed: [], gained: [], same: 0, noCik: 0, failed: 0 };
let cellsBefore = 0, cellsAfter = 0, symbolsTouched = 0;
const choices = new Map();
const perSymbol = new Map();

for (const symbol of targets) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { tally.noCik++; continue; }
  let facts;
  try {
    if (process.env.FACTS_DIR) {
      facts = JSON.parse(fs.readFileSync(`${process.env.FACTS_DIR}/CIK${cik}.json`, "utf8"));
    } else {
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
      });
      if (!res.ok) { tally.failed++; continue; }
      facts = await res.json();
    }
  } catch { tally.failed++; continue; }

  // THE SWITCH, flipped in place between two runs of one extractor.
  field.oneConceptPerFiler = false;
  const before = readField(encodeFactSet(extractCompanyFacts(symbol, facts)));
  field.oneConceptPerFiler = true;
  const afterSet = encodeFactSet(extractCompanyFacts(symbol, facts));
  const after = readField(afterSet);
  if (afterSet.cc?.[FIELD]) choices.set(symbol, afterSet.cc[FIELD]);

  // WHETHER THE NEWEST PERIOD FILES BOTH — the fact the tie-break turns on, and
  // the one a reader needs to know whether a correction still applies to what
  // the page shows. Read from the field's own candidate rows, not inferred.
  const cands = rowsForField(facts, field);
  let newestEnd = null;
  for (const c of cands) if (c.row.end && (newestEnd === null || c.row.end > newestEnd)) newestEnd = c.row.end;
  const atNewest = new Set(cands.filter((c) => c.row.end === newestEnd).map((c) => `${c.ns}|${c.tag}`));

  const keys = [...new Set([...before.keys(), ...after.keys()])];
  let lost = 0, moved = 0, got = 0;
  const detail = [];
  for (const k of keys) {
    const b = before.get(k) ?? null;
    const a = after.get(k) ?? null;
    if (b === a) continue;
    if (b !== null && a === null) { lost++; detail.push(`${k} ${b} -> NOT REPORTED`); }
    else if (b === null && a !== null) { got++; detail.push(`${k} NONE -> ${a}`); }
    else { moved++; detail.push(`${k} ${b} -> ${a}`); }
  }
  let symBefore = 0, symAfter = 0;
  for (const v of before.values()) if (v !== null) { cellsBefore++; symBefore++; }
  for (const v of after.values()) if (v !== null) { cellsAfter++; symAfter++; }
  perSymbol.set(symbol, {
    before: symBefore, after: symAfter, choice: afterSet.cc?.[FIELD] ?? null,
    newestEnd, newestBoth: newestEnd === null ? null : atNewest.size > 1,
  });
  if (lost || moved || got) {
    symbolsTouched++;
    if (lost) tally.notReported.push({ symbol, n: lost, detail: detail.filter((d) => d.includes("NOT REPORTED")) });
    if (moved) tally.changed.push({ symbol, n: moved, detail: detail.filter((d) => !d.includes("NOT REPORTED") && !d.includes("NONE ->")) });
    if (got) tally.gained.push({ symbol, n: got, detail: detail.filter((d) => d.includes("NONE ->")) });
  } else tally.same++;
}

const read = targets.length - tally.noCik - tally.failed;
console.log("=".repeat(76));
console.log(`READ ${read} SYMBOLS of ${targets.length} (${tally.noCik} no CIK, ${tally.failed} fetch failed)`);
console.log(`${FIELD} cells carrying a figure: ${cellsBefore} before -> ${cellsAfter} after ` +
  `(${cellsBefore - cellsAfter} fewer)`);
console.log(`${symbolsTouched} SYMBOLS move at all; ${tally.same} identical\n`);

const sum = (rows) => rows.reduce((a, r) => a + r.n, 0);
console.log(`1. CELLS THAT BECOME "Not reported": ${sum(tally.notReported)} across ${tally.notReported.length} SYMBOLS`);
for (const r of tally.notReported.sort((a, b) => b.n - a.n).slice(0, 25)) {
  console.log(`   ${r.symbol.padEnd(6)} ${String(r.n).padStart(2)} cell(s): ${r.detail.slice(0, 4).join(" | ")}${r.detail.length > 4 ? " …" : ""}`);
}
if (!tally.notReported.length) console.log("   (none)");

console.log(`\n2. CELLS THAT CHANGE VALUE: ${sum(tally.changed)} across ${tally.changed.length} SYMBOLS`);
for (const r of tally.changed.sort((a, b) => b.n - a.n).slice(0, 25)) {
  console.log(`   ${r.symbol.padEnd(6)} ${String(r.n).padStart(2)} cell(s): ${r.detail.slice(0, 4).join(" | ")}${r.detail.length > 4 ? " …" : ""}`);
}
if (!tally.changed.length) console.log("   (none)");

// EXPECTED ON A DIFFERENCED FIELD, IMPOSSIBLE ON AN INSTANT ONE. See the
// docblock: fixing one concept removes the mid-year concept changes the
// differencing refuses to subtract across, so a refused quarter can resolve.
console.log(`\n3. CELLS THAT GAIN A FIGURE: ${sum(tally.gained)} across ${tally.gained.length} SYMBOLS`);
if (tally.gained.length) {
  for (const r of tally.gained) console.log(`   ${r.symbol.padEnd(6)} ${r.detail.slice(0, 4).join(" | ")}`);
  const onInstant = tally.gained.flatMap((r) =>
    r.detail.filter((d) => d.startsWith("i:")).map((d) => `${r.symbol} ${d}`));
  if (onInstant.length) {
    console.log(`   >> ${onInstant.length} OF THESE ARE ON AN INSTANT PERIOD, WHICH IS NEVER DIFFERENCED,`);
    console.log(`      so there is no refused subtraction to refund and a restriction cannot have`);
    console.log(`      added the reading. This run should not be quoted as a cost:`);
    console.log(`      ${onInstant.join(" | ")}`);
  } else {
    console.log(`   Each is a DIFFERENCED quarter the same-concept guard had refused: fixing one`);
    console.log(`   concept removes the mid-year change, so both operands match and it resolves.`);
    console.log(`   Cross-check against sec-capex-concepts' own list of quarters that rule nulls.`);
  }
} else {
  console.log("   (none)");
}

const broad = [...choices].filter(([, c]) => c.endsWith("|PaymentsToAcquireProductiveAssets"));
console.log(`\n4. WHICH CONCEPT EACH FILER IS ON — ${choices.size} SYMBOLS recorded a choice`);
console.log(`   on the BROADER concept, so the row label changes: ${broad.length} SYMBOLS`);
console.log(`   ${broad.map(([s]) => s).join(" ") || "(none)"}`);

// ── PER-SYMBOL, FOR THE ONES A RULING TURNS ON ────────────────────────────
// A total cannot answer "did NVDA keep its column". WATCH names the symbols
// whose chosen concept and cell count are printed individually, so the report
// quotes a line rather than an inference from an aggregate.
const WATCH = (process.env.WATCH || "NVDA,PANW,GE,CRM,SCHW,MELI,ANET")
  .split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
console.log(`\n5. PER-SYMBOL DETAIL — cells carrying a figure, before -> after`);
for (const sym of WATCH) {
  const c = perSymbol.get(sym);
  if (!c) { console.log(`   ${sym.padEnd(6)} not read in this run`); continue; }
  const label = c.choice?.endsWith("|PaymentsToAcquireProductiveAssets")
    ? "BROADER (label changes)" : c.choice ? "PP&E" : "no capex at all";
  console.log(
    `   ${sym.padEnd(6)} ${String(c.before).padStart(3)} -> ${String(c.after).padStart(3)} cells` +
    `   ${label}   ${c.choice ?? "(none)"}` +
    (c.newestBoth === null ? "" :
      `\n          newest period ${c.newestEnd} files ${c.newestBoth ? "BOTH concepts" : "one concept"}` +
      (c.newestBoth ? " — the tie-break decides it" : ""))
  );
}
