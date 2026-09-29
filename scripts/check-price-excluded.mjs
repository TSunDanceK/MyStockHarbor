// The dated PRICE_EXCLUDED list (#553 COWORK #61 §1): EQR, BK and CCZ hidden
// from every price surface, and nowhere else.
//
// WHAT IS AT RISK: a hidden name comes back through one path that forgot the
// list (the market's movers come from outside the universe, related-stock
// links from curated lists), or the list quietly grows a reason-less row.
// Search and the SEC pages must NOT apply it: hide from lists, never delete.
//
// Each application site is held by a predicate, and each predicate is run
// again on a mutant with that site's filter removed: it must fail.
//
//   node scripts/check-price-excluded.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const X = await import(pathToFileURL(path.join(ROOT, "lib/priceExcluded.mjs")).href);
const rows = X.PRICE_EXCLUDED;
check("the list is exactly EQR, BK, CCZ", Object.keys(rows).sort().join() === "BK,CCZ,EQR", Object.keys(rows).join());
check("EQR and BK are tiingo-gap; CCZ is debt-security", rows.EQR?.reason === "tiingo-gap" && rows.BK?.reason === "tiingo-gap" && rows.CCZ?.reason === "debt-security");
check("every row is dated and says why", Object.values(rows).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.since) && String(r.note).length > 5));
check("isPriceExcluded: any case, either spelling", X.isPriceExcluded("eqr") && X.isPriceExcluded(" BK ") && X.isPriceExcluded("CCZ"));
check("...and nothing else", !X.isPriceExcluded("AAPL") && !X.isPriceExcluded(["BRK", "B"].join(".")) && !X.isPriceExcluded("BKNG"));

// ── where it is applied ──────────────────────────────────────────────────────
const SITES = [
  {
    label: "the Tiingo universe (EOD and quotes) drops them",
    file: "lib/server/marketData/jobs.ts",
    ok: (c) => /\.filter\(\(s\) => !isDebtListing\(s\) && !isPriceExcluded\(s\)\)/.test(c),
    mutate: (c) => c.replace("&& !isPriceExcluded(s)", ""),
  },
  {
    label: "the Pickers universe skips them (so every preset, signal and section)",
    file: "lib/server/pickersBuilder.ts",
    ok: (c) => /if \(!s \|\| universeSlots\.has\(s\) \|\| isPriceExcluded\(s\)\) continue;/.test(c),
    mutate: (c) => c.replace(" || isPriceExcluded(s)) continue;", ") continue;"),
  },
  {
    label: "the dashboard ticker's movers skip them",
    file: "lib/server/pickersBuilder.ts",
    ok: (c) => /const topMoversForTicker = topMoversRaw[\s\S]{0,400}\.filter\(\(row\) => !isPriceExcluded\(row\.symbol\)\)/.test(c),
    mutate: (c) => c.replace(".filter((row) => !isPriceExcluded(row.symbol))", ""),
  },
  {
    label: "\"Explore More Stocks\" never links to them",
    file: "lib/curatedSymbols.ts",
    ok: (c) => /if \(seen\.has\(candidate\) \|\| isPriceExcluded\(candidate\)\) continue;/.test(c),
    mutate: (c) => c.replace(" || isPriceExcluded(candidate)", ""),
  },
];
for (const site of SITES) {
  const code = readCodeOnly(site.file);
  check(site.label, site.ok(code), site.file);
  const mutant = site.mutate(code);
  check(`...mutant caught: that filter removed, a hidden name comes back`, mutant !== code && !site.ok(mutant));
}

// ── where it must NOT be applied ─────────────────────────────────────────────
for (const f of ["lib/server/symbolSearch.ts", "lib/server/searchIndex.ts"]) {
  if (fs.existsSync(path.join(ROOT, f))) check(`search keeps them (${f} does not apply the list)`, !/isPriceExcluded|PRICE_EXCLUDED/.test(readCodeOnly(f)));
}
const secFiles = fs.readdirSync(path.join(ROOT, "lib/server")).filter((f) => /^sec.*\.ts$/.test(f));
check(`the SEC side keeps them (${secFiles.length} lib/server/sec*.ts files do not apply the list)`, secFiles.every((f) => !/isPriceExcluded|PRICE_EXCLUDED/.test(readCodeOnly(`lib/server/${f}`))));

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
