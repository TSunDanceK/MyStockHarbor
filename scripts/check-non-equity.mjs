// Fundamentals presets exclude exchange-traded notes and preferreds (Relay B,
// #553 COWORK #14, 2026-09-24).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A NOTE IS A "CASH-RICH VALUE STOCK" AGAIN. CCZ and TBB are notes of
//      Comcast and AT&T; SEC files the issuer's statements under the same CIK,
//      so the preset paired a note's price with the parent's cash flow.
//   2. A REAL COMPANY IS DROPPED: the parent itself (CMCSA, T), an LP unit (ET),
//      an ADR of preferred shares (PBR-A), a second share class (BRK-B, GOOG).
//   3. CCZ SLIPS BACK IN. Its name is "Comcast Holdings ZONES"; the guard's
//      debt-acronym rule (#575) is what catches it.
//   4. THE WIRING GOES SLACK: the page stops filtering, a fundamentals preset
//      loses its opt-in, or a technical preset gains it.
//
// The decision is lib/server/pickerEquity.fundamentalsExclusion over the REAL
// guard (lib/server/securityKind.admitForExtraction), fed from the committed
// ticker map and name snapshot read directly here. Every assertion runs again
// on mutants of both modules; each must be caught.
//
//   node scripts/check-non-equity.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const GUARD = read("lib/server/securityKind.ts");
const EQUITY = read("lib/server/pickerEquity.ts");
const FUNDAMENTALS_PAGES = [
  "low-pe-stocks",
  "high-dividend-yield-stocks",
  "dividend-growth-stocks",
  "cash-rich-value-stocks",
  "cheap-tech-stocks",
  "semiconductor-stocks",
];
const TECHNICAL_PAGE = "stocks-below-200-day-moving-average";

const transpile = (src) =>
  ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;

// The guard's pure half (its render-path loaders cut, as check-security-kind
// does), then pickerEquity's pure half importing THAT guard.
async function build(guardSrc, equitySrc) {
  const guard = guardSrc
    .replace(/import \{ loadTickerMap \} from "\.\/secTickerMap";/, "const loadTickerMap = () => ({ present: false, map: new Map() });")
    .replace(/import \{ snapshotCompanyName \} from "\.\/companyNameSnapshot";/, "const snapshotCompanyName = () => \"\";")
    .replace(/\/\/ ─+\n\/\/ THE RENDER-PATH ENTRY POINT[\s\S]*$/, "");
  const guardUrl = dataUrl(transpile(guard));
  const equity = equitySrc
    .replace(/import \{ admitForExtraction \} from "\.\/securityKind";/, `import { admitForExtraction } from "${guardUrl}";`)
    .replace(/import \{ loadTickerMap \} from "\.\/secTickerMap";/, "const loadTickerMap = () => ({ present: false, map: new Map() });")
    .replace(/import \{ snapshotCompanyName \} from "\.\/companyNameSnapshot";/, "const snapshotCompanyName = () => \"\";")
    .replace(/import \{ lookupBySpelling \} from "\.\.\/symbolSpellings\.mjs";/, "const lookupBySpelling = () => null;");
  if (/^import .* from "\.\.?\//m.test(equity)) throw new Error("pickerEquity.ts gained an import this harness does not stub");
  return import(dataUrl(transpile(equity)));
}

// ── the real maps ─────────────────────────────────────────────────────────
const sec = JSON.parse(read("data/sec/company-tickers.json"));
const NAMES = JSON.parse(read("data/company-names.json")).rows;
const TI = sec.fields.indexOf("ticker");
const CI = sec.fields.indexOf("cik");
const cikOf = new Map();
const groups = new Map();
for (const row of sec.data) {
  const t = String(row[TI]).toUpperCase();
  const c = row[CI] == null ? null : String(row[CI]);
  if (!c) continue;
  cikOf.set(t, c);
  groups.set(c, [...(groups.get(c) ?? []), t]);
}
const inputsFor = (symbol) => {
  const cik = cikOf.get(symbol) ?? null;
  return { symbol, cik, cikGroup: cik ? groups.get(cik) : [], securityName: NAMES[symbol] ?? null };
};

const OUT = ["CCZ", "TBB", "SOJE", "PFH", "AIZN", "RZC", "ATHS"];
const IN = ["CMCSA", "T", "SO", "PRU", "ET", "PBR-A", "BRK-B", "GOOG", "GOOGL", "AAPL"];

async function suite(mod, pages) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const verdict = (s) => mod.fundamentalsExclusion(inputsFor(s));

  for (const s of [...OUT, ...IN]) {
    ok(`${s} fixture is real (CIK and name committed)`, cikOf.has(s) && Boolean(NAMES[s]));
  }
  for (const s of OUT) ok(`${s} (${NAMES[s]}) leaves the fundamentals presets`, verdict(s) === "debt-or-preferred", String(verdict(s)));
  for (const s of IN) ok(`${s} (${NAMES[s]}) stays`, verdict(s) === null, String(verdict(s)));

  ok("a lone filer is admitted whatever its name says (the guard's rule)",
    mod.fundamentalsExclusion({ symbol: "ZZZ", cik: "1", cikGroup: ["ZZZ"], securityName: "Lone Issuer ZONES" }) === null);
  ok("a shared CIK with no name on file is unverifiable, never kept",
    mod.fundamentalsExclusion({ symbol: "ZZZ", cik: "1", cikGroup: ["ZZZ", "ZZY"], securityName: null }) === "unverifiable");

  const page = pages.PAGE;
  ok("the preset branch filters through excludedFromFundamentals",
    /config\.kind === "preset" && config\.excludeNonEquity\)\s*\{\s*all = all\.filter\(\(entry\) => !excludedFromFundamentals\(entry\.symbol\)\)/.test(page));
  ok("the entry point reads the committed map, spelling helper and snapshot",
    /lookupBySpelling\(map, symbol\)/.test(pages.EQUITY) && /snapshotCompanyName\(symbol\)/.test(pages.EQUITY) && /fundamentalsExclusion\(\{/.test(pages.EQUITY));
  for (const slug of FUNDAMENTALS_PAGES) ok(`${slug} opts in`, /excludeNonEquity: true/.test(pages[slug]));
  ok(`a technical preset (${TECHNICAL_PAGE}) does not opt in`, !/excludeNonEquity/.test(pages[TECHNICAL_PAGE]));
  return fails;
}

const pages = { PAGE: readCodeOnly("app/components/PickerResultPage.tsx"), EQUITY: readCodeOnly("lib/server/pickerEquity.ts") };
for (const slug of [...FUNDAMENTALS_PAGES, TECHNICAL_PAGE]) pages[slug] = readCodeOnly(`app/${slug}/page.tsx`);

const base = await suite(await build(GUARD, EQUITY), pages);
if (base.length) {
  console.error("FAIL check-non-equity:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return src.replace(from, () => to);
};
const MUTANTS = [
  ["the guard's ZONES rule removed (CCZ would stay)", () => [mut("zones", GUARD, `const DEBT_ACRONYMS = /\\bZONES\\b/;`, `const DEBT_ACRONYMS = /(?!)/;`), EQUITY, pages]],
  ["unverifiable kept", () => [GUARD, mut("unverifiable", EQUITY, `: "unverifiable";`, `: null;`), pages]],
  ["the guard's ADR-first rule removed (PBR-A would be dropped)", () => [mut("adr", GUARD, `if (ADR_WORDING.test(name)) return "issuer-equity";`, ""), EQUITY, pages]],
  ["the guard's debt words removed (TBB would stay)", () => [mut("debt", GUARD, `/\\bnotes?\\b|\\bdebentures?\\b|\\bsubordinated\\b|`, `/`), EQUITY, pages]],
  ["the page stops filtering", () => [GUARD, EQUITY, { ...pages, PAGE: mut("filter", pages.PAGE, `all = all.filter((entry) => !excludedFromFundamentals(entry.symbol));`, "") }]],
  ["cash-rich loses its opt-in", () => [GUARD, EQUITY, { ...pages, "cash-rich-value-stocks": mut("optin", pages["cash-rich-value-stocks"], "excludeNonEquity: true", "") }]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [g, e, p] = make();
  const fails = await suite(await build(g, e), p);
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-non-equity: ${OUT.length} notes out, ${IN.length} companies in; ${MUTANTS.length} mutants caught`);
