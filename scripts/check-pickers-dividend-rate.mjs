// A PER-QUARTER-RATE FILER'S DIVIDEND ON PICKERS (#553 COWORK #210).
//
// A's #848 withholds a rate filer's differenced quarters and its "year" (one
// quarter's rate) and stamps the set `dvr.rate`. Pickers then shows, by
// Cowork's ruling:
//   Div ($)  the latest rate the filer filed itself (newest four quarters) x 4,
//            marked as an estimate (A's "≈", the owner's DIVIDEND_RATE_YEAR_NOTE);
//   Yield    that over the price, marked the same;
//   Growth   that rate against the same quarter's filed rate a year before;
//   Payout   rate x 4 over the row's twelve months of EPS, marked, never
//            "periods differ".
// A filer that is not a rate filer (WMT: the whole year declared in Q1) keeps
// the four-quarter path and no mark. Fixtures follow check-dividend-basis's.
// Every assertion runs again on mutants; each must be caught.
//
//   node scripts/check-pickers-dividend-rate.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MODULE = "lib/server/pickersSecFundamentals.ts";
const PAGE = "app/components/PickerResultPage.tsx";
const GRID = "app/components/PickerResultsGrid.tsx";
const TODAY = "2026-05-15";
const NOW = Date.parse(TODAY);
const PRICE = 100;
const viaRedis = (row) => JSON.parse(JSON.stringify(row));

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-pdrate-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}
const { SEC_FIELD_KEYS } = await import(pathToFileURL(path.join(ROOT, "lib/server/secFields.ts")).href);
const { DIVIDEND_RATE_YEAR_NOTE } = await import(pathToFileURL(path.join(ROOT, "lib/server/secEarningsView.ts")).href);

const DPS = "dividendsDeclaredPerShare";
const per = (e, fp, fy, o) => {
  const pairs = SEC_FIELD_KEYS.map((k) => (Array.isArray(o[k]) ? o[k] : o[k] == null ? [null, "-"] : [o[k], "F"]));
  return { e, s: null, fp, fy, a: null, f: null, v: pairs.map((x) => x[0]), d: pairs.map((x) => x[1]).join("") };
};
const set = (quarters, years) => ({ tx: ["us-gaap"], asr: [], instants: [], quarters: [...quarters].reverse(), years: [...years].reverse() });
const eps = (v) => ({ epsDiluted: v });

// BKNG: Q1 filed at the rate each year, Q2–Q4 differenced to $0 (withheld by A).
const BKNG = set([
  per("2025-03-31", "Q1", 2025, { [DPS]: 0.384, ...eps(0.4) }),
  per("2025-06-30", "Q2", 2025, { [DPS]: [0, "D"], ...eps(1.1) }),
  per("2025-09-30", "Q3", 2025, { [DPS]: [0, "D"], ...eps(3.38) }),
  per("2025-12-31", "Q4", 2025, { [DPS]: [0, "D"], ...eps(1.74) }),
  per("2026-03-31", "Q1", 2026, { [DPS]: 0.42, ...eps(1.36) }),
], [per("2025-12-31", "FY", 2025, { [DPS]: 0.384, ...eps(6.62) })]);
// V: Q1–Q3 filed at the rate, Q4 differenced to $0; no year-earlier quarter on file.
const V = set([
  per("2024-12-31", "Q1", 2025, { [DPS]: 0.59, ...eps(2.58) }),
  per("2025-03-31", "Q2", 2025, { [DPS]: 0.59, ...eps(2.32) }),
  per("2025-06-30", "Q3", 2025, { [DPS]: 0.59, ...eps(2.69) }),
  per("2025-09-30", "Q4", 2025, { [DPS]: [0, "D"], ...eps(2.61) }),
], [per("2025-09-30", "FY", 2025, { [DPS]: 0.59, ...eps(10.2) })]);
// WMT: the whole year declared in Q1, $0 after: NOT a rate filer.
const WMT = set([
  per("2025-04-30", "Q1", 2026, { [DPS]: 0.94, ...eps(0.61) }),
  per("2025-07-31", "Q2", 2026, { [DPS]: 0, ...eps(0.88) }),
  per("2025-10-31", "Q3", 2026, { [DPS]: [0, "D"], ...eps(0.77) }),
  per("2026-01-31", "Q4", 2026, { [DPS]: [0, "D"], ...eps(0.47) }),
], [per("2026-01-31", "FY", 2026, { [DPS]: 0.94, ...eps(2.73) })]);
// STALE: a rate filer whose only filed rate is five quarters back.
const STALE = set([
  per("2025-03-31", "Q1", 2025, { [DPS]: 0.3, ...eps(1) }),
  per("2025-06-30", "Q2", 2025, { [DPS]: [0, "D"], ...eps(1) }),
  per("2025-09-30", "Q3", 2025, { [DPS]: [0, "D"], ...eps(1) }),
  per("2025-12-31", "Q4", 2025, { [DPS]: [0, "D"], ...eps(1) }),
  per("2026-03-31", "Q1", 2026, { [DPS]: [0, "D"], ...eps(1) }),
], [per("2025-12-31", "FY", 2025, { [DPS]: 0.3, ...eps(4) })]);

function suite(mod, page, grid) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const close = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const build = (s) => viaRedis(mod.buildSecPickerRow(s, TODAY, {}, NOW));

  // 1. BKNG: the latest filed rate x 4, its growth, its payout, all marked.
  const b = build(BKNG);
  ok("BKNG Div ($) is the latest filed rate x 4 ($0.42 x 4)", close(b.divPerShare, 1.68), String(b.divPerShare));
  ok("BKNG's row records the rate it used", b.div?.rate?.q === 0.42 && b.div?.rate?.end === "2026-03-31", JSON.stringify(b.div));
  ok("BKNG growth is $0.42 against Q1 a year before ($0.384)", close(b.divGrowth, (0.42 / 0.384 - 1) * 100), String(b.divGrowth));
  const bf = mod.applySecPickerRow(b, PRICE);
  ok("BKNG yield is the estimate over the price", close(bf.divYield, 1.68), String(bf.divYield));
  const mark = bf.marks?.dps;
  ok("Div ($) carries A's estimate mark", mark?.kind === "estimate", JSON.stringify(bf.marks));
  ok("...whose note is the owner's DIVIDEND_RATE_YEAR_NOTE, then the method", typeof mark?.note === "string" && mark.note.startsWith(DIVIDEND_RATE_YEAR_NOTE) && /× 4/.test(mark.note), String(mark?.note));
  ok("the yield is marked the same", bf.marks?.dyield === mark || JSON.stringify(bf.marks?.dyield) === JSON.stringify(mark));
  ok("BKNG payout = rate x 4 over the row's EPS, on that EPS's period", b.eps && b.payout && close(b.payout.val, (1.68 / b.eps.val) * 100) && b.payout.basis === b.eps.basis && b.payout.periodEnd === b.eps.periodEnd, JSON.stringify({ eps: b.eps, payout: b.payout }));
  const be = mod.applySecEarnings(b, PRICE);
  ok("...so it is shown, not withheld as periods differing", be && be.payoutRatio !== null && be.payoutBasis !== mod.PAYOUT_PERIODS_DIFFER, JSON.stringify(be));
  ok("the payout cell's mark", JSON.stringify(mod.payoutRateMark(b, be)) === JSON.stringify(mark));

  // 2. V: Q4 withheld, so the latest filed rate is Q3's; no year-earlier quarter.
  const v = build(V);
  ok("V Div ($) is Q3's filed $0.59 x 4", close(v.divPerShare, 2.36), String(v.divPerShare));
  ok("V growth is \"–\" with no same quarter a year before", v.divGrowth === null, String(v.divGrowth));

  // 3. Not a rate filer: unchanged, unmarked.
  const w = build(WMT);
  const wf = mod.applySecPickerRow(w, PRICE);
  ok("WMT (the year declared in Q1) is not a rate filer: no rate, no mark", !w.div?.rate && !wf.marks?.dps && !wf.marks?.dyield && mod.payoutRateMark(w, mod.applySecEarnings(w, PRICE)) === null, JSON.stringify({ div: w.div, marks: wf.marks }));
  ok("WMT keeps its four filed quarters ($0.94)", close(w.divPerShare, 0.94), String(w.divPerShare));

  // 4. A rate older than the newest four quarters is not "the latest rate".
  const st = build(STALE);
  ok("a rate filed five quarters back gives no Div ($)", st.divPerShare === null && !st.div?.rate, JSON.stringify({ d: st.divPerShare, div: st.div }));

  // 5. The wiring: the page puts the payout mark on the cell; the grid renders all three marked.
  ok("the page merges payoutRateMark into the cell marks", /const payoutMark = payoutRateMark\(row, earnings\);/.test(page) && /\{ \.\.\.figures\.marks, payout: payoutMark \}/.test(page) && /if \(marks\) entry\.cellEst = marks;/.test(page));
  ok("the grid renders a marked Div ($) through EstimateCell", /if \(e\.cellEst\?\.dps\) \{[\s\S]{0,200}<EstimateCell [^>]*est=\{e\.cellEst\.dps\}/.test(grid));
  ok("the grid renders a marked yield through EstimateCell", /e\.cellEst\?\.dyield \? <EstimateCell [^>]*est=\{e\.cellEst\.dyield\}/.test(grid));
  ok("the grid renders a marked payout through EstimateCell", /e\.cellEst\?\.payout \? <EstimateCell [^>]*est=\{e\.cellEst\.payout\}/.test(grid));
  return fails;
}

const src = read(MODULE), page = read(PAGE), grid = read(GRID);
const real = suite(await import(pathToFileURL(path.join(ROOT, MODULE)).href), page, grid);
console.log("1. the rules hold on the real module");
for (const f of real) console.log(`  FAIL  ${f}`);
if (!real.length) console.log("  PASS  all assertions");

const MUTANTS = [
  ["Div ($) is the rate, not x 4", MODULE, "Math.round(rate.rate * 4 * 1e6) / 1e6", "rate.rate"],
  ["the rate pass ignores A's stamp", MODULE, "if (!set.dvr?.rate) return null;", "if (set.dvr?.rate || !set.dvr?.rate) return null;"],
  ["any age of rate counts", MODULE, "set.quarters.slice(0, 4).find(", "set.quarters.find("],
  ["growth falls back to the four-quarter path", MODULE, "divGrowth: rate ? (rate.prior ? ((rate.rate - rate.prior) / rate.prior) * 100 : null) : dividendGrowth(set),", "divGrowth: dividendGrowth(set),"],
  ["Div ($) unmarked", MODULE, "    marks.dps = DIVIDEND_RATE_MARK;\n", ""],
  ["the yield unmarked", MODULE, "    if (divYield !== null) marks.dyield = DIVIDEND_RATE_MARK;\n", ""],
  ["payout keeps the fiscal-year fallback", MODULE, "      : samePeriodPayout(set, eps),", "      : samePeriodPayout(set, eps),\n    ...(rate ? { payout: samePeriodPayout(set, eps) } : {}),"],
  ["the note drops the owner's wording", MODULE, "  `${DIVIDEND_RATE_YEAR_NOTE} Estimate:", "  `Estimate:"],
  ["the page drops the payout mark", PAGE, "{ ...figures.marks, payout: payoutMark }", "figures.marks"],
  ["the grid shows Div ($) unmarked", GRID, "if (e.cellEst?.dps) {", "if (false) {"],
];
console.log("\n2. mutants");
let failures = real.length;
for (const [label, file, from, to] of MUTANTS) {
  const base = file === MODULE ? src : file === PAGE ? page : grid;
  if (!base.includes(from)) { console.log(`  FAIL  mutant "${label}": its anchor is gone`); failures++; continue; }
  const mutated = base.replace(from, to);
  const mod = file === MODULE ? await loadSibling(MODULE, mutated) : await import(pathToFileURL(path.join(ROOT, MODULE)).href);
  const caught = suite(mod, file === PAGE ? mutated : page, file === GRID ? mutated : grid);
  console.log(`  ${caught.length ? "PASS" : "FAIL"}  mutant "${label}" ${caught.length ? `is caught — ${caught[0]}` : "is NOT caught"}`);
  if (!caught.length) failures++;
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
