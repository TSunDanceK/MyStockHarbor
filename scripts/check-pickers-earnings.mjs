// Pickers P/E, EPS and Payout Ratio from the filings (Relay B, #553 COWORK #21).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. P/E DRIFTS FROM THE STOCK PAGE. It must be secValuation.peRatio over
//      valuationInputs (A's post-#577 TTM EPS), not a second implementation.
//   2. PAYOUT MIXES TWO YEARS. The census found 70 of 260 payers whose EPS is
//      TTM to June and whose dividends are only filed for the fiscal year to
//      December; DPS ÷ EPS across them is a ratio of nothing. Only a same-period
//      pair, TTM with TTM or FY with the same FY, else "–".
//   3. THE BASIS GOES UNSAID. A fiscal-year EPS shown under a bare column reads
//      as trailing; each cell must name its period and FY rows be marked.
//   4. ADS NAMES LEAK: an EPS per ordinary share beside a price per ADS.
//   5. A ROW FROM BEFORE THE MOVE CLEARS THE STORED P/E (it has no `eps` key;
//      it must leave the page's values alone, not refuse them).
//   6. THE WIRING: the page stops clearing refused figures, the grid recomputes
//      payout from Div ($) ÷ EPS on a filings row, or the tooltip is dropped.
//
// Runs the real module on the committed SEC fact-set fixtures, then every
// assertion again on mutants; each must be caught.
//
//   node scripts/check-pickers-earnings.mjs
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
const viaRedis = (row) => JSON.parse(JSON.stringify(row));

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-pearn-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}
const V = await import(pathToFileURL(path.join(ROOT, "lib/server/secValuation.ts")).href);
const { valueOf } = await import(pathToFileURL(path.join(ROOT, "lib/server/secFactCodec.ts")).href);
const { SEC_FIELDS } = await import(pathToFileURL(path.join(ROOT, "lib/server/secFields.ts")).href);
const idx = (k) => SEC_FIELDS.findIndex((f) => f.key === k);

async function suite(mod, code) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const close = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const earn = (set, filer = {}) => mod.applySecEarnings(viaRedis(mod.buildSecPickerRow(set, TODAY, filer, NOW)), PRICE);

  // 1. P/E and EPS are A's, through Redis's JSON round trip.
  const aapl = fixture("AAPL");
  const inputs = V.valuationInputs(aapl, TODAY, {});
  const a = earn(aapl);
  ok("P/E is secValuation.peRatio over valuationInputs", close(a.peRatio, V.peRatio(inputs, PRICE).val), JSON.stringify(a));
  ok("EPS is valuationInputs' twelve months", close(a.epsTtm, inputs.eps.val));
  ok("a four-quarter EPS is labelled TTM with its end date", a.epsBasis === "TTM to 27 Jun 2026", String(a.epsBasis));

  // 2. Payout, same period only.
  const four = aapl.quarters.slice(0, 4);
  const dpsTtm = four.reduce((s, q) => s + valueOf(q, "dividendsDeclaredPerShare"), 0);
  ok("TTM payout = TTM DPS ÷ TTM EPS, labelled TTM", close(a.payoutRatio, (dpsTtm / inputs.eps.val) * 100) && a.payoutBasis === "TTM to 27 Jun 2026", JSON.stringify(a));

  // The census's mixed case: a quarter's DPS not filed (it sits in the 10-K),
  // so TTM DPS does not exist while TTM EPS does. It must fall to the fiscal
  // year's own pair, never divide the FY dividend by the TTM EPS.
  const mixed = JSON.parse(JSON.stringify(aapl));
  mixed.quarters[1].v[idx("dividendsDeclaredPerShare")] = null;
  const y = mixed.years[0];
  const m = earn(mixed);
  const fyPair = (valueOf(y, "dividendsDeclaredPerShare") / valueOf(y, "epsDiluted")) * 100;
  ok("mixed periods: payout is the fiscal year's DPS ÷ THAT year's EPS", close(m.payoutRatio, fyPair), `${m.payoutRatio} vs ${fyPair}`);
  ok("...and says so", m.payoutBasis === `FY${y.fy}`, String(m.payoutBasis));
  ok("...while P/E stays on the TTM EPS", close(m.peRatio, a.peRatio) && m.epsBasis === "TTM to 27 Jun 2026");

  // A loss has no payout, in either period.
  const loss = JSON.parse(JSON.stringify(mixed));
  loss.years[0].v[idx("epsDiluted")] = -1;
  ok("a fiscal-year loss gives no payout ratio", earn(loss).payoutRatio === null);
  const avav = earn(fixture("AVAV"));
  ok("a TTM loss: no P/E, no payout, EPS shown as filed", avav.peRatio === null && avav.payoutRatio === null && avav.epsTtm < 0 && avav.epsBasis?.startsWith("TTM"));
  ok("a non-payer has no payout, not 0% (TSLA)", earn(fixture("TSLA")).payoutRatio === null);

  // 3. The fiscal-year basis is named.
  const kgc = earn(fixture("KGC"));
  ok("an annual-only EPS is labelled with its fiscal year (KGC)", kgc.epsBasis === "FY2025" && kgc.peRatio !== null, JSON.stringify(kgc));
  ok("the label reads as a date", mod.basisLabel({ basis: "four-quarters", periodEnd: "2026-06-30" }) === "TTM to 30 Jun 2026");

  // 4. ADS stays "–".
  const azn = earn(fixture("AZN"), { annualForm: "20-F" });
  ok("an ADS filer: no P/E, no EPS, no payout, no label", azn.peRatio === null && azn.epsTtm === null && azn.payoutRatio === null && azn.epsBasis === null, JSON.stringify(azn));

  // Not in dollars: nothing.
  const cop = JSON.parse(JSON.stringify(aapl));
  cop.cur = "COP";
  delete cop.fx;
  const c = earn(cop);
  ok("an unconverted non-USD set gives no P/E, EPS or payout", c.peRatio === null && c.epsTtm === null && c.payoutRatio === null);

  // 5. A row from before the move.
  const legacy = viaRedis(mod.buildSecPickerRow(aapl, TODAY, {}, NOW));
  delete legacy.eps;
  delete legacy.payout;
  ok("a row written before the move leaves the stored figures (null, not a refusal)", mod.applySecEarnings(legacy, PRICE) === null);

  // 6. Wiring.
  ok("the three are their own field list, apart from the twelve",
    JSON.stringify(mod.SEC_EARNINGS_FIELDS) === JSON.stringify(["peRatio", "epsTtm", "payoutRatio"]) &&
      !mod.SEC_EARNINGS_FIELDS.some((f) => mod.SEC_PICKER_FIELDS.includes(f)));
  ok("the page clears a refused figure rather than leaving FMP's",
    /const earnings = applySecEarnings\(row, [^)]*\);\s*if \(earnings\) \{\s*for \(const field of SEC_EARNINGS_FIELDS\) \{\s*const v = earnings\[field\];\s*if \(v === null\) delete rec\[field\];/.test(code.page));
  ok("the page carries the basis to the grid", /entry\.epsBasis = earnings\.epsBasis/.test(code.page) && /entry\.payoutBasis = earnings\.payoutBasis/.test(code.page));
  ok("the grid takes a filings row's payout as filed", /if \(e\.fundamentalsFrom === "sec"\) return num\(e\.payoutRatio\);/.test(code.grid));
  ok("P/E and EPS cells carry their basis", /basisCell\(numCell\(num\(e\.peRatio\)\), num\(e\.peRatio\), e\.epsBasis\)/.test(code.grid) && /basisCell\(numCell\(num\(e\.epsTtm\)\), num\(e\.epsTtm\), e\.epsBasis\)/.test(code.grid));
  ok("a fiscal-year figure is marked FY", /basis\.startsWith\("FY"\) \? <span className="basisFy">FY<\/span>/.test(code.grid));
  ok("the header explains the column", /title=\{col\.tip\}/.test(code.grid));
  return fails;
}

const src = read(MODULE);
const code = { page: readCodeOnly("app/components/PickerResultPage.tsx"), grid: readCodeOnly("app/components/PickerResultsGrid.tsx") };

const base = await suite(await loadSibling(MODULE, src), code);
if (base.length) {
  console.error("FAIL check-pickers-earnings:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["payout divides FY dividends by TTM EPS", () => [mut("period", src, `if (dps && dps.basis === "four-quarters" && dps.periodEnd === eps.periodEnd) {`, `if (dps) {`), code]],
  ["a fiscal-year loss still gets a payout", () => [mut("loss", src, `if (e === null || e <= 0 || d === null) return null;`, `if (e === null || d === null) return null;`), code]],
  ["ADS EPS shown", () => [mut("ads", src, `const epsTtm = usd && !ads && eps ? eps.val : null;`, `const epsTtm = usd && eps ? eps.val : null;`), code]],
  ["the basis always reads TTM", () => [mut("label", src, "if (b.basis === \"fiscal-year\") return b.fiscalYear ? `FY${b.fiscalYear}` : `FY to ${date}`;", ""), code]],
  ["a legacy row refuses instead of leaving", () => [mut("legacy", src, `if (!("eps" in row)) return null;`, ""), code]],
  ["the page keeps FMP's figure on a refusal", () => [src, { ...code, page: mut("clear", code.page, `const v = earnings[field];\n              if (v === null) delete rec[field];`, `const v = earnings[field];\n              if (v === null) continue;`) }]],
  ["the grid recomputes payout on a filings row", () => [src, { ...code, grid: mut("grid", code.grid, `if (e.fundamentalsFrom === "sec") return num(e.payoutRatio);`, "") }]],
  ["no FY marker", () => [src, { ...code, grid: mut("fy", code.grid, `<span className="basisFy">FY</span>`, `null`) }]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, c] = make();
  const fails = await suite(await loadSibling(MODULE, s), c);
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-pickers-earnings: all assertions pass; ${MUTANTS.length} mutants caught`);
