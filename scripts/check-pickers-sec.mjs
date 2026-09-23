// Pickers off FMP fundamentals (Relay B, #553 COWORK #5, 2026-09-23).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A REFUSAL QUIETLY BECOMES FMP'S NUMBER. The filings refuse a figure (an
//      ADS share count, an incomplete revenue line, a missing debt line) and
//      the page shows the old FMP value in its place -- a column of two sources
//      that says neither.
//   2. THE ARITHMETIC DRIFTS FROM THE STOCK PAGE. Market Cap / PS / PB have to
//      come from the SAME secValuation functions the stock page uses.
//   3. A HIDDEN COLUMN IS HALF-HIDDEN: gone from the grid but still offered as
//      a filter, or registered under a key that matches no column.
//   4. A PRESET GOES TO ZERO ROWS because its predicate reads a hidden field
//      (always empty) -- COWORK #1's explicit rule.
//
// Section 1 runs the real module on the committed SEC fact-set fixtures
// (data/sec/factset-fixture-*.json -- SEC data, public domain) and then runs
// every assertion again on mutated copies: each mutant must be caught.
//
//   node scripts/check-pickers-sec.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MODULE = "lib/server/pickersSecFundamentals.ts";
const TODAY = "2026-09-23";
const NOW = Date.parse(TODAY);
const PRICE = 100;
const fixture = (s) => JSON.parse(read(`data/sec/factset-fixture-${s}.json`));

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-psec-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}
const V = await import(pathToFileURL(path.join(ROOT, "lib/server/secValuation.ts")).href);
const { valueOf } = await import(pathToFileURL(path.join(ROOT, "lib/server/secFactCodec.ts")).href);

// ─────────────────────────────────────────────── 1. the module, on fixtures
async function suite(mod) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const close = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const figs = {};
  const rows = {};
  for (const s of ["AAPL", "TSLA", "AZN", "KTOS", "AVAV", "GEV", "KGC"]) {
    rows[s] = mod.buildSecPickerRow(fixture(s), TODAY, {}, NOW);
    figs[s] = mod.applySecPickerRow(JSON.parse(JSON.stringify(rows[s])), PRICE); // through JSON, as Redis stores it
  }
  const aapl = fixture("AAPL");
  const inputs = V.valuationInputs(aapl, TODAY, {});
  const m = V.multipleInputs(aapl);
  const mult = V.valuationMultiples(inputs, m, PRICE);

  ok("Market Cap is secValuation.marketCap, the stock page's function", close(figs.AAPL.marketCap, V.marketCap(inputs, PRICE).val));
  ok("PS and PB are secValuation.valuationMultiples'", close(figs.AAPL.psRatio, mult.ps.val) && close(figs.AAPL.pbRatio, mult.pb.val));
  const bs = m.balanceSheet;
  ok("Ent. Value = cap + short debt + long debt − cash",
    close(figs.AAPL.enterpriseValue, figs.AAPL.marketCap + bs.shortTermDebt + bs.longTermDebt - bs.cash));
  const four = aapl.quarters.slice(0, 4);
  const sum = (k) => four.reduce((a, q) => a + valueOf(q, k), 0);
  ok("FCF = TTM operating cash flow − TTM capex", close(figs.AAPL.freeCashFlow, sum("operatingCashFlow") - sum("capex")));
  ok("P/FCF = cap ÷ FCF", close(figs.AAPL.pfcfRatio, figs.AAPL.marketCap / figs.AAPL.freeCashFlow));
  ok("Div Yield is a PERCENT (the grid's 100× trap)", close(figs.AAPL.divYield, (figs.AAPL.divPerShare / PRICE) * 100) && figs.AAPL.divYield > 0.5);
  ok("Revenue is the TTM revenue", close(figs.AAPL.revenue, m.revenue.vals.revenue));

  ok("a refused share count is a DASH on every cap-based column (AZN: no cover shares)",
    ["marketCap", "psRatio", "pbRatio", "enterpriseValue", "pfcfRatio"].every((k) => figs.AZN[k] === null));
  ok("non-positive FCF gives no P/FCF (KTOS)", figs.KTOS.freeCashFlow < 0 && figs.KTOS.pfcfRatio === null);
  ok("a missing debt line gives no Ent. Value, not debt = 0 (KTOS)", figs.KTOS.marketCap !== null && figs.KTOS.enterpriseValue === null);
  ok("a non-payer has no dividend figures, not zero (TSLA)",
    figs.TSLA.divPerShare === null && figs.TSLA.divYield === null && figs.TSLA.divGrowth === null);

  const guarded = JSON.parse(JSON.stringify(rows.AAPL));
  guarded.m.revenueIncomplete = true;
  const g = mod.applySecPickerRow(guarded, PRICE);
  ok("an incomplete revenue line refuses BOTH Revenue and PS (the shared guard)", g.revenue === null && g.psRatio === null);

  const noPrice = mod.applySecPickerRow(JSON.parse(JSON.stringify(rows.AAPL)), null);
  ok("no price: the price-based columns are empty, the filed ones are not",
    noPrice.marketCap === null && noPrice.divYield === null && noPrice.revenue !== null && noPrice.divPerShare !== null);

  ok("every figure the module returns is one of SEC_PICKER_FIELDS, and vice versa",
    Object.keys(figs.AAPL).sort().join() === [...mod.SEC_PICKER_FIELDS].sort().join());
  ok("P/E, EPS and Payout Ratio are NOT owned by the filings yet (COWORK #5 Q1)",
    !["peRatio", "epsTtm", "payoutRatio"].some((k) => mod.SEC_PICKER_FIELDS.includes(k)));

  process.env.PICKERS_FUNDAMENTALS = "fmp";
  const rollback = mod.pickersFundamentalsSource();
  process.env.PICKERS_FUNDAMENTALS = "anything-else";
  const typo = mod.pickersFundamentalsSource();
  delete process.env.PICKERS_FUNDAMENTALS;
  ok("PICKERS_FUNDAMENTALS=fmp is the rollback; anything else reads the filings", rollback === "fmp" && typo === "sec" && mod.pickersFundamentalsSource() === "sec");
  return fails;
}

let failures = 0;
const src = read(MODULE);
const real = await suite(await loadSibling(MODULE, src));
console.log("\n=== 1. the SEC figures, on the committed fact-set fixtures ===");
if (!real.length) console.log("  PASS  every assertion");
for (const f of real) console.log(`  FAIL  ${f}`);
failures += real.length;

console.log("\n=== mutants (each must be caught) ===");
const MUTANTS = [
  ["revenue ignores the incomplete-line guard", "const revenue = row.m.revenueIncomplete ? null : row.m.revenue?.vals.revenue ?? null;", "const revenue = row.m.revenue?.vals.revenue ?? null;"],
  ["negative FCF divided anyway", "row.freeCashFlow !== null && row.freeCashFlow > 0 ? cap / row.freeCashFlow", "row.freeCashFlow !== null ? cap / row.freeCashFlow"],
  ["yield left as a fraction", "(row.divPerShare / price) * 100", "row.divPerShare / price"],
  ["FCF adds capex", "cf.vals.operatingCashFlow - Math.abs(cf.vals.capex)", "cf.vals.operatingCashFlow + Math.abs(cf.vals.capex)"],
  ["a missing debt line read as zero",
    "cap !== null && bs && bs.shortTermDebt !== null && bs.longTermDebt !== null && bs.cash !== null\n      ? cap + bs.shortTermDebt + bs.longTermDebt - bs.cash",
    "cap !== null && bs\n      ? cap + (bs.shortTermDebt ?? 0) + (bs.longTermDebt ?? 0) - (bs.cash ?? 0)"],
  ["the rollback spelling broken", 'process.env.PICKERS_FUNDAMENTALS === "fmp"', 'process.env.PICKERS_FUNDAMENTALS === "FMP"'],
  ["P/E moved before the EPS fix", '"marketCap", "psRatio"', '"peRatio", "marketCap", "psRatio"'],
];
for (const [label, from, to] of MUTANTS) {
  if (!src.includes(from)) {
    console.log(`  FAIL  mutant "${label}" no longer matches the source — update this check`);
    failures++;
    continue;
  }
  const fails = await suite(await loadSibling(MODULE, src.replace(from, to)));
  console.log(`  ${fails.length ? "PASS" : "FAIL"}  mutant caught: ${label}${fails.length ? ` (${fails[0]})` : " — NOTHING FAILED"}`);
  if (!fails.length) failures++;
}

// ─────────────────────────────────────────────── 2. the hide registry
console.log("\n=== 2. hidden columns (lib/pickerHiddenFields.ts) ===");
const reg = await import(pathToFileURL(path.join(ROOT, "lib/pickerHiddenFields.ts")).href);
const grid = readCodeOnly("app/components/PickerResultsGrid.tsx");
const colKeys = new Set([...grid.matchAll(/: Col = \{ key: "([a-z0-9]+)"/g)].map((m) => m[1]));
const entryType = readCodeOnly("app/components/PickerResultPage.tsx");
const fields = readCodeOnly("lib/screenerFields.ts");
const checks = [
  ["the five analyst columns and Payout Freq. are registered, dated",
    ["rating", "analysts", "ptgt", "ptups", "fwdpe", "freq"].every((k) => reg.HIDDEN_COLUMN_KEYS.has(k)) &&
      reg.HIDDEN_PICKER_FIELDS.every((h) => /^2026-\d\d-\d\d$/.test(h.retiredOn) && h.reason.length > 40 && h.source)],
  ["every registered column key matches a real grid column (a typo would hide nothing)",
    [...reg.HIDDEN_COLUMN_KEYS].every((k) => colKeys.has(k)), [...reg.HIDDEN_COLUMN_KEYS].filter((k) => !colKeys.has(k)).join(",")],
  ["every registered field is a real ResultEntry field",
    reg.HIDDEN_PICKER_FIELDS.every((h) => new RegExp(`\\b${h.field}\\?:`).test(entryType))],
  ["the grid drops registered columns from EVERY tab", /sets\[tab\] = sets\[tab\]\.filter\(\(col\) => !HIDDEN_COLUMN_KEYS\.has\(col\.key\)\)/.test(grid)],
  ["the grid drops registered tabs, and a page defaulting to one opens on General",
    /const TABS = ALL_TABS\.filter\(\(t\) => !HIDDEN_PICKER_TABS\.includes\(t\.key\)\)/.test(grid) &&
      /HIDDEN_PICKER_TABS\.includes\(defaultTab\) \? "general" : defaultTab/.test(grid)],
  ["a hidden tab really has nothing left to show (only identity columns + price)",
    reg.HIDDEN_PICKER_TABS.every((t) => {
      const m = grid.match(new RegExp(`${t}: \\[([^\\]]+)\\]`));
      const left = (m?.[1] ?? "").split(",").map((x) => x.trim()).filter((x) => !["symbol", "name", "marketCap", "price"].includes(x));
      const byVar = { rating: "rating", analysts: "analysts", ptgt: "ptgt", ptups: "ptups" };
      return m && left.every((v) => reg.HIDDEN_COLUMN_KEYS.has(byVar[v] ?? v));
    })],
  ["the filter search is not offered hidden fields", /\]\.filter\(offered\);/.test(fields) && /!HIDDEN_FIELD_KEYS\.has\(f\.key\)/.test(fields)],
  ["the page does not ship hidden fields", /for \(const field of HIDDEN_FIELD_KEYS\) delete rec\[field\];/.test(entryType)],
];

// ─────────────────────────────────────────────── 3. presets never read a hidden field
const presetFiles = fs.readdirSync(path.join(ROOT, "app"))
  .map((d) => `app/${d}/page.tsx`)
  .filter((p) => fs.existsSync(path.join(ROOT, p)) && /presetPredicates:/.test(read(p)));
const presetFields = new Map();
for (const p of presetFiles) {
  for (const m of readCodeOnly(p).matchAll(/field: "([a-zA-Z]+)"/g)) presetFields.set(`${p}:${m[1]}`, m[1]);
}
checks.push(
  ["the six predicate presets were found", presetFiles.length === 6, presetFiles.join(" ")],
  ["NO preset filters on a hidden field (it would be empty on every row: 0 rows)",
    [...presetFields.values()].every((f) => !reg.HIDDEN_FIELD_KEYS.has(f)),
    [...presetFields].filter(([, f]) => reg.HIDDEN_FIELD_KEYS.has(f)).map(([k]) => k).join(" ")],
);
// The mutant for that rule: a preset on a hidden field must be caught.
const mutantPreset = [...presetFields.values(), "priceTarget"];
checks.push(["mutant caught: a preset on a hidden field (priceTarget)", !mutantPreset.every((f) => !reg.HIDDEN_FIELD_KEYS.has(f))]);

// ─────────────────────────────────────────────── 4. wiring
const page = entryType;
const job = readCodeOnly("app/api/jobs/warm-pickers-sec/route.ts");
const vercel = JSON.parse(read("vercel.json"));
checks.push(
  ["the page layers the filings LAST, after the stored FMP values",
    page.indexOf("await readSecPickerRows(") > page.indexOf("await readCachedStockDataBulk(") &&
      page.indexOf("await readSecPickerRows(") > page.indexOf("await readPricePoolBulk(") &&
      page.indexOf("await readCachedStockDataBulk(") > 0],
  ["a refusal CLEARS the field instead of leaving FMP's figure", /if \(v === null\) delete rec\[field\];\s*else rec\[field\] = v;/.test(page)],
  ["the division uses the price the row shows", /const shown = valueForPredicateField\(entry, "price"\);/.test(page)],
  ["Payout Ratio stays on its stored figure on a filings row", /if \(e\.fundamentalsFrom === "sec"\) return num\(e\.payoutRatio\);/.test(grid)],
  ["the job is scheduled daily and needs no FMP key",
    vercel.crons.some((c) => c.path === "/api/jobs/warm-pickers-sec" && c.schedule === "35 5 * * *") && !/FMP_API_KEY/.test(job)],
  ["the job reads the shared revenue guard through multipleInputs (imported, not copied)",
    !/revenueLineIncomplete/.test(readCodeOnly(MODULE)) && /multipleInputs\(set\)/.test(readCodeOnly(MODULE))],
);

for (const [label, pass, detail] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
