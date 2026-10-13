// data/content-candidates.json (#563 COWORK #183): the shortlist the content
// schedules pick new bottleneck maps and insight posts from. Rules:
//   - it parses, with generatedAt (ISO), source and a non-empty symbols list;
//   - every row has the stated fields and types; the four flags are booleans;
//   - every symbol is unique (a dot/dash pair is one row);
//   - sorted by marketCap descending, nulls last;
//   - the generator's Pickers universe key is pickersBuilder's;
//   - (#185) `skipContent`, where present, is true with a non-empty skipReason,
//     and every name in the generator's SKIP_CONTENT carries it (GOOG).
// Mutants: rows out of order; a duplicated row; a flag as a string; GOOG's
// skip dropped; a skip without its reason.
//
//   node scripts/check-content-candidates.mjs
import fs from "node:fs";
import { toDotted } from "../lib/symbolSpellings.mjs";

const FILE = "data/content-candidates.json";
// The generator's editorial skips, read from its source (it imports Redis at run time).
const SKIPS = new Set([...(/export const SKIP_CONTENT = \{([^}]*)\}/.exec(fs.readFileSync("scripts/content-candidates.mjs", "utf8"))?.[1] ?? "").matchAll(/^\s*"?([A-Z0-9.\-]+)"?:/gm)].map((m) => m[1]));
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
    if ("skipContent" in (r ?? {}) && (r.skipContent !== true || typeof r.skipReason !== "string" || !r.skipReason)) bad.push(`${at}: skipContent without a reason`);
    if (SKIPS.has(r?.symbol) && r.skipContent !== true) bad.push(`${at}: in SKIP_CONTENT but not skipped`);
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
check("the generator's SKIP_CONTENT lists GOOG (#185)", SKIPS.has("GOOG"));
check("the generator reads pickersBuilder's universe key", !!builderKey && gen.includes(`const PICKERS_SYMBOLS_KEY = "${builderKey}";`));

console.log("\n=== Mutants: each must be caught ===");
const rows = doc.symbols;
const mutants = [
  ["rows out of order", { ...doc, symbols: [rows[1], rows[0], ...rows.slice(2)] }],
  ["a duplicated row", { ...doc, symbols: [rows[0], ...rows] }],
  ["a flag as a string", { ...doc, symbols: [{ ...rows[0], inPool: "true" }, ...rows.slice(1)] }],
  ["GOOG's skip dropped", { ...doc, symbols: rows.map((r) => (r.symbol === "GOOG" ? (({ skipContent, skipReason, ...rest }) => rest)(r) : r)) }],
  ["a skip without its reason", { ...doc, symbols: rows.map((r) => (r.symbol === "GOOG" ? { ...r, skipReason: "" } : r)) }],
];
for (const [name, m] of mutants) check(`mutant caught: ${name}`, problems(m).length > 0);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
