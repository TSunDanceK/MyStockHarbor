// THE TWO PICKERS QUICK WINS (#553 COWORK #168 item 2, from A's census,
// CODE-A #177).
//
//   1. BRK.B. The grid asks for the dotted spelling; the warm job writes the
//      row under the universe's dashed BRK-B. readSecPickerRows (extracted as
//      it ships, run on a stub HMGET) must find the row under either spelling,
//      return it under the symbol asked, prefer the asked spelling, and still
//      send exactly ONE command.
//   2. Preferreds and notes. A listing pickerEquity calls "debt-or-preferred"
//      gets the code `notCommon` on its six valuation cells: "n/a" in EV, P/E,
//      P/S, P/B and P/FCF, and the dash in Market Cap (on every tab), each
//      with "Not a common share" on hover or tap.
// Every rule has a planted mutant.
//
//   node scripts/check-picker-quick-wins.mjs
import "./lib/register-capex-ts.mjs";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const SECF = "lib/server/pickersSecFundamentals.ts";
const WHY = "lib/pickerCellWhy.ts";
const PAGE = "app/components/PickerResultPage.tsx";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const swap = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutant anchor missing: ${a}`); return s.replace(a, b); };

// ── 1. the spelling fallback ────────────────────────────────────────────────
const fnText = (src, name) => {
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.ES2020, true);
  let out = null;
  const visit = (n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) out = n.getText(sf); ts.forEachChild(n, visit); };
  visit(sf);
  return out;
};
// The shared helper, inlined as it ships (the reader calls it by name).
const SPELL = ts.transpileModule(fs.readFileSync(path.join(ROOT, "lib/symbolSpellings.mjs"), "utf8").replace(/^export /gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
async function loadReader(src) {
  const fn = fnText(src, "readSecPickerRows");
  if (!fn) return null;
  const prelude = `${SPELL}\nlet redis = null; const PICKERS_SEC_TTL_SECONDS = 86400; const pickersSecKey = () => "pickers-sec";
const isRow = (v) => Boolean(v && typeof v === "object" && v.v === 1);
export const setRedis = (r) => { redis = r; };`;
  const js = ts.transpileModule(`${prelude}\n${fn}\nexport const reader = readSecPickerRows;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}
async function readerFails(src) {
  const M = await loadReader(src);
  if (!M) return ["readSecPickerRows could not be extracted"];
  const fails = [];
  const at = Date.now();
  const row = (tag) => ({ v: 1, at, tag });
  let commands = 0;
  const run = async (store, asked) => {
    M.setRedis({ hmget: async (_k, ...fields) => { commands++; return fields.map((f) => store[f] ?? null); } });
    return M.reader(asked);
  };
  const out = await run({ "BRK-B": row("dashed"), AAPL: row("aapl") }, ["BRK.B", "AAPL", "NOPE"]);
  if (out.get("BRK.B")?.tag !== "dashed") fails.push("BRK.B must find the row filed under BRK-B");
  if (out.has("BRK-B")) fails.push("the row must come back under the spelling asked (BRK.B), not the stored one");
  if (out.get("AAPL")?.tag !== "aapl") fails.push("a plain symbol still finds its own row");
  if (out.has("NOPE")) fails.push("a symbol with no row stays absent");
  const back = await run({ "BRK.B": row("dotted") }, ["BRK-B"]);
  if (back.get("BRK-B")?.tag !== "dotted") fails.push("the fallback works dash -> dot too");
  const both = await run({ "BRK.B": row("dot"), "BRK-B": row("dash") }, ["BRK-B"]);
  if (both.get("BRK-B")?.tag !== "dash") fails.push("the asked spelling wins when both exist");
  if (commands !== 3) fails.push(`one HMGET per page read, saw ${commands} over 3 reads`);
  return fails;
}

// ── 2. the not-a-common-share n/a ───────────────────────────────────────────
let seq = 0;
const tmp = [];
async function loadWhy(src) {
  const f = path.join(ROOT, "lib", `.check-pqw-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}
const SIX = ["marketCap", "ev", "pe", "ps", "pb", "pfcf"];
// Market Cap is on every tab: it keeps the dash, with the same reason on tap.
const WORD_COLS = ["ev", "pe", "ps", "pb", "pfcf"];
function whyFails(W) {
  const fails = [];
  for (const col of WORD_COLS) {
    const m = W.cellMark(col, "notCommon");
    if (m.mark !== "n/a" || !m.word) fails.push(`${col}: notCommon must read "n/a", got "${m.mark}"`);
  }
  if (W.cellMark("marketCap", "notCommon").mark !== W.CELL_DASH) fails.push("Market Cap (every tab) keeps the dash for notCommon");
  if (!W.NOT_APPLICABLE_CODES.has("notCommon")) fails.push("notCommon must count as not applicable (lighter n/a), not missing");
  if (!/^Not a common share/.test(W.CELL_WHY_WORDS.notCommon ?? "")) fails.push('the tap reason must open "Not a common share"');
  // Other reasons are untouched: the bank/insurer n/a and the plain dash.
  if (W.cellMark("ev", "naEv").mark !== "n/a" || W.cellMark("pe", "noShr").mark !== W.CELL_DASH) fails.push("other codes changed");
  return fails;
}
function pageFails(src) {
  const code = stripComments(src, { file: PAGE });
  const fails = [];
  const m = code.match(/const NOT_COMMON_WHY[^=]*=\s*\{([^}]*)\}/);
  const cols = m ? [...m[1].matchAll(/(\w+):\s*"notCommon"/g)].map((x) => x[1]).sort() : [];
  if (cols.join() !== [...SIX].sort().join()) fails.push(`NOT_COMMON_WHY must cover the six valuation cells, has ${cols.join(",") || "none"}`);
  if (!/if \(!row\) \{\s*if \(excludedFromFundamentals\(entry\.symbol\) === "debt-or-preferred"\) \{\s*entry\.cellWhy = \{ \.\.\.entry\.cellWhy, \.\.\.NOT_COMMON_WHY \};/.test(code))
    fails.push('a row-less "debt-or-preferred" listing must get NOT_COMMON_WHY');
  return fails;
}

const SECF_SRC = read(SECF);
const WHY_SRC = read(WHY);
const PAGE_SRC = read(PAGE);

try {
  console.log("\n=== 1. BRK.B: one HMGET, either spelling ===\n");
  const r = await readerFails(SECF_SRC);
  check("the reader finds dot/dash twins under the asked symbol in one command", r.length === 0, r.join("; "));

  console.log("\n=== 2. Preferreds and notes: n/a, not a common share ===\n");
  const w = whyFails(await loadWhy(WHY_SRC));
  check("notCommon reads n/a in the five valuation ratio cells, a reasoned dash in Market Cap", w.length === 0, w.join("; "));
  const p = pageFails(PAGE_SRC);
  check("the page attaches it to row-less non-common listings", p.length === 0, p.join("; "));

  console.log("\n=== 3. Planted mutants (each must be caught) ===\n");
  const READER_MUTANTS = [
    ["no fallback (asked spelling only)", (s) => swap(s, "const spellingsOf = (sym: string): string[] => symbolSpellings(sym);", "const spellingsOf = (sym: string): string[] => [sym];")],
    ["dot -> dash only", (s) => swap(s, "const spellingsOf = (sym: string): string[] => symbolSpellings(sym);", 'const spellingsOf = (sym: string): string[] => [sym, sym.replace(/\\./g, "-")];')],
    ["stored spelling returned", (s) => swap(s, "out.set(sym, row);", "out.set(f, row);")],
    ["last spelling wins", (s) => swap(s, "out.set(sym, row);\n          break;", "out.set(sym, row);")],
    ["one HMGET per spelling", (s) => swap(s, "const raw = (await redis.hmget(pickersSecKey(), ...fields)) as unknown;", "await redis.hmget(pickersSecKey(), fields[0]); const raw = (await redis.hmget(pickersSecKey(), ...fields)) as unknown;")],
  ];
  for (const [label, mutate] of READER_MUTANTS) check(`mutant caught: ${label}`, (await readerFails(mutate(SECF_SRC))).length > 0);

  const WHY_MUTANTS = [
    ["n/a missing on P/E", (s) => swap(s, '  pe: { notCommon: "n/a" },\n', "")],
    ["notCommon shown as missing, not n/a", (s) => swap(s, '"naFcf", "notCommon"]', '"naFcf"]')],
    ["reason reworded away from not a common share", (s) => swap(s, 'notCommon: "Not a common share:', 'notCommon: "Unavailable:')],
  ];
  for (const [label, mutate] of WHY_MUTANTS) check(`mutant caught: ${label}`, whyFails(await loadWhy(mutate(WHY_SRC))).length > 0);

  const PAGE_MUTANTS = [
    ["P/B left out of the six", (s) => swap(s, ' pb: "notCommon",', "")],
    ["classifier branch removed", (s) => swap(s, 'if (excludedFromFundamentals(entry.symbol) === "debt-or-preferred") {', "if (false) {")],
    ["any exclusion treated as not common", (s) => swap(s, 'if (excludedFromFundamentals(entry.symbol) === "debt-or-preferred") {', "if (excludedFromFundamentals(entry.symbol)) {")],
  ];
  for (const [label, mutate] of PAGE_MUTANTS) check(`mutant caught: ${label}`, pageFails(mutate(PAGE_SRC)).length > 0);
} finally {
  for (const f of tmp) try { fs.unlinkSync(f); } catch {}
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
