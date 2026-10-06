// WHY "COMING UP" IS THIN, AND WHAT WIDENING THE CUT WOULD ADD (#552 COWORK #180).
//
// READ-ONLY. It runs the SHIPPED due strip and expected section (dueToReport,
// dueInputs, expectedToReport, the grid's week windows) over the LIVE
// report-date records, and prints:
//
//   1. the committed 50: each symbol's state, and for every one not on the
//      grid, the named reason (no record / thin history / below the bar, with
//      the 6-K filers named / beyond the window / past the grid's fourth week /
//      already due);
//   2. named large names (JPM, BAC, WFC, GS, JNJ, PEP) wherever they sit;
//   3. a fresh market-cap ranking of the analysis universe (the price pool,
//      one HMGET), cut at 100 and 150, with the same rule and the same bar:
//      how many rows each would ADD to the grid, and which;
//   4. the command cost per forward-section build for each cut, as GETs (as
//      shipped) and as one MGET.
//
// Commands: 1 GET (universe) + 1 HMGET (pool) + up to ~200 GETs (records).
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly, grabConst } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const NAMED = (process.env.NAMED || "JPM BAC WFC GS JNJ PEP").split(/\s+/).filter(Boolean);
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const unexport = (s) => s.replace(/export (const|function|type|async function)/g, "$1");

// ── THE SHIPPED MODULES, LIFTED ─────────────────────────────────────────────
const rdFile = "lib/server/secReportDates.ts";
const rdSrc = readCodeOnly(rdFile);
const deadlinePieces = [grabConst(rdFile, "FILING_DEADLINE_DAYS"), grabConst(rdFile, "DEADLINE_FALLBACK"), grabFunction(rdSrc, "deadlineDays")];
if (deadlinePieces.some((x) => !x)) { console.error("FATAL: the deadline table moved in secReportDates.ts"); process.exit(2); }
const due = await lift(
  deadlinePieces.join("\n").replace(/^export /gm, "") + "\n" + unexport(strip("lib/server/dueToReport.ts")) +
  "\nexport { selectDue };", "", "dueToReport");
const diSrc = readCodeOnly("lib/server/dueInputs.ts");
const di = await lift(
  ["const ANNUAL_WHEN_UNKNOWN = true;", grabFunction(diSrc, "dueInputFrom"), grabFunction(diSrc, "buildDueInputs")].join("\n").replace(/^export /gm, "") +
  "\nexport { buildDueInputs };", "", "dueInputs");
const exp = await lift(unexport(strip("lib/server/expectedToReport.ts")) +
  "\nexport { buildExpected, lagsFrom, lagHabit, PRECISION_BAR_DOMESTIC, PRECISION_BAR_FPI, EXPECTED_WINDOW_DAYS };", "", "expectedToReport");
const wk = await lift(unexport(strip("lib/server/earningsWeek.ts")) + "\nexport { comingUpColumns, addDays };", "", "earningsWeek");

const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const PICKERS_SYMBOLS_KEY = keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY");
const POOL_KEY = keyOf("lib/server/pricePool.ts", "PRICE_POOL_KEY");
const DATES_PREFIX = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const CUT50 = JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols;
const dashed = (s) => s.replace(/\./g, "-");

let commands = 0;
const universe = await redis.get(PICKERS_SYMBOLS_KEY); commands++;
if (!Array.isArray(universe) || !universe.length) { console.error("FATAL: no universe list"); process.exit(2); }
const fields = [...new Set(universe.map(dashed))];
const rawPool = await redis.hmget(POOL_KEY, ...fields); commands++;
const capOf = new Map();
fields.forEach((f, i) => {
  const row = Array.isArray(rawPool) ? rawPool[i] : rawPool?.[f];
  const c = row && typeof row === "object" ? Number(row.marketCap) : NaN;
  if (Number.isFinite(c) && c > 0) capOf.set(f, c);
});
const ranked = [...capOf.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
console.log(`today ${TODAY} · universe ${universe.length} · with a pool market cap ${capOf.size}`);

const want = [...new Set([...CUT50, ...ranked.slice(0, 150).map((s) => s), ...NAMED])];
const records = new Map();
for (const s of want) {
  const rec = await redis.get(`${DATES_PREFIX}:${s.toUpperCase()}`); commands++;
  records.set(s, rec && typeof rec === "object" && Array.isArray(rec.events) ? rec : null);
}

/** The shipped forward sections over one cut, and where each symbol lands. */
function forward(cut) {
  const { inputs } = di.buildDueInputs(cut, records);
  const dueEntries = due.selectDue(inputs, TODAY);
  const alreadyDue = new Set(dueEntries.map((e) => e.symbol));
  const built = exp.buildExpected(cut, records, TODAY, alreadyDue);
  const rows = built.rows.map((r) => ({ symbol: r.symbol, estimatedOn: wk.addDays(TODAY, r.daysAway), cap: capOf.get(dashed(r.symbol)) ?? null, daysAway: r.daysAway }));
  const cols = wk.comingUpColumns(rows, TODAY, { thisWeekHasDue: dueEntries.length > 0 });
  const onGrid = new Set(cols.flatMap((c) => c.items.map((x) => x.symbol)));
  const reason = new Map();
  for (const [why, syms] of Object.entries(built.skipped)) for (const s of syms) reason.set(s, why);
  for (const r of rows) if (!onGrid.has(r.symbol)) reason.set(r.symbol, `past the grid's last week (estimate in ${r.daysAway} days)`);
  for (const s of alreadyDue) reason.set(s, "shown: due (period ended, not filed yet)");
  for (const s of onGrid) reason.set(s, "shown: on the grid");
  return { dueEntries, built, rows, cols, onGrid, reason };
}

/** One line of evidence for a symbol: its period, habit and bar. */
function evidence(s) {
  const rec = records.get(s);
  if (!rec) return "no record";
  const h = exp.lagHabit(rec);
  const bar = h.isFpi ? exp.PRECISION_BAR_FPI : exp.PRECISION_BAR_DOMESTIC;
  const prec = h.scored ? h.scored.precision.toFixed(2) : "n/a";
  const est = rec.nextPeriodEnd && h.medianLagDays != null ? wk.addDays(rec.nextPeriodEnd, h.medianLagDays) : null;
  return `${h.isFpi ? "6-K filer" : "10-Q filer"} · next period ${rec.nextPeriodEnd ?? "none"} · median lag ${h.medianLagDays ?? "n/a"}d over ${h.fromPeriods ?? 0} · precision ${prec} vs bar ${bar}${est ? ` · would estimate ${est}` : ""}`;
}
const label = (why, s) => why === "below-precision-bar" && exp.lagHabit(records.get(s)).isFpi ? "below the bar (6-K filer, higher bar)" : why;

// ── 1. THE COMMITTED 50 ─────────────────────────────────────────────────────
const f50 = forward(CUT50);
console.log(`\n1. THE COMMITTED 50 (data/due-strip.json): ${f50.onGrid.size} on the grid, ${f50.dueEntries.length} due, ${f50.built.rows.length} estimated in the 30-day window`);
const tally = {};
for (const s of CUT50) {
  const why = label(f50.reason.get(s) ?? "unaccounted", s);
  tally[why] = (tally[why] ?? 0) + 1;
}
for (const [why, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)}  ${why}`);
console.log("\n   NOT SHOWN, one line each:");
for (const s of CUT50) {
  const why = f50.reason.get(s) ?? "unaccounted";
  if (why.startsWith("shown")) continue;
  console.log(`   ${s.padEnd(6)} ${label(why, s).padEnd(38)} ${evidence(s)}`);
}

// ── 2. THE NAMED ONES ───────────────────────────────────────────────────────
console.log("\n2. THE NAMED LARGE NAMES");
const rank = (s) => { const i = ranked.indexOf(dashed(s)); return i < 0 ? "unranked" : `#${i + 1} by cap`; };
for (const s of NAMED) {
  const inCut = CUT50.includes(s);
  const why = inCut ? label(f50.reason.get(s) ?? "unaccounted", s) : "NOT IN THE COMMITTED 50";
  console.log(`   ${s.padEnd(6)} ${rank(s).padEnd(12)} ${why.padEnd(38)} ${evidence(s)}`);
}

// ── 3. WIDENING ─────────────────────────────────────────────────────────────
console.log("\n3. WIDENING, SAME RULE AND SAME BAR (fresh ranking: the price pool's market cap)");
const fresh50 = ranked.slice(0, 50);
const drift = CUT50.filter((s) => !fresh50.includes(dashed(s)));
console.log(`   the committed 50 vs today's top 50: ${drift.length} differ (${drift.join(" ") || "none"})`);
const base = new Set([...f50.onGrid, ...f50.dueEntries.map((e) => e.symbol)]);
for (const n of [100, 150]) {
  const cut = [...new Set([...CUT50, ...ranked.slice(0, n)])];
  const f = forward(cut);
  const shown = new Set([...f.onGrid, ...f.dueEntries.map((e) => e.symbol)]);
  const added = [...shown].filter((s) => !base.has(s));
  const t = {};
  for (const s of cut) { const why = label(f.reason.get(s) ?? "unaccounted", s); t[why] = (t[why] ?? 0) + 1; }
  console.log(`\n   TOP ${n} (+ the committed 50 kept): ${cut.length} considered · ${shown.size} shown (${f.onGrid.size} grid, ${f.dueEntries.length} due) · +${added.length} vs today`);
  for (const [why, k] of Object.entries(t).sort((a, b) => b[1] - a[1])) console.log(`      ${String(k).padStart(3)}  ${why}`);
  for (const c of f.cols) {
    const extra = c.items.filter((x) => !base.has(x.symbol)).map((x) => x.symbol);
    console.log(`      ${c.label.padEnd(16)} ${c.range.padEnd(14)} ${String(c.items.length).padStart(3)} rows, +${extra.length}: ${extra.join(" ")}`);
  }
  const noRec = cut.filter((s) => !records.get(s));
  console.log(`      no report-date record yet: ${noRec.length}${noRec.length ? ` (${noRec.slice(0, 40).join(" ")}${noRec.length > 40 ? " …" : ""})` : ""}`);
}

// ── 4. COST ─────────────────────────────────────────────────────────────────
console.log("\n4. COMMAND COST PER FORWARD-SECTION BUILD (the page memoises a build 5 min per warm instance)");
for (const n of [50, 100, 150]) {
  const perBuild = n + 1;
  console.log(`   cut ${String(n).padStart(3)}: as shipped ${perBuild} commands/build (${n} GETs + 1 universe GET) · as one MGET: 2 · per always-warm instance/day: ${perBuild * 288} shipped vs ${2 * 288} MGET`);
}
console.log(`\nthis census used ${commands} commands.`);
