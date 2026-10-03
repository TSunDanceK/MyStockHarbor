// The Daily and Weekly returns cards on /stock/[symbol] are STACKED at every
// width (owner, #553 COWORK #6, 2026-09-23). Layout only.
//
// SINCE #552 COWORK #89 the two are ONE card with a Daily | Weekly toggle
// (app/components/ReturnsToggleCard.tsx; its behaviour is pinned in
// check-tiingo-step3.mjs). This check still holds the grid to one full-width
// column, and the card to Daily-first: daily={dailyReturns} weekly={weeklyReturns}.
//
// WHAT IS AT RISK: a later edit restores the two-column grid (or adds a
// breakpoint that does), and the half-width cards come back with nothing
// failing. The rule lives in a <style> template string, so the check reads the
// declared grid for .returns-charts-grid -- every declaration of it, media
// queries included -- and requires exactly one column. A mutant restoring the
// old two-column rule must fail it.
//
//   node scripts/check-returns-stacked.mjs
import fs from "node:fs";

const FILE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const src = fs.readFileSync(FILE, "utf8");

function verdict(source) {
  const fails = [];
  const rules = [...source.matchAll(/\.returns-charts-grid\s*\{([^}]*)\}/g)].map((m) => m[1]);
  if (!rules.length) fails.push("no .returns-charts-grid rule found");
  for (const body of rules) {
    const cols = body.match(/grid-template-columns:\s*([^;!]+)/)?.[1]?.trim();
    if (cols && cols !== "1fr") fails.push(`a .returns-charts-grid rule declares "${cols}", not one column`);
  }
  const grid = source.match(/<div className="returns-charts-grid">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const cards = [...grid.matchAll(/<ReturnsToggleCard [^>]*daily=\{(\w+)\} weekly=\{(\w+)\}/g)].map((m) => `${m[1]}|${m[2]}`);
  if (cards.join(",") !== "dailyReturns|weeklyReturns") fails.push(`the grid holds [${cards}] rather than one toggle card, Daily then Weekly`);
  return fails;
}

let failures = 0;
const real = verdict(src);
console.log(real.length ? real.map((f) => `  FAIL  ${f}`).join("\n") : "  PASS  Daily and Weekly returns are stacked, one column, at every width");
failures += real.length;

const MUTANTS = [
  ["the old two-column grid", "grid-template-columns: 1fr; gap: 16px;", "grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;"],
  ["a desktop breakpoint re-splitting it", "@media (max-width: 900px) {", "@media (min-width: 1200px) { .returns-charts-grid { grid-template-columns: 1fr 1fr; } }\n        @media (max-width: 900px) {"],
  ["the views swapped", "daily={dailyReturns} weekly={weeklyReturns}", "daily={weeklyReturns} weekly={dailyReturns}"],
];
for (const [label, from, to] of MUTANTS) {
  if (!src.includes(from)) { console.log(`  FAIL  mutant "${label}" no longer matches`); failures++; continue; }
  const caught = verdict(src.replace(from, to)).length > 0;
  console.log(`  ${caught ? "PASS" : "FAIL"}  mutant caught: ${label}`);
  if (!caught) failures++;
}
console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
