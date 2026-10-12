// data/content-candidates.json (#563 COWORK #183): the shortlist the content
// schedules pick new bottleneck maps and insight posts from. Rules:
//   - it parses, with generatedAt (ISO), source and a non-empty symbols list;
//   - every row has the stated fields and types; the four flags are booleans;
//   - every symbol is unique (a dot/dash pair is one row);
//   - sorted by marketCap descending, nulls last;
//   - the generator's Pickers universe key is pickersBuilder's.
// Mutants: rows out of order; a duplicated row; a flag as a string.
//
//   node scripts/check-content-candidates.mjs
import fs from "node:fs";
import { toDotted } from "../lib/symbolSpellings.mjs";

const FILE = "data/content-candidates.json";
const FLAGS = ["inPool", "hasSecFacts", "thinFilings", "hasBottleneck"];

function problems(doc) {
  const bad = [];
  if (!doc || typeof doc !== "object") return ["not an object"];
  if (typeof doc.generatedAt !== "string" || Number.isNaN(Date.parse(doc.generatedAt))) bad.push("generatedAt is not an ISO date");
  if (doc.source !== "relay content-candidates") bad.push("source is not 'relay content-candidates'");
  const rows = Array.isArray(doc.symbols) ? doc.symbols : null;
  if (!rows || !rows.length) return [...bad, "symbols is empty or missing"];
  const seen = new Set();
  rows.forEach((r, i) => {
    const at = `row ${i} (${r?.symbol})`;
    if (typeof r?.symbol !== "string" || !/^[A-Z0-9][A-Z0-9.\-]*$/.test(r.symbol)) bad.push(`${at}: symbol`);
    const key = toDotted(r?.symbol);
    if (seen.has(key)) bad.push(`${at}: duplicate`);
    seen.add(key);
    if (typeof r?.name !== "string" || !r.name) bad.push(`${at}: name`);
    if (r?.sector !== null && typeof r?.sector !== "string") bad.push(`${at}: sector`);
    if (r?.marketCap !== null && !(typeof r?.marketCap === "number" && Number.isFinite(r.marketCap) && r.marketCap > 0)) bad.push(`${at}: marketCap`);
    for (const f of FLAGS) if (typeof r?.[f] !== "boolean") bad.push(`${at}: ${f} is not a boolean`);
    if (r?.latestInsightDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(r?.latestInsightDate))) bad.push(`${at}: latestInsightDate`);
    if (i > 0) {
      const a = rows[i - 1].marketCap ?? -1, b = r.marketCap ?? -1;
      if (b > a) bad.push(`${at}: out of order (marketCap descending, nulls last)`);
    }
  });
  return bad;
}

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const found = problems(doc);
check(`${FILE}: parses, ${doc.symbols?.length ?? 0} unique rows, flags boolean, sorted by marketCap (nulls last)`, found.length === 0, found.slice(0, 5).join("; "));
const gen = fs.readFileSync("scripts/content-candidates.mjs", "utf8");
const builderKey = /export const PICKERS_SYMBOLS_KEY = "([^"]+)";/.exec(fs.readFileSync("lib/server/pickersBuilder.ts", "utf8"))?.[1];
check("the generator reads pickersBuilder's universe key", !!builderKey && gen.includes(`const PICKERS_SYMBOLS_KEY = "${builderKey}";`));

console.log("\n=== Mutants: each must be caught ===");
const rows = doc.symbols;
const mutants = [
  ["rows out of order", { ...doc, symbols: [rows[1], rows[0], ...rows.slice(2)] }],
  ["a duplicated row", { ...doc, symbols: [rows[0], ...rows] }],
  ["a flag as a string", { ...doc, symbols: [{ ...rows[0], inPool: "true" }, ...rows.slice(1)] }],
];
for (const [name, m] of mutants) check(`mutant caught: ${name}`, problems(m).length > 0);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
