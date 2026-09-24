// Pickers Market Cap = shown price x SEC cover-page shares, and nothing else on
// the SEC path (Relay B, #553 COWORK #16 item 3 -- Friday price-split prep).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. AN FMP CAP LEAKS BACK. The price pool's and the stored fundamentals
//      row's market cap are FMP-quote figures; if either is written after the
//      filings overlay, or where the overlay has no row, the column mixes two
//      sources. After the split the pool has a price and no cap, so a leak turns
//      into a silently stale number.
//   2. THE CAP STOPS FOLLOWING THE PRICE. The split swaps the price source and
//      must change nothing else: cap = the price this row SHOWS x SEC shares.
//   3. THE ROLLBACK BREAKS. PICKERS_FUNDAMENTALS=fmp must still show the stored
//      caps (FMP stays on until 14 Oct).
//
//   node scripts/check-pickers-marketcap.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const P = await import(pathToFileURL(path.join(ROOT, "lib/server/pickersSecFundamentals.ts")).href);

function suite(page) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // Behaviour: the cap is shares x the price given, and moves only with it.
  const row = { v: 1, symbol: "X", asOf: "2026-09-24", unit: { reporting: "USD", converted: false }, inputs: { shares: { val: 1_000_000, asOf: "2026-08-01" }, refusals: [] }, m: {} };
  const at100 = P.applySecPickerRow(JSON.parse(JSON.stringify(row)), 100);
  const at120 = P.applySecPickerRow(JSON.parse(JSON.stringify(row)), 120);
  ok("cap = SEC shares x the price shown", at100.marketCap === 100_000_000 && at120.marketCap === 120_000_000, `${at100.marketCap} ${at120.marketCap}`);
  ok("no price, no cap (never a stored figure)", P.applySecPickerRow(JSON.parse(JSON.stringify(row)), null).marketCap === null);
  ok("a refused share count gives no cap", P.applySecPickerRow({ ...row, inputs: { shares: null, refusals: ["share-count-is-stale"] } }, 100).marketCap === null);
  ok("marketCap is one of the overlay's fields", P.SEC_PICKER_FIELDS.includes("marketCap"));

  // Wiring.
  ok("one switch, tied to the SEC path", /const secMarketCap = pickersFundamentalsSource\(\) === "sec";/.test(page));
  ok("the stored row's FMP cap is skipped on the SEC path", /if \(f\.marketCap != null && !secMarketCap\) entry\.marketCap = f\.marketCap;/.test(page));
  ok("the pool's FMP cap is skipped on the SEC path", /if \(p\.marketCap != null && !secMarketCap\) entry\.marketCap = p\.marketCap;/.test(page));
  ok("no other write of marketCap from a stored or pooled row", (page.match(/entry\.marketCap = /g) ?? []).length === 2);
  ok("the overlay divides by the price the row shows", /const shown = valueForPredicateField\(entry, "price"\);\s*const figures = applySecPickerRow\(row, typeof shown === "number" \? shown : null\);/.test(page));
  return fails;
}

const page = readCodeOnly("app/components/PickerResultPage.tsx");
const base = suite(page);
if (base.length) {
  console.error("FAIL check-pickers-marketcap:\n  " + base.join("\n  "));
  process.exit(1);
}
const MUTANTS = [
  ["the pool cap leaks back", page.replace("if (p.marketCap != null && !secMarketCap) entry.marketCap", "if (p.marketCap != null) entry.marketCap")],
  ["the stored cap leaks back", page.replace("if (f.marketCap != null && !secMarketCap) entry.marketCap", "if (f.marketCap != null) entry.marketCap")],
  ["the switch always on (rollback broken)", page.replace('const secMarketCap = pickersFundamentalsSource() === "sec";', "const secMarketCap = true;")],
  ["a third cap source added", page + "\nentry.marketCap = extended.marketCap;"],
];
let survived = 0;
for (const [label, p] of MUTANTS) {
  if (!suite(p).length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-pickers-marketcap: all assertions pass; ${MUTANTS.length} mutants caught`);
