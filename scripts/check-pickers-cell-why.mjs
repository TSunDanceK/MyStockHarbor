// EVERY EMPTY PICKERS CELL SAYS WHY (#553 COWORK #69, 2026-10-01).
//
// What must hold, and how each is shown:
//   1. Every refusal A's secValuation can return has a grid code, and every
//      code has words (lib/pickerCellWhy.ts) -- parsed from the source, so a
//      new refusal fails here before it can reach a page as a bare dash.
//   2. EXECUTED on the committed SEC fact-set fixtures (and a no-price, a bank
//      and a non-dollar variant): for each filings column, an empty figure
//      always carries a code with words, a filled one never does, and the
//      known cases get the known reason (AZN's cover, KTOS's negative FCF, a
//      bank's n/a).
//   3. The page attaches the codes; the grid wraps every column so an empty
//      cell renders the reason mark, and prints the table note.
//   4. MKC-V (dashed in the universe, dotted in the live directory) has a
//      committed name, and the page falls back to it.
//   5. WORD CELLS (#553 COWORK #94 Part 1): "EPS not positive" on P/E reads
//      "Loss", negative FCF on P/FCF and negative equity on P/B read "Neg.",
//      a bank's Ent. Value / P/S / P/FCF read "n/a"; every other reason stays
//      "–". A word cell sorts with the blanks, never as zero. RENDERED
//      (app/components/PickerCellMarks.tsx through react-dom/server).
//   6. THE FY MARKER (#553 COWORK #90) renders BEFORE the figure, in a slot
//      that is there with or without it. RENDERED.
//   7. #91: n/a only on an empty cell (a bank's filed figure keeps it); no
//      hard-coded ticker list in the reasons; a refusal A adds without words
//      fails here.
//   8. #103 (2026-10-03): the table note is the TAB's -- the SEC wording only
//      on tabs whose visible columns all come from the filings, the word cells
//      named on exactly the tabs that can show them -- with "Tap" on touch
//      (rendered, plus the CSS media rule); the .whyPop popover fits a 360 px
//      screen (static CSS rule, plus the shift's arithmetic); and an FCF of
//      exactly 0 reads "–" with its own reason, not "Neg." (behavioural, on a
//      fixture variant).
//   9. Mutants: each rule above broken once, and caught.
//
// No Redis, no network: fixtures and source only.
//
//   node scripts/check-pickers-cell-why.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MODULE = "lib/server/pickersSecFundamentals.ts";
const WORDS = "lib/pickerCellWhy.ts";
const GRID = "app/components/PickerResultsGrid.tsx";
const PAGE = "app/components/PickerResultPage.tsx";
const MARKS = "app/components/PickerCellMarks.tsx";
const TODAY = "2026-09-23";
const NOW = Date.parse(TODAY);
const PRICE = 100;
const fixture = (s) => JSON.parse(read(`data/sec/factset-fixture-${s}.json`));

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-why-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// Grid column key -> the figure it shows.
const COLUMN_FIGURE = {
  marketCap: ["f", "marketCap"], ps: ["f", "psRatio"], pb: ["f", "pbRatio"], ev: ["f", "enterpriseValue"],
  pfcf: ["f", "pfcfRatio"], revenue: ["f", "revenue"], opinc: ["f", "operatingIncome"], netinc: ["f", "netIncome"],
  fcf: ["f", "freeCashFlow"], dps: ["f", "divPerShare"], dyield: ["f", "divYield"], dgrowth: ["f", "divGrowth"],
  pe: ["e", "peRatio"], eps: ["e", "epsTtm"], payout: ["e", "payoutRatio"],
};

// ── 1 + 2. the codes, and the module on fixtures ────────────────────────────
const W = await import(pathToFileURL(path.join(ROOT, WORDS)).href);
const refusalUnion = (() => {
  const src = read("lib/server/secValuation.ts");
  const m = /export type ValuationRefusal =([\s\S]*?);/.exec(src);
  return m ? [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]) : [];
})();

async function suite(mod, words, union = refusalUnion) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const has = (code) => Boolean(code && words.CELL_WHY_WORDS[code]);

  want("ValuationRefusal parsed from secValuation.ts", union.length >= 10, String(union.length));
  const missing = union.filter((r) => !has(mod.WHY_FOR_REFUSAL[r]));
  want("every refusal A can return has a code with words", missing.length === 0, missing.join(", "));
  want("the grid's columns are the ones the check maps", JSON.stringify([...words.CELL_WHY_COLUMNS].sort()) === JSON.stringify(Object.keys(COLUMN_FIGURE).sort()));

  const cases = [];
  for (const s of ["AAPL", "TSLA", "AZN", "KTOS", "AVAV", "GEV", "KGC", "AUR", "BYND", "NBIS", "WKHS", "AXTI"]) {
    let set;
    try { set = fixture(s); } catch { continue; }
    const row = JSON.parse(JSON.stringify(mod.buildSecPickerRow(set, TODAY, {}, NOW)));
    cases.push({ name: s, row, price: PRICE, industry: "Software - Application" });
    cases.push({ name: `${s} no price`, row, price: null, industry: null });
    cases.push({ name: `${s} as a bank`, row, price: PRICE, industry: "Banks - Regional" });
  }
  // #103: a filer whose free cash flow is exactly 0 (KTOS's row, FCF zeroed).
  const ktos = cases.find((c) => c.name === "KTOS");
  if (ktos) {
    const zero = JSON.parse(JSON.stringify(ktos.row));
    zero.freeCashFlow = 0;
    cases.push({ name: "KTOS with FCF of 0", row: zero, price: PRICE, industry: "Software - Application" });
  }
  const nonUsd = JSON.parse(JSON.stringify(cases[0].row));
  nonUsd.unit = { reporting: "COP", converted: false };
  cases.push({ name: "AAPL in unconverted pesos", row: nonUsd, price: PRICE, industry: null });

  const byName = {};
  for (const c of cases) {
    const f = mod.applySecPickerRow(c.row, c.price);
    const e = mod.applySecEarnings(c.row, c.price);
    const why = mod.secPickerWhy(c.row, c.price, f, e, c.industry);
    byName[c.name] = { f, e, why };
    for (const [col, [src, field]] of Object.entries(COLUMN_FIGURE)) {
      const holder = src === "f" ? f : e;
      if (!holder) {
        want(`${c.name} ${col}: no reason when the page applies no figure`, why[col] === undefined);
        continue;
      }
      const empty = holder[field] === null;
      if (empty) want(`${c.name} ${col}: an empty cell carries a reason with words`, has(why[col]), String(why[col]));
      else want(`${c.name} ${col}: a filled cell carries no reason`, why[col] === undefined, String(why[col]));
    }
  }
  const at = (n) => byName[n]?.why ?? {};
  want("AZN: the cap's refusal is A's (no cover share count / ADS), on every cap column",
    ["marketCap", "ps", "pb"].every((k) => at("AZN")[k] && at("AZN")[k] === at("AZN").marketCap) &&
      ["noShr", "adsS", "multi"].includes(at("AZN").marketCap), JSON.stringify(at("AZN")));
  want("KTOS: negative free cash flow is said as such on P/FCF", at("KTOS").pfcf === "fcfNeg", String(at("KTOS").pfcf));
  // #103: zero is not negative. FCF of exactly 0 -> "–" with its own reason.
  {
    const z = byName["KTOS with FCF of 0"];
    want("FCF of 0: the fixture variant ran", Boolean(z));
    const code = z?.why.pfcf;
    const m = words.cellMark("pfcf", code);
    want("FCF of 0: P/FCF carries the zero-FCF reason, not the negative one", code === "fcf0", String(code));
    want("FCF of 0: P/FCF reads '–', not 'Neg.'", m.mark === "–" && !m.word, JSON.stringify(m));
    want("FCF of 0: the reason says free cash flow is zero", /free cash flow is zero/i.test(words.cellWhyWords(code)) && words.cellWhyWords(code) !== words.CELL_WHY_DEFAULT, words.cellWhyWords(code));
    want("FCF of 0: the FCF column itself still shows the 0", z?.f.freeCashFlow === 0 && z?.why.fcf === undefined, String(z?.f.freeCashFlow));
  }
  want("a bank's empty Ent. Value / P/S / P/FCF read n/a",
    Object.entries(at("KTOS as a bank")).filter(([k]) => ["ev", "ps", "pfcf"].includes(k)).every(([, v]) => words.NOT_APPLICABLE_CODES.has(v)) &&
      at("KTOS as a bank").pfcf === "naFcf" && at("AZN as a bank").ps === "naPs" && at("AZN as a bank").ev === "naEv",
    JSON.stringify(at("AZN as a bank")));
  want("n/a is for banks only (KTOS as software keeps its reason)", !Object.values(at("KTOS")).some((v) => words.NOT_APPLICABLE_CODES.has(v)));
  want("no price: the cap's dash says so", at("AAPL no price").marketCap === "noPx", String(at("AAPL no price").marketCap));
  want("unconverted currency: money columns say fx", at("AAPL in unconverted pesos").revenue === "fx" && at("AAPL in unconverted pesos").netinc === "fx");
  want("bank/insurer test: banks and carriers in, brokers out",
    words.isBankOrInsurer("Banks - Diversified") && words.isBankOrInsurer("Insurance - Life") &&
      !words.isBankOrInsurer("Insurance - Brokers") && !words.isBankOrInsurer("Financial - Capital Markets") && !words.isBankOrInsurer(null));
  // #94 Part 1: the word cells, by column and code; every other reason a dash.
  const mk = (col, code) => words.cellMark(col, code);
  want("P/E on a loss reads Loss", mk("pe", "epsNeg").mark === "Loss" && mk("pe", "epsNeg").word, JSON.stringify(mk("pe", "epsNeg")));
  want("P/FCF on negative FCF reads Neg.", mk("pfcf", "fcfNeg").mark === "Neg." && mk("pfcf", "fcfNeg").word, JSON.stringify(mk("pfcf", "fcfNeg")));
  want("P/B on negative equity reads Neg.", mk("pb", "eqNeg").mark === "Neg." && mk("pb", "eqNeg").word, JSON.stringify(mk("pb", "eqNeg")));
  want("a bank's Ent. Value / P/S / P/FCF read n/a",
    mk("ev", "naEv").mark === "n/a" && mk("ps", "naPs").mark === "n/a" && mk("pfcf", "naFcf").mark === "n/a");
  want("every other reason stays a dash (EPS near zero, no dividend, not enough history, no EPS, no price)",
    [["pe", "eps0"], ["pe", "noEps"], ["dps", "noDiv"], ["dyield", "noDiv"], ["dgrowth", "noDg"], ["marketCap", "noPx"], ["pe", null], ["eps", "epsNeg"]]
      .every(([c, k]) => mk(c, k).mark === "–" && !mk(c, k).word));
  const wordCodes = Object.values(words.CELL_WORDS).flatMap((m) => Object.keys(m));
  want("every word cell's code has words for its hover", wordCodes.every(has), wordCodes.join(","));
  // A word cell carries no figure: the grid's get() is null there, and the
  // comparator must sink it below every figure in both directions.
  const vals = [{ s: "A", v: 3 }, { s: "LOSS", v: null }, { s: "B", v: 0.5 }, { s: "NEG", v: null }, { s: "C", v: 12 }];
  const order = (dir) => vals.slice().sort((a, b) => words.compareForSort(a.v, b.v, "num", dir)).map((x) => x.s).join(",");
  want("a word cell sorts with the blanks, last both ways (never as zero)",
    order("asc") === "B,A,C,LOSS,NEG" && order("desc") === "C,A,B,LOSS,NEG", `${order("asc")} / ${order("desc")}`);
  // #91: a bank's FILED figure keeps it -- n/a only where the cell is empty.
  for (const n of Object.keys(byName).filter((k) => k.endsWith("as a bank"))) {
    const { f, why } = byName[n];
    for (const [col, field] of [["ev", "enterpriseValue"], ["ps", "psRatio"], ["pfcf", "pfcfRatio"]]) {
      if (f[field] !== null) want(`${n} ${col}: a filed figure is not replaced by n/a`, why[col] === undefined, String(why[col]));
    }
  }
  want("the table note is the owner's wording", words.CELL_WHY_TABLE_NOTE.startsWith("Figures come from company SEC filings; '–' means the filing doesn't give enough to calculate it."));
  return fails;
}

const moduleSrc = read(MODULE);
const wordsSrc = read(WORDS);
const real = await suite(await import(pathToFileURL(path.join(ROOT, MODULE)).href), W);
for (const f of real) check(f, false);
check("the reasons hold on the real modules", real.length === 0);

// ── #91: no hard-coded ticker list in the reasons ───────────────────────────
{
  const code = stripComments(wordsSrc, { file: WORDS }) + stripComments(moduleSrc.slice(moduleSrc.indexOf("export const WHY_FOR_REFUSAL")), { file: MODULE });
  const tickers = [...code.matchAll(/["']([A-Z]{1,5}(?:[.-][A-Z]{1,2})?)["']/g)].map((m) => m[1]).filter((t) => t !== "FY" && t !== "USD");
  check("no ticker symbols are hard-coded in the reasons (A's labels and refusals drive them)", tickers.length === 0, tickers.join(","));
}

// ── 5 + 6. RENDERED: word cells and the FY marker ───────────────────────────
// PickerCellMarks imports React and lib/pickerCellWhy.ts only; it is transpiled
// with JSX on and its "@/" import pointed at the real file, then rendered.
const marksSrc = read(MARKS);
async function loadMarks(src, wordsHref = pathToFileURL(path.join(ROOT, WORDS)).href) {
  const js = ts.transpileModule(src.replace(`from "@/lib/pickerCellWhy"`, `from ${JSON.stringify(wordsHref)}`), {
    fileName: "marks.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  const tmp = path.join(ROOT, "scripts", `.check-why-marks-${process.pid}-${seq++}.mjs`);
  fs.writeFileSync(tmp, js);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
function renderRules(M, words) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const html = (el) => renderToStaticMarkup(el);
  const mark = (col, code) => {
    const m = words.cellMark(col, code);
    return html(React.createElement(M.WhyMark, { text: words.cellWhyWords(code), mark: m.mark, word: m.word, na: words.NOT_APPLICABLE_CODES.has(code) }));
  };
  for (const [col, code, word] of [["pe", "epsNeg", "Loss"], ["pfcf", "fcfNeg", "Neg."], ["pb", "eqNeg", "Neg."], ["ev", "naEv", "n/a"], ["ps", "naPs", "n/a"], ["pfcf", "naFcf", "n/a"]]) {
    const h = mark(col, code);
    want(`rendered: ${col} ${code} shows "${word}" in the lighter tone, with its reason on hover`,
      h.includes(`>${word}</span>`) && /class="whyMark whyWord"/.test(h) && h.includes(`title="${words.cellWhyWords(code).replace(/'/g, "&#x27;")}"`) && !h.includes(">–<"), h);
    want(`rendered: ${col} ${code} is keyboard-operable`, /role="button"/.test(h) && /tabindex="0"/.test(h), h);
  }
  const dash = mark("pe", "eps0");
  want("rendered: EPS near zero stays a dash with its reason", dash.includes(">–</span>") && /whyMark muted/.test(dash), dash);
  const fy = html(React.createElement(M.BasisCell, { value: "4.08", basis: "FY2025" }));
  const iFy = fy.indexOf(">FY<");
  const iVal = fy.indexOf("4.08");
  want("rendered: the FY marker comes BEFORE the figure", iFy >= 0 && iVal >= 0 && iFy < iVal, fy);
  want("rendered: the FY marker carries A's period in plain words on hover and tap",
    fy.includes("Based on the last full fiscal year on file (FY2025)") && /class="basisFy"[^>]*role="button"[^>]*tabindex="0"/.test(fy), fy);
  const ttm = html(React.createElement(M.BasisCell, { value: "4.08", basis: "TTM to 30 Jun 2026" }));
  want("rendered: a TTM figure keeps the same slot, empty, before the figure",
    /<span class="basisSlot"><\/span><span class="basisVal">4\.08<\/span>/.test(ttm) && !ttm.includes(">FY<"), ttm);
  want("rendered: the FY figure uses the same slot then value order",
    /<span class="basisSlot">[\s\S]*?FY[\s\S]*?<\/span><\/span><span class="basisVal">4\.08<\/span>/.test(fy), fy);
  return fails;
}
{
  let fails;
  try { fails = renderRules(await loadMarks(marksSrc), W); } catch (err) { fails = [String(err)]; }
  for (const f of fails) check(f, false);
  check("the rendered word cells and FY marker hold", fails.length === 0);
}

// ── 3. page and grid (comments stripped) ────────────────────────────────────
function uiRules(gridSrc, pageSrc, marksSource = marksSrc) {
  const g = stripComments(gridSrc, { file: GRID });
  const mk = stripComments(marksSource, { file: MARKS });
  const p = stripComments(pageSrc, { file: PAGE });
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("the page attaches secPickerWhy's codes to the entry", /const why = secPickerWhy\(row, [^;]*entry\.industry\);[\s\S]{0,80}entry\.cellWhy = why/.test(p));
  want("every column goes through withWhy", /sets\[tab\] = sets\[tab\]\.filter\(\(col\) => !HIDDEN_COLUMN_KEYS\.has\(col\.key\)\)\.map\(withWhy\);/.test(g));
  want("withWhy renders the reason mark for an empty value", /if \(!isEmptyValue\(col\.get\(e, d\)\)\) return filled\(e, d, inert\);\s*const why = cellWhyFor\(e, col\.key\);\s*return <WhyMark /.test(g));
  want("the mark carries its reason on hover and tap", /title=\{text\}[\s\S]{0,200}role="button"[\s\S]{0,900}\{open \? <span className="whyPop"/.test(mk));
  want("the grid hands the mark its word", /return <WhyMark text=\{why\.text\} mark=\{why\.mark\} word=\{why\.word\}/.test(g));
  want("the grid sorts through compareForSort", /return compareForSort\(sortCol\.get\(a, da\), sortCol\.get\(b, db\), sortCol\.sortType, sort\.dir\);/.test(g));
  want("the grid's filed figures go through BasisCell", /return <BasisCell value=\{value\} basis=\{basis\} inert=\{inert\} \/>;/.test(g));
  want("the table note is printed (the active tab's, #103)", /<CellWhyNote tab=\{activeTab\} \/>/.test(g));
  want("the page falls back to the committed name", /if \(entry\.companyName\) continue;\s*const name = cleanName\(gridCompanyName\(entry\.symbol\)\);/.test(p));
  return fails;
}
const gridSrc = read(GRID);
const pageSrc = read(PAGE);
const ui = uiRules(gridSrc, pageSrc);
for (const f of ui) check(f, false);
check("the page and grid rules hold", ui.length === 0);

// ── 8. #103: the per-tab note, the tap wording, the popover clamp ─────────
// The tab -> visible columns map is read from the grid's own column sets (less
// the hidden-fields registry), so a tab's note is judged against what the tab
// actually shows, not a list kept here.
const HIDDEN = await import(pathToFileURL(path.join(ROOT, "lib/pickerHiddenFields.ts")).href);
const OWNER_SEC_LEAD = "Figures come from company SEC filings; '–' means the filing doesn't give enough to calculate it";
function tabColumns(gridSource) {
  const block = /const sets: Record<TabKey, Col\[\]> = \{([\s\S]*?)\n\s*\};/.exec(gridSource)?.[1] ?? "";
  const out = {};
  for (const m of block.matchAll(/(\w+): \[([^\]]*)\]/g)) {
    out[m[1]] = m[2].split(",").map((x) => x.trim()).filter((k) => k && k !== "symbol" && k !== "name" && !HIDDEN.HIDDEN_COLUMN_KEYS.has(k));
  }
  return out;
}
/** The popover's max-width at a viewport width, from the CSS value: min(), px, vw, calc(100vw - Npx). */
function maxWidthAt(value, vw) {
  const inner = /^min\((.*)\)$/.exec(value.trim())?.[1] ?? value;
  const args = inner.split(/,(?![^(]*\))/).map((a) => a.trim());
  const px = args.map((a) => {
    let m;
    if ((m = /^(\d+(?:\.\d+)?)px$/.exec(a))) return Number(m[1]);
    if ((m = /^(\d+(?:\.\d+)?)vw$/.exec(a))) return (Number(m[1]) * vw) / 100;
    if ((m = /^calc\(100vw - (\d+(?:\.\d+)?)px\)$/.exec(a))) return vw - Number(m[1]);
    return NaN;
  });
  return px.some((n) => !Number.isFinite(n)) ? NaN : Math.min(...px);
}
function noteRules(gridSource, M, words) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const g = stripComments(gridSource, { file: GRID });
  const cols = tabColumns(gridSource);
  want("#103: the grid's tab column sets were read", Object.keys(cols).length >= 5 && (cols.valuation ?? []).includes("pfcf"), JSON.stringify(cols));
  const filings = new Set(words.CELL_WHY_COLUMNS);
  const WORD_MARKS = ["Loss", "Neg.", "n/a"];
  for (const [tab, keys] of Object.entries(cols)) {
    const note = words.CELL_WHY_TABLE_NOTE_BY_TAB?.[tab];
    want(`#103 ${tab}: has its own table note`, typeof note === "string" && note.length > 20, String(note));
    if (typeof note !== "string") continue;
    const allFilings = keys.length > 0 && keys.every((k) => filings.has(k));
    if (allFilings) want(`#103 ${tab}: every column is from the filings, so the note keeps the owner's SEC wording`, note.startsWith(OWNER_SEC_LEAD), note);
    else want(`#103 ${tab}: not every column is from the filings, so the note does not claim they all are`, !note.includes("Figures come from company SEC filings"), note);
    const canShow = new Set(keys.flatMap((k) => Object.values(words.CELL_WORDS[k] ?? {})));
    const named = new Set(WORD_MARKS.filter((w) => note.includes(`'${w}'`)));
    want(`#103 ${tab}: names exactly the word cells its columns can show`,
      [...canShow].every((w) => named.has(w)) && [...named].every((w) => canShow.has(w)), `can show ${[...canShow].join("/") || "none"}, names ${[...named].join("/") || "none"}`);
    want(`#103 ${tab}: the note leaves the hover/tap action to CELL_WHY_ACTION`, !/\b(Hover|Tap)\b/.test(note), note);
    const h = renderToStaticMarkup(React.createElement(M.CellWhyNote, { tab }));
    want(`#103 ${tab}: rendered note carries the tab's words, then hover and tap`,
      h.startsWith('<p class="cellWhyNote">') && h.includes(note.replace(/'/g, "&#x27;")) &&
        h.includes(`<span class="cellWhyHover">${words.CELL_WHY_ACTION.hover}</span><span class="cellWhyTap">${words.CELL_WHY_ACTION.tap}</span>`), h);
  }
  want("#103: the action says Hover on a pointer and Tap on touch",
    /^Hover\b/.test(words.CELL_WHY_ACTION?.hover ?? "") && /^Tap\b/.test(words.CELL_WHY_ACTION?.tap ?? ""), JSON.stringify(words.CELL_WHY_ACTION));
  want("#103: the grid prints the active tab's note", /<CellWhyNote tab=\{activeTab\} \/>/.test(g) && !/\{CELL_WHY_TABLE_NOTE\}/.test(g));
  // Static CSS: tap shown only on touch, hover hidden there.
  want("#103 CSS: 'Tap for why.' is hidden by default",
    /\.cellWhyTap \{ display: none; \}/.test(gridSource));
  want("#103 CSS: (hover: none) / (pointer: coarse) swaps hover for tap",
    /@media \(hover: none\), \(pointer: coarse\) \{\s*\.cellWhyHover \{ display: none; \}\s*\.cellWhyTap \{ display: inline; \}\s*\}/.test(gridSource));
  // Static CSS: the popover.
  const pop = /\.whyPop \{([^}]*)\}/.exec(gridSource)?.[1] ?? "";
  const decl = (prop) => new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+);`).exec(pop)?.[1]?.trim();
  want("#103 CSS: .whyPop is found", pop.length > 0);
  want("#103 CSS: .whyPop is anchored to the mark's right edge, not centred",
    decl("right") === "0" && decl("left") !== "50%" && !/translateX\(-50%\)/.test(pop), pop.replace(/\s+/g, " ").trim().slice(0, 160));
  want("#103 CSS: .whyPop takes the edge-clamp shift", decl("transform") === "translateX(var(--why-shift, 0px))", String(decl("transform")));
  const mw = decl("max-width") ?? "";
  for (const vw of [240, 300, 360]) {
    const w = maxWidthAt(mw, vw);
    want(`#103 CSS: .whyPop fits a ${vw} px screen with the gutter`, Number.isFinite(w) && w <= vw - 2 * words.WHY_POP_GUTTER, `${mw} -> ${w}`);
  }
  // The arithmetic: at 360 px, a popover of the CSS width hung off a mark
  // anywhere across the screen ends up inside it once shifted.
  const vw = 360;
  const width = maxWidthAt(mw, vw);
  const bad = [];
  if (Number.isFinite(width) && typeof words.whyPopShift === "function") {
    for (let markRight = 12; markRight <= vw; markRight += 4) {
      const left = markRight - width;
      const shift = words.whyPopShift(left, markRight, vw);
      if (left + shift < 0 || markRight + shift > vw) bad.push(markRight);
    }
  } else bad.push("no width or no whyPopShift");
  want("#103: at 360 px the popover never leaves the screen, at either edge", bad.length === 0, bad.slice(0, 5).join(","));
  want("#103: a popover that already fits is not moved", typeof words.whyPopShift === "function" && words.whyPopShift(50, 250, 360) === 0);
  return fails;
}
const W103 = W;
{
  let fails;
  try { fails = noteRules(gridSrc, await loadMarks(marksSrc), W103); } catch (err) { fails = [String(err)]; }
  for (const f of fails) check(f, false);
  check("#103: the per-tab note, tap wording and popover clamp hold", fails.length === 0);
}
{
  const mk = stripComments(marksSrc, { file: MARKS });
  check("#103: the open popover is measured and clamped", /<span className="whyPop" role="tooltip" ref=\{clampPop\}>/.test(mk) &&
    /const shift = whyPopShift\(r\.left, r\.right, /.test(mk) && /el\.style\.setProperty\("--why-shift"/.test(mk));
}

// ── 4. MKC-V's name ─────────────────────────────────────────────────────────
// The snapshot is the page's committed floor (gridCompanyName reads it first;
// it is imported through the "@/" alias, which this loader does not resolve, so
// the file is read directly).
{
  const rows = JSON.parse(read("data/company-names.json")).rows ?? {};
  check("MKC-V has a committed name", /McCormick/i.test(rows["MKC-V"] ?? ""), rows["MKC-V"] ?? "(none)");
}

// ── 5. mutants ──────────────────────────────────────────────────────────────
const MODULE_MUTANTS = [
  ["a refusal loses its code", `  "no-cover-share-count": "noShr",\n`, ""],
  ["negative FCF is not explained", `row.freeCashFlow === 0 ? "fcf0" : "fcfNeg"`, `row.freeCashFlow === 0 ? "fcf0" : (undefined as unknown as CellWhyCode)`],
  ["#103: an FCF of 0 reads Neg. again", `row.freeCashFlow === 0 ? "fcf0" : "fcfNeg"`, `"fcfNeg"`],
  ["a bank's P/S is a plain dash", `bank ? "naPs" :`, ``],
];
for (const [label, from, to] of MODULE_MUTANTS) {
  if (!moduleSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  let fails;
  try { fails = await suite(await loadSibling(MODULE, moduleSrc.replace(from, to)), W); } catch (err) { fails = [String(err)]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
{
  const from = `  fcfNeg: "Free cash flow was negative",\n`;
  let fails;
  if (!wordsSrc.includes(from)) fails = null;
  else {
    try { fails = await suite(await import(pathToFileURL(path.join(ROOT, MODULE)).href), await loadSibling(WORDS, wordsSrc.replace(from, ""))); } catch (err) { fails = [String(err)]; }
  }
  if (fails === null) check(`mutant "a code has no words" applies`, false, "the replacement matched nothing");
  else check(`mutant "a code has no words" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
const UI_MUTANTS = [
  ["a column skips withWhy", GRID, ".map(withWhy);", ";"],
  ["the mark loses its tap popover", MARKS, `{open ? <span className="whyPop"`, `{false ? <span className="whyPop"`],
  ["the grid sorts inline again", GRID, "return compareForSort(sortCol.get(a, da), sortCol.get(b, db), sortCol.sortType, sort.dir);", "return 0;"],
  ["the page drops the codes", PAGE, "if (Object.keys(why).length) entry.cellWhy = why;", "void why;"],
  ["the name floor is gone", PAGE, "const name = cleanName(gridCompanyName(entry.symbol));", "const name = \"\";"],
];
for (const [label, file, from, to] of UI_MUTANTS) {
  const src = file === GRID ? gridSrc : file === MARKS ? marksSrc : pageSrc;
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const m = src.replace(from, to);
  const fails = file === GRID ? uiRules(m, pageSrc) : file === MARKS ? uiRules(gridSrc, pageSrc, m) : uiRules(gridSrc, m);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// #91: a refusal A adds without words fails the check.
{
  let fails;
  try { fails = await suite(await import(pathToFileURL(path.join(ROOT, MODULE)).href), W, [...refusalUnion, "a-new-refusal-with-no-words"]); } catch (err) { fails = [String(err)]; }
  check(`mutant "A adds a refusal with no code or words" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
// #94: the word cells, broken.
const WORD_MUTANTS = [
  ["'–' rendered for a loss", `  pe: { epsNeg: "Loss" },\n`, `  pe: {},\n`],
  ["word cells sorted as zero", `const an = typeof av === "number" && Number.isFinite(av) ? av : null;\n  const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : null;`,
    `const an = typeof av === "number" && Number.isFinite(av) ? av : 0;\n  const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : 0;`],
];
for (const [label, from, to] of WORD_MUTANTS) {
  if (!wordsSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  let fails;
  try {
    const mutWords = await loadSibling(WORDS, wordsSrc.replace(from, to));
    fails = await suite(await import(pathToFileURL(path.join(ROOT, MODULE)).href), mutWords);
  } catch (err) { fails = [String(err)]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
// #94 rendered: the mark ignores its word.
{
  const from = `      {mark}\n    </TipMark>`;
  if (!marksSrc.includes(from)) check(`mutant "the mark renders '–' whatever the word" applies`, false, "the replacement matched nothing");
  else {
    let fails;
    try { fails = renderRules(await loadMarks(marksSrc.replace(from, `      {"–"}\n    </TipMark>`)), W); } catch (err) { fails = [String(err)]; }
    check(`mutant "the mark renders '–' whatever the word" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
}
// #90 rendered: the marker after the value.
{
  const from = `      <span className="basisSlot">`;
  const valLine = `      <span className="basisVal">{value}</span>\n`;
  if (!marksSrc.includes(from) || !marksSrc.includes(valLine)) check(`mutant "the FY marker after the value" applies`, false, "the replacement matched nothing");
  else {
    const m = marksSrc.replace(valLine, "").replace(from, `${valLine}${from}`);
    let fails;
    try { fails = renderRules(await loadMarks(m), W); } catch (err) { fails = [String(err)]; }
    check(`mutant "the FY marker after the value" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
}

// #103 mutants: the per-tab note, tap wording, popover clamp.
{
  const NOTE_MUTANTS = [
    ["#103: the Performance tab claims SEC filings", "words", `  performance:\n    "Returns are calculated from price history`, `  performance:\n    "Figures come from company SEC filings; Returns are calculated from price history`],
    ["#103: Valuation stops naming 'Neg.'", "words", `'Loss', 'Neg.' or 'n/a' means a ratio`, `'Loss' or 'n/a' means a ratio`],
    ["#103: General names a word it never shows", "words", `'Loss' means earnings per share`, `'Loss' or 'Neg.' means earnings per share`],
    ["#103: the shift never moves the popover", "words", `  if (right > viewport - gutter) return`, `  if (left === left) return 0;\n  if (right > viewport - gutter) return`],
    ["#103: the note renders hover only", "marks", `      <span className="cellWhyTap">{CELL_WHY_ACTION.tap}</span>\n`, ``],
    ["#103: touch still says hover (media rule gone)", "grid", `@media (hover: none), (pointer: coarse) {`, `@media (max-width: 1px) {`],
    ["#103: the tap line is always shown", "grid", `.cellWhyTap { display: none; }`, `.cellWhyTap { display: inline; }`],
    ["#103: the popover centred again", "grid", `right: 0; left: auto; top: calc(100% + 6px); transform: translateX(var(--why-shift, 0px));`, `left: 50%; top: calc(100% + 6px); transform: translateX(-50%);`],
    ["#103: the popover wider than a small screen", "grid", `max-width: min(260px, calc(100vw - 16px));`, `max-width: min(260px, 120vw);`],
    ["#103: the grid prints the one note again", "grid", `<CellWhyNote tab={activeTab} />`, `<p className="cellWhyNote">{CELL_WHY_TABLE_NOTE}</p>`],
  ];
  for (const [label, where, from, to] of NOTE_MUTANTS) {
    const src = where === "words" ? wordsSrc : where === "marks" ? marksSrc : gridSrc;
    if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    let fails;
    try {
      const m = src.replace(from, to);
      if (where === "words") {
        const href = pathToFileURL(path.join(ROOT, "scripts", `.check-why-words-${process.pid}-${seq++}.ts`));
        fs.writeFileSync(href, m);
        try {
          const mw = await import(href.href);
          fails = noteRules(gridSrc, await loadMarks(marksSrc, href.href), mw);
        } finally { fs.rmSync(href, { force: true }); }
      } else if (where === "marks") fails = noteRules(gridSrc, await loadMarks(m), W103);
      else fails = noteRules(m, await loadMarks(marksSrc), W103);
    } catch (err) { fails = [String(err)]; }
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
  // The popover is no longer measured (ref dropped).
  const from = `role="tooltip" ref={clampPop}>`;
  const mk = stripComments(marksSrc.replace(from, `role="tooltip">`), { file: MARKS });
  check(`mutant "#103: the open popover is not clamped" is caught`, marksSrc.includes(from) && !/<span className="whyPop" role="tooltip" ref=\{clampPop\}>/.test(mk));
  // FCF of 0 given the "Neg." word.
  const wFrom = `  pfcf: { fcfNeg: "Neg.", naFcf: "n/a" },\n`;
  if (!wordsSrc.includes(wFrom)) check(`mutant "#103: an FCF of 0 shows Neg." applies`, false, "the replacement matched nothing");
  else {
    let fails;
    try { fails = await suite(await import(pathToFileURL(path.join(ROOT, MODULE)).href), await loadSibling(WORDS, wordsSrc.replace(wFrom, `  pfcf: { fcfNeg: "Neg.", fcf0: "Neg.", naFcf: "n/a" },\n`))); } catch (err) { fails = [String(err)]; }
    check(`mutant "#103: an FCF of 0 shows Neg." is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
