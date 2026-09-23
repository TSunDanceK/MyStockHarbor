// NO FMP DATA IS STORED IN THIS REPO (owner ruling, #552 COWORK #4/#5/#6).
//
//   1. No file under data/ or public/ carries a `source`-type field naming FMP
//      or financialmodelingprep, and no file there names financialmodelingprep
//      at all. MUTATION: a file with one such row added is caught.
//   2. The removed paths stay removed: the consensus freeze, the static-profile
//      snapshot and its wire form, the taxonomy, the dashboard mockups.
//   3. relay.yml no longer uploads data/consensus/* into every artifact.
//   4. Every screenshot under claude/screenshots/ is one reviewed for FMP-sourced
//      figures (the list below). A new screenshot fails this until someone looks
//      at it and adds it. MUTATION: an unreviewed name is caught.
//
//   node scripts/check-no-fmp-data.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const TEXT = /\.(json|jsonl|txt|csv|tsv|html|htm|md|xml|js|mjs|svg)$/i;
const walk = (dir) => !fs.existsSync(path.join(ROOT, dir)) ? [] :
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);

/** The offending lines in a text: a source-type key naming FMP, or the FMP host at all. */
export function fmpHits(text) {
  const hits = [];
  for (const m of text.matchAll(/"([A-Za-z_]*source[A-Za-z_]*)"\s*:\s*"([^"]*)"/gi)) {
    if (/\bfmp\b|financialmodelingprep/i.test(m[2])) hits.push(`${m[1]}: ${m[2].slice(0, 60)}`);
  }
  if (/financialmodelingprep/i.test(text)) hits.push("names financialmodelingprep");
  return hits;
}

console.log("\n=== 1. No FMP-sourced data under data/ or public/ ===\n");
{
  const files = [...walk("data"), ...walk("public")].filter((f) => TEXT.test(f));
  const bad = files.map((f) => [f, fmpHits(fs.readFileSync(path.join(ROOT, f), "utf8"))]).filter(([, h]) => h.length);
  check(`none of ${files.length} text files carries an FMP source`, bad.length === 0,
    bad.slice(0, 5).map(([f, h]) => `${f} (${h[0]})`).join("; "));
  const sample = '{"rows":{"AAPL":{"sector":"Technology"}}}';
  const mutated = sample.replace('"sector":"Technology"', '"sector":"Technology","source":"FMP /stable/profile"');
  check("MUTATION: one re-added FMP-sourced row is caught", fmpHits(sample).length === 0 && fmpHits(mutated).length === 1);
  check("MUTATION: the FMP host anywhere is caught", fmpHits('{"note":"from financialmodelingprep.com"}').length === 1);
}

console.log("\n=== 2. The removed paths stay removed ===\n");
for (const p of ["data/consensus", "data/static-profile.json", "data/taxonomy.json", "public/preview",
  "app/api/debug/static-profile", ".github/workflows/consensus-freeze-commit.yml",
  ".github/workflows/step0-ground-truth.yml", "scripts/consensus-freeze.mjs"]) {
  check(`${p} is absent`, !fs.existsSync(path.join(ROOT, p)));
}
{
  const wire = fs.existsSync(path.join(ROOT, "data/.wire")) ? fs.readdirSync(path.join(ROOT, "data/.wire")) : [];
  check("no data/.wire/static-profile-* file", !wire.some((f) => f.startsWith("static-profile-")));
}

console.log("\n=== 3. The relay does not bundle data/consensus/ ===\n");
check("relay.yml's upload paths do not include data/consensus",
  !/^\s*data\/consensus/m.test(fs.readFileSync(path.join(ROOT, ".github/workflows/relay.yml"), "utf8")));

console.log("\n=== 4. Every committed screenshot was reviewed for FMP-sourced figures ===\n");
// Reviewed 2026-09-23 (#552): SEC-filed figures only, no price or market-cap
// panel. The earnings-round-2 set showed a valuation card built on the then
// FMP close and was deleted.
const REVIEWED = new Set([
  "claude/screenshots/earnings-small-defects-2026-09-23/before-TSLA.png",
  "claude/screenshots/earnings-small-defects-2026-09-23/after-TSLA.png",
  "claude/screenshots/earnings-small-defects-2026-09-23/before-AVAV.png",
  "claude/screenshots/earnings-small-defects-2026-09-23/after-AVAV.png",
]);
const unreviewed = (list) => list.filter((f) => !REVIEWED.has(f));
{
  const shots = walk("claude/screenshots");
  check(`all ${shots.length} screenshots are on the reviewed list`, unreviewed(shots).length === 0, unreviewed(shots).join(", "));
  check("MUTATION: an unreviewed screenshot is caught",
    unreviewed([...shots, "claude/screenshots/new/avav-valuation.png"]).length === 1);
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
