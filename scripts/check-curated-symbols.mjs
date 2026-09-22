// EVERY CURATED STOCK RESOLVES TO A CIK — because the sitemap submits it.
//
// ── WHAT THIS EXISTS FOR ──────────────────────────────────────────────────
// lib/curatedSymbols.ts said "SQ" after Block renamed its ticker to XYZ. SEC's
// registrant directory carries XYZ at cik 0001512673 and no row for SQ, so
// /stock/SQ/earnings resolved no CIK — and app/sitemap.ts was submitting that
// URL to Google. One stale string in a hand-maintained list, invisible until
// someone opened the page.
//
// It was the ONLY one of 129 that failed, which is why a check is worth more
// than a one-off fix: the list is edited by hand and the next rename will look
// exactly like this one did.
//
// ── THE LOOKUP IS THE SHIPPED ONE ─────────────────────────────────────────
// lookupBySpelling, not a bare Map.has. The file spells Berkshire BRK-B and
// the site spells it BRK.B; a membership test reported that as broken earlier,
// which is a wrong answer that reads as a finding about Berkshire.
//
// ── ETFs ARE EXEMPT, AND THAT IS NOT A LOOPHOLE ───────────────────────────
// app/sitemap.ts already excludes uniqueEtfs from the /earnings entries: a
// fund has no quarter to show. Measured, 25 of 32 do not resolve, and that is
// correct — a fund trading as a series of a trust is never its own registrant.
// Requiring them to resolve would be asserting something false about funds.
import fs from "node:fs";
import ts from "typescript";
import { lookupBySpelling } from "../lib/symbolSpellings.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
const parser = await lift([
  grabFunction(tickerSrc, "padCik"),
  grabFunction(tickerSrc, "parseTickerFile"),
  "export { parseTickerFile };",
].join("\n"));
const TICKER_FILE = (readCodeOnly("lib/server/secTickerMap.ts").match(/TICKER_FILE = "([^"]+)"/) ?? [])[1];
const { map, shape } = parser.parseTickerFile(fs.readFileSync(TICKER_FILE, "utf8"));
check("the committed registrant file parses", map.size > 1000, `${map.size} tickers, shape=${shape}`);

const js = ts.transpileModule(fs.readFileSync("lib/curatedSymbols.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const tmp = `scripts/.curated-check-${process.pid}.mjs`;
fs.writeFileSync(tmp, js);
let curated;
try { curated = await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }

const etfs = new Set(curated.uniqueEtfs.map((s) => s.toUpperCase()));
const submitted = [...new Set(curated.priorityStocks.map((s) => s.toUpperCase()))].filter((s) => !etfs.has(s));
check("the curated universe loaded", submitted.length > 50, `${submitted.length} stocks submitted for /earnings`);

const unresolved = submitted.filter((s) => !lookupBySpelling(map, s)?.value?.cik);
check("every curated stock the sitemap submits resolves to a CIK",
  unresolved.length === 0,
  unresolved.length
    ? `${unresolved.join(" ")} — a renamed or delisted ticker in curatedSymbols.ts. ` +
      `Check SEC's directory for the current spelling before removing it.`
    : `all ${submitted.length}`);

// THE SPELLING BRIDGE IS LOAD-BEARING, so it is asserted rather than assumed:
// if lookupBySpelling stopped bridging separators this check would start
// failing on Berkshire and the message above would blame curatedSymbols.
const brk = submitted.find((s) => /^BRK/.test(s));
if (brk) {
  check(`...including ${brk}, through the spelling bridge`,
    Boolean(lookupBySpelling(map, brk)?.value?.cik),
    `the file spells it with a hyphen; a bare lookup would fail here and blame the list`);
}

console.log(`\n${failures ? `${failures} FAILED` : "Curated symbols all resolve."}`);
process.exit(failures ? 1 : 0);
