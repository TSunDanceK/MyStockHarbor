// NO FMP IMAGE-CDN LOGO FALLBACK (#553 COWORK #102, FMP-off checklist row B9).
//
// TickerLogo's chain was: harvested /logos/SYM.webp -> Clearbit (when a domain
// is known) -> FMP's image CDN -> monogram. The owner ruled the FMP hotlink out
// with the FMP exit, after a last harvest on 3 Oct 2026. What must hold, in
// site code with comments stripped:
//   1. No page or component loads anything from FMP's image host.
//   2. TickerLogo still tries the harvested file first and ends on the monogram.
//   3. Mutants: the CDN source restored, and the harvested source dropped.
//
//   node scripts/check-no-fmp-logo-cdn.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel, out); }
    else if (/\.(tsx|ts|mjs|js)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const LOGO = "app/components/TickerLogo.tsx";
const CDN = /images\.financialmodelingprep\.com/;

function rules(srcs) {
  const fails = [];
  for (const [f, s] of Object.entries(srcs)) {
    if (CDN.test(stripComments(s, { file: f }))) fails.push(`${f} loads from FMP's image CDN`);
  }
  const logo = stripComments(srcs[LOGO] ?? "", { file: LOGO });
  if (!/sources\.push\(`\$\{LOGO_BASE\}\/\$\{encodeURIComponent\(sym\)\}\.webp`\)/.test(logo)) fails.push("TickerLogo no longer tries the harvested file first");
  if (!/idx >= sources\.length/.test(logo)) fails.push("TickerLogo no longer ends on the monogram");
  return fails;
}

const files = [...walk("app"), ...walk("lib")];
const srcs = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
const real = rules(srcs);
for (const f of real) check(f, false);
check("no FMP image-CDN logo source; harvested file first, monogram last", real.length === 0);

const MUTANTS = [
  ["the FMP CDN source restored", LOGO, /  \/\/ ── THE FALLBACK POSITION/, "  if (sym) sources.push(`https://images.financialmodelingprep.com/symbol/${encodeURIComponent(sym)}.png`);\n  // ── THE FALLBACK POSITION"],
  ["the harvested source dropped", LOGO, /  if \(sym\) sources\.push\(`\$\{LOGO_BASE\}\/\$\{encodeURIComponent\(sym\)\}\.webp`\);\n/, ""],
];
for (const [label, file, from, to] of MUTANTS) {
  const m = srcs[file].replace(from, to);
  if (m === srcs[file]) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules({ ...srcs, [file]: m });
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
