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
//   5. Mutants: each rule above broken once, and caught.
//
// No Redis, no network: fixtures and source only.
//
//   node scripts/check-pickers-cell-why.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MODULE = "lib/server/pickersSecFundamentals.ts";
const WORDS = "lib/pickerCellWhy.ts";
const GRID = "app/components/PickerResultsGrid.tsx";
const PAGE = "app/components/PickerResultPage.tsx";
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

async function suite(mod, words) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const has = (code) => Boolean(code && words.CELL_WHY_WORDS[code]);

  want("ValuationRefusal parsed from secValuation.ts", refusalUnion.length >= 10, String(refusalUnion.length));
  const missing = refusalUnion.filter((r) => !has(mod.WHY_FOR_REFUSAL[r]));
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
  want("the table note is the owner's wording", words.CELL_WHY_TABLE_NOTE.startsWith("Figures come from company SEC filings; '–' means the filing doesn't give enough to calculate it."));
  return fails;
}

const moduleSrc = read(MODULE);
const wordsSrc = read(WORDS);
const real = await suite(await import(pathToFileURL(path.join(ROOT, MODULE)).href), W);
for (const f of real) check(f, false);
check("the reasons hold on the real modules", real.length === 0);

// ── 3. page and grid (comments stripped) ────────────────────────────────────
function uiRules(gridSrc, pageSrc) {
  const g = stripComments(gridSrc, { file: GRID });
  const p = stripComments(pageSrc, { file: PAGE });
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("the page attaches secPickerWhy's codes to the entry", /const why = secPickerWhy\(row, [^;]*entry\.industry\);[\s\S]{0,80}entry\.cellWhy = why/.test(p));
  want("every column goes through withWhy", /sets\[tab\] = sets\[tab\]\.filter\(\(col\) => !HIDDEN_COLUMN_KEYS\.has\(col\.key\)\)\.map\(withWhy\);/.test(g));
  want("withWhy renders the reason mark for an empty value", /if \(!isEmptyValue\(col\.get\(e, d\)\)\) return filled\(e, d, inert\);\s*const why = cellWhyFor\(e, col\.key\);\s*return <WhyMark /.test(g));
  want("the mark carries its reason on hover and tap", /title=\{text\}[\s\S]{0,200}role="button"[\s\S]{0,900}\{open \? <span className="whyPop"/.test(g));
  want("the table note is printed", /<p className="cellWhyNote">\{CELL_WHY_TABLE_NOTE\}<\/p>/.test(g));
  want("the page falls back to the committed name", /if \(entry\.companyName\) continue;\s*const name = cleanName\(gridCompanyName\(entry\.symbol\)\);/.test(p));
  return fails;
}
const gridSrc = read(GRID);
const pageSrc = read(PAGE);
const ui = uiRules(gridSrc, pageSrc);
for (const f of ui) check(f, false);
check("the page and grid rules hold", ui.length === 0);

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
  ["negative FCF is not explained", `row.freeCashFlow === null ? "noFcf" : "fcfNeg"`, `row.freeCashFlow === null ? "noFcf" : (undefined as unknown as CellWhyCode)`],
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
  ["the mark loses its tap popover", GRID, `{open ? <span className="whyPop"`, `{false ? <span className="whyPop"`],
  ["the page drops the codes", PAGE, "if (Object.keys(why).length) entry.cellWhy = why;", "void why;"],
  ["the name floor is gone", PAGE, "const name = cleanName(gridCompanyName(entry.symbol));", "const name = \"\";"],
];
for (const [label, file, from, to] of UI_MUTANTS) {
  const src = file === GRID ? gridSrc : pageSrc;
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const m = src.replace(from, to);
  const fails = file === GRID ? uiRules(m, pageSrc) : uiRules(gridSrc, m);
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
