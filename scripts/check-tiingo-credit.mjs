// EVERY TIINGO PRICE CARRIES THE LINKED CREDIT (#553 COWORK #92, 2 Oct).
//
// Production, 2 Oct: /low-pe-stocks and /oversold-stocks-today ended their
// status line "Market data from Tiingo.com" as plain text while every other
// Tiingo surface linked it, and /pickers (the hub) showed Tiingo-built prices
// with no credit at all.
//
// What must hold (source, comments stripped):
//   1. Every PAGE that switches a surface to Tiingo (priceProviderFor(...) or
//      readSurfacePrice(...)) renders the credit, i.e. it renders TIINGO_CREDIT
//      or hands it to the Pickers footer.
//   2. Every rendered {TIINGO_CREDIT} sits inside <a href={TIINGO_URL} ...>.
//   3. The Pickers footer is given the link with the credit, and ScanFooter
//      renders a credit with an href as a link.
//   4. Nobody hand-types the credit: the string lives in one constant.
//   5. Mutants: each rule broken once, and caught.
//
//   node scripts/check-tiingo-credit.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel, out); }
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const FOOTER = "app/components/ScanFooter.tsx";
const PICKER_PAGE = "app/components/PickerResultPage.tsx";
const HUB = "app/pickers/page.tsx";
const CREDIT_FILE = "lib/server/tiingoSurfacePrice.ts";

/** The rules over a {file: source} map. Returns failure labels. */
function rules(srcs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const code = Object.fromEntries(Object.entries(srcs).map(([f, s]) => [f, stripComments(s, { file: f })]));

  // 1. pages that switch a surface render the credit
  const pages = Object.keys(code).filter((f) => f.startsWith("app/") && !f.startsWith("app/api/") && /\b(priceProviderFor|readSurfacePrice)\(/.test(code[f]));
  want(`the switched pages are found (${pages.length})`, pages.length >= 4 && pages.includes(HUB) && pages.includes(PICKER_PAGE));
  for (const f of pages) want(`${f} renders the Tiingo credit`, /\{TIINGO_CREDIT\}|marketDataCredit=\{[^}]*TIINGO_CREDIT/.test(code[f]));

  // 2. every rendered {TIINGO_CREDIT} is inside a link to TIINGO_URL
  for (const [f, c] of Object.entries(code)) {
    let i = -1;
    while ((i = c.indexOf("{TIINGO_CREDIT}", i + 1)) >= 0) {
      const before = c.slice(Math.max(0, i - 200), i);
      const open = before.lastIndexOf("<a ");
      const closed = before.lastIndexOf("</a>");
      want(`${f}: the credit at ${i} is a link to TIINGO_URL`, open > closed && /<a href=\{TIINGO_URL\}/.test(before.slice(open)));
    }
  }

  // 3. the Pickers footer: the link is passed with the credit, and rendered
  want("the Pickers footer is given TIINGO_URL with the credit", /marketDataCredit=\{[^}]*TIINGO_CREDIT[^}]*\}\s*marketDataHref=\{[^}]*TIINGO_URL[^}]*\}/.test(code[PICKER_PAGE] ?? ""));
  want("ScanFooter renders a credit with an href as a link", /marketDataHref \? \(\s*<a href=\{marketDataHref\}[^>]*>\{marketDataCredit\}<\/a>/.test(code[FOOTER] ?? ""));

  // 4. one constant, no hand-typed credit
  const typed = Object.entries(code).filter(([f, c]) => f !== CREDIT_FILE && /Market data from Tiingo/.test(c)).map(([f]) => f);
  want(`nobody hand-types the credit${typed.length ? ` (${typed.join(", ")})` : ""}`, typed.length === 0);
  return fails;
}

const files = [...walk("app"), ...walk("lib")];
const srcs = Object.fromEntries(files.map((f) => [f, read(f)]));
const real = rules(srcs);
for (const f of real) check(f, false);
check("every Tiingo price carries the linked credit", real.length === 0);

const MUTANTS = [
  ["the footer renders the credit as plain text", FOOTER, /marketDataHref \? \(\s*<a href=\{marketDataHref\}[^>]*>\{marketDataCredit\}<\/a>\s*\) : \(\s*marketDataCredit\s*\)/, "marketDataCredit"],
  ["the Pickers footer loses its link", PICKER_PAGE, /\s*marketDataHref=\{[^}]*\}/, ""],
  ["the hub drops its credit", HUB, /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/, ""],
  ["a page hand-types the credit unlinked", HUB, /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/, "Market data from Tiingo.com"],
];
for (const [label, file, from, to] of MUTANTS) {
  const m = srcs[file].replace(from, to);
  if (m === srcs[file]) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules({ ...srcs, [file]: m });
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
