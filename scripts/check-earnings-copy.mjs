// No beat/miss/surprise promised where the site has no estimates (#553 COWORK #63).
//
// The earnings pages run on SEC filings since 2026-09-21 and carry no analyst
// estimates, so there is no beat, miss or surprise anywhere on them. The
// dashboard's Earnings discovery tile still promised "Beat, miss & surprise %
// — decoded" on 27 Sep. Each surface that links to an earnings page is held
// here; a mutant restoring the old wording must fail.
//
//   node scripts/check-earnings-copy.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const WORDS = /\b(beat|beats|miss|misses|surprise|surprises)\b/i;

/** The Earnings tile's text in DiscoveryStrip, from code only. */
function earningsTileText(code) {
  const m = code.match(/key:\s*"earnings"[\s\S]*?text:\s*"([^"]*)"/);
  return m ? m[1] : null;
}
const strip = readCodeOnly("app/components/DiscoveryStrip.tsx");
const tile = earningsTileText(strip);
check("the Earnings discovery tile has text", Boolean(tile), String(tile));
check("...and promises no beat, miss or surprise", tile !== null && !WORDS.test(tile), String(tile));
const mutant = earningsTileText(strip.replace(/(key:\s*"earnings"[\s\S]*?text:\s*)"[^"]*"/, '$1"Beat, miss & surprise % — decoded"'));
check("...mutant caught: the old tile text restored", mutant !== null && WORDS.test(mutant));

const ticker = readCodeOnly("app/components/DashboardTicker.tsx");
const tickerLine = (c) => (c.match(/id: `posearnings-\$\{item\.symbol\}`,\s*text: `([^`]*)`/) ?? [])[1] ?? null;
check("the dashboard ticker's earnings line claims no beat", tickerLine(ticker) !== null && !WORDS.test(tickerLine(ticker)), String(tickerLine(ticker)));
check("...mutant caught: the old ticker line restored",
  WORDS.test(tickerLine(ticker.replace(/(id: `posearnings-\$\{item\.symbol\}`,\s*text: `)[^`]*`/, "$1${item.symbol} beat on its last earnings report`")) ?? ""));

const lesson = fs.readFileSync("app/learn/fundamentals-lessons.ts", "utf8");
check("the fundamentals lesson no longer says our earnings card shows the estimate and the surprise",
  !/earnings card shows the actual, the estimate and the surprise/.test(lesson));

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
