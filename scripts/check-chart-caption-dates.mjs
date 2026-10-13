// CHART CAPTIONS READ AS DATES, NOT ISO STRINGS (#553 COWORK #113/#114, 2026-10-03).
//
// The stock page's chart caption read "AAPL • 2025-10-20 → 2026-10-02". It
// now reads "20 Oct 2025 → 2 Oct 2026" through lib/utcDate.ts utcDay (UTC
// fields, formatted by hand, so the server render and the browser's agree --
// no toLocale*). Same for PriceChart's "From ... → ..." caption.
//   1. utcDay on the caption's inputs (date-only strings, a year boundary,
//      single-digit days) gives "D Mon YYYY" in UTC.
//   2. Both captions pass both endpoints through utcDay (comments stripped).
//   3. Mutants: each caption back to raw ISO, and utcDay on local fields.
//
//   node scripts/check-chart-caption-dates.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const UTC = "lib/utcDate.ts";
const STOCK = "app/stock/[symbol]/StockPriceChart.tsx";
const PRICE = "app/components/PriceChart.tsx";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
async function loadSibling(source) {
  const file = path.join(ROOT, "lib", `.check-ccd-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

// Run in a zone west of UTC, where local-field formatting of "2025-10-20"
// (UTC midnight) would give the 19th -- so a local-field mutant is caught.
process.env.TZ = "America/Los_Angeles";
function dateRules(U) {
  const fails = [];
  for (const [input, want] of [["2025-10-20", "20 Oct 2025"], ["2026-10-02", "2 Oct 2026"], ["2025-12-31", "31 Dec 2025"], ["2026-01-01", "1 Jan 2026"]]) {
    const got = U.utcDay(input);
    if (got !== want) fails.push(`utcDay("${input}") is "${want}" — got ${got}`);
  }
  return fails;
}
const CAPTION = {
  [STOCK]: /\{symbol\} • \{utcDay\(series\[0\]\.date\) \?\? series\[0\]\.date\} → \{utcDay\(series\[series\.length - 1\]\.date\) \?\? series\[series\.length - 1\]\.date\}/,
  [PRICE]: /`From \$\{utcDay\(series\[0\]\.date\) \?\? series\[0\]\.date\} → \$\{utcDay\(series\[series\.length - 1\]\.date\) \?\? series\[series\.length - 1\]\.date\}`/,
};
function captionRules(file, src) {
  const c = stripComments(src, { file });
  const fails = [];
  if (!CAPTION[file].test(c)) fails.push(`${file}: the caption formats both endpoints with utcDay`);
  if (/\{series\[0\]\.date\} →|\$\{series\[0\]\.date\} →/.test(c)) fails.push(`${file}: no raw ISO start date in the caption`);
  if (!/import \{[^}]*\butcDay\b[^}]*\} from "@\/lib\/utcDate";/.test(c)) fails.push(`${file}: utcDay imported from lib/utcDate`);
  return fails;
}

const utcSrc = read(UTC);
{
  const fails = dateRules(await loadSibling(utcSrc));
  for (const f of fails) check(f, false);
  check("utcDay: \"20 Oct 2025\" style, UTC, at a year boundary and on single-digit days", fails.length === 0);
}
const srcs = { [STOCK]: read(STOCK), [PRICE]: read(PRICE) };
for (const file of [STOCK, PRICE]) {
  const fails = captionRules(file, srcs[file]);
  for (const f of fails) check(f, false);
  check(`${file}: the caption reads as dates`, fails.length === 0);
}

console.log("\n  mutants (each must be caught)");
for (const [label, file, from, to] of [
  ["the stock-page caption back to ISO", STOCK, "{utcDay(series[0].date) ?? series[0].date} → {utcDay(series[series.length - 1].date) ?? series[series.length - 1].date}", "{series[0].date} → {series[series.length - 1].date}"],
  ["the PriceChart caption back to ISO", PRICE, "${utcDay(series[0].date) ?? series[0].date} → ${utcDay(series[series.length - 1].date) ?? series[series.length - 1].date}", "${series[0].date} → ${series[series.length - 1].date}"],
]) {
  const m = srcs[file].replace(from, to);
  check(`mutant "${label}" is caught`, m !== srcs[file] && captionRules(file, m).length > 0);
}
{
  const from = "`${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`";
  const m = utcSrc.replace(from, "`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`");
  let fails;
  try { fails = m === utcSrc ? ["anchor"] : dateRules(await loadSibling(m)); } catch (err) { fails = [String(err)]; }
  check(`mutant "utcDay on local fields (the day before, west of UTC)" is caught`, m !== utcSrc && fails.length > 0, fails[0] ?? "no assertion failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
