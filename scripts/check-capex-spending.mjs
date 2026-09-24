// "Who is spending" (Relay C, #563 COWORK #1 D1): the aggregation rules, each
// one a way the sector chart could mislead without anyone noticing:
//   * fiscal years placed in the calendar year holding most of them;
//   * a FIXED cohort per sector (capex in every year), so a bar cannot grow
//     because more companies started reporting;
//   * other-currency filers counted, not silently dropped; unclassified
//     companies counted, not placed;
//   * one row per SEC filer (share classes and listed notes folded);
//   * sector totals only -- no grand total.
//
//   node scripts/check-capex-spending.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CORE = "lib/server/capexSpendingCore.ts";

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "lib", `.check-cxs-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const YEARS = [2021, 2022, 2023, 2024, 2025];
const NOW = Date.parse("2026-09-24T00:00:00Z");
// Calendar-year fiscal years, capex = base * (1 + i/10), revenue = 10x capex.
const cyYears = (base, opts = {}) =>
  YEARS.filter((y) => !(opts.skip ?? []).includes(y)).map((y) => ({
    s: `${y}-01-01`,
    e: `${y}-12-31`,
    capex: base * (1 + (y - 2021) / 10),
    revenue: opts.noRevenue ? null : base * 10,
    rnd: opts.rnd ? base : null,
  }));
const I = (symbol, sector, years, extra = {}) => ({ symbol, cik: extra.cik ?? `000${symbol.length}${symbol.charCodeAt(0)}`, sector, currency: extra.currency ?? null, years });

// A July–June filer: FY ending 2025-06-30 has its midpoint in 2024.
const julJun = YEARS.map((y) => ({ s: `${y}-07-01`, e: `${y + 1}-06-30`, capex: 7, revenue: 70, rnd: null }));

const INPUTS = [
  I("AAA", "Technology", cyYears(100, { rnd: true }), { cik: "0000000001" }),
  I("AAA-B", "Technology", cyYears(100, { rnd: true }), { cik: "1" }), // same filer, another listing
  I("BBB", "Technology", cyYears(10, { noRevenue: true }), { cik: "2" }),
  I("NEWCO", "Technology", cyYears(1000, { skip: [2021, 2022] }), { cik: "3" }), // not in every year
  I("JUL", "Industrials", julJun, { cik: "4" }),
  I("NOSEC", null, cyYears(50), { cik: "5" }),
  I("EURO", "Industrials", [], { cik: "6", currency: "EUR" }),
  // SEC lists CMCSA first; its exchangeable notes CCZ are shorter but second.
  { ...I("CCZ", "Communication Services", cyYears(20), { cik: "7" }), rank: 1 },
  { ...I("CMCSA", "Communication Services", cyYears(20), { cik: "7" }), rank: 0 },
];

async function suite(M) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  ok("a July–June year sits in the calendar year of its midpoint", M.calendarYearOf("2024-07-01", "2025-06-30") === 2024 && M.calendarYearOf("2025-01-27", "2026-01-25") === 2025 && M.calendarYearOf(null, "2025-12-31") === 2025);
  ok("the years are the last five complete ones", M.spendingYears(NOW).join() === YEARS.join());

  const r = M.aggregateSpending(INPUTS, YEARS, NOW);
  const tech = r.sectors.find((s) => s.sector === "Technology");
  const ind = r.sectors.find((s) => s.sector === "Industrials");
  ok("one row per filer: the second listing is folded", r.duplicateListings === 2 && tech?.cohort === 2 && tech.top.filter((t) => t.startsWith("AAA")).length === 1, JSON.stringify(tech));
  ok("the filer's row is the listing SEC names first, not the shortest", r.sectors.find((s) => s.sector === "Communication Services")?.top.join() === "CMCSA");
  ok("the fixed cohort leaves out a company missing years", tech?.capex[0] === 110 && tech?.capex[4] === 140 * 1.1 && !tech.top.includes("NEWCO"), JSON.stringify(tech?.capex));
  ok("a company with some years is counted as partial", r.partial === 1, String(r.partial));
  ok("capex ÷ revenue uses only companies with revenue every year", tech?.ratioCohort === 1 && Math.abs(tech.capexToRevenue[0] - 0.1) < 1e-12, JSON.stringify(tech?.capexToRevenue));
  ok("R&D has its own cohort", tech?.rndCohort === 1 && tech.rnd[0] === 100);
  ok("a July–June filer fills 2021..2025 from FY2022..FY2026's midpoints", ind?.cohort === 1 && ind.capex.every((v) => v === 7), JSON.stringify(ind));
  ok("another currency is counted, not dropped silently", r.otherCurrency === 1);
  ok("no sector: counted as unclassified, not placed", r.unclassified === 1 && !r.sectors.some((s) => s.top.includes("NOSEC")));
  ok("sector totals only, no grand total", Object.keys(r).sort().join() === "builtAt,companiesRead,duplicateListings,otherCurrency,partial,sectors,unclassified,v,years", Object.keys(r).sort().join());
  ok("sectors sort by latest capex", r.sectors[0].sector === "Technology");
  const moved = M.aggregateSpending([I("CHG", "Energy", [...cyYears(5), { s: "2025-01-01", e: "2025-03-31", capex: 999, revenue: 1, rnd: null }], { cik: "9" })], YEARS, NOW);
  ok("two years in one calendar year: the later-ending one is kept", moved.sectors[0].capex[4] === 5 * 1.4, JSON.stringify(moved.sectors[0].capex));
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, CORE), "utf8");
const base = await suite(await load(src));
if (base.length) {
  console.error("FAIL check-capex-spending:\n  " + base.join("\n  "));
  process.exit(1);
}
const mut = (label, from, to) => {
  if (!src.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return src.replace(from, () => to);
};
const MUTANTS = [
  ["fiscal year placed by its end, not its midpoint", () => mut("mid", "return new Date((start + end) / 2).getUTCFullYear();", "return new Date(end).getUTCFullYear();")],
  ["cohort of anyone with any capex", () => mut("cohort", "const cohort = rows.filter((r) => complete(r.capex));", "const cohort = rows.filter((r) => r.capex.some((v) => v !== null)).map((r) => ({ ...r, capex: r.capex.map((v) => v ?? 0) }));")],
  ["other currencies dropped silently", () => mut("cur", "if (input.currency && input.currency !== \"USD\") otherCurrency++;", "")],
  ["unclassified placed in a catch-all", () => mut("unc", "if (!input.sector) {\n      if (row.capex.some((v) => v !== null)) unclassified++;\n      continue;\n    }", "if (!input.sector) input.sector = \"Other\";")],
  ["listings not folded by filer", () => mut("dedupe", "const { kept: inputs, duplicates: duplicateListings } = dedupeByFiler(all);", "const inputs = all, duplicateListings = 0;")],
  ["SEC's listing order ignored", () => mut("rank", "(b.rank ?? Infinity) - (a.rank ?? Infinity) ||", "")],
  ["a grand total added", () => mut("total", "return { v: 1, builtAt: nowMs,", "return { total: sectors.length, v: 1, builtAt: nowMs,")],
  ["the earlier of two years kept", () => mut("order", "[...input.years].sort((a, b) => a.e.localeCompare(b.e))", "[...input.years].sort((a, b) => b.e.localeCompare(a.e))")],
];
let survived = 0;
for (const [label, make] of MUTANTS) {
  if (!(await suite(await load(make()))).length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-capex-spending: all assertions pass; ${MUTANTS.length} mutants caught`);
