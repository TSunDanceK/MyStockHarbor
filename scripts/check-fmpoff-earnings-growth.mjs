// FMP-off: Strong Earnings Growth membership from SEC filings (#553 CODE-B #94 B5, 2026-10-03).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE LIST STILL READS FMP. Under PICKERS_FUNDAMENTALS's SEC default the
//      membership must come from the picker SEC rows, never from the FMP
//      /stable/earnings rows that stop being written once the key goes.
//   2. A REFUSAL PASSES. An ADS filer whose EPS unit is unclear, a set not in
//      dollars, an incomplete revenue line, a missing year-ago period, a
//      one-off non-operating gain: each must leave the symbol OUT, not in.
//   3. THE THRESHOLD DRIFTS FROM THE WORDS. The page says "at least N%"; the
//      rule must let exactly N% in and N% less a hair out.
//   4. A ROW WRITTEN BEFORE THE FIELD EXISTED falls back to something.
//
// Section 1 runs the real module on the committed SEC fact-set fixtures
// (data/sec/factset-fixture-*.json, SEC data, public domain) and again on
// mutated copies: each mutant must be caught. Section 2 checks the builder and
// the page are wired to it, with text mutants.
//
//   node scripts/check-fmpoff-earnings-growth.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MODULE = "lib/server/pickersSecEarningsGrowth.ts";
const TODAY = "2026-10-03";
const NOW = Date.parse(TODAY);
const fixture = (s) => JSON.parse(read(`data/sec/factset-fixture-${s}.json`));
const clone = (x) => JSON.parse(JSON.stringify(x));

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-b5-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const V = await imp("lib/server/secValuation.ts");
const C = await imp("lib/server/secFactCodec.ts");
const F = await imp("lib/server/secFields.ts");
const P = await imp("lib/server/pickersSecFundamentals.ts");

const setVal = (p, key, val) => { p.v[F.SEC_FIELD_INDEX[key]] = val; };
const q = (set, fp, fy) => set.quarters.find((x) => x.fp === fp && x.fy === fy);

// ─────────────────────────────────────────────── 1. the rule, on fixtures
async function suite(mod) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  // 1e-5: the rule rounds a growth percentage to six decimals before testing it.
  const close = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
  const refusalsOf = (set, filer = {}) => V.valuationInputs(set, TODAY, filer).refusals;
  const facts = (set, filer = {}) => mod.secGrowthFacts(set, TODAY, filer, refusalsOf(set, filer));
  // Through JSON, as Redis stores the row.
  const member = (set, filer = {}) => {
    const row = clone({ unit: { reporting: (set.cur ?? "USD").toUpperCase(), converted: Boolean(set.cur && set.cur !== "USD" && set.fx) }, inputs: { refusals: refusalsOf(set, filer) }, growth: facts(set, filer) });
    return mod.secStrongEarningsGrowth(row, row.unit.reporting === "USD" || row.unit.converted);
  };

  // ── fixtures: who is in and why
  const aapl = fixture("AAPL");
  const a = member(aapl);
  const aq = aapl.quarters[0], ap = q(aapl, "Q3", 2025);
  const epsPct = ((C.valueOf(aq, "epsDiluted") - C.valueOf(ap, "epsDiluted")) / C.valueOf(ap, "epsDiluted")) * 100;
  const revPct = ((C.valueOf(aq, "revenue") - C.valueOf(ap, "revenue")) / C.valueOf(ap, "revenue")) * 100;
  ok("AAPL is a member: Q3 FY2026 vs Q3 FY2025 from the filed quarters", a !== null && close(a.epsGrowthPct, epsPct) && close(a.revenueGrowthPct, revPct),
    JSON.stringify(a));
  ok("the note names both periods and the source", a !== null && a.note.includes("Q3 FY2026 vs Q3 FY2025") && a.note.includes("SEC filings"));
  ok("the release date is the latest period's filing date", a !== null && a.releaseDate === aq.f);
  ok("GEV is a member (EPS +33%, revenue +22%)", member(fixture("GEV")) !== null);
  const kgc = member(fixture("KGC"));
  ok("KGC (no quarters on file) is compared fiscal year vs fiscal year", kgc !== null && kgc.note.includes("FY2025 vs FY2024"), JSON.stringify(kgc));
  ok("TSLA is out: EPS down year over year", member(fixture("TSLA")) === null);
  ok("KTOS is out: EPS of two cents is below PE_MIN_EPS on both sides", member(fixture("KTOS")) === null);
  ok("NBIS / AXTI are out: a turn from a loss is not a growth rate", member(fixture("NBIS")) === null && member(fixture("AXTI")) === null);
  ok("loss-makers are out (AUR, AVAV, BYND, SPCX, WKHS)", ["AUR", "AVAV", "BYND", "SPCX", "WKHS"].every((s) => member(fixture(s)) === null));

  // ── refusals exclude
  const f20 = { annualForm: "20-F" };
  const adsNoRatio = facts(aapl, f20);
  ok("ADS: a 20-F filer with no cited ratio is refused (A's EPS-unit refusal), not passed",
    adsNoRatio.ok === false && adsNoRatio.why === "ads-eps-unit" && member(aapl, f20) === null, JSON.stringify(adsNoRatio));
  const mixed = clone(aapl);
  // Latest EPS per ADS (x5), the year-ago per ordinary share: units differ.
  setVal(mixed.quarters[0], "epsDiluted", C.valueOf(aq, "epsDiluted") * 5);
  const cite = { ads: { ordinaryPerAds: 5, source: "fixture", kind: "ads" } };
  const mixedFacts = facts(mixed, cite);
  ok("ADS: a cited ratio with the two periods' EPS in different units is refused",
    mixedFacts.ok === false && mixedFacts.why === "ads-eps-unit" && member(mixed, cite) === null, JSON.stringify(mixedFacts));
  const cop = clone(aapl); cop.cur = "COP"; delete cop.fx;
  ok("CURRENCY: a set not in dollars and not convertible is refused", facts(cop).ok === false && facts(cop).why === "not-in-dollars" && member(cop) === null);
  const inc = clone(aapl);
  setVal(inc.quarters[0], "revenue", C.valueOf(aq, "operatingIncome") / 2);
  ok("REVENUE: an incomplete revenue line (operating income above revenue) is refused",
    facts(inc).ok === false && facts(inc).why === "revenue-line-incomplete" && member(inc) === null, JSON.stringify(facts(inc)));
  const incPrior = clone(aapl);
  setVal(q(incPrior, "Q3", 2025), "revenue", C.valueOf(ap, "operatingIncome") / 2);
  ok("REVENUE: ...on the year-ago period too", facts(incPrior).ok === false && member(incPrior) === null);
  const noPrior = clone(aapl);
  noPrior.quarters = noPrior.quarters.filter((x) => !(x.fp === "Q3" && x.fy === 2025));
  ok("YEAR-AGO: no year-ago quarter on file is refused, never a nearest-row fallback",
    facts(noPrior).ok === false && facts(noPrior).why === "no-year-ago-period" && member(noPrior) === null, JSON.stringify(facts(noPrior)));
  const oneOff = clone(aapl);
  const opi = C.valueOf(aq, "operatingIncome");
  setVal(oneOff.quarters[0], "nonOperatingIncomeExpense", opi * 2);
  setVal(oneOff.quarters[0], "preTaxIncome", opi * 3);
  ok("ONE-OFF: a large non-operating item in the latest period is refused (A's largeNonOperating)",
    facts(oneOff).ok === false && facts(oneOff).why === "large-non-operating-item" && member(oneOff) === null);
  const stale = clone(aapl);
  ok("STALE: a latest period older than A's EPS age limit is refused",
    mod.secGrowthFacts(stale, "2028-01-01", {}, []).ok === false && mod.secGrowthFacts(stale, "2028-01-01", {}, []).why === "period-is-stale");

  // ── currency: growth in the REPORTING currency
  const eu = clone(aapl); eu.cur = "EUR";
  const ends = [...eu.quarters, ...eu.years, ...(eu.instants ?? [])].map((p) => p.e);
  eu.fx = { from: "EUR", source: "fixture", applied: ends.map((e, i) => ({ end: e, usdPerUnit: 1 + (i % 7) / 20, basis: "average" })), refused: [] };
  const rate = (e) => eu.fx.applied.find((x) => x.end === e).usdPerUnit;
  const euFacts = facts(eu);
  ok("CURRENCY: a converted set's revenue growth is taken in the reporting currency (an FX move is not growth)",
    euFacts.ok && close(euFacts.revenue, C.valueOf(aq, "revenue") / rate(aq.e)) && close(euFacts.revenuePrior, C.valueOf(ap, "revenue") / rate(ap.e)) &&
      rate(aq.e) !== rate(ap.e), JSON.stringify(euFacts));
  const euNoRate = clone(eu);
  euNoRate.fx.applied = euNoRate.fx.applied.filter((x) => x.end !== ap.e);
  ok("CURRENCY: no recorded rate for the year-ago period is refused", facts(euNoRate).ok === false && facts(euNoRate).why === "no-fx-rate");

  // ── read side
  const good = { ok: true, basis: "quarter", label: "Q2 FY2026", priorLabel: "Q2 FY2025", periodEnd: "2026-06-30", filed: "2026-07-30", eps: 1.15, epsPrior: 1, revenue: 101, revenuePrior: 100 };
  const row = (g, refusals = []) => ({ inputs: { refusals }, growth: g });
  const N = mod.SEC_GROWTH_MIN_EPS_YOY;
  ok("BOUNDARY: EPS up exactly the minimum is IN", mod.secStrongEarningsGrowth(row({ ...good, eps: 1 + N / 100 }), true) !== null);
  ok("BOUNDARY: EPS up a hair less is OUT", mod.secStrongEarningsGrowth(row({ ...good, eps: 1 + N / 100 - 1e-6 }), true) === null);
  ok("BOUNDARY: revenue flat is OUT; revenue up a hair is IN",
    mod.secStrongEarningsGrowth(row({ ...good, eps: 2, revenue: 100 }), true) === null &&
      mod.secStrongEarningsGrowth(row({ ...good, eps: 2, revenue: 100.01 }), true) !== null);
  ok("a cent-level base is not growth (0.01 -> 0.04 is not +300%)", mod.secStrongEarningsGrowth(row({ ...good, eps: 0.04, epsPrior: 0.01 }), true) === null);
  ok("a row written before the field existed is NOT a member (no fallback)", mod.secStrongEarningsGrowth({ inputs: { refusals: [] } }, true) === null);
  ok("a stored refusal is not a member", mod.secStrongEarningsGrowth(row({ ok: false, why: "ads-eps-unit" }), true) === null);
  ok("read side: A's ADS refusal on the row excludes even ok facts",
    mod.secStrongEarningsGrowth(row({ ...good, eps: 2 }, ["ads-ratio-makes-eps-incomparable"]), true) === null);
  ok("read side: a row whose money is not USD is not a member", mod.secStrongEarningsGrowth(row({ ...good, eps: 2 }), false) === null);

  // ── copy matches the rule
  const copy = Object.values(mod.SEC_GROWTH_COPY).join(" ");
  ok("COPY: every SEC description states the EPS minimum the rule applies",
    [mod.SEC_GROWTH_COPY.description, mod.SEC_GROWTH_COPY.explainerBody, mod.SEC_GROWTH_COPY.metaDescription, mod.SEC_GROWTH_COPY.sectionDescription]
      .every((t) => t.includes(`${N}%`)) && !/\d+%/.test(copy.replaceAll(`${N}%`, "")),
    `minimum ${N}%`);
  ok("COPY: says revenue must be up and the source is filings, and promises no beats or consistency",
    /revenue (up|is also higher)/.test(copy) && /filed|SEC/.test(copy) && !/beat history|consistency|beating expectations/i.test(copy));
  return fails;
}

let failures = 0;
const src = read(MODULE);
const real = await suite(await loadSibling(MODULE, src));
console.log("\n=== 1. the SEC rule, on the committed fact-set fixtures ===");
if (!real.length) console.log("  PASS  every assertion");
for (const f of real) console.log(`  FAIL  ${f}`);
failures += real.length;

console.log("\n=== mutants (each must be caught) ===");
const MUTANTS = [
  ["incomplete-revenue refusal dropped", "  if (revenueLineIncomplete(now) || revenueLineIncomplete(then)) return refuse(\"revenue-line-incomplete\");\n", ""],
  ["A's ADS EPS refusal ignored (build side)", "  if (refusals.includes(\"ads-ratio-makes-eps-incomparable\")) return refuse(\"ads-eps-unit\");\n", ""],
  ["cited-ADS unit comparison dropped", "    if (a === null || a !== b) return refuse(\"ads-eps-unit\");", "    void a; void b;"],
  ["currency gate removed", "  if (reporting !== \"USD\" && !set.fx) return refuse(\"not-in-dollars\");", "  void reporting;"],
  ["growth taken on converted (USD) values", "  const home = (x: StoredPeriod) => (set.fx ? storedInReportingCurrency(x, set.fx) : x);", "  const home = (x: StoredPeriod): StoredPeriod | null => x;"],
  ["nearest-row fallback for the year-ago period", "  const prior = priorYearOf(list, p);", "  const prior = priorYearOf(list, p) ?? list[1] ?? null;"],
  ["large non-operating item allowed", "  if (largeNonOperating(rows)) return refuse(\"large-non-operating-item\");", "  void rows;"],
  ["threshold made strict", "  if (!(epsGrowthPct >= SEC_GROWTH_MIN_EPS_YOY)) return null;", "  if (!(epsGrowthPct > SEC_GROWTH_MIN_EPS_YOY)) return null;"],
  ["revenue condition dropped", "  if (!(revenueGrowthPct > SEC_GROWTH_MIN_REVENUE_YOY)) return null;", ""],
  ["profit on both sides not required", "  if (!(g.epsPrior >= PE_MIN_EPS) || !(g.eps >= PE_MIN_EPS)) return null;", "  if (!(g.epsPrior > 0)) return null;"],
  ["read-side refusal belt removed", "  if (r.includes(\"ads-ratio-makes-eps-incomparable\") || r.includes(\"ticker-is-a-debt-security\") || r.includes(\"share-basis-changed\")) {", "  if (false) {"],
  ["read-side currency gate removed", "  if (!row || !g || !g.ok || !usd) return null;", "  if (!row || !g || !g.ok) return null;"],
  ["copy states a different minimum", "`Stocks whose latest filed quarter shows diluted EPS up at least ${SEC_GROWTH_MIN_EPS_YOY}%", "`Stocks whose latest filed quarter shows diluted EPS up at least 20%"],
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

// ─────────────────────────────────────────────── 2. wiring
// The row: the daily job writes `growth` through buildSecPickerRow, so it
// survives JSON and the read side finds it (AAPL in, TSLA out), on the SHIPPED
// pickersSecFundamentals.
const viaRow = (s, filer = {}) => {
  const r = clone(P.buildSecPickerRow(fixture(s), TODAY, filer, NOW));
  return r;
};
const shipped = await imp(MODULE);
const wiring = (builder, page, fundamentals) => {
  const out = [];
  const ok = (label, cond) => { if (!cond) out.push(label); };
  const aaplRow = viaRow("AAPL");
  ok("the daily row carries the growth facts (AAPL in, TSLA out, through JSON)",
    aaplRow.growth?.ok === true && shipped.secStrongEarningsGrowth(aaplRow, P.moneyIsUsd(aaplRow.unit)) !== null &&
      shipped.secStrongEarningsGrowth(viaRow("TSLA"), true) === null);
  ok("an unconverted non-USD row carries a refusal, not figures",
    (() => { const s = fixture("AAPL"); s.cur = "COP"; delete s.fx; const r = clone(P.buildSecPickerRow(s, TODAY, {}, NOW)); return r.growth?.ok === false; })());
  ok("buildSecPickerRow writes growth on BOTH branches (dollar and non-dollar)",
    (fundamentals.match(/growth: secGrowthFacts\(set, today, filer, inputs\.refusals\),/g) ?? []).length === 2);
  ok("the builder takes the SEC rule on PICKERS_FUNDAMENTALS's SEC default",
    /const earningsGrowthFromSec = pickersFundamentalsSource\(\) === "sec";/.test(builder));
  ok("on that setting, membership is secStrongEarningsGrowth over the SEC row; the FMP rule only otherwise",
    /const strongEarningsGrowthCandidate = earningsGrowthFromSec\s*\?\s*secStrongEarningsGrowth\(secRow, secRow \? moneyIsUsd\(secRow\.unit\) : false\)\s*:\s*computeStrongEarningsGrowthCandidate\(earningsRows\);/.test(builder));
  ok("the SEC rows are one build-time read of the picker SEC hash",
    /const secRowsBySymbol: Map<string, SecPickerRow> = earningsGrowthFromSec\s*\?\s*await readSecPickerRows\(universe\)\s*:\s*new Map\(\);/.test(builder));
  ok("the FMP earnings rows are read and queued only when something still needs them",
    /const needFmpEarnings = !earningsGrowthFromSec \|\| POSITIVE_LAST_EARNINGS_ENABLED;/.test(builder) &&
      /= needFmpEarnings\s*\?\s*await readCachedFmpEarningsBulk\(universe\)\s*:\s*new Map\(\);/.test(builder) &&
      /if \(needFmpEarnings\) \{\s*if \(!dryRun\) await queueEarningsWarmupSymbols\(universe, earningsBySymbol\);\s*\}/.test(builder) &&
      (builder.match(/await readCachedFmpEarningsBulk\(/g) ?? []).length === 1);
  ok("the section description follows the rule in force",
    /description: earningsGrowthFromSec\s*\?\s*SEC_GROWTH_COPY\.sectionDescription/.test(builder));
  ok("the page's description, explainer, empty text and meta follow the rule in force",
    /const SEC = pickersFundamentalsSource\(\) === "sec";/.test(page) &&
      [/\n  description: SEC\s*\?\s*SEC_GROWTH_COPY\.description\n/, /explainerTitle: SEC \? SEC_GROWTH_COPY\.explainerTitle :/,
        /explainerBody: SEC\s*\?\s*SEC_GROWTH_COPY\.explainerBody/, /emptyText: SEC\s*\?\s*SEC_GROWTH_COPY\.emptyText/,
        /\n  description: SEC\s*\?\s*SEC_GROWTH_COPY\.metaDescription\n/].every((re) => re.test(page)));
  ok("the page no longer points at the FMP Fetch Earnings button on the SEC setting",
    /emptyText: SEC\s*\?\s*SEC_GROWTH_COPY\.emptyText/.test(page));
  return out;
};
const B = "lib/server/pickersBuilder.ts";
const PG = "app/stocks-with-strong-earnings-growth/page.tsx";
const FM = "lib/server/pickersSecFundamentals.ts";
const builderSrc = readCodeOnly(B), pageSrc = readCodeOnly(PG), fundSrc = readCodeOnly(FM);
console.log("\n=== 2. wiring (builder, page, daily row) ===");
const w = wiring(builderSrc, pageSrc, fundSrc);
if (!w.length) console.log("  PASS  every assertion");
for (const f of w) console.log(`  FAIL  ${f}`);
failures += w.length;

const TEXT_MUTANTS = [
  ["builder reads the FMP rule on the SEC setting", "builder",
    "? secStrongEarningsGrowth(secRow, secRow ? moneyIsUsd(secRow.unit) : false)\n            : computeStrongEarningsGrowthCandidate(earningsRows);",
    "? computeStrongEarningsGrowthCandidate(earningsRows)\n            : secStrongEarningsGrowth(secRow, secRow ? moneyIsUsd(secRow.unit) : false);"],
  ["FMP earnings read unconditionally", "builder", "= needFmpEarnings\n    ? await readCachedFmpEarningsBulk(universe)\n    : new Map();", "= await readCachedFmpEarningsBulk(universe);"],
  ["FMP earnings still queued on the SEC setting", "builder", "  if (needFmpEarnings) {\n    if (!dryRun) await queueEarningsWarmupSymbols(", "  if (true) {\n    if (!dryRun) await queueEarningsWarmupSymbols("],
  ["page keeps the FMP copy", "page", "  description: SEC\n    ? SEC_GROWTH_COPY.description", "  description: false\n    ? SEC_GROWTH_COPY.description"],
  ["growth not written on the dollar branch", "fund", "    payout: samePeriodPayout(set, inputs.eps),\n    growth: secGrowthFacts(set, today, filer, inputs.refusals),", "    payout: samePeriodPayout(set, inputs.eps),"],
];
for (const [label, which, from, to] of TEXT_MUTANTS) {
  const srcs = { builder: builderSrc, page: pageSrc, fund: fundSrc };
  if (!srcs[which].includes(from)) {
    console.log(`  FAIL  mutant "${label}" no longer matches the source — update this check`);
    failures++;
    continue;
  }
  srcs[which] = srcs[which].replace(from, to);
  const caught = wiring(srcs.builder, srcs.page, srcs.fund).length > 0;
  console.log(`  ${caught ? "PASS" : "FAIL"}  mutant caught: ${label}${caught ? "" : " — NOTHING FAILED"}`);
  if (!caught) failures++;
}

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
