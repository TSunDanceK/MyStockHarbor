// THE DILUTION CHART'S LONGER HISTORY AND HONEST SCALE (#552 COWORK #136).
//
//   1. quarters and fiscal-year averages merge on one axis (the year-ends no
//      quarter covers are filled), so AAPL's series spans years, not 9 quarters,
//      and the 3-year figure fills;
//   2. a fiscal-year figure outside its own quarters' range is refused as
//      another basis, and named; a slipped quarter does not widen that range
//      (ONDS, whose FY2025 annual count is itself a ×1000 slip);
//   3. a Q4 slot is filled from the fiscal year, dated at the year-end;
//   4. the headline: the move in words with an arrow, hedged, from the 3-year
//      figure, else since the first point; the footnote states the basis.
// A mutant per rule. The scale rule is check-dilution-axis's.
//
//   node scripts/check-share-history-years.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const ROOT = process.cwd();
const BUILDER = path.join(ROOT, "lib/server/secShareHistory.ts");
const COMPONENT = "app/components/DilutionHistory.tsx";
let seq = 0;
async function builder(mutate = (s) => s) {
  const tmp = BUILDER.replace(/\.ts$/, `.__mut${process.pid}_${seq++}.ts`);
  fs.writeFileSync(tmp, mutate(fs.readFileSync(BUILDER, "utf8")));
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
async function component(mutate = (s) => s) {
  const js = ts.transpileModule(mutate(fs.readFileSync(COMPONENT, "utf8")), {
    fileName: "d.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  const tmp = `scripts/.share-years-${process.pid}-${seq++}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${ROOT}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
const SI = SEC_FIELD_KEYS.indexOf("sharesBasic");

/** AAPL with one in-window fiscal year moved off its quarters by ×3 (another basis, e.g. ADS). */
function mixedBasis() {
  const s = structuredClone(fixture("AAPL"));
  // A year-end inside the quarter window with no quarterly share count (a Q4 slot).
  const qEnds = new Set(s.quarters.filter((q) => typeof q.v[SI] === "number").map((q) => q.e));
  const oldest = s.quarters.map((q) => q.e).sort()[0];
  const y = s.years.find((p) => !qEnds.has(p.e) && p.e > oldest);
  y.v[SI] = y.v[SI] * 3;
  return { set: s, date: y.e };
}

/** AAPL with its FY2025 Q4 row carrying a quarterly count: the quarter must win the date. */
function q4Filed() {
  const s = structuredClone(fixture("AAPL"));
  const fy = s.years[0];
  const q = s.quarters.find((p) => p.e === fy.e);
  q.v[SI] = fy.v[SI] * 0.99;
  return { set: s, date: fy.e, quarterVal: q.v[SI] };
}

/** A CRCL-shaped listing: first 10-Q for Jun 2025; FY2025's average mixes in pre-listing months. */
function newListing() {
  const q = (e, shares) => { const v = new Array(SEC_FIELD_KEYS.length).fill(null); v[SI] = shares; return { e, v, d: "" }; };
  return {
    quarters: [q("2026-06-30", 236e6), q("2026-03-31", 233e6), q("2025-12-31", null), q("2025-09-30", 229e6), q("2025-06-30", 222e6), q("2025-03-31", 120e6)],
    years: [], as: [["2024-12-31", 110e6], ["2025-12-31", 180e6]],
  };
}

async function measure(B, C) {
  const aapl = fixture("AAPL"), onds = fixture("ONDS");
  const mix = mixedBasis();
  const render = (h) => renderToStaticMarkup(React.createElement(C.default, { data: h, symbol: "X" }));
  return {
    aapl: B.buildShareHistory(aapl), aaplSet: aapl,
    onds: B.buildShareHistory(onds),
    mix: B.buildShareHistory(mix.set), mixDate: mix.date,
    listing: B.buildShareHistory(newListing(), { listedFrom: "2025-06-30" }),
    q4: (() => { const c = q4Filed(); return { h: B.buildShareHistory(c.set), ...c }; })(),
    render, C,
  };
}

const RULES = {
  "1. AAPL: quarters and fiscal years merged; spans 4+ years; the 3-year figure fills": (m) =>
    m.aapl.basis === "annual+quarters" && m.aapl.points.length > 9 &&
    (Date.parse(m.aapl.points.at(-1).date) - Date.parse(m.aapl.points[0].date)) / 864e5 > 4 * 365 &&
    m.aapl.threeYear?.pct !== null,
  "2a. a fiscal year off its own quarters' range is refused as another basis, and named": (m) =>
    m.mix.refusedYears?.includes(m.mixDate) && !m.mix.points.some((p) => p.date === m.mixDate) &&
    /fiscal-year figure is left out: outside the range of that year&#x27;s own quarterly figures/.test(m.render(m.mix)),
  "2b. ONDS: a slipped quarter does not admit its slipped fiscal year; the series still draws": (m) =>
    m.onds.points.length >= 9 && m.onds.refusedYears?.includes("2025-12-31") && !m.onds.withheld,
  "3. a Q4 slot is filled from the fiscal year, at the year-end, and only where no quarter is": (m) => {
    const qEnds = new Set(m.aaplSet.quarters.filter((q) => typeof q.v[SI] === "number").map((q) => q.e));
    const oldest = m.aaplSet.quarters.map((q) => q.e).sort()[0];
    const inWindow = (m.aapl.yearEnds ?? []).filter((d) => d >= oldest);
    const atQ4 = m.q4.h.points.filter((p) => p.date === m.q4.date);
    return inWindow.length >= 2 && inWindow.every((d) => !qEnds.has(d)) && new Set(m.aapl.points.map((p) => p.date)).size === m.aapl.points.length &&
      atQ4.length === 1 && atQ4[0].shares === m.q4.quarterVal && !(m.q4.h.yearEnds ?? []).includes(m.q4.date);
  },
  "3b. a fiscal year that began before the listing is left out; the listed series still draws (CRCL)": (m) =>
    !m.listing.withheld && m.listing.points.length >= 4 && !m.listing.points.some((p) => p.date === "2025-12-31") &&
    m.listing.points.every((p) => p.date >= "2025-06-30"),
  "4a. the headline: arrow and hedged words, from the 3-year figure": (m) =>
    m.C.shareHeadline(-9.1, -12, "Sept 2021") === "▼ Down 9.1% over the last 3 years, which may reflect buybacks" &&
    m.C.shareHeadline(98.9, null, null).startsWith("▲ Up 98.9% over the last 3 years") &&
    m.C.shareHeadline(0.4, null, null) === "≈ Share count roughly unchanged over the last 3 years" &&
    m.C.shareHeadline(null, -5.5, "Dec 2023") === "▼ Down 5.5% since Dec 2023, which may reflect buybacks",
  "4b. the headline renders above the chart, and the footnote names the basis": (m) => {
    const h = m.render(m.aapl);
    return h.indexOf("data-share-headline") > 0 && h.indexOf("data-share-headline") < h.indexOf("<svg") &&
      /quarterly averages plus \d+ fiscal-year averages/.test(h);
  },
};

const B0 = await builder(), C0 = await component();
const M0 = await measure(B0, C0);
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(M0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}

const MUTANTS = [
  ["fiscal years only before the first quarter (the old rule)", (s) => once(s, "    if (y.date >= firstQuarter) {", "    if (y.date >= firstQuarter) { continue;"), null],
  ["no basis check", (s) => once(s, "        if (y.shares < lo || y.shares > hi) { refusedYears.push(y.date); continue; }", ""), null],
  ["a slipped quarter widens the range", (s) => once(s, "const own = ownAll.filter((v) => v / mid <= SHARE_SCALE_MAX_STEP && mid / v <= SHARE_SCALE_MAX_STEP);", "const own = ownAll;"), null],
  ["a fiscal year drawn on top of a quarter's date", (s) => once(s, "    if (quarterDates.has(y.date)) continue;\n", ""), null],
  ["fiscal years kept whatever the listing date", (s) => once(s, "filedQuarters.has(p.date) || p.date < listedFrom || days(listedFrom, p.date) >= SHARE_YEAR_AFTER_LISTING_DAYS", "true"), null],
  ["the headline without its arrow", null, (s) => once(s, "`▼ Down ${", "`Down ${")],
  ["the footnote's basis dropped", null, (s) => once(s, "quarterly averages plus{\" \"}", "quarters plus{\" \"}")],
];
for (const [label, bm, cm] of MUTANTS) {
  let bites = false;
  try {
    const Mm = await measure(bm ? await builder(bm) : B0, cm ? await component(cm) : C0);
    bites = Object.values(RULES).some((r) => { try { return !r(Mm); } catch { return true; } });
  } catch { bites = true; }
  check(`MUTATION: ${label} → caught`, bites);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
