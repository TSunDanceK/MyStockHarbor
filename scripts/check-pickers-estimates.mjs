// PICKERS ON A's ESTIMATE LAYER (#553 COWORK #102, A's #696 "For B and C").
//
// What must hold, and how each is shown:
//   1. Ent. Value is A's enterpriseValueOf: a row whose balance sheet leaves
//      only short-term debt untagged (M2) gets the ≈ figure, marked, with A's
//      note; every other gap is still refused. RUN on the committed AVAV and
//      KTOS fact-set fixtures. A's bank gate holds: the row stores the filer's
//      SIC, and a bank SIC or none (a row written before it) gets no ≈.
//   2. P/B opts in ({ withEstimates: true }): a derived parent equity (M6a)
//      gives a figure marked "derived"; a non-positive one is the "Neg."
//      refusal, the same as filed negative equity, with no mark.
//   3. No estimate renders without its mark: every figure A's layer marks
//      carries the mark into the row, a refused or non-dollar figure carries
//      none, and the grid's Ent. Value / PB cells render through EstimateCell
//      -> A's EstimatedValue. RENDERED (react-dom/server) on A's real
//      components, transpiled.
//   4. EstimateKey appears only when a visible cell is marked, listing only
//      the kinds present (table columns; a phone row's headline, plus an
//      expanded row's metrics). RENDERED.
//   5. A's refusal words (secValuation.REFUSAL_CELL_WORD), not copies: P/E
//      "Loss" / "Not meaningful", P/B "Neg." / "Not meaningful", P/S "Not
//      meaningful", each only in its own column (REFUSAL_WORD_CODES), looked up
//      server-side and shipped as entry.cellWord; the bank/insurer "n/a" stays.
//   6. Sorting is unchanged: the two columns still sort on the number.
//   7. Mutants: each rule broken once, through temp files, and caught.
//
// No Redis, no network: fixtures, real modules and source only.
//
//   node scripts/check-pickers-estimates.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MODULE = "lib/server/pickersSecFundamentals.ts";
const WORDS = "lib/pickerCellWhy.ts";
const GRID = "app/components/PickerResultsGrid.tsx";
const PAGE = "app/components/PickerResultPage.tsx";
const MARKS = "app/components/PickerEstimateMarks.tsx";
const EV_COMP = "app/components/EstimatedValue.tsx";
const KEY_COMP = "app/components/EstimateKey.tsx";
const MARK_CONST = "app/components/estimateMark.ts";
const TODAY = "2026-09-23";
const NOW = Date.parse(TODAY);
const PRICE = 100;
const fixture = (s) => JSON.parse(read(`data/sec/factset-fixture-${s}.json`));

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 70)}`);
  return src.replace(from, to);
};

/** Import a (possibly mutated) copy of a .ts module beside the original, then delete it. */
let seq = 0;
async function loadSibling(rel, source) {
  const file = path.join(path.dirname(path.join(ROOT, rel)), `.check-pest-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

const V = await import(pathToFileURL(path.join(ROOT, "lib/server/secValuation.ts")).href);
const E = await import(pathToFileURL(path.join(ROOT, "lib/server/secEstimates.ts")).href);
const W = await import(pathToFileURL(path.join(ROOT, WORDS)).href);
const moduleSrc = read(MODULE);
const REAL = await loadSibling(MODULE, moduleSrc);

// ── the components, transpiled together (JSX on, "@/" pointed at the copies)
async function loadComponents(over = {}) {
  const dir = path.join(ROOT, "scripts", `.check-pest-ui-${process.pid}-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = { estimateMark: MARK_CONST, EstimatedValue: EV_COMP, EstimateKey: KEY_COMP, PickerEstimateMarks: MARKS };
  try {
    for (const [name, rel] of Object.entries(files)) {
      let src = over[rel] ?? read(rel);
      src = src
        .replace(/from "@\/app\/components\/(estimateMark|EstimatedValue|EstimateKey)"/g, 'from "./$1.mjs"')
        .replace(/from "\.\/estimateMark"/g, 'from "./estimateMark.mjs"');
      const js = ts.transpileModule(src, {
        fileName: rel,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
      }).outputText;
      fs.writeFileSync(path.join(dir, `${name}.mjs`), js);
    }
    return await import(pathToFileURL(path.join(dir, "PickerEstimateMarks.mjs")).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const html = (el) => renderToStaticMarkup(el);

// ── rows ────────────────────────────────────────────────────────────────────
const viaJson = (x) => JSON.parse(JSON.stringify(x));
// A non-bank SIC (3812, aircraft/defence electronics), so A's bank gate allows
// the M2 estimate; `filer` overrides it (a bank SIC, or none at all).
const rowOf = (mod, s, filer = { sic: "3812" }) => viaJson(mod.buildSecPickerRow(fixture(s), TODAY, filer, NOW));
/** A row whose equity is filed only including NCI, with A's derived parent equity beside it (M6a). */
function derivedRow(mod, derivedTotal, nci) {
  const row = rowOf(mod, "AAPL");
  const asOf = row.m.balanceSheet.asOf;
  const d = E.derivedParentEquity(derivedTotal, [[asOf, nci]], asOf);
  row.m.balanceSheet = { ...row.m.balanceSheet, equity: null, equityIncludesNci: false, equityOnlyInclNci: true, derivedEquity: { val: d.equity, est: d.est } };
  return viaJson(row);
}

// ── 1-3, 5: the module ──────────────────────────────────────────────────────
function moduleRules(mod) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const close = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

  // 1. M2: AVAV's balance sheet tags long-term debt and cash, not short-term debt.
  const avav = rowOf(mod, "AVAV");
  const bs = avav.m.balanceSheet;
  const fa = mod.applySecPickerRow(avav, PRICE);
  want("fixture: AVAV leaves only short-term debt untagged", bs.shortTermDebt === null && bs.longTermDebt !== null && bs.cash !== null, JSON.stringify(bs));
  want("M2: AVAV's Ent. Value = cap + long-term debt − cash (short-term debt counted as zero)",
    close(fa.enterpriseValue, fa.marketCap + bs.longTermDebt - bs.cash), `${fa.enterpriseValue}`);
  const evNote = E.estimateOf("ev-short-term-debt-untagged", bs.asOf).note;
  want("M2: the figure carries A's mark (estimate) and A's note, with the balance-sheet date",
    fa.marks?.ev?.kind === "estimate" && fa.marks.ev.note === evNote && /balance sheet as at \d{1,2} [A-Z][a-z]{2} \d{4}/.test(fa.marks.ev.note), JSON.stringify(fa.marks));
  want("M2: the mark is A's EstimateMark shape, nothing else", fa.marks?.ev && Object.keys(fa.marks.ev).sort().join() === "kind,note");
  // A's bank gate (#552 COWORK #113), carried through the stored row's SIC.
  const avavBank = mod.applySecPickerRow(rowOf(mod, "AVAV", { sic: "6022" }), PRICE);
  want("bank gate: the same balance sheet under a bank SIC gets no ≈ EV and no mark", avavBank.enterpriseValue === null && !avavBank.marks?.ev, JSON.stringify(avavBank.marks));
  const avavOld = viaJson(avav);
  delete avavOld.inputs.sic;
  const fOld = mod.applySecPickerRow(avavOld, PRICE);
  want("a row written before the SIC was stored (or with no SIC) gets no ≈ EV (fail-closed)", fOld.enterpriseValue === null && !fOld.marks?.ev);
  want("the row stores the filer's SIC for the gate", avav.inputs.sic === "3812", JSON.stringify(avav.inputs));
  const ktos = mod.applySecPickerRow(rowOf(mod, "KTOS"), PRICE);
  want("KTOS (long-term debt untagged too): still refused, no mark", ktos.marketCap !== null && ktos.enterpriseValue === null && !ktos.marks);
  const aapl = mod.applySecPickerRow(rowOf(mod, "AAPL"), PRICE);
  want("AAPL (every line filed): the filed EV, no mark", aapl.enterpriseValue !== null && !aapl.marks);

  // 2. M6a.
  const dRow = derivedRow(mod, 455e9, 55e9);
  const fd = mod.applySecPickerRow(dRow, PRICE);
  want("M6a: P/B = cap ÷ (total equity − filed NCI), marked derived with A's note",
    close(fd.pbRatio, fd.marketCap / 400e9) && fd.marks?.pb?.kind === "derived" && fd.marks.pb.note === dRow.m.balanceSheet.derivedEquity.est.note,
    `${fd.pbRatio} ${JSON.stringify(fd.marks)}`);
  const nRow = derivedRow(mod, 50e9, 55e9);
  const fn = mod.applySecPickerRow(nRow, PRICE);
  const whyN = mod.secPickerWhy(nRow, PRICE, fn, mod.applySecEarnings(nRow, PRICE), "Software - Application");
  want("M6a: a non-positive derived equity is the \"Neg.\" refusal, unmarked",
    fn.pbRatio === null && !fn.marks?.pb && whyN.pb === "eqNeg" && mod.secPickerWords(whyN).pb === V.REFUSAL_CELL_WORD["equity-is-zero-or-negative"],
    `${fn.pbRatio} ${whyN.pb} ${mod.secPickerWords(whyN).pb}`);
  const whyD = mod.secPickerWhy(dRow, PRICE, fd, mod.applySecEarnings(dRow, PRICE), "Software - Application");
  want("M6a: a shown derived P/B has no reason code (it is a figure, not a gap)", whyD.pb === undefined, String(whyD.pb));

  // 3. Every marked figure is shown; every figure A's layer marks is marked.
  const cases = [];
  for (const s of ["AAPL", "TSLA", "AZN", "KTOS", "AVAV", "GEV", "KGC", "AUR", "BYND", "NBIS", "WKHS", "AXTI"]) {
    let row;
    try { row = rowOf(mod, s); } catch { continue; }
    cases.push([s, row, PRICE], [`${s} no price`, row, null]);
  }
  cases.push(["derived", dRow, PRICE], ["derived neg", nRow, PRICE]);
  const peso = viaJson(avav);
  peso.unit = { reporting: "COP", converted: false };
  cases.push(["AVAV in unconverted pesos", peso, PRICE]);
  for (const [name, row, price] of cases) {
    const f = mod.applySecPickerRow(row, price);
    for (const [col, field] of [["ev", "enterpriseValue"], ["pb", "pbRatio"]]) {
      if (f.marks?.[col]) want(`${name} ${col}: a mark only beside a shown figure`, f[field] !== null);
    }
    // What A's layer itself says about these figures (independent of the module under test).
    const inputs = { shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals, sic: row.inputs.sic ?? null };
    const cap = V.marketCap(inputs, price);
    const evA = E.enterpriseValueOf(cap?.ok ? cap.val : null, row.m.balanceSheet, row.inputs.sic ?? null);
    const pbA = V.valuationMultiples(inputs, row.m, price, { withEstimates: true }).pb;
    if (f.enterpriseValue !== null && evA.val !== null && evA.est) want(`${name} ev: A's estimate is shown with its mark`, f.marks?.ev?.kind === evA.est.kind);
    if (f.pbRatio !== null && pbA?.ok && pbA.est) want(`${name} pb: A's derived figure is shown with its mark`, f.marks?.pb?.kind === pbA.est.kind);
  }
  want("an unconverted currency: no Ent. Value and no mark", mod.applySecPickerRow(peso, PRICE).enterpriseValue === null && !mod.applySecPickerRow(peso, PRICE).marks);

  // 5. A's words, by code, and only in the ratio columns.
  const word = (col, code) => mod.secPickerWords({ [col]: code })[col];
  const A = V.REFUSAL_CELL_WORD;
  want("P/E on a loss: A's word", word("pe", "epsNeg") === A["eps-is-zero-or-negative"] && A["eps-is-zero-or-negative"] === "Loss");
  want("P/E on EPS near zero: A's word (\"Not meaningful\")", word("pe", "eps0") === A["eps-near-zero"] && A["eps-near-zero"] === "Not meaningful");
  want("P/S on an incomplete revenue line: A's word", word("ps", "revInc") === A["revenue-line-incomplete"]);
  want("P/B on negative equity: A's word", word("pb", "eqNeg") === A["equity-is-zero-or-negative"]);
  want("P/B on equity under 1% of market value: A's word (\"Not meaningful\")", word("pb", "eqSmall") === A["equity-too-small-for-pb"] && A["equity-too-small-for-pb"] === "Not meaningful");
  want("an A word only in the column its refusal belongs to (no \"Loss\" on P/B, no \"Neg.\" on P/E)", word("pb", "epsNeg") === undefined && word("pe", "eqNeg") === undefined && word("ps", "eps0") === undefined);
  want("every refusal A gives a word is reachable by its grid code",
    Object.keys(A).every((r) => mod.REFUSAL_WORD_BY_CODE[mod.WHY_FOR_REFUSAL[r]] === A[r]));
  want("a figure column keeps its dash (Revenue on an incomplete line, EPS on a loss)", word("revenue", "revInc") === undefined && word("eps", "epsNeg") === undefined);
  want("a gap in the data has no word (no EPS, short-term debt + cash missing)", word("pe", "noEps") === undefined && word("ev", "evIn") === undefined);
  const bank = mod.secPickerWhy(rowOf(mod, "AZN"), PRICE, mod.applySecPickerRow(rowOf(mod, "AZN"), PRICE), null, "Banks - Regional");
  const bankMark = W.cellMark("ev", bank.ev, mod.secPickerWords(bank).ev);
  want("B's bank/insurer rule stays: a bank's Ent. Value reads n/a", bank.ev === "naEv" && bankMark.mark === "n/a" && bankMark.word, JSON.stringify(bankMark));
  return fails;
}

const realMod = moduleRules(REAL);
for (const f of realMod) check(f, false);
check("1-3, 5. the module: M2 ≈ EV, derived P/B, marks only where figures are, A's words", realMod.length === 0);

// No string of A's is copied into the client words module or Pickers' server module.
{
  const wordsCode = stripComments(read(WORDS), { file: WORDS });
  const modCode = stripComments(moduleSrc, { file: MODULE });
  const aOnly = [...new Set(Object.values(V.REFUSAL_CELL_WORD))].filter((w) => w !== "Neg.");
  const copied = aOnly.filter((w) => wordsCode.includes(JSON.stringify(w)) || modCode.includes(JSON.stringify(w)));
  check("A's words are imported, not copied (no \"Loss\" / \"Not meaningful\" literal in Pickers' modules)", copied.length === 0, copied.join(", "));
  const aCodes = new Set(Object.keys(V.REFUSAL_CELL_WORD).map((r) => REAL.WHY_FOR_REFUSAL[r]));
  const shadowed = Object.entries(W.CELL_WORDS).flatMap(([col, m]) => Object.keys(m).filter((c) => aCodes.has(c)).map((c) => `${col}.${c}`));
  check("the client word table does not redefine a word A gives", shadowed.length === 0, shadowed.join(", "));
  check("lib/pickerCellWhy.ts imports nothing (the client grid loads it)", !/^\s*import\b/m.test(wordsCode));
}

// ── 3 + 4. RENDERED ─────────────────────────────────────────────────────────
function renderRules(C) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const avav = REAL.applySecPickerRow(rowOf(REAL, "AVAV"), PRICE);
  const derived = REAL.applySecPickerRow(derivedRow(REAL, 455e9, 55e9), PRICE);
  const cell = (props) => html(React.createElement(C.EstimateCell, { empty: "–", ...props }));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

  const m2 = cell({ text: "1.23B", est: avav.marks.ev });
  want("an M2 Ent. Value renders ≈ in the estimate colour, with A's note on hover",
    m2.includes("≈") && m2.includes("1.23B") && /color:#7dd3fc/i.test(m2) && m2.includes(`title="${esc(avav.marks.ev.note)}"`), m2);
  want("...and is keyboard-operable (A's control)", /role="button"/.test(m2) && /tabindex="0"/.test(m2), m2);
  const dv = cell({ text: "2.50", est: derived.marks.pb });
  want("a derived P/B renders \"derived\" with its note, not ≈", />derived<\/span>/.test(dv) && !dv.includes("≈") && dv.includes(`title="${esc(derived.marks.pb.note)}"`), dv);
  const plain = cell({ text: "2.50", est: undefined });
  want("a filed figure renders plain: no ≈, no colour, no \"derived\"", plain === "2.50", plain);
  want("an empty figure renders the caller's dash", cell({ text: null, est: avav.marks.ev }) === "–");
  const inert = cell({ text: "1.23B", est: avav.marks.ev, inert: true });
  want("inside the phone row's button the mark still shows, but inert (no nested control)",
    inert.includes("≈") && /^<span inert="">/.test(inert), inert);
  for (const [label, h] of [["estimate", m2], ["derived", dv], ["inert", inert]]) {
    want(`no estimate renders without its mark (${label})`, h.includes("≈") || />derived</.test(h), h);
  }

  // 4. The key.
  const key = (marks) => html(React.createElement(C.PickerEstimateKey, { marks }));
  want("no marks → no key", key([]) === "");
  const kE = key([avav.marks.ev]);
  want("≈ only → the key lists Estimate, not derived", kE.includes("≈ Estimate") && !/>derived</.test(kE) && /data-estimate-key/.test(kE), kE);
  const kB = key([avav.marks.ev, derived.marks.pb]);
  want("both kinds → the key lists both", kB.includes("≈ Estimate") && />derived</.test(kB), kB);
  const rows = [{ symbol: "AVAV", cellEst: avav.marks }, { symbol: "AAPL" }, { symbol: "DRV", cellEst: derived.marks }];
  const table = C.estimateMarksShown(rows, () => ["symbol", "ev", "pb", "pe"]);
  want("the table: every shown row's marked cells", table.length === 2, JSON.stringify(table));
  const phoneShut = C.estimateMarksShown(rows, () => ["pe"]);
  want("a phone row showing only a P/E headline: no mark visible, so no key", phoneShut.length === 0 && key(phoneShut) === "");
  const phoneOpen = C.estimateMarksShown(rows, (e) => (e.symbol === "AVAV" ? ["pe", "ev", "pb"] : ["pe"]));
  want("an expanded phone row's marked metric is visible, and keyed", phoneOpen.length === 1 && key(phoneOpen).includes("≈ Estimate") && !/>derived</.test(key(phoneOpen)));
  return fails;
}
{
  let fails;
  try { fails = renderRules(await loadComponents()); } catch (err) { fails = [String(err)]; }
  for (const f of fails) check(f, false);
  check("3-4. rendered: ≈ with its note, \"derived\", plain filed figures, the key only when marked", fails.length === 0);
}

// ── 3, 4, 6. the grid and the page (comments stripped) ──────────────────────
function uiRules(gridSrc, pageSrc) {
  const g = stripComments(gridSrc, { file: GRID });
  const p = stripComments(pageSrc, { file: PAGE });
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("the Ent. Value cell renders through EstimateCell with the row's mark",
    /const ev: Col = \{ key: "ev",[^\n]*cell: \(e, _d, inert\) => <EstimateCell text=\{fmtCap\(num\(e\.enterpriseValue\)\)\} est=\{e\.cellEst\?\.ev\} inert=\{inert\}/.test(g));
  want("the PB cell renders through EstimateCell with the row's mark",
    /const pb: Col = \{ key: "pb",[^\n]*cell: \(e, _d, inert\) => <EstimateCell text=\{fmtNum\(num\(e\.pbRatio\)\)\} est=\{e\.cellEst\?\.pb\} inert=\{inert\}/.test(g));
  want("sort unchanged: Ent. Value and PB still sort on the number",
    /const ev: Col = \{ key: "ev", label: "Ent\. Value", sortType: "num", get: \(e\) => num\(e\.enterpriseValue\),/.test(g) &&
      /const pb: Col = \{ key: "pb", label: "PB Ratio", sortType: "num", get: \(e\) => num\(e\.pbRatio\),/.test(g) &&
      /return compareForSort\(sortCol\.get\(a, da\), sortCol\.get\(b, db\), sortCol\.sortType, sort\.dir\);/.test(g));
  want("the key renders under the table and the phone list, from the shown marks",
    /\{shown\.length && \(showMobileRows \|\| viewMode === "list"\) \? \(\s*<PickerEstimateKey marks=\{shownEstimateMarks\} \/>/.test(g));
  want("the shown marks: table columns; on a phone the headline, plus an expanded row's metrics",
    /const shownEstimateMarks = estimateMarksShown\(shown, \(e\) =>\s*showMobileRows\s*\? \(expandedRows\.has\(e\.symbol\) \? \[\.\.\.headKeys, \.\.\.metricColumns\.map\(\(c\) => c\.key\)\] : headKeys\)\s*: activeColumns\.map\(\(c\) => c\.key\)/.test(g));
  want("the grid passes A's word to the mark", /const aWord = \(e\.cellWord as [^;]*\)\?\.\[key\];[\s\S]{0,200}cellMark\(key, code, aWord\)/.test(g));
  want("the page ships the marks and A's words", /if \(figures\.marks\) entry\.cellEst = figures\.marks;/.test(p) && /const words = secPickerWords\(why\);\s*if \(Object\.keys\(words\)\.length\) entry\.cellWord = words;/.test(p));
  return fails;
}
const gridSrc = read(GRID);
const pageSrc = read(PAGE);
{
  const fails = uiRules(gridSrc, pageSrc);
  for (const f of fails) check(f, false);
  check("3, 4, 6. the grid and page: marked cells through EstimateCell, the key, the shipped words, sort on the number", fails.length === 0);
}
// 1, wiring: the job and the seed hand the filer's SIC to the row (A's bank
// gate is fail-closed, so without it no ≈ EV would ever be shown).
const JOB = "app/api/jobs/warm-pickers-sec/route.ts";
const SEED = "scripts/pickers-sec-seed.mjs";
function wiringRules(jobSrc, seedSrc) {
  const j = stripComments(jobSrc, { file: JOB });
  const sd = stripComments(seedSrc, { file: SEED });
  const fails = [];
  if (!/warmPickersSec\(symbols, \(s\) => \(\{[\s\S]*?\bsic: registrantFor\(s\)\?\.sic \?\? null,[\s\S]*?\}\)\)/.test(j)) fails.push("the job passes registrantFor(s)?.sic as the filer's SIC");
  if (!/warmPickersSec\(symbols, \(s\) => \(\{[\s\S]*?\bsic: REGISTRANTS\[s\]\?\.sic \?\? null,[\s\S]*?\}\), Date\.now\(\), KEY\)/.test(sd)) fails.push("the seed passes REGISTRANTS[s]?.sic as the filer's SIC");
  return fails;
}
const jobSrc = read(JOB);
const seedSrc = read(SEED);
{
  const fails = wiringRules(jobSrc, seedSrc);
  for (const f of fails) check(f, false);
  check("1. wiring: the job and the seed store the filer's SIC for A's bank gate", fails.length === 0);
}
// 6, behaviourally: the comparator on the two columns' values, marked or not.
{
  const vals = [{ s: "A", v: 3.1 }, { s: "EST", v: 1.2 }, { s: "NONE", v: null }, { s: "DRV", v: 0.4 }];
  const order = (dir) => vals.slice().sort((a, b) => W.compareForSort(a.v, b.v, "num", dir)).map((x) => x.s).join(",");
  check("6. a marked figure sorts by its number, a blank last, both ways", order("asc") === "DRV,EST,A,NONE" && order("desc") === "A,EST,DRV,NONE", `${order("asc")} / ${order("desc")}`);
}

// ── 7. mutants ──────────────────────────────────────────────────────────────
console.log("\n  mutants (each must be caught)");
const MODULE_MUTANTS = [
  ["Pickers' own EV maths again (no M2)", "const evFig = enterpriseValueOf(cap, row.m.balanceSheet, row.inputs.sic ?? null);",
    "const evFig = (() => { const b = row.m.balanceSheet; return cap !== null && b && b.shortTermDebt !== null && b.longTermDebt !== null && b.cash !== null ? { val: cap + b.shortTermDebt + b.longTermDebt - b.cash } : { val: null, missing: [] }; })() as ReturnType<typeof enterpriseValueOf>;"],
  ["the opt-in dropped (no derived P/B)", "const PICKERS_VALUATION_OPTS = { withEstimates: true } as const;", "const PICKERS_VALUATION_OPTS = { withEstimates: false } as const;"],
  ["the EV mark dropped (an ≈ figure unmarked)", "  if (evMark) marks.ev = evMark;\n", ""],
  ["the P/B mark dropped (a derived figure unmarked)", "  if (pbMark) marks.pb = pbMark;\n", ""],
  ["a mark on a non-dollar row", "const evMark = usd && evFig.val !== null", "const evMark = evFig.val !== null"],
  ["A's word lookup removed", "const word = REFUSAL_WORD_CODES[col]?.includes(code) ? REFUSAL_WORD_BY_CODE[code] : undefined;", "const word = undefined as string | undefined;"],
  ["A's word spread to a figure column", `  pe: ["epsNeg", "eps0"],\n`, `  pe: ["epsNeg", "eps0"],\n  revenue: ["revInc"],\n  eps: ["epsNeg"],\n`],
  ["A's word in any ratio column, whatever the code", `REFUSAL_WORD_CODES[col]?.includes(code) ? REFUSAL_WORD_BY_CODE[code]`, `REFUSAL_WORD_CODES[col] ? REFUSAL_WORD_BY_CODE[code]`],
  ["the bank gate skipped (a SIC-less EV call)", "const evFig = enterpriseValueOf(cap, row.m.balanceSheet, row.inputs.sic ?? null);", `const evFig = enterpriseValueOf(cap, row.m.balanceSheet, "3812");`],
  ["the SIC not stored on the row", "    inputs: { shares: inputs.shares, refusals: inputs.refusals, ...(inputs.sic ? { sic: inputs.sic } : {}) },\n", "    inputs: { shares: inputs.shares, refusals: inputs.refusals },\n"],
];
for (const [label, from, to] of MODULE_MUTANTS) {
  let fails;
  try { fails = moduleRules(await loadSibling(MODULE, once(moduleSrc, from, to))); } catch (err) { fails = [String(err)]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const RENDER_MUTANTS = [
  ["EstimateCell ignores the mark", MARKS, "  if (!est) return <>{text}</>;", "  if (est || !est) return <>{text}</>;"],
  ["the key shown with no marks", MARKS, "return <EstimateKey marks={marks}", "return marks.length ? <EstimateKey marks={marks}"],
  ["the phone inert wrapper dropped", MARKS, "  if (inert) return <span inert>{marked}</span>;\n", ""],
  ["the shown marks ignore the visible columns", MARKS, "    for (const k of keysFor(e)) {", "    for (const k of Object.keys(marks)) {"],
];
for (const [label, rel, from, to] of RENDER_MUTANTS) {
  let fails;
  try {
    let src = once(read(rel), from, to);
    if (label === "the key shown with no marks") src = once(src, `style={{ margin: "8px 2px 0", color: "rgba(203,213,225,0.9)" }} />;`, `style={{ margin: "8px 2px 0", color: "rgba(203,213,225,0.9)" }} /> : <span data-estimate-key="" />;`);
    fails = renderRules(await loadComponents({ [rel]: src }));
  } catch (err) { fails = [String(err)]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const UI_MUTANTS = [
  ["the Ent. Value cell back to capCell (≈ figure unmarked)", GRID,
    "cell: (e, _d, inert) => <EstimateCell text={fmtCap(num(e.enterpriseValue))} est={e.cellEst?.ev} inert={inert} empty={MUTED} /> };",
    "cell: (e) => capCell(num(e.enterpriseValue)) };"],
  ["the PB cell drops its mark", GRID, "est={e.cellEst?.pb}", "est={undefined}"],
  ["the key removed from the grid", GRID, "<PickerEstimateKey marks={shownEstimateMarks} />", "null"],
  ["PB sorted by something other than its number", GRID, `sortType: "num", get: (e) => num(e.pbRatio),`, `sortType: "num", get: (e) => (e.cellEst?.pb ? null : num(e.pbRatio)),`],
  ["the page drops the marks", PAGE, "if (figures.marks) entry.cellEst = figures.marks;", "void figures;"],
  ["the page drops A's words", PAGE, "if (Object.keys(words).length) entry.cellWord = words;", "void words;"],
];
for (const [label, file, from, to] of UI_MUTANTS) {
  let fails;
  try {
    fails = file === GRID ? uiRules(once(gridSrc, from, to), pageSrc) : uiRules(gridSrc, once(pageSrc, from, to));
  } catch (err) { fails = [String(err)]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

const WIRING_MUTANTS = [
  ["the job drops the SIC", "job", "      sic: registrantFor(s)?.sic ?? null,\n", ""],
  ["the seed drops the SIC", "seed", "  sic: REGISTRANTS[s]?.sic ?? null,\n", ""],
];
for (const [label, where, from, to] of WIRING_MUTANTS) {
  let fails;
  try { fails = where === "job" ? wiringRules(once(jobSrc, from, to), seedSrc) : wiringRules(jobSrc, once(seedSrc, from, to)); } catch (err) { fails = [String(err)]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
