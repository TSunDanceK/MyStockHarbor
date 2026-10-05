// COPY BEFORE INDEX (#553 COWORK #152, 2026-10-05).
//
// The picker pages were noindexed on 15 Aug as a thin near-duplicate cluster.
// Batch 1 of the indexing test unblocked five only once each carried a
// write-up. This makes the rule permanent: every picker page OUTSIDE
// lib/noindexPickerPages.ts must carry bodySections with at least 400 words of
// paragraph text, so a page can never be indexed thin again.
//
// THE KEEPERS THAT PREDATE THE RULE are named here, exactly. They were kept
// indexable on 15 Aug for measured reasons (see the header of
// lib/noindexPickerPages.ts) and have no write-up yet. The list may shrink
// (give one a write-up and delete it here) but never grow: adding a name is
// itself a failure, so an unblocked page cannot hide in it.
//
// Also: the write-up is read text, so .screenerProse p is at --fs-read /
// --lh-read (the reading floor), at both widths.
//
// Every rule has a planted mutant.
//
//   node scripts/check-picker-copy-before-index.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MIN_WORDS = 400;
const KEEPERS_WITHOUT_COPY = [
  "/all-time-high-breakout-stocks",
  "/bullish-bearish-divergence-stocks",
  "/oversold-stocks-today",
  "/stock-screener",
  "/stocks-near-200-day-moving-average",
];
const BATCH_1 = [
  "/cheap-tech-stocks",
  "/overbought-stocks-today",
  "/volume-spike-stocks",
  "/stocks-trading-above-200-day-moving-average",
  "/bullish-rsi-divergence-stocks",
];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function noindexList(src) {
  const body = src.match(/export const NOINDEX_PICKER_PAGES = \[([\s\S]*?)\] as const;/);
  return body ? [...body[1].matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]) : null;
}

/** Words in the paragraphs of a page's bodySections (headings excluded). */
function writeUpWords(src) {
  const block = src.match(/\n  bodySections: \[([\s\S]*?)\n  \],/);
  if (!block) return 0;
  let words = 0;
  for (const para of block[1].matchAll(/paragraphs: \[([\s\S]*?)\n\s*\],/g)) {
    for (const q of para[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) words += q[1].split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  }
  return words;
}

function pickerPages(files) {
  const out = [];
  for (const [file, src] of Object.entries(files)) {
    if (!/from "@\/app\/components\/PickerResultPage"/.test(src)) continue;
    out.push({ href: "/" + path.basename(path.dirname(file)), src });
  }
  return out;
}

function rules({ files, noindexSrc, keepers, pageSrc }) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const noindex = noindexList(noindexSrc);
  want("the noindex list was found", Array.isArray(noindex) && noindex.length > 0);
  const pages = pickerPages(files);
  want("the picker pages were found by scanning app/", pages.length >= 30);
  for (const { href, src } of pages) {
    if (noindex?.includes(href)) continue;
    if (keepers.includes(href)) continue;
    const w = writeUpWords(src);
    want(`${href} is indexable, so it carries a write-up of ≥ ${MIN_WORDS} words (has ${w})`, w >= MIN_WORDS);
  }
  want("the keepers without copy are exactly the five that predate the rule (it may shrink, never grow)",
    keepers.length <= KEEPERS_WITHOUT_COPY.length && keepers.every((k) => KEEPERS_WITHOUT_COPY.includes(k)));
  for (const href of BATCH_1) want(`batch 1: ${href} is out of the noindex list`, !noindex?.includes(href));
  // The write-up is read text: the reading floor at both widths.
  const prose = pageSrc.match(/\.screenerProse p \{[^}]*\}/g) ?? [];
  want("the write-up paragraphs are at --fs-read / --lh-read, desktop and phone",
    prose.length >= 2 && prose.every((r) => /font-size: var\(--fs-read\)/.test(r) && /line-height: var\(--lh-read\)/.test(r)));
  return fails;
}

const files = {};
for (const d of fs.readdirSync(path.join(ROOT, "app"))) {
  const f = `app/${d}/page.tsx`;
  if (fs.existsSync(path.join(ROOT, f))) files[f] = read(f);
}
const real = { files, noindexSrc: read("lib/noindexPickerPages.ts"), keepers: KEEPERS_WITHOUT_COPY, pageSrc: read("app/components/PickerResultPage.tsx") };

console.log("\n1. The real pages");
const fails = rules(real);
for (const f of fails) check(f, false);
check("every indexable picker page has its write-up; batch 1 is unblocked; the prose reads at --fs-read", fails.length === 0);

console.log("\n2. Planted mutants");
const strip = (src) => src.replace(/\n  \/\/ WRITE-UP[\s\S]*?\n  bodySections: \[[\s\S]*?\n  \],/, "");
const MUTANTS = [
  ["an unblocked page loses its write-up", () => ({ ...real, files: { ...files, "app/volume-spike-stocks/page.tsx": strip(files["app/volume-spike-stocks/page.tsx"]) } })],
  ["a page is unblocked with no write-up", () => ({ ...real, noindexSrc: real.noindexSrc.replace('  "/atr-spike-stocks",\n', "") })],
  ["the keepers list grows to hide a page", () => ({ ...real, keepers: [...KEEPERS_WITHOUT_COPY, "/volume-spike-stocks"] })],
  ["a write-up cut below 400 words", () => ({ ...real, files: { ...files, "app/overbought-stocks-today/page.tsx": files["app/overbought-stocks-today/page.tsx"].replace(/(paragraphs: \[\n)((?:\s+"[^\n]*",\n)+)/g, (m, a, b) => a + b.split("\n").slice(0, 1).join("\n") + "\n") } })],
  ["a batch-1 page back on the noindex list", () => ({ ...real, noindexSrc: real.noindexSrc.replace('export const NOINDEX_PICKER_PAGES = [\n', 'export const NOINDEX_PICKER_PAGES = [\n  "/cheap-tech-stocks",\n') })],
  ["the prose back at 14.5px", () => ({ ...real, pageSrc: real.pageSrc.replace(/\.screenerProse p \{ margin: 0 0 12px; font-size: var\(--fs-read\);/, ".screenerProse p { margin: 0 0 12px; font-size: 14.5px;") })],
];
for (const [label, make] of MUTANTS) {
  const m = make();
  const changed = JSON.stringify(m) !== JSON.stringify(real);
  if (!changed) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const f = rules(m);
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
