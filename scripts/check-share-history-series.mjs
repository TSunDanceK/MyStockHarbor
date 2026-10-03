// THE DILUTION CHART'S SERIES IS CORRECTED BEFORE IT IS DRAWN (#552 COWORK #88/#89).
//
// Replaces the interim guard (#673), which only withheld the figures. Series
// shapes are the CODE-A #94 probe's own (SEC share counts):
//   1. AMZN's 20:1 split WITH the filer's restatement on file -> earlier years
//      scaled ×20, no step left, the note names the split.
//   2. the same series WITHOUT a restatement -> the chart starts after the step.
//   3. PAC ×1000 from 2017, NVDA's thousands -> the clean (latest) segment only.
//   4. GDDY: pre-listing 2013–2014 dropped; the 2016 -> 2023 hole breaks the
//      line ("no filing data"); no base within 6 months of the 3-year cut ->
//      "Recent history too short".
//   5. a steady diluter / a buyback -> the 3-year figure, its colour and its
//      hedged words; "Since" in plain ink beside it.
//   plus MUTATIONS, one per rule.
//
//   node scripts/check-share-history-series.mjs
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
const BUILDER = "lib/server/secShareHistory.ts";
const COMPONENT = "app/components/DilutionHistory.tsx";
let seq = 0;
async function builder(mutate = (s) => s) {
  const abs = path.join(ROOT, BUILDER);
  const tmp = abs.replace(/\.ts$/, `.__mut${process.pid}_${seq++}.ts`);
  fs.writeFileSync(tmp, mutate(fs.readFileSync(abs, "utf8")));
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
async function component(mutate = (s) => s) {
  const js = ts.transpileModule(mutate(fs.readFileSync(COMPONENT, "utf8")), {
    fileName: "dilution.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  const tmp = `scripts/.share-series-${process.pid}-${seq++}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${ROOT}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
/** A minimal stored set: annual points only (`as`), plus the restatement evidence. */
const set = (pairs, asr, asf) => ({ as: pairs, quarters: [], years: [], ...(asr ? { asr } : {}), ...(asf ? { asf } : {}) });
// AAPL's 4:1 (2020), crossed by a year of buybacks: the step reads 3.80.
const AAPL = [["2015-09-26", 5753421000], ["2016-09-24", 5470820000], ["2017-09-30", 5217242000], ["2018-09-29", 19821510000], ["2019-09-28", 18471336000], ["2020-09-26", 17352119000]];
// A real doubling (an offering year), its earlier year re-filed unchanged.
const ISSUER = [["2020-12-31", 50e6], ["2021-12-31", 52e6], ["2022-12-31", 104e6], ["2023-12-31", 110e6], ["2024-12-31", 116e6]];
const AMZN = [["2017-12-31", 480e6], ["2018-12-31", 487e6], ["2019-12-31", 494e6], ["2020-12-31", 10005e6], ["2021-12-31", 10117e6], ["2022-12-31", 10189e6]];
const PAC = [["2015-12-31", 525575547], ["2016-12-31", 525575547], ["2017-12-31", 525575547000], ["2018-12-31", 525575547000], ["2019-12-31", 525575547000]];
const NVDA = [["2008-01-27", 550108], ["2009-01-25", 548126], ["2010-01-31", 549574000], ["2011-01-30", 575177000], ["2012-01-29", 602000000]];
const GDDY = [["2013-12-31", 38826000], ["2014-12-31", 38826000], ["2015-12-31", 58676000], ["2016-12-31", 79835000], ["2023-12-31", 148296000], ["2024-06-30", 141269000], ["2024-09-30", 140523000]];
const DILUTER = [["2019-12-31", 100e6], ["2020-12-31", 106e6], ["2021-12-31", 112e6], ["2022-12-31", 118e6], ["2023-12-31", 125e6]];
const BUYBACK = [["2019-12-31", 125e6], ["2020-12-31", 120e6], ["2021-12-31", 115e6], ["2022-12-31", 110e6], ["2023-12-31", 105e6]];

const B = await builder();
const C = await component();
const render = (M, h) => renderToStaticMarkup(React.createElement(M.default, { data: h, symbol: "X" }));

// ── the rules, over one load of each module ────────────────────────────────
const RULES = {
  "1. AMZN with its 20:1 restatement: earlier years ×20, no step left, the split noted": (b, c) => {
    const h = b.buildShareHistory(set(AMZN, [["2020-12-31", 20.01]]));
    return h && h.points.length === 6 && Math.abs(h.points[2].shares - 494e6 * 20) < 1 && h.splits?.[0]?.ratio === 20 && !h.startedAfter
      && h.points.slice(1).every((p, i) => b.splitRatioOf(p.shares / h.points[i].shares) === null)
      && /adjusted for a 20-for-1 split/.test(render(c, h));
  },
  "1b. AAPL: a 3.80 step against a proven 4:1 is scaled by 4 (buybacks mixed into the split year)": (b) => {
    const h = b.buildShareHistory(set(AAPL, [["2018-09-29", 4], ["2019-09-28", 4]]));
    return h && h.splits?.[0]?.ratio === 4 && h.points[2].shares === 5217242000 * 4 && !h.startedAfter;
  },
  "1c. an old proven split never explains a new step (2:1 proven in 2012, a 2.0x step in 2022 unproven)": (b) => {
    const h = b.buildShareHistory(set(ISSUER, [["2012-12-31", 2]]));
    return h && h.startedAfter?.reason === "unexplained-split-step" && h.points[0].date === "2022-12-31";
  },
  "1d. a doubling whose earlier year was re-filed unchanged is real issuance: kept": (b) => {
    const h = b.buildShareHistory(set(ISSUER, undefined, ["2021-12-31"]));
    return h && h.points.length === 5 && !h.startedAfter && !h.splits;
  },
  "2. the same series with NO restatement on file: starts after the step, nothing scaled": (b) => {
    const h = b.buildShareHistory(set(AMZN));
    return h && h.points[0].date === "2020-12-31" && h.startedAfter?.reason === "unexplained-split-step" && !h.splits;
  },
  "3. PAC ×1000 and NVDA's thousands: the clean latest segment only": (b) => {
    const p = b.buildShareHistory(set(PAC)), n = b.buildShareHistory(set(NVDA));
    return p && p.points[0].date === "2017-12-31" && p.startedAfter?.reason === "scale-step"
      && n && n.points[0].date === "2010-01-31" && n.startedAfter?.reason === "scale-step";
  },
  "4a. GDDY: pre-listing points dropped (first report 2015-03-31)": (b) => {
    const h = b.buildShareHistory(set(GDDY), { listedFrom: "2015-03-31" });
    return h && h.points[0].date === "2015-12-31" && h.startedAfter?.reason === "listing";
  },
  "4b. GDDY: the 2016 -> 2023 hole breaks the line, labelled \"no filing data\"": (b, c) => {
    const h = b.buildShareHistory(set(GDDY), { listedFrom: "2015-03-31" });
    const html = render(c, h);
    return h?.gaps?.length === 1 && h.gaps[0].from === "2016-12-31" && (html.match(/data-share-segment/g) ?? []).length === 2 && /no filing data/.test(html);
  },
  "4c. GDDY: no base within 6 months of the 3-year cut -> \"Recent history too short\"": (b, c) => {
    const h = b.buildShareHistory(set(GDDY), { listedFrom: "2015-03-31" });
    return h?.threeYear?.pct === null && /Recent history too short/.test(render(c, h));
  },
  "5. a diluter reads risen (red), a buyback fallen (green); Since sits beside it in plain ink": (b, c) => {
    const d = b.buildShareHistory(set(DILUTER)), k = b.buildShareHistory(set(BUYBACK));
    const hd = render(c, d), hk = render(c, k);
    return Math.abs(d.threeYear.pct - ((125 - 106) / 106) * 100) < 1e-9 && /Share count has risen over the last 3 years/.test(hd) && /color:#ef4444/.test(hd)
      && /Share count has fallen over the last 3 years/.test(hk) && /color:#22c55e/.test(hk) && /Since Dec 2019/.test(hd);
  },
};
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(B, C)); } catch (e) { ok = false; }
  check(name, ok);
}

const caught = async (bm, cm) => {
  const b = bm ? await builder(bm) : B, c = cm ? await component(cm) : C;
  return Object.values(RULES).some((r) => { try { return !r(b, c); } catch { return true; } });
};
const MUTANTS = [
  ["a split-like step scaled with no restatement on file", (s) => once(s, "    if (refiled.includes(pts[i - 1].date)) continue;\n    {", "    if (refiled.includes(pts[i - 1].date)) continue;\n    if (true) { for (let j = 0; j < i; j++) pts[j] = { ...pts[j], shares: pts[j].shares * k }; continue; }\n    {"), null],
  ["the proven-split date window removed", (s) => once(s, "x.e > pts[i - 1].date && x.e <= plusYears(pts[i].date, SHARE_PROVEN_SPLIT_YEARS)\n      && ", ""), null],
  ["the loose match for a proven split removed", (s) => once(s, "Math.abs(r / x.k - 1) < SHARE_PROVEN_SPLIT_TOLERANCE", "Math.abs(r / x.k - 1) < SHARE_SPLIT_TOLERANCE"), null],
  ["re-filed periods ignored", (s) => once(s, "    if (refiled.includes(pts[i - 1].date)) continue;\n", ""), null],
  ["the >100× guard removed", (s) => once(s, "if (r > SHARE_SCALE_MAX_STEP || r < 1 / SHARE_SCALE_MAX_STEP) {", "if (false) {"), null],
  ["pre-listing points kept", (s) => once(s, "  if (listedFrom) {", "  if (false) {"), null],
  ["the 6-month base window removed", (s) => once(s, "days(base.date, cut) > SHARE_TREND_BASE_MAX_DAYS || ", ""), null],
  ["the line drawn across a gap", null, (s) => once(s, "if (gapStarts.has(c.p.date)) segments.push([]);", "")],
  ["the colour from first-vs-last again", null, (s) => once(s, "const trend = threeYearWords(threePct);", "const trend = threeYearWords(changePercent);")],
];
for (const [label, bm, cm] of MUTANTS) check(`MUTATION: ${label} → caught`, await caught(bm, cm));

// THE LAYOUT (#552 COWORK #88 §1): the chart and the learn links FULL WIDTH
// after the clear; phones read description -> dilution -> stats -> links.
const PROFILE = fs.readFileSync("app/components/CompanyProfile.tsx", "utf8");
const layout = (src) =>
  /<div className="cp-clear" \/>\s*\{belowDescription \? <div className="cp-full cp-full-chart">\{belowDescription\}<\/div> : null\}\s*\{belowStats \? <div className="cp-full cp-full-learn">\{belowStats\}<\/div> : null\}/.test(src)
  && /\.cp-desc \{ order: 1; \}\s*\.cp-full-chart \{ order: 2; \}\s*\.cp-stats \{ order: 3; \}\s*\.cp-full-learn \{ order: 4;/.test(src)
  && !/cp-below-desc/.test(src);
check("layout: the chart, then Learn the indicators, full width after the clear; phones description -> dilution -> stats -> links", layout(PROFILE));
check("MUTATION: the chart back beside the float (before the clear) → caught",
  !layout(once(PROFILE, `<div className="cp-clear" />\n          {belowDescription ? <div className="cp-full cp-full-chart">{belowDescription}</div> : null}`, `{belowDescription ? <div className="cp-full cp-full-chart">{belowDescription}</div> : null}\n          <div className="cp-clear" />`)));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
