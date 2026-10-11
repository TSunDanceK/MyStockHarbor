// NO PER-TICKER VENDOR DATA IN THE DOCS, NOW OR IN THE PURGE (#552 COWORK #41).
//
// The owner's ruling: no FMP data is stored, the repo included. Two rule files
// under scripts/purge/ are the history purge's `--replace-text` input
// (git filter-repo), written to match the SHAPE around each value, never the
// value itself, so they can be posted and committed without republishing it:
//   replace-fmp-values.txt     FMP figures redacted from four docs in #561,
//                              and B's per-ticker P/E rows (old commit)
//   replace-vendor-labels.txt  tickers paired with FMP sector/industry labels
//
//   1. Both files parse as filter-repo `regex:PATTERN==>REPLACEMENT` lines.
//   2. Every claude/ doc on this tree is already clean under both: applying
//      them changes nothing. MUTATION: a redacted table row re-added → caught.
//   3. The rule files do not rewrite themselves (the purge runs over them too).
//
//   node scripts/check-no-vendor-labels.mjs
import fs from "node:fs";
import path from "node:path";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const FILES = ["scripts/purge/replace-fmp-values.txt", "scripts/purge/replace-vendor-labels.txt"];

// filter-repo's regex flavour is Python's; these rules use only (?m), \s, \b,
// classes and groups, which read the same in JavaScript once (?m) becomes a flag.
function load(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    if (!line.startsWith("regex:") || !line.includes("==>")) throw new Error(`${file}: not a regex rule: ${line.slice(0, 60)}`);
    const [pat, rep] = line.slice(6).split("==>");
    const multi = pat.startsWith("(?m)");
    return { re: new RegExp(multi ? pat.slice(4) : pat, multi ? "gm" : "g"), rep: rep.replace(/\\(\d)/g, "$$$1") };
  });
}
const apply = (rules, text) => rules.reduce((t, r) => t.replace(r.re, r.rep), text);

console.log("1. the rule files");
let RULES = [];
try { RULES = FILES.flatMap(load); check("both parse as regex rules", RULES.length >= 25, `${RULES.length} rules`); }
catch (e) { check("both parse as regex rules", false, String(e.message)); }

console.log("\n2. the claude/ docs are already clean under them");
const docs = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".md")) docs.push(p); } };
walk("claude");
const dirty = docs.filter((f) => { const t = fs.readFileSync(f, "utf8"); return apply(RULES, t) !== t; });
check("applying the purge rules to every claude/ doc changes nothing", dirty.length === 0, dirty.join(", "));
{
  const f = "claude/taxonomy-tail-audit-2026-09-14.md";
  const t = fs.readFileSync(f, "utf8").replace("| `Silver` | [removed 2026-09-24] |", "| `Silver` | AG, AYA, EXK |");
  check("MUTATION: a ticker list re-added beside its vendor label → caught", apply(RULES, t) !== t);
}

console.log("\n3. the rules do not rewrite themselves");
check("each rule file is unchanged under both", FILES.every((f) => { const t = fs.readFileSync(f, "utf8"); return apply(RULES, t) === t; }));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
